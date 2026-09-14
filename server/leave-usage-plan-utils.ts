/**
 * Szabadságfelhasználási terv — tiszta (adatbázis nélküli) segédfüggvények.
 *
 * A terv 12 havi halmozott százalék: az m. hónap végéig az éves keret hány
 * százalékát célszerű kivenni. Mellette a tűrés és a kritikus küszöb, mindkettő
 * az éves keret százalékában. A terv tervezési referencia, nem tilt semmit.
 *
 * Külön modul, hogy a kliens is importálhassa (mint a leave-day-utils.ts), és a
 * tests/leave-usage-plan.test.ts tesztelhesse. A szerver oldali műveletek a
 * leave-usage-plan.ts fájlban vannak. Részletek: specs/leave-balance-overview.md
 */

export interface UsagePlan {
	/** 12 egész szám 0 és 100 között, hónapról hónapra nem csökken. */
	months: number[];
	/** Az éves keret százalékában: e fölött „enyhén magas” / „gyorsan fogy”. */
	tolerancePct: number;
	/** Az éves keret százalékában: e fölött „túl magas”. */
	criticalPct: number;
}

export const DEFAULT_TOLERANCE_PCT = 10;
export const DEFAULT_CRITICAL_PCT = 20;

/** Az egyenletes eloszlás havi értékei: round(100 · m / 12). */
export function uniformMonths(): number[] {
	return Array.from({ length: 12 }, (_, i) => Math.round((100 * (i + 1)) / 12));
}

/** Az egyenletes eloszlás az alapértelmezett küszöbökkel. */
export function uniformPlan(): UsagePlan {
	return { months: uniformMonths(), tolerancePct: DEFAULT_TOLERANCE_PCT, criticalPct: DEFAULT_CRITICAL_PCT };
}

// --- Ellenőrzés --------------------------------------------------------------

export type PlanErrorCode =
	| 'months_length'
	| 'month_range'
	| 'month_decreasing'
	| 'tolerance_range'
	| 'critical_range'
	| 'critical_not_above';

export interface PlanError {
	field: 'months' | 'tolerancePct' | 'criticalPct';
	/** A hónap (1–12), ha a hiba egy hónaphoz tartozik. */
	month?: number;
	code: PlanErrorCode;
}

function isPercent(value: unknown, min: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 100;
}

/**
 * A terv ellenőrzése. Hibánként egy bejegyzés; a csökkenő hónapnál a későbbi
 * (kisebb) hónap kapja a hibát.
 *
 * @param input - A felületről vagy a hívásból érkező terv.
 * @returns A hibák és hiba nélkül a tiszta terv.
 */
export function validatePlan(input: {
	months?: unknown;
	tolerancePct?: unknown;
	criticalPct?: unknown;
}): { plan: UsagePlan | null; errors: PlanError[] } {
	const errors: PlanError[] = [];
	const months = Array.isArray(input?.months) ? input.months : null;

	if (!months || months.length !== 12) {
		errors.push({ field: 'months', code: 'months_length' });
	} else {
		let previous: number | null = null;
		months.forEach((value, i) => {
			if (!isPercent(value, 0)) {
				errors.push({ field: 'months', month: i + 1, code: 'month_range' });
				return;
			}
			if (previous !== null && value < previous) {
				errors.push({ field: 'months', month: i + 1, code: 'month_decreasing' });
			}
			previous = value;
		});
	}

	const tolerance = input?.tolerancePct;
	const critical = input?.criticalPct;
	const toleranceOk = isPercent(tolerance, 1);
	const criticalOk = isPercent(critical, 1);
	if (!toleranceOk) errors.push({ field: 'tolerancePct', code: 'tolerance_range' });
	if (!criticalOk) errors.push({ field: 'criticalPct', code: 'critical_range' });
	if (toleranceOk && criticalOk && critical <= tolerance) {
		errors.push({ field: 'criticalPct', code: 'critical_not_above' });
	}

	if (errors.length > 0) return { plan: null, errors };
	return {
		plan: { months: [...(months as number[])], tolerancePct: tolerance as number, criticalPct: critical as number },
		errors
	};
}

/** A szerver hibaüzenete (a felület a locales fájlokból fordít). */
export function planErrorMessage(error: PlanError): string {
	switch (error.code) {
		case 'months_length':
			return 'A tervnek 12 havi értéket kell tartalmaznia.';
		case 'month_range':
			return `A(z) ${error.month}. hónap értéke 0 és 100 közötti egész szám legyen.`;
		case 'month_decreasing':
			return `A(z) ${error.month}. hónap értéke nem lehet kisebb az előző hónapénál.`;
		case 'tolerance_range':
			return 'A tűrés 1 és 100 közötti egész szám legyen.';
		case 'critical_range':
			return 'A kritikus küszöb 1 és 100 közötti egész szám legyen.';
		case 'critical_not_above':
			return 'A kritikus küszöb legyen nagyobb a tűrésnél.';
	}
}

/** Egy tárolt érték tervként, vagy null, ha nem érvényes (pl. kézzel módosított kv_store). */
export function normalizeStoredPlan(raw: unknown): UsagePlan | null {
	if (!raw || typeof raw !== 'object') return null;
	return validatePlan(raw as Record<string, unknown>).plan;
}

// --- Dolgozó terve (specs/leave-balance-overview.md, 4.2) ----------------------

export interface Employment {
	hireDate: string | null;
	employmentEndDate: string | null;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function yearOf(isoDay: string): number {
	return Number(isoDay.slice(0, 4));
}

function monthOf(isoDay: string): number {
	return Number(isoDay.slice(5, 7));
}

/**
 * A dolgozó tervezett aránya (0–100) a nap végén.
 *
 * A terv a munkaviszony hónapjaira skálázódik: a belépés hónapjától indul, és ha
 * a dolgozó az évben kilép, a kilépés hónapjára éri el a 100%-ot. Hónapon belül
 * a nap arányában halad. A belépés előtt 0, a kilépés után a cél.
 *
 * @param months - A terv havi értékei (P[1..12]).
 * @param employment - Belépés és kilépés napja (YYYY-MM-DD vagy null).
 * @param year - A terv éve.
 * @param isoDay - A vizsgált nap (YYYY-MM-DD).
 */
export function employeePlanShare(months: number[], employment: Employment, year: number, isoDay: string): number {
	const { hireDate, employmentEndDate: endDate } = employment;
	const P = (m: number) => (m <= 0 ? 0 : months[m - 1]);

	if (hireDate && yearOf(hireDate) > year) return 0;
	if (endDate && yearOf(endDate) < year) return 100;

	const endsInYear = !!endDate && yearOf(endDate) === year;
	const target = endsInYear ? 100 : P(12);
	if (yearOf(isoDay) < year || (hireDate && isoDay < hireDate)) return 0;
	if (yearOf(isoDay) > year || (endDate && isoDay >= endDate)) return target;

	const s = hireDate && yearOf(hireDate) === year ? monthOf(hireDate) : 1;
	const e = endsInYear ? monthOf(endDate!) : 12;
	const a = P(s - 1);
	const b = P(e);

	const monthShare = (m: number): number => {
		if (m < s) return 0;
		if (m >= e) return target;
		if (b > a) return ((P(m) - a) / (b - a)) * target;
		return ((m - s + 1) / (e - s + 1)) * target;
	};

	const m = monthOf(isoDay);
	const d = Number(isoDay.slice(8, 10));
	const before = monthShare(m - 1);
	return before + ((monthShare(m) - before) * d) / daysInMonth(year, m);
}

/**
 * A vonatkozási nap: a mai nap az évre szorítva (múltbeli évnél dec. 31.,
 * jövőbelinél jan. 1.).
 *
 * @param year - A kiválasztott év.
 * @param today - A mai nap (YYYY-MM-DD, budapesti idő).
 */
export function referenceDay(year: number, today: string): string {
	const thisYear = yearOf(today);
	if (year < thisYear) return `${year}-12-31`;
	if (year > thisYear) return `${year}-01-01`;
	return today;
}
