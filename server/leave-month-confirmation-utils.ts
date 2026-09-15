/**
 * Havi szabadság-ellenőrzés — tiszta segédfüggvények (specs/leave-month-confirmation.md).
 *
 * Nincs adatbázis-hívás, ezért a kliens is importálhatja (az irányítópult
 * kártyája és a csapatnézet blokkja ugyanígy összegez és ellenőriz).
 */

import { LEAVE_TYPES, isLeaveType } from './leave-types.js';
import type { LeaveType } from './leave-types.js';
import { groupIntoRuns, normalizeDays } from './leave-day-utils.js';

export type MonthConfirmationStatus = 'pending' | 'accepted' | 'disputed' | 'closed' | 'superseded';

/** Egy nap a pillanatképben. */
export interface SnapshotDay {
	/** YYYY-MM-DD */
	day: string;
	leaveType: string;
}

/** A kiküldéskori állapot, amit a dolgozó elfogad (D4). */
export interface MonthSnapshot {
	from: string;
	to: string;
	/** A hónap munkanapjai a kiküldéskori munkanaptárral. */
	workingDays: string[];
	/** A jóváhagyott napok. */
	days: SnapshotDay[];
	/** A függő kérelmek munkanapjai a hónapban, tájékoztatásul (D7). */
	pending: SnapshotDay[];
}

export type DisputeItemKind = 'not_on_leave' | 'wrong_type' | 'missing';

/** Egy tétel a dolgozó eltérés-jelzésében (D8). */
export interface DisputeItem {
	kind: DisputeItemKind;
	day: string;
	/** `wrong_type`: a helyes típus; `missing`: a távollét típusa. */
	leaveType?: LeaveType;
}

export type SendAction = 'send' | 'resend' | 'none';

export const DISPUTE_ITEM_KINDS: readonly DisputeItemKind[] = ['not_on_leave', 'wrong_type', 'missing'];

/** A megjegyzések és válaszok legnagyobb hossza. */
export const MAX_CONFIRMATION_NOTE_LENGTH = 1000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES: Record<'hu' | 'en', string[]> = {
	hu: [
		'január',
		'február',
		'március',
		'április',
		'május',
		'június',
		'július',
		'augusztus',
		'szeptember',
		'október',
		'november',
		'december'
	],
	en: [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	]
};

/**
 * Ellenőrzi az évet és a hónapot.
 *
 * @throws Ha a hónap nem 1–12, vagy az év nem értelmes.
 */
export function parseYearMonth(year: unknown, month: unknown): { year: number; month: number } {
	const y = Number(year);
	const m = Number(month);
	if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('Érvénytelen év.');
	if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('Érvénytelen hónap.');
	return { year: y, month: m };
}

/**
 * A hónap első és utolsó napja.
 *
 * @param year - Az év.
 * @param month - A hónap, 1–12.
 */
export function monthBounds(year: number, month: number): { from: string; to: string } {
	const mm = String(month).padStart(2, '0');
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Miért nem küldhető ki a hónap ellenőrzése (D3), vagy null, ha kiküldhető.
 *
 * @param year - Az év.
 * @param month - A hónap, 1–12.
 * @param today - A mai nap (YYYY-MM-DD, budapesti idő).
 * @param closedYear - A legutolsó lezárt év, vagy null.
 */
export function monthSendBlocker(
	year: number,
	month: number,
	today: string,
	closedYear: number | null
): 'future' | 'closed' | null {
	if (monthBounds(year, month).from > today) return 'future';
	if (closedYear !== null && year <= closedYear) return 'closed';
	return null;
}

/** Rendezett napok típussal, a napok ismétlése nélkül (az első típus marad). */
function sortDays(days: SnapshotDay[]): SnapshotDay[] {
	const byDay = new Map<string, string>();
	for (const d of days) if (!byDay.has(d.day)) byDay.set(d.day, d.leaveType);
	return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, leaveType]) => ({ day, leaveType }));
}

/**
 * A kiküldendő pillanatkép: rendezett, ismétlés nélküli napok.
 */
export function buildMonthSnapshot(params: {
	from: string;
	to: string;
	workingDays: string[];
	days: SnapshotDay[];
	pending: SnapshotDay[];
}): MonthSnapshot {
	const approved = sortDays(params.days);
	const approvedDays = new Set(approved.map((d) => d.day));
	return {
		from: params.from,
		to: params.to,
		workingDays: normalizeDays(params.workingDays),
		days: approved,
		// Ami már jóváhagyott, az nem függő
		pending: sortDays(params.pending).filter((d) => !approvedDays.has(d.day))
	};
}

/**
 * A jóváhagyott napok ujjlenyomata (D5): a sorrendtől független.
 */
export function snapshotFingerprint(days: SnapshotDay[]): string {
	return sortDays(days)
		.map((d) => `${d.day}:${d.leaveType}`)
		.join(',');
}

/** Egy összefüggő szakasz egy típussal. */
export interface SnapshotPeriod {
	leaveType: string;
	startDate: string;
	endDate: string;
	days: number;
}

export interface SnapshotSummary {
	dayCount: number;
	/** Típusonként a napok, a LEAVE_TYPES sorrendjében, az ismeretlen típus a végén. */
	byType: { leaveType: string; days: number }[];
	/** Típusonként összefüggő szakaszok (a nem munkanap nem szakít), kezdőnap szerint. */
	periods: SnapshotPeriod[];
	pendingDayCount: number;
	pendingPeriods: SnapshotPeriod[];
}

function toPeriods(days: SnapshotDay[], workingDays: Set<string>): SnapshotPeriod[] {
	const byType = new Map<string, string[]>();
	for (const d of days) {
		if (!byType.has(d.leaveType)) byType.set(d.leaveType, []);
		byType.get(d.leaveType)!.push(d.day);
	}
	const periods: SnapshotPeriod[] = [];
	for (const [leaveType, typeDays] of byType) {
		for (const run of groupIntoRuns(typeDays, (day) => workingDays.has(day))) {
			periods.push({ leaveType, startDate: run.startDate, endDate: run.endDate, days: run.days.length });
		}
	}
	return periods.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.leaveType.localeCompare(b.leaveType));
}

function typeOrder(type: string): number {
	const index = (LEAVE_TYPES as readonly string[]).indexOf(type);
	return index === -1 ? LEAVE_TYPES.length : index;
}

/**
 * A pillanatkép összegzése az emailhez, az értesítéshez és a kártyához.
 */
export function summarizeSnapshot(snapshot: MonthSnapshot): SnapshotSummary {
	const workingDays = new Set(snapshot.workingDays);
	const counts = new Map<string, number>();
	for (const d of snapshot.days) counts.set(d.leaveType, (counts.get(d.leaveType) ?? 0) + 1);
	return {
		dayCount: snapshot.days.length,
		byType: [...counts]
			.map(([leaveType, days]) => ({ leaveType, days }))
			.sort((a, b) => typeOrder(a.leaveType) - typeOrder(b.leaveType)),
		periods: toPeriods(snapshot.days, workingDays),
		pendingDayCount: snapshot.pending.length,
		pendingPeriods: toPeriods(snapshot.pending, workingDays)
	};
}

/**
 * Mit tegyen a kiküldés gomb a dolgozóval (D6).
 *
 * @param current - Az élő tétel állapota és ujjlenyomata, vagy null.
 * @param fingerprint - A mostani napok ujjlenyomata.
 */
export function planSendAction(
	current: { status: MonthConfirmationStatus; fingerprint: string } | null,
	fingerprint: string
): SendAction {
	if (!current || current.status === 'superseded') return 'send';
	// Az eltérést jelzett tételt a HR egyenként kezeli (D9)
	if (current.status === 'disputed') return 'none';
	return current.fingerprint === fingerprint ? 'none' : 'resend';
}

/**
 * Zárható-e a hónap (D10): minden címzettnél elfogadott vagy lezárt tétel van,
 * és egyik sem változott a kiküldés óta.
 */
export function isMonthClosable(
	rows: { status: MonthConfirmationStatus | null; stale: boolean }[]
): boolean {
	return rows.length > 0 && rows.every((r) => (r.status === 'accepted' || r.status === 'closed') && !r.stale);
}

/** Szöveg levágva, üresnél null. */
export function trimConfirmationNote(value: unknown): string | null {
	return typeof value === 'string' && value.trim()
		? value.trim().slice(0, MAX_CONFIRMATION_NOTE_LENGTH)
		: null;
}

/**
 * A dolgozó eltérés-jelzésének ellenőrzése a pillanatképhez (D8).
 *
 * @param rawItems - A kliensről érkező tételek.
 * @param rawNote - A megjegyzés.
 * @param snapshot - A kiküldött pillanatkép.
 * @returns A tételek nap szerint rendezve és a megjegyzés.
 * @throws Magyar nyelvű hibaüzenettel.
 */
export function parseDisputeItems(
	rawItems: unknown,
	rawNote: unknown,
	snapshot: MonthSnapshot
): { items: DisputeItem[]; note: string | null } {
	const note = trimConfirmationNote(rawNote);
	if (rawItems !== undefined && rawItems !== null && !Array.isArray(rawItems)) {
		throw new Error('Érvénytelen eltérés-tételek.');
	}
	const list = (rawItems ?? []) as unknown[];
	if (list.length > 62) throw new Error('Túl sok eltérés-tétel.');

	const recorded = new Map(snapshot.days.map((d) => [d.day, d.leaveType]));
	const working = new Set(snapshot.workingDays);
	const seen = new Set<string>();
	const items: DisputeItem[] = [];

	for (const raw of list) {
		const item = (raw ?? {}) as Partial<DisputeItem>;
		if (!DISPUTE_ITEM_KINDS.includes(item.kind as DisputeItemKind)) {
			throw new Error('Érvénytelen eltérés-típus.');
		}
		const day = item.day;
		if (typeof day !== 'string' || !ISO_DAY.test(day) || day < snapshot.from || day > snapshot.to) {
			throw new Error(`A nap nem ebbe a hónapba esik: ${String(day)}.`);
		}
		if (seen.has(day)) throw new Error(`Egy napra egy eltérést jelezhetsz: ${day}.`);
		seen.add(day);

		if (item.kind === 'missing') {
			if (recorded.has(day)) throw new Error(`Erre a napra már van rögzített szabadság: ${day}.`);
			if (!working.has(day)) throw new Error(`Hiányzó szabadságot csak munkanapra jelezhetsz: ${day}.`);
			if (!isLeaveType(item.leaveType)) throw new Error(`Add meg a hiányzó nap típusát: ${day}.`);
			items.push({ kind: 'missing', day, leaveType: item.leaveType });
			continue;
		}

		if (!recorded.has(day)) throw new Error(`Erre a napra nincs rögzített szabadság: ${day}.`);
		if (item.kind === 'wrong_type') {
			if (!isLeaveType(item.leaveType)) throw new Error(`Add meg a helyes típust: ${day}.`);
			if (item.leaveType === recorded.get(day)) {
				throw new Error(`A helyes típus ugyanaz, mint a rögzített: ${day}.`);
			}
			items.push({ kind: 'wrong_type', day, leaveType: item.leaveType });
		} else {
			items.push({ kind: 'not_on_leave', day });
		}
	}

	if (items.length === 0 && !note) {
		throw new Error('Jelöld meg, mi nem stimmel, vagy írd le megjegyzésben.');
	}
	items.sort((a, b) => a.day.localeCompare(b.day));
	return { items, note };
}

/**
 * A hónap neve az emailekhez és az értesítésekhez.
 *
 * @example formatMonthLabel(2026, 9, 'hu') // „2026. szeptember”
 */
export function formatMonthLabel(year: number, month: number, locale: 'hu' | 'en'): string {
	const name = MONTH_NAMES[locale][month - 1] ?? String(month);
	return locale === 'hu' ? `${year}. ${name}` : `${name} ${year}`;
}
