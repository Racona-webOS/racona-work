/**
 * Az áthozott szabadságnapok felhasználása és határideje (Mt. 123. §).
 *
 * Az áthozott napok fogynak először, a határidőig eső jóváhagyott éves
 * szabadságnapokból (leave_days; leave-entitlement.ts: carryOverUsage). A határidő
 * lejárta után a kiadatlan napok nem vesznek el: a munkáltatónak ki kell adnia
 * őket, ezért a HR figyelmeztetést kap (getCarryOverAlerts).
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import { currentYear, todayInBudapest } from './dates.js';
import { carryOverUsage } from './leave-entitlement.js';
import type { CarryOverStatus } from './leave-entitlement.js';
import { BALANCE_COLUMNS, mapBalanceRow } from './leave.js';
import type { LeaveBalance } from './leave.js';

const SCHEMA = 'app__racona_work';

export interface CarryOverAlert {
	balanceId: number;
	employeeId: number;
	employeeName: string;
	year: number;
	carriedDays: number;
	remainingDays: number;
	deadline: string;
	daysLeft: number;
	status: CarryOverStatus;
}

/**
 * Belső segéd (a functions.ts NEM reexportálja) — a leave.ts is használja.
 * Az áthozott napos keretekhez hozzáteszi a felhasználást és az állapotot.
 */
export async function enrichCarryOver(
	context: RemoteContext,
	balances: LeaveBalance[]
): Promise<LeaveBalance[]> {
	const targets = balances.filter((b) => b.carriedOverDays > 0 && b.carryOverDeadline);
	if (targets.length === 0) return balances;

	// Naponként egy tétel: így a határidő előtti napok pontosan számolhatók,
	// akkor is, ha a kérelem átnyúlik a határidőn vagy egyes napjait törölték.
	const r = await context.db.query(
		`SELECT employee_id, EXTRACT(YEAR FROM day)::int AS year,
		        to_char(day, 'YYYY-MM-DD') AS day
		   FROM ${SCHEMA}.leave_days
		  WHERE employee_id = ANY($1::int[])
		    AND EXTRACT(YEAR FROM day)::int = ANY($2::int[])
		    AND leave_type = 'annual'
		  ORDER BY day`,
		[[...new Set(targets.map((b) => b.employeeId))], [...new Set(targets.map((b) => b.year))]]
	);
	const requestsBy = new Map<string, { startDate: string; days: number }[]>();
	for (const row of r.rows) {
		const key = `${row.employee_id}:${row.year}`;
		if (!requestsBy.has(key)) requestsBy.set(key, []);
		requestsBy.get(key)!.push({ startDate: row.day, days: 1 });
	}

	const today = todayInBudapest();
	return balances.map((b) =>
		b.carriedOverDays > 0 && b.carryOverDeadline
			? {
					...b,
					carryOver: carryOverUsage({
						carriedDays: b.carriedOverDays,
						deadline: b.carryOverDeadline,
						requests: requestsBy.get(`${b.employeeId}:${b.year}`) ?? [],
						today
					})
				}
			: b
	);
}

/**
 * A szervezet lejáró (30 napon belül) és lejárt, még kiadatlan áthozott napjai,
 * határidő szerint. Csak leave.balance.manage joggal.
 */
export async function getCarryOverAlerts(
	params: { organizationId: number },
	context: RemoteContext
): Promise<CarryOverAlert[]> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'leave.balance.manage');

	// A tavalyi keretek is: egy lejárt, kiadatlan áthozatal ott is kiadandó marad
	const r = await context.db.query(
		`SELECT b.*, u.full_name AS employee_name
		   FROM (SELECT ${BALANCE_COLUMNS} FROM ${SCHEMA}.leave_balances
		          WHERE organization_id = $1 AND carried_over_days > 0 AND year >= $2) b
		   JOIN ${SCHEMA}.employees e ON e.id = b.employee_id
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.status <> 'inactive'`,
		[params.organizationId, currentYear() - 1]
	);
	const names = new Map<number, string>(r.rows.map((row: any) => [row.id, row.employee_name]));
	const balances = await enrichCarryOver(context, r.rows.map(mapBalanceRow));

	return balances
		.filter((b) => b.carryOver && (b.carryOver.status === 'due_soon' || b.carryOver.status === 'expired'))
		.map((b) => ({
			balanceId: b.id,
			employeeId: b.employeeId,
			employeeName: names.get(b.id) ?? '—',
			year: b.year,
			carriedDays: b.carryOver!.carriedDays,
			remainingDays: b.carryOver!.remainingDays,
			deadline: b.carryOver!.deadline,
			daysLeft: b.carryOver!.daysLeft,
			status: b.carryOver!.status
		}))
		.sort((a, b) => a.deadline.localeCompare(b.deadline) || a.employeeName.localeCompare(b.employeeName));
}
