/**
 * Szabadság egyenleg — a szerver lekérdezése (specs/leave-balance-overview.md, D12–D14).
 *
 * Egy hívásban adja a dolgozók nyers havi adatait, a projekteket és az év
 * tervét; a szűrést, az összesítést és a státuszt a leave-balance-utils.ts
 * számolja (a kliensen is).
 */

import type { RemoteContext } from './context.js';
import { todayInBudapest } from './dates.js';
import { BALANCE_LEAVE_TYPES } from './leave-types.js';
import { requireUsagePlanViewAccess, resolveUsagePlan } from './leave-usage-plan.js';
import type { ResolvedUsagePlan } from './leave-usage-plan.js';
import { referenceDay } from './leave-usage-plan-utils.js';
import type { BalanceEmployeeRow } from './leave-balance-utils.js';

const SCHEMA = 'app__racona_work';

export interface BalanceOverviewProject {
	id: number;
	name: string;
	status: string;
	/** A kerettel rendelkező tagok száma. */
	memberCount: number;
}

export interface LeaveBalanceOverview {
	year: number;
	/** A mai nap (budapesti idő); a kliens ezzel számol. */
	today: string;
	refDay: string;
	/** Azok az évek, amelyekre van keret, és az idei év. */
	years: number[];
	plan: ResolvedUsagePlan;
	/** Azok a projektek, amelyeknek van kerettel rendelkező tagja. */
	projects: BalanceOverviewProject[];
	employees: BalanceEmployeeRow[];
	/** A nem kilépett dolgozók, akiknek nincs keretük az évre (D12). */
	missingBalance: { employeeId: number; name: string }[];
}

function parseParams(params: { organizationId: number; year: number }): { organizationId: number; year: number } {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	const year = Number(params.year);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Érvénytelen év.');
	return { organizationId: params.organizationId, year };
}

/**
 * A szervezet szabadság egyenlege egy évre: dolgozónként a keret, a havi
 * kivett és lefoglalt napok, a függő napok és a projekttagság.
 * Jog: `leave.balance.manage` vagy `leave.approve` (D10).
 */
export async function getLeaveBalanceOverview(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<LeaveBalanceOverview> {
	const { organizationId, year } = parseParams(params);
	await requireUsagePlanViewAccess(context, organizationId);

	const today = todayInBudapest();
	const refDay = referenceDay(year, today);
	const balanceTypes = [...BALANCE_LEAVE_TYPES];
	const db = context.db;

	const [employeesResult, daysResult, pendingResult, projectsResult, membersResult, yearsResult, plan] =
		await Promise.all([
			db.query(
				`SELECT e.id, u.full_name, u.image, e.position,
				        to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date,
				        to_char(e.employment_end_date, 'YYYY-MM-DD') AS end_date,
				        b.total_days
				   FROM ${SCHEMA}.employees e
				   JOIN auth.users u ON u.id = e.user_id
				   LEFT JOIN ${SCHEMA}.leave_balances b ON b.employee_id = e.id AND b.year = $2
				  WHERE e.organization_id = $1 AND e.status <> 'inactive'
				  ORDER BY u.full_name, e.id`,
				[organizationId, year]
			),
			db.query(
				`SELECT ld.employee_id, EXTRACT(MONTH FROM ld.day)::int AS month,
				        (ld.day <= $2::date) AS taken, COUNT(*)::int AS days
				   FROM ${SCHEMA}.leave_days ld
				  WHERE ld.organization_id = $1
				    AND ld.day >= $3::date AND ld.day <= $4::date
				    AND ld.leave_type = ANY($5::text[])
				  GROUP BY ld.employee_id, month, taken`,
				[organizationId, refDay, `${year}-01-01`, `${year}-12-31`, balanceTypes]
			),
			// Mint a keret-ellenőrzésnél: a függő kérelmek napjai a kezdőnap éve szerint
			db.query(
				`SELECT lr.employee_id, COALESCE(SUM(lr.days), 0)::int AS days
				   FROM ${SCHEMA}.leave_requests lr
				  WHERE lr.organization_id = $1 AND lr.status = 'pending'
				    AND lr.leave_type = ANY($3::text[])
				    AND EXTRACT(YEAR FROM lr.start_date)::int = $2
				  GROUP BY lr.employee_id`,
				[organizationId, year, balanceTypes]
			),
			db.query(`SELECT id, name, status FROM ${SCHEMA}.projects WHERE organization_id = $1 ORDER BY name, id`, [
				organizationId
			]),
			db.query(
				`SELECT pm.project_id, pm.employee_id
				   FROM ${SCHEMA}.project_members pm
				   JOIN ${SCHEMA}.projects p ON p.id = pm.project_id
				  WHERE p.organization_id = $1`,
				[organizationId]
			),
			db.query(
				`SELECT DISTINCT b.year
				   FROM ${SCHEMA}.leave_balances b
				   JOIN ${SCHEMA}.employees e ON e.id = b.employee_id
				  WHERE e.organization_id = $1`,
				[organizationId]
			),
			resolveUsagePlan(db, organizationId, year)
		]);

	const taken = new Map<number, number[]>();
	const booked = new Map<number, number[]>();
	for (const r of daysResult.rows) {
		const target = r.taken ? taken : booked;
		const months = target.get(r.employee_id) ?? Array(12).fill(0);
		months[r.month - 1] += r.days;
		target.set(r.employee_id, months);
	}
	const pending = new Map<number, number>(pendingResult.rows.map((r: any) => [r.employee_id, r.days]));
	const projectsOf = new Map<number, number[]>();
	for (const r of membersResult.rows) {
		const list = projectsOf.get(r.employee_id) ?? [];
		list.push(r.project_id);
		projectsOf.set(r.employee_id, list);
	}

	const employees: BalanceEmployeeRow[] = [];
	const missingBalance: { employeeId: number; name: string }[] = [];
	for (const e of employeesResult.rows) {
		if (e.total_days === null || e.total_days === undefined) {
			missingBalance.push({ employeeId: e.id, name: e.full_name });
			continue;
		}
		employees.push({
			employeeId: e.id,
			name: e.full_name,
			image: e.image ?? null,
			position: e.position ?? null,
			hireDate: e.hire_date ?? null,
			employmentEndDate: e.end_date ?? null,
			totalDays: Number(e.total_days),
			takenByMonth: taken.get(e.id) ?? Array(12).fill(0),
			bookedByMonth: booked.get(e.id) ?? Array(12).fill(0),
			pending: pending.get(e.id) ?? 0,
			projectIds: projectsOf.get(e.id) ?? []
		});
	}

	const memberCount = new Map<number, number>();
	for (const e of employees) {
		for (const id of e.projectIds) memberCount.set(id, (memberCount.get(id) ?? 0) + 1);
	}
	const projects: BalanceOverviewProject[] = projectsResult.rows
		.filter((p: any) => memberCount.has(p.id))
		.map((p: any) => ({ id: p.id, name: p.name, status: p.status, memberCount: memberCount.get(p.id)! }));

	const years = new Set<number>(yearsResult.rows.map((r: any) => Number(r.year)));
	years.add(Number(today.slice(0, 4)));
	years.add(year);

	return {
		year,
		today,
		refDay,
		years: [...years].sort((a, b) => a - b),
		plan,
		projects,
		employees,
		missingBalance
	};
}
