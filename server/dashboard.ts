/**
 * Irányítópult — szerver oldali függvények.
 *
 * Egyetlen hívásban adja vissza a szervezet összesítő statisztikáit.
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin } from './context.js';
import { hasCapability } from './permissions.js';
import type { LeaveRequestRow } from './leave.js';

export interface DashboardStats {
	totalEmployees: number;
	activeEmployees: number;
	pendingLeaveRequests: number;
	onLeaveThisMonth: number;
	recentPendingRequests: LeaveRequestRow[];
}

/**
 * Irányítópult összefoglaló statisztikák egyetlen hívással, szervezet szerint szűrve.
 * Követelmények: 6.3, 6.4, 9.1, 9.2, 9.4
 */
export async function getDashboardStats(
	params: { organizationId: number },
	context: RemoteContext
): Promise<DashboardStats> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	// Vezetői dashboard: leave.approve VAGY employee.manage kell.
	// Alap dolgozó (csak leave.request + employee.view) self-service nézetet kap a kliensen.
	if (!isDevMode(context) && !isCoreAdmin(context)) {
		const canApprove = await hasCapability(context, params.organizationId, 'leave.approve');
		const canManageEmp = canApprove
			? true
			: await hasCapability(context, params.organizationId, 'employee.manage');
		if (!canApprove && !canManageEmp) {
			throw new Error('Nincs jogosultságod a vezetői irányítópult megtekintéséhez');
		}
	}

	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
	const nextMonth =
		month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

	// Összes és aktív dolgozók száma (csak az adott szervezetben)
	const employeeCountResult = await context.db.query(
		`SELECT
			COUNT(*) AS total_employees,
			COUNT(*) FILTER (WHERE e.status = 'active') AS active_employees
		 FROM app__racona_work.employees e
		 WHERE e.organization_id = $1`,
		[params.organizationId]
	);

	// Függőben lévő szabadságkérelmek száma (csak az adott szervezet dolgozóinak)
	const pendingResult = await context.db.query(
		`SELECT COUNT(*) AS pending_leave_requests
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON e.id = lr.employee_id
		 WHERE lr.status = 'pending' AND e.organization_id = $1`,
		[params.organizationId]
	);

	// Aktuális hónapban szabadságon lévők száma (jóváhagyott, átfedő kérelmek, csak az adott szervezetben)
	const onLeaveResult = await context.db.query(
		`SELECT COUNT(DISTINCT lr.employee_id) AS on_leave_this_month
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON e.id = lr.employee_id
		 WHERE lr.status = 'approved'
		   AND lr.start_date < $1
		   AND lr.end_date >= $2
		   AND e.organization_id = $3`,
		[nextMonth, monthStart, params.organizationId]
	);

	// Legutóbbi 5 függőben lévő kérelem (dolgozó névvel, csak az adott szervezetből)
	const recentResult = await context.db.query(
		`SELECT
			lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
			lr.days, lr.status, lr.reason, lr.approved_by, lr.created_at, lr.updated_at,
			u.full_name AS employee_name,
			NULL AS approver_name
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON e.id = lr.employee_id
		 JOIN auth.users u ON u.id = e.user_id
		 WHERE lr.status = 'pending' AND e.organization_id = $1
		 ORDER BY lr.created_at DESC
		 LIMIT 5`,
		[params.organizationId]
	);

	const empRow = employeeCountResult.rows[0];
	const pendingRow = pendingResult.rows[0];
	const onLeaveRow = onLeaveResult.rows[0];

	const recentPendingRequests: LeaveRequestRow[] = recentResult.rows.map((row: any) => ({
		id: row.id,
		employeeId: row.employee_id,
		leaveType: row.leave_type,
		startDate: row.start_date,
		endDate: row.end_date,
		days: row.days,
		status: row.status,
		reason: row.reason,
		approvedBy: row.approved_by,
		childId: row.child_id ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		employeeName: row.employee_name,
		approverName: row.approver_name
	}));

	return {
		totalEmployees: parseInt(empRow.total_employees, 10),
		activeEmployees: parseInt(empRow.active_employees, 10),
		pendingLeaveRequests: parseInt(pendingRow.pending_leave_requests, 10),
		onLeaveThisMonth: parseInt(onLeaveRow.on_leave_this_month, 10),
		recentPendingRequests
	};
}
