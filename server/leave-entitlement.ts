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
export const RULE_SET = 'hu-mt@2';

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
/** A gyermekgondozási fizetés nélküli szabadságból ennyi hónap még munkában töltött idő. */
const CHILDCARE_COUNTED_MONTHS = 6;

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

/**
 * Nem munkában töltött időszak (Mt. 115. §). Az `unpaid_request` a jóváhagyott
 * fizetés nélküli szabadságkérelmekből jön, a többit a HR rögzíti.
 */
export type AbsenceKind =
	| 'unpaid_leave'
	| 'childcare_unpaid_leave'
	| 'unexcused_absence'
	| 'other'
	| 'unpaid_request';

export interface EntitlementAbsence {
	kind: AbsenceKind;
	from: string;
	to: string;
}

export interface EntitlementInput {
	year: number;
	birthDate: string | null;
	hireDate: string | null;
	employmentEndDate: string | null;
	children: { birthDate: string; isDisabled: boolean }[];
	extras: EntitlementExtra[];
	policy: LeavePolicy;
	/** Hiányzó mező: nincs levonandó időszak (a hu-mt@1 pillanatképekben nincs). */
	absences?: EntitlementAbsence[];
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
	/**
	 * Ebből a nem munkában töltött napok (Mt. 115. §). Az arányosítás alapja
	 * employedDays − nonCountingDays. A hu-mt@1 pillanatképekben nincs (= 0).
	 */
	nonCountingDays?: number;
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

	// Arányosítás — Mt. 121. §, a nem munkában töltött idő nélkül (Mt. 115. §)
	if (!input.hireDate) {
		warnings.push({ code: 'missing_hire_date' });
	}
	const window = employmentWindow(year, input.hireDate, input.employmentEndDate);
	if (window.endBeforeHire) {
		warnings.push({ code: 'end_before_hire' });
	} else if (window.days === 0) {
		warnings.push({ code: 'not_employed_in_year', params: { year } });
	}

	const nonCountingDays = window.days > 0 ? countNonCountingDays(input.absences ?? [], window) : 0;
	const countedDays = window.days - nonCountingDays;
	const totalDays =
		countedDays === yearDays ? fullYearDays : prorate(fullYearDays, countedDays, yearDays);

	return {
		ruleSet: RULE_SET,
		year,
		items,
		fullYearDays,
		daysInYear: yearDays,
		employedDays: window.days,
		nonCountingDays,
		totalDays,
		warnings
	};
}

// --- Munkaviszony és távollétek ---------------------------------------------

interface EmploymentWindow {
	/** UTC ms, a tárgyévre vágva. Csak days > 0 esetén értelmes. */
	fromMs: number;
	toMs: number;
	days: number;
	endBeforeHire: boolean;
}

/** A munkaviszony a tárgyévben: [max(belépés, jan. 1.), min(kilépés, dec. 31.)]. */
function employmentWindow(
	year: number,
	hireDate: string | null,
	employmentEndDate: string | null
): EmploymentWindow {
	const yearStart = Date.UTC(year, 0, 1);
	const yearEnd = Date.UTC(year, 11, 31);
	const hireMs = hireDate ? dayMs(hireDate) : null;
	const endMs = employmentEndDate ? dayMs(employmentEndDate) : null;

	if (hireMs !== null && endMs !== null && endMs < hireMs) {
		return { fromMs: yearStart, toMs: yearStart, days: 0, endBeforeHire: true };
	}
	const fromMs = Math.max(hireMs ?? yearStart, yearStart);
	const toMs = Math.min(endMs ?? yearEnd, yearEnd);
	const days = toMs < fromMs ? 0 : (toMs - fromMs) / DAY_MS + 1;
	return { fromMs, toMs, days, endBeforeHire: false };
}

/** YYYY-MM-DD + n hónap, a hónap végére igazítva (jan. 31. + 1 hónap = febr. 28/29.). */
function addMonths(isoDay: string, months: number): number {
	const [y, m, d] = isoDay.slice(0, 10).split('-').map(Number);
	const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
	return Date.UTC(y, m - 1 + months, Math.min(d, lastDay));
}

/**
 * Egy távollét nem munkában töltött része [ms, ms] intervallumként, vagy null.
 * A gyermek gondozása céljából kapott fizetés nélküli szabadság első hat
 * hónapja munkában töltött időnek számít (Mt. 115. § (2)), csak az utána lévő
 * rész nem.
 */
function nonCountingInterval(absence: EntitlementAbsence): [number, number] | null {
	const from = dayMs(absence.from);
	const to = dayMs(absence.to);
	if (to < from) return null;
	if (absence.kind === 'childcare_unpaid_leave') {
		const after = addMonths(absence.from, CHILDCARE_COUNTED_MONTHS);
		return after <= to ? [after, to] : null;
	}
	return [from, to];
}

/**
 * A munkaviszony-időszakba eső nem munkában töltött napok száma. Az átfedő
 * időszakok (pl. a HR által rögzített és egy jóváhagyott kérelem) csak egyszer
 * számítanak.
 */
function countNonCountingDays(absences: EntitlementAbsence[], window: EmploymentWindow): number {
	const intervals = absences
		.map(nonCountingInterval)
		.filter((i): i is [number, number] => i !== null)
		.map(([from, to]) => [Math.max(from, window.fromMs), Math.min(to, window.toMs)] as [number, number])
		.filter(([from, to]) => from <= to)
		.sort((a, b) => a[0] - b[0]);

	let days = 0;
	let current: [number, number] | null = null;
	for (const interval of intervals) {
		if (current && interval[0] <= current[1] + DAY_MS) {
			current[1] = Math.max(current[1], interval[1]);
		} else {
			if (current) days += (current[1] - current[0]) / DAY_MS + 1;
			current = [interval[0], interval[1]];
		}
	}
	if (current) days += (current[1] - current[0]) / DAY_MS + 1;
	return days;
}

// --- Betegszabadság, apasági és szülői szabadság -----------------------------

/** Betegszabadság: naptári évenként 15 munkanap — Mt. 126. § */
export const SICK_LEAVE_DAYS = 15;
/** Apasági szabadság: 10 munkanap, ikreknél sem több — Mt. 118. § (4) */
export const PATERNITY_DAYS = 10;
/** Az apasági szabadságot legfeljebb két részletben kell kiadni. */
export const PATERNITY_MAX_PARTS = 2;
/** Szülői szabadság: 44 munkanap a gyermek hároméves koráig — Mt. 128/A. § */
export const PARENTAL_DAYS = 44;

export interface SickLeaveAllowance {
	year: number;
	fullYearDays: number;
	daysInYear: number;
	employedDays: number;
	/** Arányosított keret (év közbeni belépésnél vagy kilépésnél). */
	totalDays: number;
}

/**
 * A betegszabadság éves kerete. Év közben kezdődő munkaviszonynál arányos
 * része jár; a kerekítés ugyanaz, mint a szabadságnál.
 */
export function calculateSickLeave(input: {
	year: number;
	hireDate: string | null;
	employmentEndDate: string | null;
}): SickLeaveAllowance {
	const yearDays = daysInYear(input.year);
	const window = employmentWindow(input.year, input.hireDate, input.employmentEndDate);
	return {
		year: input.year,
		fullYearDays: SICK_LEAVE_DAYS,
		daysInYear: yearDays,
		employedDays: window.days,
		totalDays:
			window.days === yearDays ? SICK_LEAVE_DAYS : prorate(SICK_LEAVE_DAYS, window.days, yearDays)
	};
}

function isoFromMs(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Ettől a naptól vehető ki az apasági szabadság, és ehhez képest számít a
 * határidő: a születés napja, örökbefogadásnál az örökbefogadást engedélyező
 * határozat véglegessé válásának napja (Mt. 118. § (4)).
 */
export function paternityStartDate(birthDate: string, adoptionDate?: string | null): string {
	return adoptionDate ?? birthDate;
}

/**
 * Az apasági szabadság utolsó napja: a születést — örökbefogadásnál a
 * határozat véglegessé válását — követő negyedik hónap vége.
 */
export function paternityDeadline(birthDate: string, adoptionDate?: string | null): string {
	const [y, m] = paternityStartDate(birthDate, adoptionDate).slice(0, 10).split('-').map(Number);
	return isoFromMs(Date.UTC(y, m - 1 + 5, 0));
}

/** A szülői szabadság utolsó napja: a gyermek harmadik születésnapja előtti nap. */
export function parentalDeadline(birthDate: string): string {
	return isoFromMs(addMonths(birthDate, 36) - DAY_MS);
}

/** Szülői szabadság attól a naptól jár, amikor a munkaviszony egy éve fennáll. */
export function parentalEligibleFrom(hireDate: string): string {
	return isoFromMs(addMonths(hireDate, 12));
}

// --- Áthozott napok határideje (Mt. 123. §) ------------------------------------

/** Ennyi nappal a határidő előtt jelezzük, hogy hamarosan lejár. */
export const CARRY_OVER_DUE_SOON_DAYS = 30;

/**
 * done: minden áthozott napot kivett; open: van még idő;
 * due_soon: 30 napon belül lejár; expired: lejárt, és maradt kiadatlan nap.
 */
export type CarryOverStatus = 'done' | 'open' | 'due_soon' | 'expired';

export interface CarryOverUsage {
	carriedDays: number;
	usedDays: number;
	remainingDays: number;
	deadline: string;
	/** Hány nap van hátra a határidőig (lejárt határidőnél negatív). */
	daysLeft: number;
	status: CarryOverStatus;
}

/** Az alapeset: a következő év március 31. (október 1. utáni belépés, a munkáltató gazdasági érdeke). */
export function defaultCarryOverDeadline(year: number): string {
	return `${year}-03-31`;
}

/**
 * Az áthozott napok felhasználása. Az áthozott napok fogynak először: a
 * határidőig kezdődő jóváhagyott éves szabadságkérelmek napjai ezekből
 * vonódnak le. A határidő lejárta után a kiadatlan napok nem vesznek el
 * (a munkáltatónak ki kell adnia őket) — ezért itt csak az állapotot jelezzük.
 *
 * @param input.requests - A keret évének jóváhagyott éves szabadságkérelmei.
 * @param input.today - A mai nap (YYYY-MM-DD), a teszthez megadható.
 */
export function carryOverUsage(input: {
	carriedDays: number;
	deadline: string;
	requests: { startDate: string; days: number }[];
	today: string;
}): CarryOverUsage {
	const takenBeforeDeadline = input.requests
		.filter((r) => r.startDate.slice(0, 10) <= input.deadline)
		.reduce((sum, r) => sum + r.days, 0);
	const usedDays = Math.min(input.carriedDays, takenBeforeDeadline);
	const remainingDays = input.carriedDays - usedDays;
	const daysLeft = (dayMs(input.deadline) - dayMs(input.today)) / DAY_MS;

	let status: CarryOverStatus = 'open';
	if (remainingDays === 0) status = 'done';
	else if (daysLeft < 0) status = 'expired';
	else if (daysLeft <= CARRY_OVER_DUE_SOON_DAYS) status = 'due_soon';

	return {
		carriedDays: input.carriedDays,
		usedDays,
		remainingDays,
		deadline: input.deadline,
		daysLeft,
		status
	};
}
