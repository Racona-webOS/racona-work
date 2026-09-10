/**
 * Éves szabadságkeret számítása a Munka törvénykönyve szerint.
 *
 * Tiszta függvény: nem ér el adatbázist, a bemenetet a hívó tölti be. Így a
 * határesetek (16. és 18. életév éve, arányosítás, kerekítés) tesztelhetők.
 * A kiszámolt érték javaslat — a HR-es korrigálhatja (leave-profile.ts).
 *
 * Szabályok és döntések: specs/leave-entitlement.md
 */

/** A szabálykészlet azonosítója. A keretek pillanatképe ezt is tárolja, hogy egy
 *  későbbi szabályváltozásnál kiderüljön, melyik számítás melyik szerint készült. */
export const RULE_SET = 'hu-mt@1';

/** Alapszabadság — Mt. 116. § */
const BASE_DAYS = 20;

/** Életkor szerinti pótszabadság — Mt. 117. §. [betöltött kor, napok], csökkenő sorrendben. */
const AGE_STEPS: ReadonlyArray<readonly [number, number]> = [
	[45, 10],
	[43, 9],
	[41, 8],
	[39, 7],
	[37, 6],
	[35, 5],
	[33, 4],
	[31, 3],
	[28, 2],
	[25, 1]
];

/** Gyermek után járó pótszabadság — Mt. 118. § (1): 1 → 2, 2 → 4, kettőnél több → 7 */
function childrenDays(count: number): number {
	if (count <= 0) return 0;
	if (count === 1) return 2;
	if (count === 2) return 4;
	return 7;
}

/** A gyereket utoljára abban az évben kell figyelembe venni, amelyben a 16. életévét betölti. */
const CHILD_LAST_AGE = 16;
/** Fiatal munkavállaló: utoljára abban az évben, amelyben a 18. életévét betölti — Mt. 119. § */
const YOUTH_LAST_AGE = 18;
const YOUTH_DAYS = 5;
const DISABLED_CHILD_DAYS = 2;

/** A törvény által rögzített napok az egyéb pótszabadságoknál (Mt. 119–120. §). */
export const STATUTORY_EXTRA_DAYS = 5;

export type ExtraLeaveKind = 'health_impaired' | 'underground_radiation' | 'custom';

export interface EntitlementExtra {
	kind: ExtraLeaveKind;
	days: number;
	validFrom: string | null;
	validTo: string | null;
	note?: string | null;
}

export interface LeavePolicy {
	/** Minden dolgozónak járó céges többlet (kollektív szerződés, belső szabályzat). */
	extraDaysForAll: number;
	extraDaysLabel?: string | null;
}

export interface EntitlementInput {
	year: number;
	birthDate: string | null;
	hireDate: string | null;
	employmentEndDate: string | null;
	children: { birthDate: string; isDisabled: boolean }[];
	extras: EntitlementExtra[];
	policy: LeavePolicy;
}

export type EntitlementItemCode =
	| 'base'
	| 'age'
	| 'youth'
	| 'children'
	| 'disabled_children'
	| 'health_impaired'
	| 'underground_radiation'
	| 'custom'
	| 'policy';

export interface EntitlementItem {
	code: EntitlementItemCode;
	days: number;
	/** Jogszabályi hivatkozás, pl. 'Mt. 117. §'. A céges tételeknél nincs. */
	legalRef?: string;
	/** A felirat paraméterei (i18n), pl. { age: 39 } vagy { count: 2 }. */
	params?: Record<string, string | number>;
}

export type EntitlementWarningCode =
	| 'missing_birth_date'
	| 'missing_hire_date'
	| 'end_before_hire'
	| 'not_employed_in_year';

export interface EntitlementWarning {
	code: EntitlementWarningCode;
	params?: Record<string, string | number>;
}

export interface EntitlementResult {
	ruleSet: string;
	year: number;
	items: EntitlementItem[];
	/** A tételek összege teljes évre. */
	fullYearDays: number;
	daysInYear: number;
	/** A munkaviszonyban töltött naptári napok a tárgyévben. */
	employedDays: number;
	/** Arányosított, kerekített végösszeg. */
	totalDays: number;
	warnings: EntitlementWarning[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD → UTC éjfél ms. */
function dayMs(isoDay: string): number {
	const [y, m, d] = isoDay.slice(0, 10).split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

function yearOf(isoDay: string): number {
	return Number(isoDay.slice(0, 4));
}

export function daysInYear(year: number): number {
	return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
}

/**
 * Az adott évben betöltött életkor. A törvény az évet nézi, nem a pontos
 * születésnapot: aki idén tölti a 25-öt, annak január 1-től jár a +1 nap.
 */
export function ageInYear(birthDate: string, year: number): number {
	return year - yearOf(birthDate);
}

/** Beszámít-e a gyerek az adott évben: a születése évétől a 16. életéve betöltésének évéig. */
export function childCountsInYear(birthDate: string, year: number): boolean {
	const age = ageInYear(birthDate, year);
	return age >= 0 && age <= CHILD_LAST_AGE;
}

/** Átfed-e egy (nyitott végű is lehet) érvényességi időszak a tárgyévvel. */
function overlapsYear(validFrom: string | null, validTo: string | null, year: number): boolean {
	const yearStart = Date.UTC(year, 0, 1);
	const yearEnd = Date.UTC(year, 11, 31);
	if (validFrom && dayMs(validFrom) > yearEnd) return false;
	if (validTo && dayMs(validTo) < yearStart) return false;
	return true;
}

/**
 * Kerekítés a Mt. 121. § (2) szerint: a fél napot elérő töredék egész nap.
 * Egész számokkal számolunk, hogy lebegőpontos hiba ne billentse át a határt.
 */
function prorate(fullYearDays: number, employedDays: number, yearDays: number): number {
	return Math.floor((2 * fullYearDays * employedDays + yearDays) / (2 * yearDays));
}

/**
 * Az éves szabadságkeret kiszámítása.
 *
 * @param input - A dolgozó adatai, a tárgyév és a céges szabály.
 * @returns Tételes bontás, arányosítás és végösszeg, figyelmeztetésekkel.
 */
export function calculateAnnualLeave(input: EntitlementInput): EntitlementResult {
	const { year } = input;
	const items: EntitlementItem[] = [];
	const warnings: EntitlementWarning[] = [];

	items.push({ code: 'base', days: BASE_DAYS, legalRef: 'Mt. 116. §' });

	// Életkor és fiatal munkavállaló
	if (input.birthDate) {
		const age = ageInYear(input.birthDate, year);
		const step = AGE_STEPS.find(([minAge]) => age >= minAge);
		if (step) {
			items.push({ code: 'age', days: step[1], legalRef: 'Mt. 117. §', params: { age } });
		}
		if (age >= 0 && age <= YOUTH_LAST_AGE) {
			items.push({ code: 'youth', days: YOUTH_DAYS, legalRef: 'Mt. 119. § (1)', params: { age } });
		}
	} else {
		warnings.push({ code: 'missing_birth_date' });
	}

	// Gyerekek
	const countedChildren = input.children.filter((c) => childCountsInYear(c.birthDate, year));
	if (countedChildren.length > 0) {
		items.push({
			code: 'children',
			days: childrenDays(countedChildren.length),
			legalRef: 'Mt. 118. § (1)',
			params: { count: countedChildren.length }
		});
	}
	const disabledCount = countedChildren.filter((c) => c.isDisabled).length;
	if (disabledCount > 0) {
		items.push({
			code: 'disabled_children',
			days: disabledCount * DISABLED_CHILD_DAYS,
			legalRef: 'Mt. 118. § (2)',
			params: { count: disabledCount }
		});
	}

	// Egyéb pótszabadságok. A törvényi jogcímek egy évben csak egyszer járnak,
	// akkor is, ha a HR több (pl. megújított) időszakot rögzített.
	const activeExtras = input.extras.filter((e) => overlapsYear(e.validFrom, e.validTo, year));
	for (const kind of ['health_impaired', 'underground_radiation'] as const) {
		const matching = activeExtras.filter((e) => e.kind === kind);
		if (matching.length > 0) {
			items.push({
				code: kind,
				days: Math.max(...matching.map((e) => e.days)),
				legalRef: kind === 'health_impaired' ? 'Mt. 120. §' : 'Mt. 119. § (2)'
			});
		}
	}
	for (const extra of activeExtras.filter((e) => e.kind === 'custom')) {
		items.push({ code: 'custom', days: extra.days, params: { note: extra.note ?? '' } });
	}

	// Céges többlet
	if (input.policy.extraDaysForAll > 0) {
		items.push({
			code: 'policy',
			days: input.policy.extraDaysForAll,
			params: { label: input.policy.extraDaysLabel ?? '' }
		});
	}

	const fullYearDays = items.reduce((sum, item) => sum + item.days, 0);
	const yearDays = daysInYear(year);

	// Arányosítás — Mt. 121. §
	let employedDays = yearDays;
	if (!input.hireDate) {
		warnings.push({ code: 'missing_hire_date' });
	}
	const yearStart = Date.UTC(year, 0, 1);
	const yearEnd = Date.UTC(year, 11, 31);
	const hireMs = input.hireDate ? dayMs(input.hireDate) : null;
	const endMs = input.employmentEndDate ? dayMs(input.employmentEndDate) : null;

	if (hireMs !== null && endMs !== null && endMs < hireMs) {
		warnings.push({ code: 'end_before_hire' });
		employedDays = 0;
	} else {
		const from = Math.max(hireMs ?? yearStart, yearStart);
		const to = Math.min(endMs ?? yearEnd, yearEnd);
		employedDays = to < from ? 0 : (to - from) / DAY_MS + 1;
	}

	if (employedDays === 0 && !warnings.some((w) => w.code === 'end_before_hire')) {
		warnings.push({ code: 'not_employed_in_year', params: { year } });
	}

	const totalDays =
		employedDays === yearDays ? fullYearDays : prorate(fullYearDays, employedDays, yearDays);

	return {
		ruleSet: RULE_SET,
		year,
		items,
		fullYearDays,
		daysInYear: yearDays,
		employedDays,
		totalDays,
		warnings
	};
}
