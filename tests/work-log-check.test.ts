/**
 * Hiányzó munkanapló-bejegyzések figyelése (specs/work-log-check.md): a
 * beállítás, a vizsgált tartomány, a hiányzó napok számítása és a napi futás
 * (címzettek, egyszeri jelzés, kihagyott és külsős dolgozók).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	addDays,
	escalationWindow,
	missingDays,
	normalizeWorkLogCheckSettings,
	reminderWindow,
	splitRecipients,
	withEnabledOn,
	WORK_LOG_CHECK_DEFAULTS
} from '../server/work-log-check-utils.ts';
import { runWorkLogCheckForAll, saveWorkLogCheck } from '../server/work-log-check.ts';
import { NOTIFICATION_EVENT_DEFAULTS, eventGroup } from '../server/notification-settings.ts';
import type { RemoteContext } from '../server/context.ts';

const enabled = (patch: Partial<typeof WORK_LOG_CHECK_DEFAULTS> = {}) => ({
	...WORK_LOG_CHECK_DEFAULTS,
	enabled: true,
	recipients: ['pm@example.com'],
	enabledOn: '2026-09-01',
	...patch
});

describe('beállítás', () => {
	test('alapértékek és korlátok', () => {
		expect(normalizeWorkLogCheckSettings(null)).toEqual(WORK_LOG_CHECK_DEFAULTS);
		expect(normalizeWorkLogCheckSettings({ lookbackDays: 99 }).lookbackDays).toBe(30);
		expect(normalizeWorkLogCheckSettings({ lookbackDays: -2 }).lookbackDays).toBe(0);
		expect(normalizeWorkLogCheckSettings({ lookbackDays: 'x' }).lookbackDays).toBe(5);
		expect(normalizeWorkLogCheckSettings({ excludedEmployeeIds: [5, '3', 5, -1, 'a'] }).excludedEmployeeIds).toEqual([3, 5]);
	});

	test('címzettek szövegből, ismétlés és érvénytelen cím nélkül', () => {
		expect(splitRecipients('a@x.hu, b@x.hu;\nA@x.hu  c@x.hu')).toEqual(['a@x.hu', 'b@x.hu', 'c@x.hu']);
		expect(normalizeWorkLogCheckSettings({ recipients: ['a@x.hu', 'rossz'] }).recipients).toEqual(['a@x.hu']);
	});

	test('a bekapcsolás napja: bekapcsoláskor a mai, utána marad, kikapcsolva null', () => {
		const off = WORK_LOG_CHECK_DEFAULTS;
		const on = enabled({ enabledOn: null });
		expect(withEnabledOn(on, off, '2026-10-06').enabledOn).toBe('2026-10-06');
		expect(withEnabledOn(on, enabled(), '2026-10-06').enabledOn).toBe('2026-09-01');
		expect(withEnabledOn(off, enabled(), '2026-10-06').enabledOn).toBeNull();
	});
});

describe('vizsgált tartományok', () => {
	test('az emlékeztető a mai és az előtte lévő N napot fedi', () => {
		expect(reminderWindow(enabled(), '2026-10-06')).toEqual({ from: '2026-10-01', to: '2026-10-06' });
		expect(reminderWindow(enabled({ lookbackDays: 0 }), '2026-10-06')).toEqual({ from: '2026-10-06', to: '2026-10-06' });
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});

	test('az eszkaláció a ma kieső napot nézi, a kimaradt napokat egy hétig pótolja', () => {
		expect(escalationWindow(enabled(), '2026-10-06')).toEqual({ from: '2026-09-23', to: '2026-09-30' });
	});

	test('csak a bekapcsoláskor már az ablakban lévő napok eszkalálódnak', () => {
		// Ma kapcsolták be: a 10-01 ma még az ablakban van, holnap esik ki először
		expect(escalationWindow(enabled({ enabledOn: '2026-10-06' }), '2026-10-06')).toBeNull();
		expect(escalationWindow(enabled({ enabledOn: '2026-10-06' }), '2026-10-07')).toEqual({
			from: '2026-10-01',
			to: '2026-10-01'
		});
	});

	test('kikapcsolva nincs tartomány', () => {
		expect(reminderWindow(WORK_LOG_CHECK_DEFAULTS, '2026-10-06')).toBeNull();
		expect(escalationWindow(WORK_LOG_CHECK_DEFAULTS, '2026-10-06')).toBeNull();
	});
});

describe('hiányzó napok', () => {
	const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
	const base = { firstDay: null, lastDay: null, logged: [], onLeave: [], alerted: [] };

	test('a bejegyzéses, szabadságos és már jelzett napok kimaradnak', () => {
		expect(
			missingDays(days, { ...base, logged: ['2026-09-28'], onLeave: ['2026-09-29'], alerted: ['2026-09-30'] })
		).toEqual(['2026-10-01']);
	});

	test('a munkaviszonyon kívüli napok kimaradnak', () => {
		expect(missingDays(days, { ...base, firstDay: '2026-09-30' })).toEqual(['2026-09-30', '2026-10-01']);
		expect(missingDays(days, { ...base, lastDay: '2026-09-28' })).toEqual(['2026-09-28']);
	});
});

describe('értesítési esemény', () => {
	test('alapból be, saját kategóriában', () => {
		expect(NOTIFICATION_EVENT_DEFAULTS['worklog.missingEntriesEmployee']).toBe(true);
		expect(NOTIFICATION_EVENT_DEFAULTS['worklog.missingEntries']).toBe(true);
		expect(eventGroup('worklog.missingEntriesEmployee')).toBe('worklog');
	});
});

// --- Ál-adatbázis ------------------------------------------------------------------

/**
 * A 3-as szervezet figyelése bekapcsolva, 5 napos ablakkal, 2026-10-06-i
 * futás → emlékeztető: 10-01 … 10-06, eszkaláció: 09-23 … 09-30. A 10-01 a
 * munkanaptárban munkaszüneti nap. A vizsgálható dolgozók (a lekérdezés már
 * kiszűri a külsősöket és a kihagyottakat):
 * - 40 Anna (user 9): 09-28-ra van bejegyzése, 09-29-én szabadságon volt,
 *   09-30 már eszkalálva; 10-02-re és 10-05-re van bejegyzése
 * - 41 Béla (user 10): mindenre van bejegyzése 10-06 kivételével
 * A 4-es szervezet beállítása ki van kapcsolva.
 */
function fakeDb(settings: Record<string, unknown> = {}) {
	const queries: { sql: string; params: unknown[] }[] = [];
	const query = async (sql: string, params: unknown[] = []) => {
		queries.push({ sql, params });
		if (/^\s*INSERT/i.test(sql)) return { rows: [] };
		if (sql.includes("LIKE 'settings:work_log_check:org_%'")) {
			return {
				rows: [
					{ key: 'settings:work_log_check:org_3', value: { ...enabled(), excludedEmployeeIds: [42], ...settings } },
					{ key: 'settings:work_log_check:org_4', value: { enabled: false } }
				]
			};
		}
		if (sql.includes('FROM app__racona_work.work_calendar_days')) {
			return { rows: [{ day: '2026-10-01', is_working_day: false }] };
		}
		if (sql.includes('work_log_alerts a')) {
			return {
				rows: [
					{ id: 40, user_id: 9, email: 'anna@example.com', locale: 'hu', full_name: 'Anna', first_day: '2026-01-01', last_day: null,
					  logged: ['2026-09-28', '2026-10-02', '2026-10-05'], on_leave: ['2026-09-29'], alerted: ['2026-09-30'] },
					{ id: 41, user_id: 10, email: 'bela@example.com', locale: 'en', full_name: 'Béla', first_day: '2026-01-01', last_day: null,
					  logged: ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-02', '2026-10-05'], on_leave: [], alerted: [] }
				]
			};
		}
		if (sql.includes('lower(u.email) = ANY')) {
			return { rows: [{ user_id: 7, full_name: 'Projekt Péter', email: 'PM@example.com', locale: 'hu' }] };
		}
		if (sql.includes('SELECT name FROM')) return { rows: [{ name: 'Teszt Kft.' }] };
		return { rows: [] };
	};
	return { query, queries };
}

function fakeContext(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }) {
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

describe('napi futás', () => {
	test('a dolgozó emlékeztetőt kap az ablak hiányzó napjairól, a kiesett napokról eszkaláció megy', async () => {
		const db = fakeDb({ recipients: ['pm@example.com', 'vezeto@example.com'] });
		const { context, notifications, emails } = fakeContext(db);
		const totals = await runWorkLogCheckForAll(context, '2026-10-06', new Date('2026-10-06T21:55:00Z'));

		// A kikapcsolt szervezet nem számít
		expect(totals).toEqual({ organizations: 1, reminded: 2, escalatedEmployees: 1, escalatedDays: 3, failed: [] });

		// Egy lekérdezés mindkét tartományra, a kihagyottakkal
		const employeeQuery = db.queries.find((q) => q.sql.includes('work_log_alerts a'))!;
		expect(employeeQuery.sql).toContain("e.status = 'active' AND NOT e.is_external");
		expect(employeeQuery.params).toEqual([3, '2026-09-23', '2026-10-06', [42]]);

		// Emlékeztető: Anna 10-06 (10-01 munkaszüneti, 10-03/04 hétvége), Béla 10-06
		const annaMail = emails.find((e) => e.to === 'anna@example.com')!;
		expect(annaMail.template).toBe('work_log_missing_employee');
		expect(annaMail.data.itemsText).toBe('  2026. 10. 06.');
		expect(annaMail.data.escalationNoteText).toContain('5 napon belül');
		const belaMail = emails.find((e) => e.to === 'bela@example.com')!;
		expect(belaMail.locale).toBe('en');
		expect(notifications.find((n) => n.userId === 9).message.hu).toBe('Még nem rögzítettél bejegyzést: 2026. 10. 06.');

		// Eszkaláció: Anna 09-23, 09-24, 09-25 (09-28 bejegyzés, 09-29 szabadság, 09-30 már jelezve)
		const insert = db.queries.find((q) => q.sql.includes('INSERT INTO app__racona_work.work_log_alerts'))!;
		expect(insert.params).toEqual([3, [40, 40, 40], ['2026-09-23', '2026-09-24', '2026-09-25']]);
		const escalations = emails.filter((e) => e.template === 'work_log_missing');
		expect(escalations.map((e) => [e.to, e.data.recipientName])).toEqual([
			['pm@example.com', 'Projekt Péter'],
			['vezeto@example.com', 'Címzett']
		]);
		expect(escalations[0].data.itemsText).toContain('Anna: 2026. 09. 23., 2026. 09. 24., 2026. 09. 25.');
		expect(notifications.find((n) => n.userIds)?.userIds).toEqual([7]);
	});

	test('címzett nélkül nincs eszkaláció, és a napok sem jelölődnek', async () => {
		const db = fakeDb({ recipients: [] });
		const { context, emails } = fakeContext(db);
		const totals = await runWorkLogCheckForAll(context, '2026-10-06');
		expect(totals).toMatchObject({ reminded: 2, escalatedEmployees: 0 });
		expect(emails.every((e) => e.template === 'work_log_missing_employee')).toBe(true);
		expect(emails[0].data.escalationNoteText).toBe('');
		expect(db.queries.some((q) => q.sql.includes('INSERT INTO app__racona_work.work_log_alerts'))).toBe(false);
		// Csak az emlékeztető ablakát kérdezi le
		expect(db.queries.find((q) => q.sql.includes('work_log_alerts a'))!.params[1]).toBe('2026-10-01');
	});

	test('a futás eredménye rögzül', async () => {
		const db = fakeDb();
		const { context } = fakeContext(db);
		await runWorkLogCheckForAll(context, '2026-10-06', new Date('2026-10-06T21:55:00Z'));
		const state = db.queries.find((q) => q.sql.includes('kv_store') && q.params[0] === 'state:work_log_check:org_3')!;
		expect(JSON.parse(state.params[1] as string).lastRun).toEqual({
			at: '2026-10-06T21:55:00.000Z',
			day: '2026-10-06',
			reminded: 2,
			escalatedEmployees: 1,
			escalatedDays: 3
		});
	});
});

describe('mentés', () => {
	function saveContext() {
		const db = fakeDb();
		// Core admin: a jogosultság-ellenőrzés átengedi
		const context = { pluginId: 'racona-work', userId: 1, permissions: ['admin'], db: { query: db.query } } as unknown as RemoteContext;
		return context;
	}

	test('érvénytelen címre hibát ad', async () => {
		await expect(
			saveWorkLogCheck({ organizationId: 3, settings: { enabled: true, recipients: 'jo@x.hu, rossz' } }, saveContext())
		).rejects.toThrow('Érvénytelen email cím: rossz');
	});

	test('címzett nélkül is menthető (nincs eszkaláció)', async () => {
		const info = await saveWorkLogCheck({ organizationId: 3, settings: { enabled: true, recipients: [] } }, saveContext());
		expect(info.settings).toMatchObject({ enabled: true, recipients: [] });
	});
});
