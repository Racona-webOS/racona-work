/**
 * Szabadság nyilvántartó — szerver oldali függvények.
 *
 * Szabadságkérelmek (leave_requests) és éves egyenlegek (leave_balances).
 * A munkanap-számítás tiszta segédfüggvényként itt él (calculateWorkingDays).
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin, resolveUserId } from './context.js';
import { requireCapability } from './permissions.js';
import { getEmployeeOrganizationId } from './employees.js';
import { getWorkCalendarOverrides } from './work-calendar.js';
import type { PaginatedResult } from './types.js';

export interface LeaveRequestListParams {
	organizationId: number;
	page?: number;
	pageSize?: number;
	sortBy?: string;
	sortOrder?: 'asc' | 'desc';
	employeeId?: number;
	status?: string;
}

export interface CreateLeaveRequestParams {
	employeeId: number;
	organizationId: number;
	leaveType: string;
	startDate: string;
	endDate: string;
	reason?: string;
}

export interface LeaveRequest {
	id: number;
	employeeId: number;
	leaveType: string;
	startDate: string;
	endDate: string;
	days: number;
	status: string;
	reason: string | null;
	approvedBy: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface LeaveRequestRow extends LeaveRequest {
	employeeName: string;
	approverName: string | null;
}

export interface LeaveBalance {
	id: number;
	employeeId: number;
	year: number;
	totalDays: number;
	usedDays: number;
	remainingDays: number;
}

/**
 * A pg DATE oszlopot Date-ként is visszaadhatja — egységes ISO napra hozzuk.
 *
 * @param value - A nyers dátumérték az adatbázisból.
 * @returns A nap YYYY-MM-DD formában.
 */
function toIsoDay(value: string | Date): string {
	if (value instanceof Date) {
		return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
			.toISOString()
			.slice(0, 10);
	}
	return String(value).slice(0, 10);
}

/**
 * Munkanapok számítása két dátum között.
 *
 * Alapszabály: a hétvége nem munkanap. Az `overrides` ezt felülírja naponként —
 * innen jönnek a munkaszüneti napok (hétköznap, mégsem munkanap) és az
 * áthelyezett munkanapok (szombat, mégis munkanap).
 *
 * Tiszta (pure) segédfüggvény: a naptárat a hívó tölti be és adja át, hogy a
 * függvény tesztelhető maradjon — Property 6 validálja.
 *
 * @param startDate - Kezdő dátum (YYYY-MM-DD).
 * @param endDate - Záró dátum (YYYY-MM-DD).
 * @param overrides - Nap → munkanap-e leképezés; hiányzó napra a hétvége-szabály dönt.
 * @returns A munkanapok száma.
 */
export function calculateWorkingDays(
	startDate: string,
	endDate: string,
	overrides?: Map<string, boolean>
): number {
	const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (!dateFormatRegex.test(startDate) || !dateFormatRegex.test(endDate)) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}

	const start = new Date(startDate);
	const end = new Date(endDate);

	if (isNaN(start.getTime()) || isNaN(end.getTime())) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}

	if (start > end) {
		return 0;
	}

	let workingDays = 0;
	// UTC alapú iteráció, hogy DST ne okozzon eltolódást
	let currentMs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
	const endMs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

	while (currentMs <= endMs) {
		const current = new Date(currentMs);
		const isoDay = current.toISOString().slice(0, 10);
		const override = overrides?.get(isoDay);

		if (override !== undefined) {
			// A naptári kivétel felülírja a hétvége-szabályt mindkét irányban
			if (override) workingDays++;
		} else {
			const dayOfWeek = current.getUTCDay();
			// 0 = vasárnap, 6 = szombat
			if (dayOfWeek !== 0 && dayOfWeek !== 6) {
				workingDays++;
			}
		}
		currentMs += 24 * 60 * 60 * 1000;
	}

	return workingDays;
}

/**
 * Szabadságkérelmek lapozott, szűrt listája JOIN-olva a dolgozó nevével.
 * Követelmények: 6.5, 6.6, 8.1, 8.2
 */
export async function getLeaveRequests(
	params: LeaveRequestListParams,
	context: RemoteContext
): Promise<PaginatedResult<LeaveRequestRow>> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'leave.request');

	const page = params.page ?? 1;
	const pageSize = params.pageSize ?? 20;
	const sortOrder = params.sortOrder === 'desc' ? 'DESC' : 'ASC';

	const sortColumnMap: Record<string, string> = {
		employeeName: 'e_user.full_name',
		leaveType: 'lr.leave_type',
		startDate: 'lr.start_date',
		endDate: 'lr.end_date',
		days: 'lr.days',
		status: 'lr.status',
		createdAt: 'lr.created_at'
	};

	const sortColumn = sortColumnMap[params.sortBy ?? 'createdAt'] ?? 'lr.created_at';

	const conditions: string[] = ['e.organization_id = $1'];
	const queryParams: unknown[] = [params.organizationId];
	let paramIndex = 2;

	if (params.employeeId !== undefined) {
		conditions.push(`lr.employee_id = $${paramIndex}`);
		queryParams.push(params.employeeId);
		paramIndex++;
	}

	if (params.status) {
		conditions.push(`lr.status = $${paramIndex}`);
		queryParams.push(params.status);
		paramIndex++;
	}

	const whereClause = `WHERE ${conditions.join(' AND ')}`;

	const countResult = await context.db.query(
		`SELECT COUNT(*) AS total
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON lr.employee_id = e.id
		 JOIN auth.users e_user ON e.user_id = e_user.id

		 ${whereClause}`,
		queryParams
	);

	const totalCount = parseInt(countResult.rows[0].total, 10);
	const totalPages = Math.ceil(totalCount / pageSize);
	const offset = (page - 1) * pageSize;

	const dataResult = await context.db.query(
		`SELECT
			lr.id,
			lr.employee_id,
			lr.leave_type,
			lr.start_date,
			lr.end_date,
			lr.days,
			lr.status,
			lr.reason,
			lr.approved_by,
			lr.created_at,
			lr.updated_at,
			e_user.full_name AS employee_name,
			approver_user.full_name AS approver_name
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON lr.employee_id = e.id
		 JOIN auth.users e_user ON e.user_id = e_user.id

		 LEFT JOIN app__racona_work.employees approver ON lr.approved_by = approver.id
		 LEFT JOIN auth.users approver_user ON approver.user_id = approver_user.id
		 ${whereClause}
		 ORDER BY ${sortColumn} ${sortOrder}
		 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
		[...queryParams, pageSize, offset]
	);

	const data: LeaveRequestRow[] = dataResult.rows.map((row: any) => ({
		id: row.id,
		employeeId: row.employee_id,
		leaveType: row.leave_type,
		startDate: row.start_date,
		endDate: row.end_date,
		days: row.days,
		status: row.status,
		reason: row.reason ?? null,
		approvedBy: row.approved_by ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		employeeName: row.employee_name,
		approverName: row.approver_name ?? null
	}));

	return {
		data,
		pagination: { page, pageSize, totalCount, totalPages }
	};
}

/**
 * Új szabadságkérelem létrehozása.
 * Követelmények: 8.3, 8.4, 8.5, 8.8
 */
export async function createLeaveRequest(
	params: CreateLeaveRequestParams,
	context: RemoteContext
): Promise<LeaveRequest> {
	const { employeeId, organizationId, leaveType, startDate, endDate, reason } = params;

	if (!organizationId || organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	// Alap leave.request képesség szükséges. Aki "más nevében" is rögzít,
	// annak leave.approve-ra is szüksége van — ezt alább, az employee id
	// ismeretében ellenőrizzük.
	await requireCapability(context, organizationId, 'leave.request');

	// Ha az employee nem a hívó saját rekordja → leave.approve szükséges.
	// Core admin / dev mód automatikusan ok.
	if (!isDevMode(context) && !isCoreAdmin(context)) {
		const callerUserId = await resolveUserId(context);
		const empRow = await context.db.query(
			`SELECT user_id FROM app__racona_work.employees WHERE id = $1 AND organization_id = $2`,
			[employeeId, organizationId]
		);
		if (empRow.rows.length === 0) {
			throw new Error('A dolgozó nem található ebben a szervezetben');
		}
		if ((empRow.rows[0] as { user_id: number }).user_id !== callerUserId) {
			await requireCapability(context, organizationId, 'leave.approve');
		}
	}

	const start = new Date(startDate);
	const end = new Date(endDate);
	if (isNaN(start.getTime()) || isNaN(end.getTime())) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}
	if (start > end) {
		throw new Error('A záró dátum nem lehet korábbi a kezdő dátumnál.');
	}

	const calendar = await getWorkCalendarOverrides(context, organizationId, startDate, endDate);
	const days = calculateWorkingDays(startDate, endDate, calendar);

	// Szabadságkeret ellenőrzés (csak éves szabadságnál)
	if (leaveType === 'annual') {
		const year = start.getFullYear();
		const balanceResult = await context.db.query(
			`SELECT remaining_days FROM app__racona_work.leave_balances
			 WHERE employee_id = $1 AND year = $2`,
			[employeeId, year]
		);

		if (balanceResult.rows.length === 0) {
			throw new Error(
				`Nincs szabadságkeret beállítva a(z) ${year}. évre. Kérjük, állítsa be a keretet először.`
			);
		}

		const remainingDays: number = balanceResult.rows[0].remaining_days;
		if (days > remainingDays) {
			throw new Error(
				`Nincs elegendő szabad keret. Kért napok: ${days}, fennmaradó napok: ${remainingDays}.`
			);
		}
	}

	const insertResult = await context.db.query(
		`INSERT INTO app__racona_work.leave_requests
			(employee_id, organization_id, leave_type, start_date, end_date, days, status, reason, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW(), NOW())
		 RETURNING id, employee_id, leave_type, start_date, end_date, days, status, reason, approved_by, created_at, updated_at`,
		[employeeId, organizationId, leaveType, startDate, endDate, days, reason ?? null]
	);

	const row = insertResult.rows[0];
	const leaveRequest: LeaveRequest = {
		id: row.id,
		employeeId: row.employee_id,
		leaveType: row.leave_type,
		startDate: row.start_date,
		endDate: row.end_date,
		days: row.days,
		status: row.status,
		reason: row.reason ?? null,
		approvedBy: row.approved_by ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};

	// Értesítés küldése a beállításokban megjelölt személyeknek (8.8)
	try {
		const settingsResult = await context.db.query(
			`SELECT value FROM app__racona_work.kv_store WHERE key = $1`,
			['settings:leave_request_notifiers']
		);

		if (settingsResult.rows.length > 0) {
			const notifierIds: number[] = settingsResult.rows[0].value ?? [];

			if (notifierIds.length > 0) {
				const empResult = await context.db.query(
					`SELECT u.full_name FROM app__racona_work.employees e
					 JOIN auth.users u ON e.user_id = u.id
					 WHERE e.id = $1`,
					[employeeId]
				);
				const employeeName = empResult.rows[0]?.name ?? 'Ismeretlen dolgozó';

				const notifierResult = await context.db.query(
					`SELECT e.id, e.user_id FROM app__racona_work.employees e
					 WHERE e.id = ANY($1::int[])`,
					[notifierIds]
				);

				// Értesítési adatok visszaadása a kliensnek (kliens oldali webOS.notifications.send() híváshoz)
				(leaveRequest as any)._notifiers = notifierResult.rows.map((r: any) => r.user_id);
				(leaveRequest as any)._notifierMessage = { employeeName, startDate, endDate, days };
			}
		}
	} catch {
		// Értesítési hiba nem akadályozza a kérelem létrehozását
	}

	return leaveRequest;
}

/**
 * Szabadságkérelem jóváhagyása.
 * Követelmények: 8.6, 8.7, 8.9
 */
export async function approveLeaveRequest(
	params: { id: number },
	context: RemoteContext
): Promise<LeaveRequest> {
	const requestResult = await context.db.query(
		`SELECT lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date, lr.days, lr.status,
		        e.organization_id
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON e.id = lr.employee_id
		 WHERE lr.id = $1`,
		[params.id]
	);

	if (requestResult.rows.length === 0) {
		throw new Error(`Nem található szabadságkérelem a megadott azonosítóval: ${params.id}`);
	}

	const req = requestResult.rows[0];

	await requireCapability(context, req.organization_id, 'leave.approve');

	if (req.status !== 'pending') {
		throw new Error(`A kérelem már el lett bírálva (jelenlegi státusz: ${req.status}).`);
	}

	// A napok újraszámolása a jóváhagyás pillanatában érvényes munkanaptárral.
	// A kérelem beadása óta változhatott a naptár (pl. bekerült egy áthelyezett
	// munkanap), és a keretet a tényleges értékkel kell terhelni.
	const startDay = toIsoDay(req.start_date);
	const endDay = toIsoDay(req.end_date);
	const calendar = await getWorkCalendarOverrides(
		context,
		req.organization_id,
		startDay,
		endDay
	);
	const days = calculateWorkingDays(startDay, endDay, calendar);

	// Éves szabadságnál a kerettel is újra egyeztetni kell: ha a naptár változása
	// miatt több napra jön ki, előfordulhat, hogy már nem fér bele.
	if (req.leave_type === 'annual') {
		const year = new Date(startDay).getFullYear();
		const balanceResult = await context.db.query(
			`SELECT remaining_days FROM app__racona_work.leave_balances
			 WHERE employee_id = $1 AND year = $2`,
			[req.employee_id, year]
		);

		if (balanceResult.rows.length === 0) {
			throw new Error(
				`Nincs szabadságkeret beállítva a(z) ${year}. évre, a kérelem nem hagyható jóvá.`
			);
		}

		const remainingDays: number = balanceResult.rows[0].remaining_days;
		if (days > remainingDays) {
			throw new Error(
				`A kérelem a munkanaptár szerint ${days} munkanap, a fennmaradó keret viszont ` +
					`${remainingDays} nap. A kérelem így nem hagyható jóvá.`
			);
		}
	}

	const updateResult = await context.db.query(
		`UPDATE app__racona_work.leave_requests
		 SET status = 'approved', days = $2, updated_at = NOW()
		 WHERE id = $1
		 RETURNING id, employee_id, leave_type, start_date, end_date, days, status, reason, approved_by, created_at, updated_at`,
		[params.id, days]
	);

	// leave_balances.used_days frissítése (csak éves szabadságnál)
	if (req.leave_type === 'annual') {
		const year = new Date(startDay).getFullYear();
		await context.db.query(
			`UPDATE app__racona_work.leave_balances
			 SET used_days = used_days + $1
			 WHERE employee_id = $2 AND year = $3`,
			[days, req.employee_id, year]
		);
	}

	const row = updateResult.rows[0];
	const leaveRequest: LeaveRequest = {
		id: row.id,
		employeeId: row.employee_id,
		leaveType: row.leave_type,
		startDate: row.start_date,
		endDate: row.end_date,
		days: row.days,
		status: row.status,
		reason: row.reason ?? null,
		approvedBy: row.approved_by ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};

	// Értesítési adatok visszaadása a kliensnek (8.9)
	(leaveRequest as any)._notifyEmployeeId = req.employee_id;
	(leaveRequest as any)._notifyAction = 'approved';

	return leaveRequest;
}

/**
 * Szabadságkérelem elutasítása.
 * Követelmények: 8.7, 8.9
 */
export async function rejectLeaveRequest(
	params: { id: number; reason?: string },
	context: RemoteContext
): Promise<LeaveRequest> {
	const requestResult = await context.db.query(
		`SELECT lr.id, lr.employee_id, lr.status, e.organization_id
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON e.id = lr.employee_id
		 WHERE lr.id = $1`,
		[params.id]
	);

	if (requestResult.rows.length === 0) {
		throw new Error(`Nem található szabadságkérelem a megadott azonosítóval: ${params.id}`);
	}

	const req = requestResult.rows[0];

	await requireCapability(context, req.organization_id, 'leave.approve');

	if (req.status !== 'pending') {
		throw new Error(`A kérelem már el lett bírálva (jelenlegi státusz: ${req.status}).`);
	}

	const updateResult = await context.db.query(
		`UPDATE app__racona_work.leave_requests
		 SET status = 'rejected', updated_at = NOW()
		 WHERE id = $1
		 RETURNING id, employee_id, leave_type, start_date, end_date, days, status, reason, approved_by, created_at, updated_at`,
		[params.id]
	);

	const row = updateResult.rows[0];
	const leaveRequest: LeaveRequest = {
		id: row.id,
		employeeId: row.employee_id,
		leaveType: row.leave_type,
		startDate: row.start_date,
		endDate: row.end_date,
		days: row.days,
		status: row.status,
		reason: row.reason ?? null,
		approvedBy: row.approved_by ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};

	// Értesítési adatok visszaadása a kliensnek (8.9)
	(leaveRequest as any)._notifyEmployeeId = req.employee_id;
	(leaveRequest as any)._notifyAction = 'rejected';

	return leaveRequest;
}

/**
 * Jóváhagyott szabadságkérelem törlése.
 * Visszaállítja a leave_balances.used_days értékét (éves szabadságnál).
 * Visszaadja az érintett dolgozó user_id-ját értesítéshez.
 */
export async function deleteLeaveRequest(
	params: { id: number },
	context: RemoteContext
): Promise<{
	_notifyUserId: number | null;
	employeeName: string;
	startDate: string;
	endDate: string;
}> {
	const requestResult = await context.db.query(
		`SELECT lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date, lr.days, lr.status,
		        u.full_name AS employee_name, e.user_id, e.organization_id
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON e.id = lr.employee_id
		 JOIN auth.users u ON u.id = e.user_id
		 WHERE lr.id = $1`,
		[params.id]
	);

	if (requestResult.rows.length === 0) {
		throw new Error(`Nem található szabadságkérelem: ${params.id}`);
	}

	const req = requestResult.rows[0];

	await requireCapability(context, req.organization_id, 'leave.approve');

	// Ha jóváhagyott éves szabadság volt, visszaállítjuk a keretet
	if (req.status === 'approved' && req.leave_type === 'annual') {
		const year = new Date(req.start_date).getFullYear();
		await context.db.query(
			`UPDATE app__racona_work.leave_balances
			 SET used_days = GREATEST(0, used_days - $1)
			 WHERE employee_id = $2 AND year = $3`,
			[req.days, req.employee_id, year]
		);
	}

	await context.db.query(`DELETE FROM app__racona_work.leave_requests WHERE id = $1`, [params.id]);

	return {
		_notifyUserId: req.user_id ?? null,
		employeeName: req.employee_name,
		startDate: req.start_date,
		endDate: req.end_date
	};
}

/**
 * Dolgozó szabadságkeretei évenként.
 * Követelmény: 8.10
 */
export async function getLeaveBalances(
	params: { employeeId: number },
	context: RemoteContext
): Promise<LeaveBalance[]> {
	const orgId = await getEmployeeOrganizationId(context, params.employeeId);
	await requireCapability(context, orgId, 'leave.request');

	const result = await context.db.query(
		`SELECT id, employee_id, year, total_days, used_days, remaining_days
		 FROM app__racona_work.leave_balances
		 WHERE employee_id = $1
		 ORDER BY year DESC`,
		[params.employeeId]
	);

	return result.rows.map((row: any) => ({
		id: row.id,
		employeeId: row.employee_id,
		year: row.year,
		totalDays: row.total_days,
		usedDays: row.used_days,
		remainingDays: row.remaining_days
	}));
}

/**
 * Éves szabadságkeret beállítása (UPSERT).
 * Követelmény: 8.11
 */
export async function setLeaveBalance(
	params: { employeeId: number; organizationId: number; year: number; totalDays: number },
	context: RemoteContext
): Promise<LeaveBalance> {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'leave.balance.manage');

	const result = await context.db.query(
		`INSERT INTO app__racona_work.leave_balances (employee_id, organization_id, year, total_days, used_days)
		 VALUES ($1, $2, $3, $4, 0)
		 ON CONFLICT (employee_id, year)
		 DO UPDATE SET total_days = EXCLUDED.total_days
		 RETURNING id, employee_id, organization_id, year, total_days, used_days, remaining_days`,
		[params.employeeId, params.organizationId, params.year, params.totalDays]
	);

	const row = result.rows[0];
	return {
		id: row.id,
		employeeId: row.employee_id,
		year: row.year,
		totalDays: row.total_days,
		usedDays: row.used_days,
		remainingDays: row.remaining_days
	};
}
