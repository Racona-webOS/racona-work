/**
 * Szabadság egyenleg — tiszta (adatbázis nélküli) számítások.
 *
 * A szerver dolgozónként a nyers havi adatokat adja (getLeaveBalanceOverview),
 * a szűrést, a dolgozói értékeket, a státuszt, az összesítést és a grafikon
 * pontjait ez a modul számolja. A kliens is importálja, így a szűrőváltás nem
 * hív szervert. Tesztek: tests/leave-balance.test.ts.
 * Részletek: specs/leave-balance-overview.md (3–4. fejezet)
 */

import { employeePlanShare, referenceDay } from './leave-usage-plan-utils.js';
import type { UsagePlan } from './leave-usage-plan-utils.js';

/** Egy dolgozó nyers adatai az évre (a szerver válaszának sora). */
export interface BalanceEmployeeRow {
	employeeId: number;
	name: string;
	image: string | null;
	position: string | null;
	hireDate: string | null;
	employmentEndDate: string | null;
	/** A keret (`leave_balances.total_days`). */
	totalDays: number;
	/** Hónaponként a vonatkozási napig kivett, keretet terhelő napok (12 elem). */
	takenByMonth: number[];
	/** Hónaponként a vonatkozási nap utáni jóváhagyott (lefoglalt) napok (12 elem). */
	bookedByMonth: number[];
	/** A keretet terhelő függő kérelmek napjai az évben. */
	pending: number;
	/** Minden projekt, aminek tagja (a státuszát a projektlista adja). */
	projectIds: number[];
}

export type BalanceStatus = 'too_high' | 'slightly_high' | 'fast' | 'ok' | 'none';

/** A státuszok súlyossági sorrendje (a táblázat alapértelmezett rendezése). */
export const STATUS_ORDER: readonly BalanceStatus[] = ['too_high', 'slightly_high', 'fast', 'ok', 'none'];

export interface TrendPoint {
	/** A nap (hónap vége vagy a vonatkozási nap). */
	day: string;
	deviation: number;
}

export interface EmployeeFigures {
	taken: number;
	booked: number;
	/** K − kivett. */
	remaining: number;
	/** A tervezett maradék a vonatkozási napon. */
	planned: number;
	/** fennmaradó − tervezett. */
	deviation: number;
	/** K − kivett − lefoglalt. */
	free: number;
	toleranceDays: number;
	criticalDays: number;
	status: BalanceStatus;
	trend: TrendPoint[];
}

const sum = (values: number[], count = values.length) => values.slice(0, count).reduce((a, b) => a + b, 0);

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** A hónap utolsó napja (YYYY-MM-DD). */
export function monthEnd(year: number, month: number): string {
	return `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/** A nap helye a grafikon vízszintes tengelyén: 0 az év eleje, m az m. hónap vége. */
export function dayPosition(isoDay: string): number {
	const year = Number(isoDay.slice(0, 4));
	const month = Number(isoDay.slice(5, 7));
	const day = Number(isoDay.slice(8, 10));
	return month - 1 + day / new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function plannedRemaining(row: BalanceEmployeeRow, plan: UsagePlan, year: number, isoDay: string): number {
	const employment = { hireDate: row.hireDate, employmentEndDate: row.employmentEndDate };
	return row.totalDays * (1 - employeePlanShare(plan.months, employment, year, isoDay) / 100);
}

/**
 * A státusz (4.3): a „magas” a lefoglalt napokkal csökkentett maradékot, a
 * „gyorsan fogy” a kivett napok utáni maradékot méri a tervhez. A határon Rendben.
 */
export function classifyStatus(input: {
	totalDays: number;
	remaining: number;
	free: number;
	planned: number;
	toleranceDays: number;
	criticalDays: number;
}): BalanceStatus {
	if (input.totalDays <= 0) return 'none';
	if (input.free - input.planned > input.criticalDays) return 'too_high';
	if (input.free - input.planned > input.toleranceDays) return 'slightly_high';
	if (input.remaining - input.planned < -input.toleranceDays) return 'fast';
	return 'ok';
}

/**
 * Egy dolgozó értékei a vonatkozási napon, a trenddel (legfeljebb 6 pont: az
 * elmúlt hónapok vége és a vonatkozási nap).
 *
 * @param row - A dolgozó nyers adatai.
 * @param plan - Az év terve.
 * @param year - Az év.
 * @param refDay - A vonatkozási nap (referenceDay).
 */
export function employeeFigures(
	row: BalanceEmployeeRow,
	plan: UsagePlan,
	year: number,
	refDay: string
): EmployeeFigures {
	const taken = sum(row.takenByMonth);
	const booked = sum(row.bookedByMonth);
	const remaining = row.totalDays - taken;
	const planned = plannedRemaining(row, plan, year, refDay);
	const free = remaining - booked;
	const toleranceDays = (row.totalDays * plan.tolerancePct) / 100;
	const criticalDays = (row.totalDays * plan.criticalPct) / 100;

	const refMonth = Number(refDay.slice(5, 7));
	const points: TrendPoint[] = [];
	for (let m = 1; m < refMonth; m++) {
		const day = monthEnd(year, m);
		points.push({ day, deviation: row.totalDays - sum(row.takenByMonth, m) - plannedRemaining(row, plan, year, day) });
	}
	points.push({ day: refDay, deviation: remaining - planned });

	return {
		taken,
		booked,
		remaining,
		planned,
		deviation: remaining - planned,
		free,
		toleranceDays,
		criticalDays,
		status: classifyStatus({ totalDays: row.totalDays, remaining, free, planned, toleranceDays, criticalDays }),
		trend: points.slice(-6)
	};
}

// --- Szűrés ------------------------------------------------------------------

export type BalanceFilter = { kind: 'all' } | { kind: 'no_project' } | { kind: 'project'; projectId: number };

/** A futó projekt státuszai: ezek számítanak a „Projekt nélkül” szűrőnél és a címkéknél. */
export const RUNNING_PROJECT_STATUSES: readonly string[] = ['active', 'paused'];

/**
 * A szűrt dolgozók (K12). Egy dolgozó egy nézetben egyszer szerepel.
 *
 * @param rows - Minden dolgozó.
 * @param filter - A szűrő.
 * @param runningProjectIds - A futó projektek azonosítói.
 */
export function filterRows(
	rows: BalanceEmployeeRow[],
	filter: BalanceFilter,
	runningProjectIds: ReadonlySet<number>
): BalanceEmployeeRow[] {
	if (filter.kind === 'project') return rows.filter((r) => r.projectIds.includes(filter.projectId));
	if (filter.kind === 'no_project') return rows.filter((r) => !r.projectIds.some((id) => runningProjectIds.has(id)));
	return rows;
}

// --- Összesítés (4.4) --------------------------------------------------------

export interface SeriesPoint {
	/** 0 az év eleje, m az m. hónap vége; a vonatkozási nap törtérték. */
	x: number;
	value: number;
}

export interface MonthDetail {
	month: number;
	/** A hónap végén (a folyamatban lévő hónapban a vonatkozási napon); null, ha még nincs. */
	actual: number | null;
	planned: number;
	/** A lefoglalt napok levonása után a hónap végén; null, ha nincs lefoglalt nap vagy a hónap elmúlt. */
	booked: number | null;
}

export interface BalanceSummary {
	count: number;
	okCount: number;
	attentionCount: number;
	totalDays: number;
	taken: number;
	booked: number;
	pending: number;
	remaining: number;
	planned: number;
	/** kivett / keret; null, ha nincs keret. */
	usageRatio: number | null;
	averageRemaining: number | null;
	averagePlanned: number | null;
	/** Az előző hónap végén fennmaradó napok; januárban és jövő évnél null. */
	previousMonthRemaining: number | null;
	chart: {
		actual: SeriesPoint[];
		planned: SeriesPoint[];
		bandLow: SeriesPoint[];
		bandHigh: SeriesPoint[];
		booked: SeriesPoint[];
		/** A vonatkozási nap helye; jövő évnél null. */
		refX: number | null;
		months: MonthDetail[];
	};
}

/**
 * A szűrt dolgozók összesítése és a grafikon pontjai. Egy dolgozóra is
 * hívható (a grafikon dolgozóválasztójához).
 *
 * @param rows - A szűrt dolgozók.
 * @param plan - Az év terve.
 * @param year - Az év.
 * @param today - A mai nap (a szerver válaszából, budapesti idő).
 */
export function aggregate(rows: BalanceEmployeeRow[], plan: UsagePlan, year: number, today: string): BalanceSummary {
	const refDay = referenceDay(year, today);
	const future = year > Number(today.slice(0, 4));
	const refMonth = Number(refDay.slice(5, 7));
	const refIsMonthEnd = refDay === monthEnd(year, refMonth);
	const figures = rows.map((r) => employeeFigures(r, plan, year, refDay));

	const totalDays = sum(rows.map((r) => r.totalDays));
	const taken = sum(figures.map((f) => f.taken));
	const booked = sum(figures.map((f) => f.booked));
	const remaining = totalDays - taken;
	const planned = sum(figures.map((f) => f.planned));
	const count = rows.length;
	const band = (totalDays * plan.tolerancePct) / 100;

	/** Σ (K − a hónap végéig kivett); csak a vonatkozási napig elmúlt hónapokra. */
	const remainingAtMonthEnd = (m: number) => totalDays - sum(rows.map((r) => sum(r.takenByMonth, m)));
	const plannedAt = (day: string) => sum(rows.map((r) => plannedRemaining(r, plan, year, day)));
	const bookedThrough = (m: number) => sum(rows.map((r) => sum(r.bookedByMonth, m)));

	const plannedSeries: SeriesPoint[] = [{ x: 0, value: totalDays }];
	for (let m = 1; m <= 12; m++) plannedSeries.push({ x: m, value: plannedAt(monthEnd(year, m)) });

	const actual: SeriesPoint[] = [];
	const bookedSeries: SeriesPoint[] = [];
	let refX: number | null = null;
	if (!future) {
		actual.push({ x: 0, value: totalDays });
		const lastFullMonth = refIsMonthEnd ? refMonth : refMonth - 1;
		for (let m = 1; m <= lastFullMonth; m++) actual.push({ x: m, value: remainingAtMonthEnd(m) });
		refX = dayPosition(refDay);
		if (!refIsMonthEnd) actual.push({ x: refX, value: remaining });
	}
	if (booked > 0) {
		bookedSeries.push({ x: future ? 0 : (refX as number), value: remaining });
		for (let m = future ? 1 : refMonth; m <= 12; m++) {
			if (!future && m === refMonth && refIsMonthEnd) continue;
			bookedSeries.push({ x: m, value: remaining - bookedThrough(m) });
		}
	}

	const months: MonthDetail[] = [];
	for (let m = 1; m <= 12; m++) {
		const passed = !future && (m < refMonth || (m === refMonth && refIsMonthEnd));
		const current = !future && m === refMonth && !refIsMonthEnd;
		months.push({
			month: m,
			actual: passed ? remainingAtMonthEnd(m) : current ? remaining : null,
			// A folyamatban lévő hónapban a tényleges a mai napé, ezért a terv is
			planned: current ? plannedAt(refDay) : plannedSeries[m].value,
			booked: booked > 0 && !passed ? remaining - bookedThrough(m) : null
		});
	}

	return {
		count,
		okCount: figures.filter((f) => f.status === 'ok').length,
		attentionCount: figures.filter((f) => f.status !== 'ok' && f.status !== 'none').length,
		totalDays,
		taken,
		booked,
		pending: sum(rows.map((r) => r.pending)),
		remaining,
		planned,
		usageRatio: totalDays > 0 ? taken / totalDays : null,
		averageRemaining: count > 0 ? remaining / count : null,
		averagePlanned: count > 0 ? planned / count : null,
		previousMonthRemaining: !future && refMonth > 1 ? remainingAtMonthEnd(refMonth - 1) : null,
		chart: {
			actual,
			planned: plannedSeries,
			bandLow: plannedSeries.map((p) => ({ x: p.x, value: Math.max(0, p.value - band) })),
			bandHigh: plannedSeries.map((p) => ({ x: p.x, value: p.value + band })),
			booked: bookedSeries,
			refX,
			months
		}
	};
}
