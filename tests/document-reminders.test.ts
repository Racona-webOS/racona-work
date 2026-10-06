/**
 * Dolgozói dokumentumok 2. ütem (specs/employee-documents.md, K9–K11):
 * emlékeztetők esedékessége és szövege, a dokumentumproblémák számítása,
 * és a napi futás (címzettek, egyszeri küldés).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	dueReminder,
	expiryPhrase,
	formatDayLabel,
	runDocumentRemindersForAll
} from '../server/document-reminders.ts';
import { countIssues, loadDocumentIssues } from '../server/document-overview.ts';
import { NOTIFICATION_EVENT_DEFAULTS } from '../server/notification-settings.ts';
import type { RemoteContext } from '../server/context.ts';

describe('dueReminder', () => {
	test('az emlékeztető napjain esedékes, előtte nem', () => {
		expect(dueReminder(31, [30, 7], [])).toBeNull();
		expect(dueReminder(30, [30, 7], [])).toEqual({ offset: 30, markOffsets: [30] });
		expect(dueReminder(7, [30, 7], [30])).toEqual({ offset: 7, markOffsets: [30, 7] });
		expect(dueReminder(0, [30, 7], [30, 7])).toEqual({ offset: 0, markOffsets: [30, 7, 0] });
	});

	test('egy eltolásra egyszer', () => {
		expect(dueReminder(20, [30, 7], [30])).toBeNull();
		expect(dueReminder(-3, [30, 7], [30, 7, 0])).toBeNull();
	});

	test('kimaradt futás után a legsürgősebb elért eltolás megy, a korábbiak küldöttnek számítanak', () => {
		expect(dueReminder(5, [30, 7], [])).toEqual({ offset: 7, markOffsets: [30, 7] });
		expect(dueReminder(-10, [30, 7], [])).toEqual({ offset: 0, markOffsets: [30, 7, 0] });
	});

	test('emlékeztető nélkül csak a lejárat napján', () => {
		expect(dueReminder(3, [], [])).toBeNull();
		expect(dueReminder(0, [], [])).toEqual({ offset: 0, markOffsets: [0] });
	});
});

describe('szövegek', () => {
	test('dátum', () => {
		expect(formatDayLabel('2026-10-20', 'hu')).toBe('2026. 10. 20.');
		expect(formatDayLabel('2026-10-20', 'en')).toBe('20 Oct 2026');
	});

	test('állapot', () => {
		expect(expiryPhrase(14, '2026-10-20', 'hu')).toBe('14 nap múlva lejár (2026. 10. 20.)');
		expect(expiryPhrase(0, '2026-10-20', 'hu')).toBe('ma lejár (2026. 10. 20.)');
		expect(expiryPhrase(-1, '2026-10-20', 'hu')).toBe('lejárt (2026. 10. 20.)');
		expect(expiryPhrase(1, '2026-10-20', 'en')).toBe('expires in 1 day (20 Oct 2026)');
	});

	test('a HR összesítő emailje alapból be, a dolgozóé alapból ki', () => {
		expect(NOTIFICATION_EVENT_DEFAULTS['document.expiring']).toBe(true);
		expect(NOTIFICATION_EVENT_DEFAULTS['document.expiringEmployee']).toBe(false);
	});
});

// --- Ál-adatbázis ------------------------------------------------------------------

/**
 * A 3-as szervezet két dolgozója: 40 (Anna, user 9) és 41 (Béla, külsős, user 10).
 * Kötelező típusok: 1 (Munkaszerződés), 3 (Orvosi). Anna dokumentumai:
 * - 100 munkaszerződés fájllal,
 * - 101 orvosi alkalmassági, 2026-10-13-ig (7 nap), fájl nélkül.
 * Béla dokumentuma: 102 erkölcsi, lejárt 2026-10-01-én (fájl nélküli típus).
 */
function fakeDb(opts: { sent?: Record<number, number[]> } = {}) {
	const inserts: { sql: string; params: unknown[] }[] = [];
	const query = async (sql: string, params: unknown[] = []) => {
		if (/^\s*INSERT/i.test(sql)) {
			inserts.push({ sql, params });
			return { rows: [] };
		}
		if (sql.includes("e.status <> 'inactive'") && sql.includes('FROM app__racona_work.employees e')) {
			return {
				rows: [
					{ id: 40, is_external: false, name: 'Anna' },
					{ id: 41, is_external: true, name: 'Béla' }
				]
			};
		}
		if (sql.includes('EXISTS (SELECT 1 FROM app__racona_work.employee_document_files')) {
			return {
				rows: [
					{ id: 100, employee_id: 40, title: 'Munkaszerződés', type_id: 1, valid_day: null, type_name: 'Munkaszerződés', file_mode: 'required', has_expiry: false, reminder_days: [], has_file: true },
					{ id: 101, employee_id: 40, title: 'Orvosi', type_id: 3, valid_day: '2026-10-13', type_name: 'Orvosi alkalmassági', file_mode: 'required', has_expiry: true, reminder_days: [30, 7], has_file: false },
					{ id: 102, employee_id: 41, title: 'Erkölcsi', type_id: 4, valid_day: '2026-10-01', type_name: 'Erkölcsi bizonyítvány', file_mode: 'none', has_expiry: true, reminder_days: [30], has_file: false }
				]
			};
		}
		if (sql.includes('is_required AND archived_at IS NULL')) {
			return { rows: [{ id: 1, name: 'Munkaszerződés' }, { id: 3, name: 'Orvosi alkalmassági' }] };
		}
		// Emlékeztetők: esedékes dokumentumok
		if (sql.includes('employee_document_reminders r')) {
			return {
				rows: [
					{ id: 101, organization_id: 3, employee_id: 40, title: 'Orvosi', valid_day: '2026-10-13', reminder_days: [30, 7], visible_to_employee: true, user_id: 9, employee_name: 'Anna', sent: opts.sent?.[101] ?? [30] },
					{ id: 102, organization_id: 3, employee_id: 41, title: 'Erkölcsi', valid_day: '2026-10-01', reminder_days: [30], visible_to_employee: false, user_id: 10, employee_name: 'Béla', sent: opts.sent?.[102] ?? [] }
				]
			};
		}
		if (sql.includes("rc.capability = 'employee.documents.manage'")) {
			return { rows: [{ user_id: 7, full_name: 'HR Hajni', email: 'hr@example.com', locale: 'hu' }] };
		}
		if (sql.includes('FROM auth.users u WHERE u.id = ANY')) {
			return { rows: [{ user_id: 9, full_name: 'Anna', email: 'anna@example.com', locale: 'en' }] };
		}
		if (sql.includes('SELECT name FROM')) return { rows: [{ name: 'Teszt Kft.' }] };
		if (sql.includes('kv_store')) return { rows: [] };
		return { rows: [] };
	};
	return { query, inserts };
}

describe('dokumentumproblémák', () => {
	test('lejárt, lejáró, hiányzó és fájl nélküli tételek, sürgősség szerint', async () => {
		const db = fakeDb();
		const context = { db: { query: db.query } } as unknown as RemoteContext;
		const issues = await loadDocumentIssues(context, 3, '2026-10-06');
		expect(issues.map((i) => `${i.kind}:${i.employeeName}:${i.typeName}`)).toEqual([
			'expired:Béla:Erkölcsi bizonyítvány',
			'expiring:Anna:Orvosi alkalmassági',
			'missing:Béla:Munkaszerződés',
			'missing:Béla:Orvosi alkalmassági',
			'fileMissing:Anna:Orvosi alkalmassági'
		]);
		expect(issues[1].daysLeft).toBe(7);
		expect(countIssues(issues)).toEqual({ pending: 0, expired: 1, expiring: 1, missing: 2, fileMissing: 1 });
	});
});

describe('napi emlékeztető futás', () => {
	function fakeContext(db: ReturnType<typeof fakeDb>) {
		const notifications: any[] = [];
		const emails: any[] = [];
		const context = {
			pluginId: 'racona-work',
			userId: null,
			permissions: [],
			db: { query: db.query },
			notifications: { send: async (p: any) => (notifications.push(p), { success: true }) },
			email: { send: async (p: any) => (emails.push(p), { success: true }) }
		} as unknown as RemoteContext;
		return { context, notifications, emails };
	}

	test('HR összesítő, a dolgozó csak a neki látható típusról kap jelzést', async () => {
		const db = fakeDb();
		const { context, notifications, emails } = fakeContext(db);
		const totals = await runDocumentRemindersForAll(context, '2026-10-06');

		expect(totals).toMatchObject({ organizations: 1, documents: 2, managerNotices: 1, employeeNotices: 1, failed: [] });
		const hr = notifications.find((n) => n.userIds);
		expect(hr.userIds).toEqual([7]);
		expect(hr.type).toBe('warning'); // van lejárt
		expect(hr.message.hu).toContain('Béla – Erkölcsi: lejárt (2026. 10. 01.)');
		expect(hr.message.hu).toContain('Anna – Orvosi: 7 nap múlva lejár');
		const own = notifications.find((n) => n.userId === 9);
		expect(own.message.hu).toBe('Orvosi: 7 nap múlva lejár (2026. 10. 13.)');
		expect(notifications.some((n) => n.userId === 10)).toBe(false);

		// HR email alapból megy, a dolgozói alapból nem
		expect(emails.map((e) => e.template)).toEqual(['document_expiring']);
		expect(emails[0].data.itemsText).toContain('Béla – Erkölcsi');

		// Küldöttnek jelölve az összes elért eltolás (a már küldött 30-at az ON CONFLICT kihagyja)
		const insert = db.inserts.find((i) => i.sql.includes('employee_document_reminders'))!;
		expect(insert.sql).toContain('ON CONFLICT DO NOTHING');
		expect(insert.params).toEqual([[101, 101, 102, 102], [30, 7, 30, 0]]);
	});

	test('ha minden ment már, nincs újabb jelzés', async () => {
		const db = fakeDb({ sent: { 101: [30, 7], 102: [30, 0] } });
		const { context, notifications } = fakeContext(db);
		const totals = await runDocumentRemindersForAll(context, '2026-10-06');
		expect(totals.documents).toBe(0);
		expect(notifications).toEqual([]);
	});
});
