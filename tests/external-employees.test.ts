/**
 * A külsős dolgozók tesztjei (specs/external-employees.md): a képességeik a
 * projektekre és a munkanaplóra szűkülnek, és a rájuk vonatkozó szervezeti
 * műveletek (szabadság, kiküldetés) hibát adnak.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	EXTERNAL_EMPLOYEE_ERROR,
	getMyCapabilities,
	hasCapability,
	requireSelfOrCapability
} from '../server/permissions.ts';
import { setLeaveBalance } from '../server/leave.ts';
import type { RemoteContext } from '../server/context.ts';

const ROLE_CAPS = ['leave.request', 'trip.record', 'employee.view', 'project.view.own', 'work.log'];

/**
 * Ál-kontextus: a hívó (user 7) szerepei `ROLE_CAPS`-t adják a 3-as szervezetben,
 * és `external` szerint külsős. A 9-es dolgozó (user 9) külsős.
 */
function fakeContext(opts: { external: boolean }) {
	const writes: string[] = [];
	const query = async (sql: string, params: unknown[] = []) => {
		if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
			writes.push(sql.trim().split(/\s+/)[0]);
			return { rows: [{ id: 1 }] };
		}
		if (sql.includes('DISTINCT rc.capability')) {
			return { rows: ROLE_CAPS.map((capability) => ({ capability })) };
		}
		if (sql.includes('wp_member_roles mr') && sql.includes('rc.capability = $3')) {
			return { rows: ROLE_CAPS.includes(String(params[2])) || String(params[2]) === 'leave.balance.manage' ? [{ ok: 1 }] : [] };
		}
		if (sql.includes('FROM app__racona_work.employees') && sql.includes('user_id = $2')) {
			return { rows: [{ is_external: opts.external }] };
		}
		if (sql.includes('FROM app__racona_work.employees WHERE id = $1')) {
			return { rows: [{ organization_id: 3, user_id: 9, is_external: true }] };
		}
		return { rows: [] };
	};
	const context = {
		pluginId: 'racona-work',
		userId: 7,
		permissions: [],
		db: { query, connect: async () => ({ query, release: () => {} }) }
	} as unknown as RemoteContext;
	return { context, writes };
}

describe('külsős dolgozó képességei', () => {
	test('csak a projekt- és munkanapló-képességek maradnak, isExternal jelzéssel', async () => {
		const { context } = fakeContext({ external: true });
		const result = await getMyCapabilities({ organizationId: 3 }, context);
		expect(result.isExternal).toBe(true);
		expect(result.capabilities.sort()).toEqual(['project.view.own', 'work.log']);
	});

	test('belsős dolgozónál a szerepek minden képessége megmarad', async () => {
		const { context } = fakeContext({ external: false });
		const result = await getMyCapabilities({ organizationId: 3 }, context);
		expect(result.isExternal).toBe(false);
		expect(result.capabilities.sort()).toEqual([...ROLE_CAPS].sort());
	});

	test('a hasCapability a projekten kívüli képességre hamis', async () => {
		const { context } = fakeContext({ external: true });
		expect(await hasCapability(context, 3, 'leave.request')).toBe(false);
		expect(await hasCapability(context, 3, 'trip.record')).toBe(false);
		expect(await hasCapability(context, 3, 'work.log')).toBe(true);
		expect(await hasCapability(context, 3, 'project.view.own')).toBe(true);
	});
});

describe('külsős dolgozóra vonatkozó műveletek', () => {
	test('a saját adatokon keresztüli műveletek hibát adnak', async () => {
		const { context } = fakeContext({ external: false });
		await expect(requireSelfOrCapability(context, 9, 'employee.view')).rejects.toThrow(EXTERNAL_EMPLOYEE_ERROR);
	});

	test('külsős dolgozónak nem állítható szabadságkeret', async () => {
		const { context, writes } = fakeContext({ external: false });
		await expect(
			setLeaveBalance({ employeeId: 9, organizationId: 3, year: 2026, totalDays: 20 }, context)
		).rejects.toThrow(EXTERNAL_EMPLOYEE_ERROR);
		expect(writes).toEqual([]);
	});
});
