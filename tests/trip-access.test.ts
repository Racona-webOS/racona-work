/**
 * Kiküldetések — ki mit tehet más útjával és rendelvényével (specs/business-trips.md,
 * 11. fejezet). A felület (trips/access.ts) ugyanezt a szabályt követi.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { deleteTrip } from '../server/trips.ts';
import { reopenSettlement, withdrawSettlement } from '../server/trip-settlements.ts';
import { SELF_DECISION_ERROR } from '../server/permissions.ts';
import { canWriteTripsOf } from '../src/components/trips/access.ts';
import type { RemoteContext } from '../server/context.ts';

/**
 * A 3-as szervezet 40-es dolgozója (Anna) a 9-es felhasználó; a 77-es út és az
 * 500-as rendelvény az övé. A 7-es felhasználó a HR.
 */
function fakeContext(opts: { caps: string[]; userId: number; settlementStatus?: string }) {
	const writes: string[] = [];
	const query = async (sql: string, params: unknown[] = []) => {
		if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
			writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
			// Üres eredmény: az állapotváltás „már nem aktuális” hibát ad, de a jogosultság átment
			return { rows: [] };
		}
		if (sql.includes('rc.capability = $3')) return { rows: opts.caps.includes(String(params[2])) ? [{ ok: 1 }] : [] };
		if (sql.includes('SELECT is_external FROM')) return { rows: [{ is_external: false }] };
		if (sql.includes('SELECT user_id FROM app__racona_work.employees WHERE id = $1')) return { rows: [{ user_id: 9 }] };
		if (sql.includes('FROM app__racona_work.employees e') && sql.includes('WHERE e.id = $1')) {
			return { rows: [{ id: 40, organization_id: 3, user_id: 9, name: 'Anna' }] };
		}
		if (sql.includes('FROM app__racona_work.trip_settlements s') && sql.includes('WHERE s.id = $1')) {
			return {
				rows: [{ id: 500, organization_id: 3, employee_id: 40, vehicle_id: 1, year: 2026, month: 9, status: opts.settlementStatus ?? 'submitted' }]
			};
		}
		if (sql.includes('FROM app__racona_work.trips t') && sql.includes('WHERE t.id = $1')) {
			return {
				rows: [{
					id: 77, organization_id: 3, employee_id: 40, vehicle_id: 1, plate_number: 'ABC123',
					started_local: '2026-09-10T08:00', ended_local: '2026-09-10T12:00', purpose: '',
					waypoints: [], return_mode: 'origin', distance_km: 10, settlement_status: null
				}]
			};
		}
		return { rows: [] };
	};
	const context = {
		pluginId: 'racona-work',
		userId: opts.userId,
		permissions: [],
		db: { query, connect: async () => ({ query, release: () => {} }) }
	} as unknown as RemoteContext;
	return { context, writes };
}

const EMPLOYEE = ['trip.record'];
const APPROVER = ['trip.record', 'trip.approve'];
const HR = ['trip.record', 'trip.approve', 'trip.manage'];

describe('más dolgozó útja', () => {
	test('jóváhagyó joggal nem törölhető, kezelés joggal igen', async () => {
		const approver = fakeContext({ caps: APPROVER, userId: 7 });
		await expect(deleteTrip({ id: 77 }, approver.context)).rejects.toThrow('Nincs jogosultságod');
		expect(approver.writes).toEqual([]);

		const hr = fakeContext({ caps: HR, userId: 7 });
		await deleteTrip({ id: 77 }, hr.context);
		expect(hr.writes).toEqual(['DELETE FROM app__racona_work.trips']);
	});

	test('a felület ugyanígy dönt: saját út, vagy bárkié kezelés joggal', () => {
		expect(canWriteTripsOf({ canApprove: false, canManage: false, employeeId: 40 }, 40)).toBe(true);
		expect(canWriteTripsOf({ canApprove: true, canManage: false, employeeId: 41 }, 40)).toBe(false);
		expect(canWriteTripsOf({ canApprove: true, canManage: false, employeeId: null }, 40)).toBe(false);
		expect(canWriteTripsOf({ canApprove: false, canManage: true, employeeId: 41 }, 40)).toBe(true);
	});
});

describe('beküldés visszavonása', () => {
	test('a dolgozó a sajátját visszavonhatja', async () => {
		const { context, writes } = fakeContext({ caps: EMPLOYEE, userId: 9 });
		await expect(withdrawSettlement({ id: 500 }, context)).rejects.toThrow('Csak beküldött');
		expect(writes).toEqual(['UPDATE app__racona_work.trip_settlements SET']);
	});

	test('a HR más rendelvényét nem vonhatja vissza (visszaküldeni tudja)', async () => {
		const { context, writes } = fakeContext({ caps: HR, userId: 7 });
		await expect(withdrawSettlement({ id: 500 }, context)).rejects.toThrow('Nincs jogosultságod');
		expect(writes).toEqual([]);
	});
});

describe('visszanyitás', () => {
	test('a HR más jóváhagyott rendelvényét visszanyithatja', async () => {
		const { context, writes } = fakeContext({ caps: HR, userId: 7, settlementStatus: 'approved' });
		await expect(reopenSettlement({ id: 500, note: 'Rossz km' }, context)).rejects.toThrow('Csak jóváhagyott');
		expect(writes).toEqual(['UPDATE app__racona_work.trip_settlements SET']);
	});

	test('a saját rendelvényét nem nyithatja vissza', async () => {
		const { context, writes } = fakeContext({ caps: HR, userId: 9, settlementStatus: 'approved' });
		await expect(reopenSettlement({ id: 500, note: 'Rossz km' }, context)).rejects.toThrow(SELF_DECISION_ERROR);
		expect(writes).toEqual([]);
	});

	test('jóváhagyó joggal (kezelés nélkül) nem nyitható vissza', async () => {
		const { context } = fakeContext({ caps: APPROVER, userId: 7, settlementStatus: 'approved' });
		await expect(reopenSettlement({ id: 500, note: 'Rossz km' }, context)).rejects.toThrow('Nincs jogosultságod');
	});
});
