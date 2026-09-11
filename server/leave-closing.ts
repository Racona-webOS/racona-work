/**
 * Év lezárása — a lezárt évre és a korábbiakra már nem lehet szabadságot
 * rögzíteni vagy módosítani.
 *
 * A HR (`leave.balance.manage`) zárja le az évet; a beállítás a kv_store-ban
 * van (`settings:leave_closed_year:org_<id>`), az érték a legutolsó lezárt év.
 * A kérelem beadása, jóváhagyása, törlése és a naptáras mentés ellenőrzi.
 * Részletek: specs/leave-days.md
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import { currentYear } from './dates.js';

const SCHEMA = 'app__racona_work';

function closedYearKey(organizationId: number): string {
	return `settings:leave_closed_year:org_${organizationId}`;
}

/** Lekérdezés-képes kapcsolat: a pool vagy egy tranzakció kliense. */
interface Queryable {
	query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/**
 * A szervezet legutolsó lezárt éve, vagy null, ha nincs lezárás.
 *
 * @param db - Kapcsolat.
 * @param organizationId - A szervezet.
 */
export async function loadClosedYear(db: Queryable, organizationId: number): Promise<number | null> {
	const r = await db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
		closedYearKey(organizationId)
	]);
	const value = r.rows[0]?.value;
	return Number.isInteger(value) ? Number(value) : null;
}

/** A nap lezárt évre esik-e. */
export function isDayClosed(isoDay: string, closedYear: number | null): boolean {
	return closedYear !== null && Number(isoDay.slice(0, 4)) <= closedYear;
}

/**
 * Hibát dob, ha a napok bármelyike lezárt évre esik.
 *
 * @param db - Kapcsolat.
 * @param organizationId - A szervezet.
 * @param days - A vizsgált napok (YYYY-MM-DD).
 */
export async function assertDaysOpen(db: Queryable, organizationId: number, days: string[]): Promise<void> {
	if (days.length === 0) return;
	const closedYear = await loadClosedYear(db, organizationId);
	const closed = days.filter((d) => isDayClosed(d, closedYear));
	if (closed.length > 0) {
		throw new Error(
			`A(z) ${closedYear}. évig az évek le vannak zárva, szabadságot már nem lehet rájuk rögzíteni vagy módosítani (${closed[0]}).`
		);
	}
}

/**
 * A lezárt év lekérdezése (a felület gombjaihoz és a naptárhoz).
 */
export async function getLeaveClosedYear(
	params: { organizationId: number },
	context: RemoteContext
): Promise<{ closedYear: number | null }> {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'leave.request');
	return { closedYear: await loadClosedYear(context.db, params.organizationId) };
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
