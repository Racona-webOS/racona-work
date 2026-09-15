/**
 * Évnyitás és a kötelező szabadságok kiírása (specs/year-opening.md).
 *
 * Az évnyitás megnyitja az évet a szabadságrögzítéshez, minden aktív
 * dolgozónak létrehozza a hiányzó, számított keretét (áthozatal nélkül), és a
 * munkanaptár kötelező szabadság napjait jóváhagyott szabadságként kiírja.
 * A kiírás nyitott évre külön is futtatható: ami még nincs kiírva, azt pótolja.
 *
 * Mindkettőnek van előnézete; a végrehajtás egy tranzakcióban a friss
 * adatokból újra elkészíti a tervet, és a véglegesítés után értesít.
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { currentYear } from './dates.js';
import { requireCapability } from './permissions.js';
import { getWorkCalendarOverrides } from './work-calendar.js';
import { isYearOpen, loadLeaveYearState, openedYearKey } from './leave-closing.js';
import type { LeaveYearState } from './leave-closing.js';
import { createYearBalances, planYearBalances } from './leave-profile.js';
import {
	findEmployeeIdOfUser,
	groupIntoRuns,
	insertLeaveDays,
	isWorkingDay,
	syncAnnualUsedDays
} from './leave-days.js';
import type { Queryable } from './leave-days.js';
import { BALANCE_LEAVE_TYPES } from './leave-types.js';
import { notifyLeaveDaysAdded } from './leave-notifications.js';
import { copyUsagePlanToYear, resolveUsagePlan } from './leave-usage-plan.js';
import type { UsagePlanSource } from './leave-usage-plan.js';

const SCHEMA = 'app__racona_work';
const MANDATORY_TYPE = 'company_mandatory';

/** Egy kiírandó szakasz: egy jóváhagyott kérelem lesz belőle. */
export interface MandatoryLeavePeriod {
	startDate: string;
	endDate: string;
	days: number;
}

/** Egy dolgozó sora: mi történik vele. */
export interface MandatoryLeaveRow {
	employeeId: number;
	employeeName: string;
	/** A munkaviszonya idejére eső kötelező napok száma. */
	applicableDays: number;
	/** Ennyi napon már van szabadsága (bármilyen típusú). */
	coveredDays: number;
	/** A kiírandó napok. */
	assignDays: string[];
	/** A kiírandó napokból készülő kérelmek. */
	periods: MandatoryLeavePeriod[];
	/** Függő kérelem esik rájuk: kimaradnak, elbírálás után újra futtatható. */
	pendingDays: string[];
	/** A keretbe nem férnek bele (vagy nincs keret): kimaradnak. */
	shortDays: string[];
	/** Van-e (évnyitásnál: lesz-e) kerete az évre. */
	hasBalance: boolean;
	/** A maradék keret a kiírás előtt. */
	remainingBefore: number;
	/** Évnyitásnál: a meglévő keret összege; null, ha most készül. */
	existingBalance: number | null;
	/** Évnyitásnál: a most készülő, számított keret; null, ha már van. */
	newBalance: number | null;
}

export interface MandatoryLeavePlan {
	year: number;
	/** Az év kötelező szabadság napjai a munkanaptárból. */
	mandatoryDays: string[];
	rows: MandatoryLeaveRow[];
	/** Ennyi dolgozónak kerül ki szabadság. */
	employeesToAssign: number;
	/** Összesen ennyi nap kerül ki. */
	daysToAssign: number;
}

export interface OpenLeaveYearPreview extends MandatoryLeavePlan {
	/** Megnyitható-e az év; ha nem, a `blockedReason` mondja meg, miért. */
	canOpen: boolean;
	blockedReason: string | null;
	/** Ennyi dolgozónak készül új keret. */
	newBalances: number;
	/** A felhasználási terv, amit az évnyitás az évre átvesz (specs/leave-balance-overview.md, K8). */
	usagePlan: { source: UsagePlanSource; inheritedFromYear: number | null };
}

export interface MandatoryLeaveResult {
	employees: number;
	days: number;
	requests: number;
}

export interface OpenLeaveYearResult extends MandatoryLeaveResult {
	year: number;
	createdBalances: number;
}

// --- Segédek -----------------------------------------------------------------

function parseParams(params: { organizationId: number; year: number }): { organizationId: number; year: number } {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	const year = Number(params.year);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Érvénytelen év.');
	return { organizationId: params.organizationId, year };
}

/**
 * Miért nem nyitható meg az év (specs/year-opening.md, D3); null, ha megnyitható.
 * Sorban nyithatók, a legutolsó megnyitott utáni évvel kezdve, legfeljebb a jövő év.
 */
export function openingBlockReason(year: number, state: LeaveYearState, thisYear: number): string | null {
	if (state.closedYear !== null && year <= state.closedYear) return `A(z) ${year}. év le van zárva.`;
	if (state.openedYear !== null && year <= state.openedYear) return `A(z) ${year}. év már meg van nyitva.`;
	if (year > thisYear + 1) return `Legfeljebb a jövő év (${thisYear + 1}) nyitható meg.`;
	if (state.openedYear !== null && year !== state.openedYear + 1) {
		return `Előbb a(z) ${state.openedYear + 1}. évet kell megnyitni.`;
	}
	return null;
}

/** A munkaviszony idejére esik-e a nap (belépés és kilépés napja is beleszámít). */
function withinEmployment(day: string, hireDate: string | null, endDate: string | null): boolean {
	return (!hireDate || hireDate <= day) && (!endDate || day <= endDate);
}

/**
 * A kötelező szabadságok terve (D5–D7). Nem ír semmit.
 *
 * @param db - Kapcsolat; a végrehajtásnál a tranzakció kliense, hogy a friss keretet lássa.
 * @param context - Remote kontextus (a munkanaptárhoz).
 * @param organizationId - A szervezet.
 * @param year - Az év.
 * @param prospective - Évnyitás előnézeténél a még nem létező keretek összege dolgozónként.
 */
async function planMandatoryLeave(
	db: Queryable,
	context: RemoteContext,
	organizationId: number,
	year: number,
	prospective: Map<number, number> = new Map()
): Promise<MandatoryLeavePlan> {
	const from = `${year}-01-01`;
	const to = `${year}-12-31`;

	// Egymás után: a végrehajtásnál a tranzakció kliensén fut, ott a párhuzamos
	// lekérdezés elavult (pg 9-ben hiba)
	const mandatory = await db.query(
		`SELECT to_char(day, 'YYYY-MM-DD') AS day FROM ${SCHEMA}.work_calendar_days
		  WHERE organization_id = $1 AND kind = 'mandatory_leave' AND day >= $2::date AND day <= $3::date
		  ORDER BY day`,
		[organizationId, from, to]
	);
	const employees = await db.query(
		`SELECT e.id, u.full_name,
		        to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date,
		        to_char(e.employment_end_date, 'YYYY-MM-DD') AS employment_end_date
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.organization_id = $1 AND e.status <> 'inactive' AND e.is_external = FALSE
		  ORDER BY u.full_name, e.id`,
		[organizationId]
	);
	const mandatoryDays: string[] = mandatory.rows.map((r: { day: string }) => r.day);
	const ids: number[] = employees.rows.map((e: { id: number }) => e.id);
	const none = { rows: [] as any[] };

	const taken =
		mandatoryDays.length > 0
			? await db.query(
					`SELECT employee_id, to_char(day, 'YYYY-MM-DD') AS day FROM ${SCHEMA}.leave_days
					  WHERE employee_id = ANY($1::int[]) AND day = ANY($2::date[])`,
					[ids, mandatoryDays]
				)
			: none;
	const pending =
		mandatoryDays.length > 0
			? await db.query(
					`SELECT employee_id, to_char(start_date, 'YYYY-MM-DD') AS start_date,
					        to_char(end_date, 'YYYY-MM-DD') AS end_date
					   FROM ${SCHEMA}.leave_requests
					  WHERE employee_id = ANY($1::int[]) AND status = 'pending'
					    AND start_date <= $3::date AND end_date >= $2::date`,
					[ids, mandatoryDays[0], mandatoryDays[mandatoryDays.length - 1]]
				)
			: none;
	const balances = await db.query(
		`SELECT employee_id, remaining_days FROM ${SCHEMA}.leave_balances
		  WHERE employee_id = ANY($1::int[]) AND year = $2`,
		[ids, year]
	);
	// A leendő keret maradékához: az év már jóváhagyott, keretet terhelő napjai
	const used =
		prospective.size > 0
			? await db.query(
					`SELECT employee_id, COUNT(*)::int AS used FROM ${SCHEMA}.leave_days
					  WHERE employee_id = ANY($1::int[]) AND leave_type = ANY($2::text[])
					    AND day >= $3::date AND day <= $4::date
					  GROUP BY employee_id`,
					[[...prospective.keys()], [...BALANCE_LEAVE_TYPES], from, to]
				)
			: none;
	const overrides =
		mandatoryDays.length > 0
			? await getWorkCalendarOverrides(context, organizationId, from, to)
			: new Map<string, boolean>();

	const takenBy = new Map<number, Set<string>>();
	for (const r of taken.rows) {
		if (!takenBy.has(r.employee_id)) takenBy.set(r.employee_id, new Set());
		takenBy.get(r.employee_id)!.add(r.day);
	}
	const pendingBy = new Map<number, { start: string; end: string }[]>();
	for (const r of pending.rows) {
		if (!pendingBy.has(r.employee_id)) pendingBy.set(r.employee_id, []);
		pendingBy.get(r.employee_id)!.push({ start: r.start_date, end: r.end_date });
	}
	const remainingBy = new Map<number, number>(balances.rows.map((r: any) => [r.employee_id, r.remaining_days]));
	const usedBy = new Map<number, number>(used.rows.map((r: any) => [r.employee_id, r.used]));
	for (const [employeeId, total] of prospective) {
		if (!remainingBy.has(employeeId)) remainingBy.set(employeeId, total - (usedBy.get(employeeId) ?? 0));
	}
	const working = (day: string) => isWorkingDay(day, overrides);

	const rows: MandatoryLeaveRow[] = employees.rows.map((e: any) => {
		const applicable = mandatoryDays.filter((d) => withinEmployment(d, e.hire_date, e.employment_end_date));
		const own = takenBy.get(e.id) ?? new Set<string>();
		const covered = applicable.filter((d) => own.has(d));
		const open = applicable.filter((d) => !own.has(d));
		const requests = pendingBy.get(e.id) ?? [];
		const pendingDays = open.filter((d) => requests.some((r) => r.start <= d && d <= r.end));
		const needed = open.filter((d) => !pendingDays.includes(d));

		const hasBalance = remainingBy.has(e.id);
		const remainingBefore = remainingBy.get(e.id) ?? 0;
		// Időrendben az elsők, amennyi a keretbe fér (D7)
		const capacity = hasBalance ? Math.max(0, remainingBefore) : 0;
		const assignDays = needed.slice(0, capacity);

		return {
			employeeId: e.id,
			employeeName: e.full_name ?? '—',
			applicableDays: applicable.length,
			coveredDays: covered.length,
			assignDays,
			periods: groupIntoRuns(assignDays, working).map((r) => ({
				startDate: r.startDate,
				endDate: r.endDate,
				days: r.days.length
			})),
			pendingDays,
			shortDays: needed.slice(capacity),
			hasBalance,
			remainingBefore,
			existingBalance: null,
			newBalance: null
		};
	});

	const toAssign = rows.filter((r) => r.assignDays.length > 0);
	return {
		year,
		mandatoryDays,
		rows,
		employeesToAssign: toAssign.length,
		daysToAssign: toAssign.reduce((sum, r) => sum + r.assignDays.length, 0)
	};
}

/**
 * A terv végrehajtása a tranzakción belül (D8): szakaszonként egy jóváhagyott
 * kötelező szabadság kérelem és a napjai, majd a keret felhasználásának frissítése.
 *
 * @returns Dolgozónként a létrehozott időszakok, az értesítéshez.
 */
async function executeMandatoryLeave(
	client: Queryable,
	organizationId: number,
	plan: MandatoryLeavePlan,
	approverEmployeeId: number | null
): Promise<{ employeeId: number; periods: MandatoryLeavePeriod[] }[]> {
	const done: { employeeId: number; periods: MandatoryLeavePeriod[] }[] = [];
	for (const row of plan.rows) {
		if (row.assignDays.length === 0) continue;
		for (const period of row.periods) {
			const inserted = await client.query(
				`INSERT INTO ${SCHEMA}.leave_requests
					(employee_id, organization_id, leave_type, start_date, end_date, days, status,
					 approved_by, created_at, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, NOW(), NOW())
				 RETURNING id`,
				[row.employeeId, organizationId, MANDATORY_TYPE, period.startDate, period.endDate, period.days, approverEmployeeId]
			);
			const days = row.assignDays.filter((d) => d >= period.startDate && d <= period.endDate);
			await insertLeaveDays(client, {
				employeeId: row.employeeId,
				organizationId,
				leaveRequestId: inserted.rows[0].id,
				leaveType: MANDATORY_TYPE,
				days
			});
		}
		await syncAnnualUsedDays(client, row.employeeId, [plan.year]);
		done.push({ employeeId: row.employeeId, periods: row.periods });
	}
	return done;
}

/** A szervezet aktív dolgozóinak zárolása: a naptáras mentések addig várnak. */
async function lockEmployees(client: Queryable, organizationId: number): Promise<void> {
	await client.query(
		`SELECT id FROM ${SCHEMA}.employees WHERE organization_id = $1 AND status <> 'inactive' ORDER BY id FOR UPDATE`,
		[organizationId]
	);
}

async function notifyAll(
	context: RemoteContext,
	organizationId: number,
	done: { employeeId: number; periods: MandatoryLeavePeriod[] }[]
): Promise<void> {
	for (const item of done) {
		await notifyLeaveDaysAdded(context, {
			employeeId: item.employeeId,
			organizationId,
			leaveType: MANDATORY_TYPE,
			periods: item.periods,
			event: 'leave.mandatoryAssigned'
		});
	}
}

function summarize(done: { periods: MandatoryLeavePeriod[] }[]): MandatoryLeaveResult {
	return {
		employees: done.length,
		days: done.reduce((sum, d) => sum + d.periods.reduce((s, p) => s + p.days, 0), 0),
		requests: done.reduce((sum, d) => sum + d.periods.length, 0)
	};
}

// --- Remote függvények -------------------------------------------------------

/**
 * Az évnyitás előnézete: megnyitható-e, a keretek és a kötelező szabadságok
 * terve dolgozónként, a leendő keretekkel számolva.
 */
export async function previewOpenLeaveYear(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<OpenLeaveYearPreview> {
	const { organizationId, year } = parseParams(params);
	await requireCapability(context, organizationId, 'leave.balance.manage');

	const state = await loadLeaveYearState(context.db, organizationId);
	const blockedReason = openingBlockReason(year, state, currentYear());
	const balances = await planYearBalances(context, organizationId, year);
	const prospective = new Map(
		balances.filter((b) => b.calculatedTotal !== null).map((b) => [b.employeeId, b.calculatedTotal!])
	);
	const plan = await planMandatoryLeave(context.db, context, organizationId, year, prospective);
	const usagePlan = await resolveUsagePlan(context.db, organizationId, year);
	const byEmployee = new Map(balances.map((b) => [b.employeeId, b]));
	for (const row of plan.rows) {
		const b = byEmployee.get(row.employeeId);
		row.existingBalance = b?.existingTotal ?? null;
		row.newBalance = b?.calculatedTotal ?? null;
	}

	return {
		...plan,
		canOpen: blockedReason === null,
		blockedReason,
		newBalances: prospective.size,
		usagePlan: { source: usagePlan.source, inheritedFromYear: usagePlan.inheritedFromYear }
	};
}

/**
 * Évnyitás egy tranzakcióban (D9): a megnyitott év beállítása, a hiányzó
 * keretek létrehozása, a kötelező szabadságok kiírása; utána értesítés.
 */
export async function openLeaveYear(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<OpenLeaveYearResult> {
	const { organizationId, year } = parseParams(params);
	await requireCapability(context, organizationId, 'leave.balance.manage');
	const userId = await resolveUserId(context);
	const approverEmployeeId = await findEmployeeIdOfUser(context.db, userId, organizationId);

	const client = await context.db.connect();
	let createdBalances = 0;
	let done: { employeeId: number; periods: MandatoryLeavePeriod[] }[] = [];
	try {
		await client.query('BEGIN');
		await lockEmployees(client, organizationId);
		const blocked = openingBlockReason(year, await loadLeaveYearState(client, organizationId), currentYear());
		if (blocked) throw new Error(blocked);

		await client.query(
			`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
			 VALUES ($1, $2::jsonb, NOW())
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
			[openedYearKey(organizationId), JSON.stringify(year)]
		);
		await copyUsagePlanToYear(client, organizationId, year);
		createdBalances = await createYearBalances(client, context, organizationId, year, userId);
		const plan = await planMandatoryLeave(client, context, organizationId, year);
		done = await executeMandatoryLeave(client, organizationId, plan, approverEmployeeId);
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	await notifyAll(context, organizationId, done);
	return { year, createdBalances, ...summarize(done) };
}

async function requireOpenYear(context: RemoteContext, organizationId: number, year: number): Promise<void> {
	if (!isYearOpen(year, await loadLeaveYearState(context.db, organizationId))) {
		throw new Error(`A(z) ${year}. év nincs megnyitva, vagy le van zárva.`);
	}
}

/** A kötelező szabadságok terve nyitott évre: kinek, melyik napokra kerül ki szabadság. */
export async function previewMandatoryLeave(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<MandatoryLeavePlan> {
	const { organizationId, year } = parseParams(params);
	await requireCapability(context, organizationId, 'leave.balance.manage');
	await requireOpenYear(context, organizationId, year);
	return planMandatoryLeave(context.db, context, organizationId, year);
}

/** A kötelező szabadságok kiírása nyitott évre, a friss adatokból újratervezve. */
export async function applyMandatoryLeave(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<MandatoryLeaveResult> {
	const { organizationId, year } = parseParams(params);
	await requireCapability(context, organizationId, 'leave.balance.manage');
	const userId = await resolveUserId(context);
	const approverEmployeeId = await findEmployeeIdOfUser(context.db, userId, organizationId);

	const client = await context.db.connect();
	let done: { employeeId: number; periods: MandatoryLeavePeriod[] }[] = [];
	try {
		await client.query('BEGIN');
		await lockEmployees(client, organizationId);
		if (!isYearOpen(year, await loadLeaveYearState(client, organizationId))) {
			throw new Error(`A(z) ${year}. év nincs megnyitva, vagy le van zárva.`);
		}
		const plan = await planMandatoryLeave(client, context, organizationId, year);
		done = await executeMandatoryLeave(client, organizationId, plan, approverEmployeeId);
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	await notifyAll(context, organizationId, done);
	return summarize(done);
}
