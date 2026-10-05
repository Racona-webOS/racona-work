/**
 * A havi ellenőrzés automatizálásának tiszta segédfüggvényei
 * (server/leave-month-automation-utils.ts; specs/leave-month-automation.md).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	AUTOMATION_DEFAULTS,
	automationActive,
	autoSendDay,
	budapestDay,
	closingDay,
	daysBetween,
	doneThisMonth,
	normalizeAutomationSettings,
	reminderDue,
	responseDeadline,
	shouldAutoSend,
	shouldSendClosingNotice,
	withReminderEnabledAt
} from '../server/leave-month-automation-utils.ts';
import type { ReminderSettings } from '../server/leave-month-automation-utils.ts';
import { listWorkingDays } from '../server/leave-day-utils.ts';

const workingDays = (year: number, month: number, overrides?: Map<string, boolean>) => {
	const mm = String(month).padStart(2, '0');
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return listWorkingDays(`${year}-${mm}-01`, `${year}-${mm}-${last}`, overrides);
};

// 2026. október: 23. péntek ünnep, 31. szombat
const octoberHolidays = new Map([['2026-10-23', false]]);
const october = workingDays(2026, 10, octoberHolidays);

describe('normalizeAutomationSettings', () => {
	test('üres érték → alapértékek, minden kikapcsolva (D1)', () => {
		expect(normalizeAutomationSettings(null)).toEqual(AUTOMATION_DEFAULTS);
		expect(automationActive(AUTOMATION_DEFAULTS)).toBe(false);
	});

	test('az egyeztetett alapértékek: 5 munkanap, naponta, zárás 2 munkanappal (D2, D8, D10)', () => {
		expect(AUTOMATION_DEFAULTS.autoSend).toMatchObject({ daysBeforeMonthEnd: 5, dayKind: 'working' });
		expect(AUTOMATION_DEFAULTS.reminders).toMatchObject({ firstAfterDays: 1, intervalDays: 1, workingDaysOnly: true });
		expect(AUTOMATION_DEFAULTS.closing.workingDaysBeforeMonthEnd).toBe(2);
	});

	test('a számok a határok közé szorulnak, az érvénytelen értékek alapértéket kapnak', () => {
		const s = normalizeAutomationSettings({
			autoSend: { enabled: true, daysBeforeMonthEnd: 40, dayKind: 'bogus', note: '  Köszi!  ' },
			reminders: { enabled: 'yes', firstAfterDays: 0, intervalDays: '3', enabledAt: 'nem dátum' },
			closing: { workingDaysBeforeMonthEnd: 0, notifyHr: true }
		});
		expect(s.autoSend).toEqual({ enabled: true, daysBeforeMonthEnd: 15, dayKind: 'working', note: 'Köszi!' });
		expect(s.reminders.enabled).toBe(false);
		expect(s.reminders.firstAfterDays).toBe(1);
		expect(s.reminders.intervalDays).toBe(3);
		expect(s.reminders.enabledAt).toBeNull();
		expect(s.closing).toEqual({ workingDaysBeforeMonthEnd: 1, notifyHr: true });
		expect(automationActive(s)).toBe(true);
	});

	test('a naptári nap választható', () => {
		expect(normalizeAutomationSettings({ autoSend: { dayKind: 'calendar' } }).autoSend.dayKind).toBe('calendar');
	});

	test('az üres megjegyzés null', () => {
		expect(normalizeAutomationSettings({ autoSend: { note: '   ' } }).autoSend.note).toBeNull();
	});
});

describe('withReminderEnabledAt', () => {
	const off = AUTOMATION_DEFAULTS;
	const on = normalizeAutomationSettings({ reminders: { enabled: true, enabledAt: '2026-09-01T08:00:00.000Z' } });
	const now = '2026-10-05T10:00:00.000Z';

	test('bekapcsoláskor most', () => {
		expect(withReminderEnabledAt(on, off, now).reminders.enabledAt).toBe(now);
	});

	test('bekapcsolva maradva a korábbi érték marad', () => {
		expect(withReminderEnabledAt(on, on, now).reminders.enabledAt).toBe('2026-09-01T08:00:00.000Z');
	});

	test('kikapcsoláskor null', () => {
		expect(withReminderEnabledAt(off, on, now).reminders.enabledAt).toBeNull();
	});
});

describe('autoSendDay (D2)', () => {
	test('2026. október, 5 munkanap → okt. 26. (az utolsó öt munkanap: 26–30.)', () => {
		expect(autoSendDay(2026, 10, { daysBeforeMonthEnd: 5, dayKind: 'working' }, october)).toBe('2026-10-26');
		expect(autoSendDay(2026, 10, { daysBeforeMonthEnd: 5, dayKind: 'calendar' }, october)).toBe('2026-10-26');
	});

	test('2026. november: munkanap szerint 24., naptári szerint 25.', () => {
		const days = workingDays(2026, 11);
		expect(autoSendDay(2026, 11, { daysBeforeMonthEnd: 5, dayKind: 'working' }, days)).toBe('2026-11-24');
		expect(autoSendDay(2026, 11, { daysBeforeMonthEnd: 5, dayKind: 'calendar' }, days)).toBe('2026-11-25');
	});

	test('hétvégére eső naptári nap → az előtte lévő munkanap', () => {
		// 2026. március 31. kedd − 3 nap = 28. szombat → 27. péntek
		expect(autoSendDay(2026, 3, { daysBeforeMonthEnd: 3, dayKind: 'calendar' }, workingDays(2026, 3))).toBe(
			'2026-03-27'
		);
	});

	test('a munkanap mód nem számolja az ünnepet', () => {
		// Okt. utolsó 6 munkanapja: 22., 26–30. (23. ünnep)
		expect(autoSendDay(2026, 10, { daysBeforeMonthEnd: 6, dayKind: 'working' }, october)).toBe('2026-10-22');
	});

	test('kevés munkanap → a hónap első munkanapja; munkanap nélkül null', () => {
		expect(autoSendDay(2026, 10, { daysBeforeMonthEnd: 5, dayKind: 'working' }, ['2026-10-30', '2026-10-29'])).toBe(
			'2026-10-29'
		);
		expect(autoSendDay(2026, 10, { daysBeforeMonthEnd: 5, dayKind: 'calendar' }, [])).toBeNull();
	});
});

describe('closingDay és responseDeadline (D10)', () => {
	test('2026. október, 2 munkanap → zárás okt. 29., határidő okt. 28.', () => {
		const closing = closingDay(2026, 10, { workingDaysBeforeMonthEnd: 2 }, october);
		expect(closing).toBe('2026-10-29');
		expect(responseDeadline(closing, october)).toBe('2026-10-28');
	});

	test('a hétvége és az ünnep nem számít munkanapnak', () => {
		// 2026. november: utolsó két munkanap 27. (péntek) és 30. (hétfő) → zárás 27., határidő 26.
		const november = workingDays(2026, 11);
		const closing = closingDay(2026, 11, { workingDaysBeforeMonthEnd: 2 }, november);
		expect(closing).toBe('2026-11-27');
		expect(responseDeadline(closing, november)).toBe('2026-11-26');
	});

	test('zárás nélkül nincs határidő', () => {
		expect(responseDeadline(null, october)).toBeNull();
	});
});

describe('shouldAutoSend (D3, D4, D9)', () => {
	const base = { year: 2026, month: 10, sendDay: '2026-10-26', alreadySent: false, closedYear: 2025 };

	test('a kiküldés napja előtt nem', () => {
		expect(shouldAutoSend({ ...base, today: '2026-10-25' })).toBe(false);
	});

	test('a kiküldés napján igen', () => {
		expect(shouldAutoSend({ ...base, today: '2026-10-26' })).toBe(true);
	});

	test('pótlás: a nap után, de még a hónapon belül igen', () => {
		expect(shouldAutoSend({ ...base, today: '2026-10-29' })).toBe(true);
	});

	test('havonta egyszer', () => {
		expect(shouldAutoSend({ ...base, today: '2026-10-27', alreadySent: true })).toBe(false);
	});

	test('a hónap után nem pótolja', () => {
		expect(shouldAutoSend({ ...base, today: '2026-11-01' })).toBe(false);
	});

	test('lezárt évre nem', () => {
		expect(shouldAutoSend({ ...base, today: '2026-10-26', closedYear: 2026 })).toBe(false);
	});

	test('doneThisMonth', () => {
		const last = { year: 2026, month: 9 };
		expect(doneThisMonth(last, 2026, 9)).toBe(true);
		expect(doneThisMonth(last, 2026, 10)).toBe(false);
		expect(doneThisMonth(null, 2026, 10)).toBe(false);
	});
});

describe('shouldSendClosingNotice (D10)', () => {
	const base = { year: 2026, month: 10, closing: '2026-10-29', alreadySent: false };

	test('a zárás napja előtt nem, a napján igen, utána pótolja a hónapon belül', () => {
		expect(shouldSendClosingNotice({ ...base, today: '2026-10-28' })).toBe(false);
		expect(shouldSendClosingNotice({ ...base, today: '2026-10-29' })).toBe(true);
		expect(shouldSendClosingNotice({ ...base, today: '2026-10-30' })).toBe(true);
		expect(shouldSendClosingNotice({ ...base, today: '2026-11-02' })).toBe(false);
	});

	test('havonta egyszer', () => {
		expect(shouldSendClosingNotice({ ...base, today: '2026-10-29', alreadySent: true })).toBe(false);
	});
});

describe('reminderDue (D7, D8)', () => {
	const settings: ReminderSettings = {
		...AUTOMATION_DEFAULTS.reminders,
		enabled: true,
		enabledAt: '2026-10-01T00:00:00.000Z'
	};
	// Kiküldve okt. 26-án (hétfő) 07:00-kor, budapesti idő szerint; zárás okt. 29.
	const base = {
		today: '2026-10-27',
		todayIsWorkingDay: true,
		sentAt: '2026-10-26T06:00:00.000Z',
		lastRemindedAt: null,
		closing: '2026-10-29',
		stale: false,
		settings
	};

	test('a kiküldés napján még nem, másnap az első', () => {
		expect(reminderDue({ ...base, today: '2026-10-26' })).toBe(false);
		expect(reminderDue(base)).toBe(true);
	});

	test('naponta, ugyanazon a napon nem ismétlődik', () => {
		const reminded = { ...base, lastRemindedAt: '2026-10-27T05:00:00.000Z' };
		expect(reminderDue(reminded)).toBe(false);
		expect(reminderDue({ ...reminded, today: '2026-10-28' })).toBe(true);
	});

	test('a zárás napjától nem (D10)', () => {
		const reminded = { ...base, lastRemindedAt: '2026-10-28T05:00:00.000Z' };
		expect(reminderDue({ ...reminded, today: '2026-10-29' })).toBe(false);
		expect(reminderDue({ ...reminded, today: '2026-10-30' })).toBe(false);
	});

	test('korábbi hónap tételére nem (a zárása elmúlt)', () => {
		expect(reminderDue({ ...base, closing: '2026-09-29', sentAt: '2026-09-24T06:00:00.000Z' })).toBe(false);
	});

	test('zárási nap nélkül nem', () => {
		expect(reminderDue({ ...base, closing: null })).toBe(false);
	});

	test('az időköz után a következő', () => {
		const twoDays = { ...settings, intervalDays: 2 };
		const reminded = { ...base, lastRemindedAt: '2026-10-27T05:00:00.000Z', settings: twoDays, closing: '2026-10-30' };
		expect(reminderDue({ ...reminded, today: '2026-10-28' })).toBe(false);
		expect(reminderDue({ ...reminded, today: '2026-10-29' })).toBe(true);
	});

	test('csak munkanapon', () => {
		expect(reminderDue({ ...base, todayIsWorkingDay: false })).toBe(false);
		expect(reminderDue({ ...base, todayIsWorkingDay: false, settings: { ...settings, workingDaysOnly: false } })).toBe(
			true
		);
	});

	test('változott tételre nem (a HR-en a sor)', () => {
		expect(reminderDue({ ...base, stale: true })).toBe(false);
	});

	test('a bekapcsolás előtt kiküldött tételre nem', () => {
		expect(reminderDue({ ...base, settings: { ...settings, enabledAt: '2026-10-27T00:00:00.000Z' } })).toBe(false);
	});

	test('kikapcsolva nem', () => {
		expect(reminderDue({ ...base, settings: { ...settings, enabled: false } })).toBe(false);
	});

	test('az éjfél körüli időbélyeget budapesti nap szerint számolja', () => {
		// 2026-10-26T23:30Z = okt. 27. 00:30 Budapesten → aznap még nem esedékes
		expect(reminderDue({ ...base, sentAt: '2026-10-26T23:30:00.000Z', today: '2026-10-27' })).toBe(false);
	});
});

describe('napok', () => {
	test('daysBetween és budapestDay', () => {
		expect(daysBetween('2026-10-26', '2026-10-29')).toBe(3);
		expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
		expect(budapestDay('2026-10-26T22:30:00.000Z')).toBe('2026-10-26');
		expect(budapestDay('2026-10-26T23:30:00.000Z')).toBe('2026-10-27');
	});
});
