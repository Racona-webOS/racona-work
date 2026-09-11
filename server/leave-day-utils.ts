/**
 * Szabadságnapok — tiszta (adatbázis nélküli) segédfüggvények.
 *
 * Külön modul, hogy a kliens is importálhassa (mint a leave-types.ts), és a
 * tests/leave-days.test.ts tesztelhesse. A szerver oldali műveletek a
 * leave-days.ts fájlban vannak. Részletek: specs/leave-days.md
 */

import type { LeaveType } from './leave-types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A naptárban felvehető típusok (specs/leave-days.md, D9). A gyerekhez kötött
 * apasági és szülői szabadság kimarad, azt kérelemként kell rögzíteni.
 */
export const CALENDAR_LEAVE_TYPES: readonly LeaveType[] = ['annual', 'company_mandatory', 'sick', 'unpaid', 'other'];

/**
 * A dolgozó a saját naptárából ezeket kérheti (specs/leave-days.md, K15). A
 * gyerekhez kötött típusok az űrlapon maradnak, a céges kötelező a HR-é.
 */
export const REQUEST_CALENDAR_LEAVE_TYPES: readonly LeaveType[] = ['annual', 'sick', 'unpaid', 'other'];

/** Egy összefüggő szabadságszakasz a naptárban felvett napokból. */
export interface LeaveRun {
	/** Az első felvett nap (YYYY-MM-DD). */
	startDate: string;
	/** Az utolsó felvett nap (YYYY-MM-DD). */
	endDate: string;
	/** A szakasz napjai növekvő sorrendben. */
	days: string[];
}

/** Naptári napok szerint összefüggő időszak. */
export interface DayPeriod {
	from: string;
	to: string;
}

function dayMs(isoDay: string): number {
	const [y, m, d] = isoDay.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

function msToIsoDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A nap után következő nap.
 *
 * @param isoDay - A nap YYYY-MM-DD formában.
 * @returns A következő nap YYYY-MM-DD formában.
 */
export function nextDay(isoDay: string): string {
	return msToIsoDay(dayMs(isoDay) + DAY_MS);
}

/**
 * Munkanap-e a nap: a munkanaptári kivétel dönt, ha van; egyébként a hétvége
 * nem munkanap.
 *
 * @param isoDay - A nap YYYY-MM-DD formában.
 * @param overrides - Nap → munkanap-e leképezés a munkanaptárból.
 * @returns Igaz, ha munkanap.
 */
export function isWorkingDay(isoDay: string, overrides?: Map<string, boolean>): boolean {
	const override = overrides?.get(isoDay);
	if (override !== undefined) return override;
	const dow = new Date(dayMs(isoDay)).getUTCDay();
	return dow !== 0 && dow !== 6;
}

/**
 * Egy időszak munkanapjai.
 *
 * Alapszabály: a hétvége nem munkanap. Az `overrides` ezt felülírja naponként —
 * innen jönnek a munkaszüneti napok (hétköznap, mégsem munkanap) és az
 * áthelyezett munkanapok (szombat, mégis munkanap). UTC alapú iteráció, hogy a
 * téli-nyári időszámítás ne okozzon eltolódást.
 *
 * @param startDate - Kezdő dátum (YYYY-MM-DD).
 * @param endDate - Záró dátum (YYYY-MM-DD).
 * @param overrides - Nap → munkanap-e leképezés; hiányzó napra a hétvége-szabály dönt.
 * @returns A munkanapok növekvő sorrendben; üres, ha a kezdő nap a záró után van.
 * @throws Ha a dátum formátuma nem YYYY-MM-DD.
 */
export function listWorkingDays(
	startDate: string,
	endDate: string,
	overrides?: Map<string, boolean>
): string[] {
	if (!ISO_DAY.test(startDate) || !ISO_DAY.test(endDate)) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}
	const startMs = dayMs(startDate);
	const endMs = dayMs(endDate);
	if (isNaN(startMs) || isNaN(endMs)) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}

	const days: string[] = [];
	for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
		const iso = msToIsoDay(ms);
		if (isWorkingDay(iso, overrides)) days.push(iso);
	}
	return days;
}

/**
 * Rendezett, ismétlés nélküli naplista.
 *
 * @param days - Napok YYYY-MM-DD formában, tetszőleges sorrendben.
 * @returns Növekvő sorrend, minden nap egyszer.
 * @throws Ha valamelyik nap formátuma nem YYYY-MM-DD.
 */
export function normalizeDays(days: string[]): string[] {
	for (const day of days) {
		if (typeof day !== 'string' || !ISO_DAY.test(day) || msToIsoDay(dayMs(day)) !== day) {
			throw new Error(`Érvénytelen nap: ${String(day)}`);
		}
	}
	return [...new Set(days)].sort();
}

/**
 * A felvett napok összefüggő szakaszokra bontása (specs/leave-days.md, D7).
 *
 * Két felvett nap egy szakaszban van, ha köztük csak nem munkanap áll: a
 * hétvége és a munkaszüneti nap nem szakít. Péntek és a következő hétfő így egy
 * szakasz, ahogy egy kézzel beadott kérelemnél is. Egy kihagyott munkanap új
 * szakaszt kezd.
 *
 * @param days - A felvett napok, tetszőleges sorrendben, ismétléssel is.
 * @param isWorking - Munkanap-e a nap (a hívó adja a munkanaptárral).
 * @returns A szakaszok növekvő sorrendben.
 */
export function groupIntoRuns(days: string[], isWorking: (isoDay: string) => boolean): LeaveRun[] {
	const sorted = normalizeDays(days);
	const runs: LeaveRun[] = [];
	let current: LeaveRun | null = null;

	for (const day of sorted) {
		if (current && !hasWorkingDayBetween(current.endDate, day, isWorking)) {
			current.endDate = day;
			current.days.push(day);
		} else {
			current = { startDate: day, endDate: day, days: [day] };
			runs.push(current);
		}
	}
	return runs;
}

/** Van-e munkanap két nap között (a két napot nem számítva). */
function hasWorkingDayBetween(
	from: string,
	to: string,
	isWorking: (isoDay: string) => boolean
): boolean {
	for (let ms = dayMs(from) + DAY_MS; ms < dayMs(to); ms += DAY_MS) {
		if (isWorking(msToIsoDay(ms))) return true;
	}
	return false;
}

/**
 * Naptári napok szerint összefüggő időszakok a napokból.
 *
 * A fizetés nélküli szabadság napjait így adjuk át a keretszámításnak, ami
 * időszakokkal dolgozik (a naptári napokat számolja, a hétvégével együtt).
 * A hétvége itt szakít: egy hétfő–péntek és a rá következő hétfő–péntek két
 * időszak, mert a köztes hétvége nem szabadságnap.
 *
 * @param days - Napok YYYY-MM-DD formában, tetszőleges sorrendben.
 * @returns Az időszakok növekvő sorrendben.
 */
export function daysToPeriods(days: string[]): DayPeriod[] {
	const sorted = normalizeDays(days);
	const periods: DayPeriod[] = [];
	let current: DayPeriod | null = null;

	for (const day of sorted) {
		if (current && nextDay(current.to) === day) {
			current.to = day;
		} else {
			current = { from: day, to: day };
			periods.push(current);
		}
	}
	return periods;
}

/**
 * Napok évenként csoportosítva (az éves keret az adott év napjait terheli).
 *
 * @param days - Napok YYYY-MM-DD formában.
 * @returns Év → napok.
 */
export function groupDaysByYear(days: string[]): Map<number, string[]> {
	const byYear = new Map<number, string[]>();
	for (const day of days) {
		const year = Number(day.slice(0, 4));
		if (!byYear.has(year)) byYear.set(year, []);
		byYear.get(year)!.push(day);
	}
	return byYear;
}
