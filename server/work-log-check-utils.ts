/**
 * Hiányzó munkanapló-bejegyzések figyelése — tiszta segédfüggvények
 * (specs/work-log-check.md). A kliens is importálja (beállítás űrlap, a
 * vizsgált nap kiírása); tesztek: tests/work-log-check.test.ts.
 *
 * Minden nap YYYY-MM-DD formájú, budapesti dátum.
 */

import { isValidReplyTo } from './reply-to.js';

export interface WorkLogCheckSettings {
	enabled: boolean;
	/** Az emlékeztető ablaka: a mai nap és az előtte lévő ennyi nap (0 = csak a mai) */
	lookbackDays: number;
	/** Az eszkaláció címzettjei (email címek); üresen nincs eszkaláció */
	recipients: string[];
	/** A vizsgálatból kihagyott dolgozók (employees.id) */
	excludedEmployeeIds: number[];
	/** A bekapcsolás napja: az ekkor már az ablakon kívüli napok nem eszkalálódnak (D6) */
	enabledOn: string | null;
}

export const WORK_LOG_CHECK_DEFAULTS: WorkLogCheckSettings = {
	enabled: false,
	lookbackDays: 5,
	recipients: [],
	excludedEmployeeIds: [],
	enabledOn: null
};

export const WORK_LOG_CHECK_LIMITS = {
	lookbackDays: { min: 0, max: 30 },
	recipients: 10
} as const;

/**
 * Kimaradt futás pótlása (D6): az eszkaláció az ablakból ma kieső nap előtti
 * ennyi napot is megnézi, a már jelzett napok kimaradnak. Így egy-két kiesett
 * futás után sem vész el jelzés, de egy hosszabb leállás után sem zúdul a
 * címzettre minden.
 */
export const CATCH_UP_DAYS = 7;

const DAY_MS = 86_400_000;

/** A nap eltolása naptári napokkal (UTC alapon, hogy az óraátállítás ne zavarjon). */
export function addDays(day: string, days: number): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

/** Email címek listája tömbből vagy vesszővel, pontosvesszővel, sortöréssel elválasztott szövegből. */
export function splitRecipients(value: unknown): string[] {
	const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const part of parts) {
		if (typeof part !== 'string') continue;
		const email = part.trim();
		if (!email || seen.has(email.toLowerCase())) continue;
		seen.add(email.toLowerCase());
		result.push(email);
	}
	return result;
}

/** A címlistából az érvénytelen címek (mentéskor hibát adunk rájuk). */
export function invalidRecipients(recipients: string[]): string[] {
	return recipients.filter((r) => !isValidReplyTo(r));
}

/**
 * A tárolt vagy beküldött értékből teljes beállítás. Az érvénytelen email
 * címek kimaradnak (a mentés előtte külön ellenőrzi és hibát ad rájuk).
 */
export function normalizeWorkLogCheckSettings(raw: unknown): WorkLogCheckSettings {
	const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const { lookbackDays, recipients } = WORK_LOG_CHECK_LIMITS;
	const ids = Array.isArray(v.excludedEmployeeIds) ? v.excludedEmployeeIds : [];
	const enabledOn =
		typeof v.enabledOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.enabledOn) ? v.enabledOn : null;
	return {
		enabled: v.enabled === true,
		lookbackDays: clampInt(v.lookbackDays, lookbackDays.min, lookbackDays.max, WORK_LOG_CHECK_DEFAULTS.lookbackDays),
		recipients: splitRecipients(v.recipients)
			.filter((r) => isValidReplyTo(r))
			.slice(0, recipients),
		excludedEmployeeIds: [
			...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))
		].sort((a, b) => a - b),
		enabledOn
	};
}

/**
 * A bekapcsolás napja: bekapcsoláskor a mai nap, bekapcsolva marad a
 * korábbi, kikapcsolva null.
 */
export function withEnabledOn(
	next: WorkLogCheckSettings,
	previous: WorkLogCheckSettings,
	today: string
): WorkLogCheckSettings {
	if (!next.enabled) return { ...next, enabledOn: null };
	const enabledOn = previous.enabled && previous.enabledOn ? previous.enabledOn : today;
	return { ...next, enabledOn };
}

export interface DayRange {
	from: string;
	to: string;
}

/**
 * A dolgozói emlékeztető ablaka (D4): a mai nap és az előtte lévő
 * `lookbackDays` nap. Ezek hiányzó munkanapjairól a dolgozó minden este
 * emlékeztetőt kap, amíg nem pótolja őket.
 */
export function reminderWindow(settings: WorkLogCheckSettings, today: string): DayRange | null {
	if (!settings.enabled) return null;
	return { from: addDays(today, -settings.lookbackDays), to: today };
}

/**
 * Az eszkaláció tartománya (D5–D6): a ma este az ablakból kieső nap, és a
 * kimaradt futások pótlására az előtte lévő napok. Csak olyan nap, amely a
 * bekapcsolás után még az ablakban volt (a dolgozó kapott róla emlékeztetőt).
 * Null, ha nincs mit vizsgálni.
 */
export function escalationWindow(settings: WorkLogCheckSettings, today: string): DayRange | null {
	if (!settings.enabled) return null;
	const to = addDays(today, -settings.lookbackDays - 1);
	let from = addDays(to, -CATCH_UP_DAYS);
	if (settings.enabledOn) {
		const firstInWindow = addDays(settings.enabledOn, -settings.lookbackDays);
		if (firstInWindow > from) from = firstInWindow;
	}
	return from <= to ? { from, to } : null;
}

export interface EmployeeLogState {
	/** Az első nap, amire bejegyzés várható: a belépés és a rendszerbe vétel közül a későbbi */
	firstDay: string | null;
	/** Az utolsó nap (a munkaviszony vége), vagy null */
	lastDay: string | null;
	/** Napok, amelyekre van munkanapló-bejegyzés (bármelyik projektben) */
	logged: string[];
	/** Jóváhagyott szabadság (bármilyen típus) napjai */
	onLeave: string[];
	/** Napok, amelyekről már ment eszkaláció */
	alerted: string[];
}

/** A dolgozó hiányzó napjai a vizsgált munkanapok közül. */
export function missingDays(workingDays: string[], employee: EmployeeLogState): string[] {
	const skip = new Set([...employee.logged, ...employee.onLeave, ...employee.alerted]);
	return workingDays.filter(
		(day) =>
			(!employee.firstDay || day >= employee.firstDay) &&
			(!employee.lastDay || day <= employee.lastDay) &&
			!skip.has(day)
	);
}
