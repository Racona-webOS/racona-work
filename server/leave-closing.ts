/**
 * Év lezárása és megnyitása — szabadságot csak nyitott évre lehet rögzíteni.
 *
 * Egy év nyitott, ha nem későbbi a legutolsó megnyitott évnél, és nincs lezárva.
 * A lezárt évre és a korábbiakra már nem lehet szabadságot rögzíteni vagy
 * módosítani; a meg nem nyitott évre még nem.
 *
 * Mindkét beállítás a kv_store-ban van: `settings:leave_closed_year:org_<id>`
 * (a legutolsó lezárt év) és `settings:leave_opened_year:org_<id>` (a legutolsó
 * megnyitott év). A lezárást a HR (`leave.balance.manage`) állítja, a
 * megnyitást az évnyitás (leave-year-opening.ts). A kérelem beadása,
 * jóváhagyása, törlése és a naptáras mentés ellenőrzi.
 * Részletek: specs/leave-days.md (D18), specs/year-opening.md
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import { currentYear } from './dates.js';

const SCHEMA = 'app__racona_work';

function closedYearKey(organizationId: number): string {
	return `settings:leave_closed_year:org_${organizationId}`;
}

export function openedYearKey(organizationId: number): string {
	return `settings:leave_opened_year:org_${organizationId}`;
}

/** Lekérdezés-képes kapcsolat: a pool vagy egy tranzakció kliense. */
interface Queryable {
	query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** A szervezet évei: a legutolsó lezárt és a legutolsó megnyitott. */
export interface LeaveYearState {
	closedYear: number | null;
	/** Beállítás nélkül null: egy év sincs megnyitva. */
	openedYear: number | null;
}

async function loadYearSetting(db: Queryable, key: string): Promise<number | null> {
	const r = await db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [key]);
	const value = r.rows[0]?.value;
	return Number.isInteger(value) ? Number(value) : null;
}

/**
 * A szervezet legutolsó lezárt éve, vagy null, ha nincs lezárás.
 *
 * @param db - Kapcsolat.
 * @param organizationId - A szervezet.
 */
export async function loadClosedYear(db: Queryable, organizationId: number): Promise<number | null> {
	return loadYearSetting(db, closedYearKey(organizationId));
}

/**
 * A szervezet lezárt és megnyitott éve egyszerre.
 *
 * @param db - Kapcsolat.
 * @param organizationId - A szervezet.
 */
export async function loadLeaveYearState(db: Queryable, organizationId: number): Promise<LeaveYearState> {
	// Egymás után: a tranzakció kliensén a párhuzamos lekérdezés elavult (pg 9-ben hiba)
	const closedYear = await loadYearSetting(db, closedYearKey(organizationId));
	const openedYear = await loadYearSetting(db, openedYearKey(organizationId));
	return { closedYear, openedYear };
}

/** A nap lezárt évre esik-e. */
export function isDayClosed(isoDay: string, closedYear: number | null): boolean {
	return closedYear !== null && Number(isoDay.slice(0, 4)) <= closedYear;
}

/** A nap még meg nem nyitott évre esik-e. */
export function isDayUnopened(isoDay: string, openedYear: number | null): boolean {
	return openedYear === null || Number(isoDay.slice(0, 4)) > openedYear;
}

/** Nyitott-e az év: megnyitották és nincs lezárva. */
export function isYearOpen(year: number, state: LeaveYearState): boolean {
	return state.openedYear !== null && year <= state.openedYear && (state.closedYear === null || year > state.closedYear);
}

/**
 * A lezárt és a meg nem nyitott napok hibaüzenetei (üres, ha minden nap nyitott).
 * Az előnézetek a tervbe gyűjtik, az `assertDaysOpen` az elsőt dobja.
 *
 * @param days - A vizsgált napok (YYYY-MM-DD).
 * @param state - A szervezet évei.
 */
export function lockedDayErrors(days: string[], state: LeaveYearState): string[] {
	const errors: string[] = [];
	const closed = days.filter((d) => isDayClosed(d, state.closedYear));
	if (closed.length > 0) {
		errors.push(
			`A(z) ${state.closedYear}. évig az évek le vannak zárva, szabadságot már nem lehet rájuk rögzíteni vagy módosítani: ${closed.join(', ')}.`
		);
	}
	const unopened = days.filter((d) => !isDayClosed(d, state.closedYear) && isDayUnopened(d, state.openedYear));
	if (unopened.length > 0) {
		const years = [...new Set(unopened.map((d) => d.slice(0, 4)))].join(', ');
		errors.push(
			`A(z) ${years}. év még nincs megnyitva, szabadságot csak az évnyitás után lehet rá rögzíteni: ${unopened.join(', ')}.`
		);
	}
	return errors;
}

/**
 * Hibát dob, ha a napok bármelyike lezárt vagy (ha `allowUnopened` nincs
 * megadva) még meg nem nyitott évre esik.
 *
 * @param db - Kapcsolat.
 * @param organizationId - A szervezet.
 * @param days - A vizsgált napok (YYYY-MM-DD).
 * @param options - `allowUnopened`: csak a lezárást nézi (a jóváhagyott szabadság törlésénél).
 */
export async function assertDaysOpen(
	db: Queryable,
	organizationId: number,
	days: string[],
	options: { allowUnopened?: boolean } = {}
): Promise<void> {
	if (days.length === 0) return;
	const state = await loadLeaveYearState(db, organizationId);
	const errors = lockedDayErrors(days, options.allowUnopened ? { ...state, openedYear: Number.MAX_SAFE_INTEGER } : state);
	if (errors.length > 0) throw new Error(errors[0]);
}

/**
 * A lezárt és a megnyitott év lekérdezése (a felület gombjaihoz és a naptárhoz).
 */
export async function getLeaveClosedYear(
	params: { organizationId: number },
	context: RemoteContext
): Promise<LeaveYearState> {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'leave.request');
	return loadLeaveYearState(context.db, params.organizationId);
}

/**
 * Év lezárása vagy újranyitása.
 *
 * `year` a legutolsó lezárt év (az összes korábbi is zárva), `null` a teljes
 * újranyitás. Jövő évet nem lehet lezárni.
 */
export async function setLeaveClosedYear(
	params: { organizationId: number; year: number | null },
	context: RemoteContext
): Promise<{ closedYear: number | null }> {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'leave.balance.manage');
	const year = params.year === null || params.year === undefined ? null : Number(params.year);
	if (year !== null) {
		if (!Number.isInteger(year) || year < 1970 || year > 2200) throw new Error('Érvénytelen év');
		if (year > currentYear()) throw new Error('Jövő évet nem lehet lezárni.');
	}
	await context.db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[closedYearKey(params.organizationId), JSON.stringify(year)]
	);
	return { closedYear: year };
}
