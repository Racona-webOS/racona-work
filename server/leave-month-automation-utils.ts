/**
 * Havi szabadság-ellenőrzés automatizálása — tiszta segédfüggvények
 * (specs/leave-month-automation.md). A kliens is importálja (beállítás űrlap,
 * következő kiküldés napja); tesztek: tests/leave-month-automation.test.ts.
 *
 * Minden nap YYYY-MM-DD formájú, budapesti dátum.
 */

import { MAX_CONFIRMATION_NOTE_LENGTH, monthBounds } from './leave-month-confirmation-utils.js';

/** A kiküldés napjának számítása: naptári nap vagy munkanap szerint (D2). */
export type AutomationDayKind = 'calendar' | 'working';

export interface AutoSendSettings {
	enabled: boolean;
	/** Hány nappal a hónap vége előtt (1–15) */
	daysBeforeMonthEnd: number;
	dayKind: AutomationDayKind;
	/** A dolgozóknak szóló megjegyzés az összesítőben, vagy null */
	note: string | null;
}

export interface ReminderSettings {
	enabled: boolean;
	/** Mikor kapcsolták be (ISO időbélyeg); csak az ezután kiküldött tételek kapnak emlékeztetőt (D7) */
	enabledAt: string | null;
	/** Az első emlékeztető a kiküldés után ennyi nappal (1–30) */
	firstAfterDays: number;
	/** Utána ennyi naponta (1–30) */
	intervalDays: number;
	/** Csak munkanapon (a szervezet munkanaptára szerint) */
	workingDaysOnly: boolean;
}

/**
 * A hónap zárása (D10): a hónap utolsó N munkanapja közül az elsőn leállnak az
 * emlékeztetők, és a szabadságkezelők összesítőt kapnak, hogy a maradék
 * munkanapokon továbbíthassák a hónapot a bérszámfejtésnek.
 */
export interface ClosingSettings {
	/** Hány munkanappal a hónap vége előtt (1–10) */
	workingDaysBeforeMonthEnd: number;
	/** Összesítő a Szabadság beállításoknál kijelölt értesítendőknek a zárás napján */
	notifyHr: boolean;
}

export interface LeaveMonthAutomationSettings {
	autoSend: AutoSendSettings;
	reminders: ReminderSettings;
	closing: ClosingSettings;
}

/** Az utolsó automatikus kiküldés (a szervezet állapota a kv_store-ban). */
export interface LastAutoSend {
	year: number;
	month: number;
	/** ISO időbélyeg */
	at: string;
	sent: number;
	resent: number;
	skipped: number;
}

/** Az utolsó zárási összesítő (a szervezet állapota a kv_store-ban). */
export interface LastClosingNotice {
	year: number;
	month: number;
	/** ISO időbélyeg */
	at: string;
}

/** Alapból minden ki van kapcsolva (D1); a számok az igénylővel egyeztetett értékek (D2, D8, D10). */
export const AUTOMATION_DEFAULTS: LeaveMonthAutomationSettings = {
	autoSend: { enabled: false, daysBeforeMonthEnd: 5, dayKind: 'working', note: null },
	reminders: {
		enabled: false,
		enabledAt: null,
		firstAfterDays: 1,
		intervalDays: 1,
		workingDaysOnly: true
	},
	closing: { workingDaysBeforeMonthEnd: 2, notifyHr: false }
};

export const AUTOMATION_LIMITS = {
	daysBeforeMonthEnd: { min: 1, max: 15 },
	firstAfterDays: { min: 1, max: 30 },
	intervalDays: { min: 1, max: 30 },
	closingWorkingDays: { min: 1, max: 10 }
} as const;

function clampInt(value: unknown, fallback: number, limits: { min: number; max: number }): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(limits.max, Math.max(limits.min, Math.round(n)));
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function noteOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.trim()
		? value.trim().slice(0, MAX_CONFIRMATION_NOTE_LENGTH)
		: null;
}

function objectOrEmpty(value: unknown): Record<string, any> {
	return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

/**
 * A tárolt vagy a felületről érkező értékből teljes beállítás: a hiányzó vagy
 * érvénytelen mezők az alapértéküket kapják, a számok a határok közé szorulnak.
 */
export function normalizeAutomationSettings(raw: unknown): LeaveMonthAutomationSettings {
	const source = objectOrEmpty(raw);
	const a = objectOrEmpty(source.autoSend);
	const r = objectOrEmpty(source.reminders);
	const c = objectOrEmpty(source.closing);
	const d = AUTOMATION_DEFAULTS;
	return {
		autoSend: {
			enabled: bool(a.enabled, d.autoSend.enabled),
			daysBeforeMonthEnd: clampInt(a.daysBeforeMonthEnd, d.autoSend.daysBeforeMonthEnd, AUTOMATION_LIMITS.daysBeforeMonthEnd),
			dayKind: a.dayKind === 'calendar' || a.dayKind === 'working' ? a.dayKind : d.autoSend.dayKind,
			note: noteOrNull(a.note)
		},
		reminders: {
			enabled: bool(r.enabled, d.reminders.enabled),
			enabledAt: typeof r.enabledAt === 'string' && !Number.isNaN(Date.parse(r.enabledAt)) ? r.enabledAt : null,
			firstAfterDays: clampInt(r.firstAfterDays, d.reminders.firstAfterDays, AUTOMATION_LIMITS.firstAfterDays),
			intervalDays: clampInt(r.intervalDays, d.reminders.intervalDays, AUTOMATION_LIMITS.intervalDays),
			workingDaysOnly: bool(r.workingDaysOnly, d.reminders.workingDaysOnly)
		},
		closing: {
			workingDaysBeforeMonthEnd: clampInt(
				c.workingDaysBeforeMonthEnd,
				d.closing.workingDaysBeforeMonthEnd,
				AUTOMATION_LIMITS.closingWorkingDays
			),
			notifyHr: bool(c.notifyHr, d.closing.notifyHr)
		}
	};
}

/** Fut-e bármi a szervezetben (a napi futás ennek hiányában kihagyja). */
export function automationActive(settings: LeaveMonthAutomationSettings): boolean {
	return settings.autoSend.enabled || settings.reminders.enabled || settings.closing.notifyHr;
}

/**
 * Mentéskor: az emlékeztető bekapcsolásának ideje (D7). Kikapcsolt → bekapcsolt
 * váltásnál most, egyébként a korábbi érték marad.
 */
export function withReminderEnabledAt(
	next: LeaveMonthAutomationSettings,
	previous: LeaveMonthAutomationSettings,
	nowIso: string
): LeaveMonthAutomationSettings {
	let enabledAt: string | null = null;
	if (next.reminders.enabled) {
		enabledAt = previous.reminders.enabled ? (previous.reminders.enabledAt ?? nowIso) : nowIso;
	}
	return { ...next, reminders: { ...next.reminders, enabledAt } };
}

// ---------------------------------------------------------------------------
// Napok
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function dayToMs(isoDay: string): number {
	return Date.parse(`${isoDay}T00:00:00Z`);
}

/** `from`-tól `to`-ig eltelt naptári napok (negatív, ha `to` korábbi). */
export function daysBetween(from: string, to: string): number {
	return Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS);
}

export function addDays(isoDay: string, days: number): string {
	return new Date(dayToMs(isoDay) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Időbélyegből budapesti dátum (YYYY-MM-DD). */
export function budapestDay(value: string | Date): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date(value));
}

/**
 * Egy nap N nappal a hónap vége előtt (D2).
 *
 * - Naptári nap: a hónap utolsó napja mínusz N nap; ha az nem munkanap, az
 *   előtte lévő utolsó munkanap.
 * - Munkanap: a hónap utolsó N munkanapja közül az első.
 *
 * @param workingDays - A hónap munkanapjai (a szervezet munkanaptára szerint).
 * @returns A nap, vagy null, ha a hónapban nincs megfelelő munkanap.
 */
export function autoSendDay(
	year: number,
	month: number,
	settings: Pick<AutoSendSettings, 'daysBeforeMonthEnd' | 'dayKind'>,
	workingDays: string[]
): string | null {
	const sorted = [...new Set(workingDays)].sort();
	if (sorted.length === 0) return null;
	const n = settings.daysBeforeMonthEnd;
	if (settings.dayKind === 'working') {
		return sorted[Math.max(0, sorted.length - n)] ?? null;
	}
	const target = addDays(monthBounds(year, month).to, -n);
	for (let i = sorted.length - 1; i >= 0; i--) {
		if (sorted[i] <= target) return sorted[i];
	}
	return null;
}

/** A hónap zárásának napja (D10): a hónap utolsó N munkanapja közül az első. */
export function closingDay(
	year: number,
	month: number,
	settings: Pick<ClosingSettings, 'workingDaysBeforeMonthEnd'>,
	workingDays: string[]
): string | null {
	return autoSendDay(year, month, { daysBeforeMonthEnd: settings.workingDaysBeforeMonthEnd, dayKind: 'working' }, workingDays);
}

/** A válaszolási határidő: a zárás előtti utolsó munkanap, vagy null. */
export function responseDeadline(closing: string | null, workingDays: string[]): string | null {
	if (!closing) return null;
	const before = [...new Set(workingDays)].sort().filter((d) => d < closing);
	return before.at(-1) ?? null;
}

/** Ebben a hónapban volt-e már (automatikus kiküldés vagy zárási összesítő). */
export function doneThisMonth(last: { year: number; month: number } | null, year: number, month: number): boolean {
	return !!last && last.year === year && last.month === month;
}

/**
 * Kell-e ma automatikusan kiküldeni (D3, D4, D9): a kiküldés napja elérkezett,
 * még a hónapon belül vagyunk, ebben a hónapban még nem ment ki, és az év nincs lezárva.
 */
export function shouldAutoSend(params: {
	today: string;
	year: number;
	month: number;
	sendDay: string | null;
	alreadySent: boolean;
	closedYear: number | null;
}): boolean {
	const { today, year, month, sendDay, alreadySent, closedYear } = params;
	if (!sendDay || alreadySent) return false;
	if (closedYear !== null && year <= closedYear) return false;
	return today >= sendDay && today <= monthBounds(year, month).to;
}

/**
 * Kell-e ma zárási összesítőt küldeni (D10): a zárás napja elérkezett, még a
 * hónapon belül vagyunk, és ebben a hónapban még nem ment ki.
 */
export function shouldSendClosingNotice(params: {
	today: string;
	year: number;
	month: number;
	closing: string | null;
	alreadySent: boolean;
}): boolean {
	const { today, year, month, closing, alreadySent } = params;
	if (!closing || alreadySent) return false;
	return today >= closing && today <= monthBounds(year, month).to;
}

/**
 * Esedékes-e ma emlékeztető egy válaszra váró tételre (D7, D8).
 *
 * @param params.sentAt - A kiküldés időbélyege (ISO).
 * @param params.lastRemindedAt - Az utolsó emlékeztető időbélyege, vagy null.
 * @param params.closing - A tétel hónapjának zárási napja: attól kezdve nincs emlékeztető.
 * @param params.stale - A tétel napjai a kiküldés óta változtak (ilyenkor a HR-en a sor).
 */
export function reminderDue(params: {
	today: string;
	todayIsWorkingDay: boolean;
	sentAt: string;
	lastRemindedAt: string | null;
	closing: string | null;
	stale: boolean;
	settings: ReminderSettings;
}): boolean {
	const { today, todayIsWorkingDay, sentAt, lastRemindedAt, closing, stale, settings } = params;
	if (!settings.enabled || stale) return false;
	if (!closing || today >= closing) return false;
	if (settings.enabledAt && Date.parse(sentAt) < Date.parse(settings.enabledAt)) return false;
	if (settings.workingDaysOnly && !todayIsWorkingDay) return false;
	if (lastRemindedAt) return daysBetween(budapestDay(lastRemindedAt), today) >= settings.intervalDays;
	return daysBetween(budapestDay(sentAt), today) >= settings.firstAfterDays;
}
