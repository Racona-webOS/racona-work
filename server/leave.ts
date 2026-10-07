/**
 * Szabadság nyilvántartó — szerver oldali függvények.
 *
 * Szabadságkérelmek (leave_requests) és éves egyenlegek (leave_balances).
 * A kérelem beadott, utólag nem módosuló meta sor; a jóváhagyott szabadság
 * napjai a leave_days táblába kerülnek (leave-days.ts), és a keret
 * felhasználása onnan számolódik. Részletek: specs/leave-days.md
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin, resolveUserId } from './context.js';
import {
	ensureNotExternalEmployee,
	ensureNotSelfDecision,
	hasCapability,
	LEAVE_VIEW_CAPABILITIES,
	requireAnyCapability,
	requireCapability,
	requireSelfOrCapability
} from './permissions.js';
import { getWorkCalendarOverrides } from './work-calendar.js';
import {
	notifyLeaveDeleted,
	notifyLeaveRequestCreated,
	notifyLeaveRequestDecision,
	notifyLeaveRequestWithdrawn
} from './leave-notifications.js';
import { validateChildLeave } from './leave-allowances.js';
import { recalculateEmployeeBalances } from './leave-profile.js';
import { CHILD_LEAVE_TYPES, HR_ONLY_LEAVE_TYPES, consumesAnnualBalance, isLeaveType } from './leave-types.js';
import { assertDaysOpen } from './leave-closing.js';
import type { CarryOverUsage, EntitlementInput, EntitlementResult } from './leave-entitlement.js';
import { enrichCarryOver } from './leave-carry-over.js';
import {
	assertAnnualBalance,
	assertDaysFree,
	findEmployeeIdOfUser,
	groupDaysByYear,
	insertLeaveDays,
	listWorkingDays,
	syncAnnualUsedDays,
	toIsoDay
} from './leave-days.js';
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
	/** Apasági és szülői szabadságnál kötelező: melyik gyerek után. */
	childId?: number | null;
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
	childId: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface LeaveRequestRow extends LeaveRequest {
	employeeName: string;
	approverName: string | null;
	/**
	 * A kérelemhez ma tartozó szabadságnapok száma (leave_days). Jóváhagyott
	 * kérelemnél eltérhet a kért napoktól, ha a HR a naptárban törölt belőle;
	 * függő és elutasított kérelemnél null.
	 */
	effectiveDays: number | null;
}

/** A keret mellé mentett számítás: az eredmény és a bemenet, amiből készült. */
export interface LeaveBalanceCalculation {
	result: EntitlementResult;
	input: EntitlementInput;
}

export interface LeaveBalance {
	id: number;
	employeeId: number;
	year: number;
	/** A ténylegesen érvényes keret. Számított módban: calculatedDays + adjustmentDays + carriedOverDays. */
	totalDays: number;
	usedDays: number;
	remainingDays: number;
	/** null = kézi keret (a számítás bevezetése előtti, vagy kézzel beállított). */
	calculatedDays: number | null;
	adjustmentDays: number;
	adjustmentNote: string | null;
	/** Az előző évből áthozott napok (csak számított keretnél). */
	carriedOverDays: number;
	/** Eddig kell kiadni az áthozott napokat (Mt. 123. §); áthozatal nélkül null. */
	carryOverDeadline: string | null;
	/** Az áthozott napok felhasználása és állapota — a getLeaveBalances tölti ki. */
	carryOver: CarryOverUsage | null;
	isLocked: boolean;
	calculation: LeaveBalanceCalculation | null;
	calculatedAt: string | null;
}

/** A leave_balances oszlopai a LeaveBalance leképezéshez (mapBalanceRow). */
export const BALANCE_COLUMNS = `id, employee_id, year, total_days, used_days, remaining_days,
	calculated_days, adjustment_days, adjustment_note, carried_over_days,
	to_char(carry_over_deadline, 'YYYY-MM-DD') AS carry_over_deadline,
	is_locked, calculation, calculated_at`;

/** Belső segéd (a functions.ts NEM reexportálja) — a leave-profile.ts is használja. */
export function mapBalanceRow(row: any): LeaveBalance {
	return {
		id: row.id,
		employeeId: row.employee_id,
		year: row.year,
		totalDays: row.total_days,
		usedDays: row.used_days,
		remainingDays: row.remaining_days,
		calculatedDays: row.calculated_days ?? null,
		adjustmentDays: row.adjustment_days ?? 0,
		adjustmentNote: row.adjustment_note ?? null,
		carriedOverDays: row.carried_over_days ?? 0,
		carryOverDeadline: row.carry_over_deadline ?? null,
		carryOver: null,
		isLocked: row.is_locked === true,
		calculation: row.calculation ?? null,
		calculatedAt: row.calculated_at ?? null
	};
}

/**
 * Munkanapok számítása két dátum között.
 *
 * A munkanapok listáját a leave-days.ts adja (listWorkingDays); ez a hossza.
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
	return listWorkingDays(startDate, endDate, overrides).length;
}

/**
 * Egy dátumtartomány munkanapjai a szervezet munkanaptára szerint.
 *
 * A kérelem-űrlap hívja élőben, hogy a beadás előtt látszódjon, hány
 * munkanapot jelent a kiválasztott időszak. Ugyanazt a számítást használja,
 * mint a createLeaveRequest, így a kiírt és a ténylegesen levont napok
 * nem csúszhatnak el egymástól.
 *
 * @param params - A szervezet azonosítója és a dátumtartomány.
 * @param context - Remote futási kontextus.
 * @returns A munkanapok száma.
 */
export async function previewLeaveDays(
	params: { organizationId: number; startDate: string; endDate: string },
	context: RemoteContext
): Promise<{ days: number }> {
	const { organizationId, startDate, endDate } = params;

	if (!organizationId || organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireAnyCapability(context, organizationId, ['leave.request', 'leave.approve']);

	const calendar = await getWorkCalendarOverrides(context, organizationId, startDate, endDate);
	return { days: calculateWorkingDays(startDate, endDate, calendar) };
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

	// A jóváhagyó és a HR saját kérelem-jog nélkül is betölti a nyilvántartót
	await requireAnyCapability(context, params.organizationId, LEAVE_VIEW_CAPABILITIES);

	// Más dolgozó kérelme (típusa, indoklása, pl. betegszabadság) csak a jóváhagyóknak
	// és a HR-nek látható; mindenki más csak a sajátját kapja, akármit kér a kliens.
	const seesAll =
		(await hasCapability(context, params.organizationId, 'leave.approve')) ||
		(await hasCapability(context, params.organizationId, 'leave.balance.manage'));
	if (!seesAll) {
		const ownEmployeeId = await findEmployeeIdOfUser(
			context.db,
			await resolveUserId(context),
			params.organizationId
		);
		if (ownEmployeeId === null) throw new Error('Nem vagy dolgozó ebben a szervezetben');
		if (params.employeeId !== undefined && params.employeeId !== ownEmployeeId) {
			throw new Error('Csak a saját szabadságkérelmeidet láthatod');
		}
		params = { ...params, employeeId: ownEmployeeId };
	}

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
		createdAt: 'lr.created_at',
		effectiveDays: '(SELECT COUNT(*) FROM app__racona_work.leave_days ld WHERE ld.leave_request_id = lr.id)'
	};

	const sortColumn = sortColumnMap[params.sortBy ?? 'createdAt'] ?? 'lr.created_at';

	const conditions: string[] = ['e.organization_id = $1', 'e.is_external = FALSE'];
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
			lr.child_id,
			lr.created_at,
			lr.updated_at,
			e_user.full_name AS employee_name,
			approver_user.full_name AS approver_name,
			(SELECT COUNT(*) FROM app__racona_work.leave_days ld WHERE ld.leave_request_id = lr.id)::int AS effective_days
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
		childId: row.child_id ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		employeeName: row.employee_name,
		approverName: row.approver_name ?? null,
		effectiveDays: row.status === 'approved' ? row.effective_days : null
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

	if (!isLeaveType(leaveType)) {
		throw new Error('Érvénytelen szabadságtípus.');
	}
	const childId = CHILD_LEAVE_TYPES.has(leaveType) ? (params.childId ?? null) : null;

	if (!organizationId || organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	// A saját kérelemhez leave.request, más nevében leave.approve kell — ezt alább,
	// az employee id ismeretében ellenőrizzük. Core admin / dev mód automatikusan ok.
	await ensureNotExternalEmployee(context, employeeId);

	if (!isDevMode(context) && !isCoreAdmin(context)) {
		const callerUserId = await resolveUserId(context);
		const empRow = await context.db.query(
			`SELECT user_id FROM app__racona_work.employees WHERE id = $1 AND organization_id = $2`,
			[employeeId, organizationId]
		);
		if (empRow.rows.length === 0) {
			throw new Error('A dolgozó nem található ebben a szervezetben');
		}
		const own = Number((empRow.rows[0] as { user_id: number }).user_id) === Number(callerUserId);
		await requireCapability(context, organizationId, own ? 'leave.request' : 'leave.approve');
	}

	const start = new Date(startDate);
	const end = new Date(endDate);
	if (isNaN(start.getTime()) || isNaN(end.getTime())) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}
	if (start > end) {
		throw new Error('A záró dátum nem lehet korábbi a kezdő dátumnál.');
	}

	// A céges kötelező szabadságot csak a jóváhagyó rögzítheti
	if (HR_ONLY_LEAVE_TYPES.has(leaveType)) {
		await requireCapability(context, organizationId, 'leave.approve');
	}

	const calendar = await getWorkCalendarOverrides(context, organizationId, startDate, endDate);
	const workingDays = listWorkingDays(startDate, endDate, calendar);
	const days = workingDays.length;

	// Lezárt évre nem lehet rögzíteni
	await assertDaysOpen(context.db, organizationId, workingDays);

	// Egy dolgozónak egy napon egy szabadsága lehet: jóváhagyott nap és függő
	// kérelem sem fedhet át (specs/leave-days.md, K2).
	await assertDaysFree(context.db, employeeId, workingDays);
	const pendingOverlap = await context.db.query(
		`SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
		   FROM app__racona_work.leave_requests
		  WHERE employee_id = $1 AND status = 'pending' AND start_date <= $3::date AND end_date >= $2::date
		  ORDER BY start_date LIMIT 1`,
		[employeeId, startDate, endDate]
	);
	if (pendingOverlap.rows.length > 0) {
		const other = pendingOverlap.rows[0];
		throw new Error(
			`A dolgozónak már van függő kérelme erre az időszakra (${other.start_date} – ${other.end_date}).`
		);
	}

	// Szabadságkeret ellenőrzés (a keretet terhelő típusoknál), a napok éve szerint
	if (consumesAnnualBalance(leaveType)) {
		await assertAnnualBalance(context.db, employeeId, workingDays, 'request');
	}

	// Apasági és szülői szabadság: határidő és keret a gyerek szerint
	if (leaveType === 'paternity' || leaveType === 'parental') {
		await validateChildLeave(context, {
			employeeId,
			childId,
			leaveType,
			startDate,
			endDate,
			days,
			countPending: true
		});
	}

	const insertResult = await context.db.query(
		`INSERT INTO app__racona_work.leave_requests
			(employee_id, organization_id, leave_type, start_date, end_date, days, status, reason, child_id,
			 created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, NOW(), NOW())
		 RETURNING id, employee_id, leave_type, start_date, end_date, days, status, reason, approved_by,
		           child_id, created_at, updated_at`,
		[employeeId, organizationId, leaveType, startDate, endDate, days, reason ?? null, childId]
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
		childId: row.child_id ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};

	// Értesítés a beállításokban megjelölt dolgozóknak (8.8)
	await notifyLeaveRequestCreated(context, {
		id: leaveRequest.id,
		employeeId,
		organizationId,
		leaveType,
		startDate: toIsoDay(startDate),
		endDate: toIsoDay(endDate),
		days,
		reason: reason ?? null
	});

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
		        lr.child_id, e.organization_id
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
	await ensureNotSelfDecision(context, req.employee_id);

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
	const workingDays = listWorkingDays(startDay, endDay, calendar);
	const days = workingDays.length;

	// Egy dolgozónak egy napon egy szabadsága lehet (specs/leave-days.md, K1)
	await assertDaysFree(context.db, req.employee_id, workingDays);

	// Lezárt évre nem lehet jóváhagyni
	await assertDaysOpen(context.db, req.organization_id, workingDays);

	// A keretet terhelő típusnál a kerettel is újra egyeztetni kell: ha a naptár
	// változása miatt több napra jön ki, előfordulhat, hogy már nem fér bele.
	// Évenként, mert az évet átlépő kérelem két keretet terhel.
	if (consumesAnnualBalance(req.leave_type)) {
		await assertAnnualBalance(context.db, req.employee_id, workingDays, 'approve');
	}

	// Apasági és szülői szabadság: a beadás óta jóváhagyott kérelmekkel együtt is beleférjen
	if (req.leave_type === 'paternity' || req.leave_type === 'parental') {
		await validateChildLeave(context, {
			employeeId: req.employee_id,
			childId: req.child_id,
			leaveType: req.leave_type,
			startDate: startDay,
			endDate: endDay,
			days,
			countPending: false,
			excludeRequestId: req.id
		});
	}

	// A jóváhagyó dolgozói sora (core admin nem feltétlenül dolgozó: akkor null)
	const approverEmployeeId = await findEmployeeIdOfUser(
		context.db,
		await resolveUserId(context),
		req.organization_id
	);

	// A státusz, a napok és a keret egy tranzakcióban: ha a napok beszúrása
	// elbukik (közben foglalták a napot), a kérelem függőben marad.
	const client = await context.db.connect();
	let row: any;
	try {
		await client.query('BEGIN');
		const updateResult = await client.query(
			`UPDATE app__racona_work.leave_requests
			 SET status = 'approved', days = $2, approved_by = $3, updated_at = NOW()
			 WHERE id = $1 AND status = 'pending'
			 RETURNING id, employee_id, leave_type, start_date, end_date, days, status, reason, approved_by, child_id, created_at, updated_at`,
			[params.id, days, approverEmployeeId]
		);
		if (updateResult.rows.length === 0) {
			throw new Error('A kérelmet közben már elbírálták.');
		}
		await insertLeaveDays(client, {
			employeeId: req.employee_id,
			organizationId: req.organization_id,
			leaveRequestId: req.id,
			leaveType: req.leave_type,
			days: workingDays
		});
		if (consumesAnnualBalance(req.leave_type)) {
			await syncAnnualUsedDays(client, req.employee_id, [...groupDaysByYear(workingDays).keys()]);
		}
		await client.query('COMMIT');
		row = updateResult.rows[0];
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	// A fizetés nélküli szabadság nem munkában töltött idő: csökkenti az éves keretet
	if (req.leave_type === 'unpaid') {
		await recalculateEmployeeBalances(context, req.employee_id);
	}

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
		childId: row.child_id ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};

	// Értesítés az érintett dolgozónak (8.9)
	await notifyLeaveRequestDecision(
		context,
		{
			id: row.id,
			employeeId: req.employee_id,
			organizationId: req.organization_id,
			leaveType: req.leave_type,
			startDate: startDay,
			endDate: endDay,
			days
		},
		'approved'
	);

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
	await ensureNotSelfDecision(context, req.employee_id);

	if (req.status !== 'pending') {
		throw new Error(`A kérelem már el lett bírálva (jelenlegi státusz: ${req.status}).`);
	}

	const updateResult = await context.db.query(
		`UPDATE app__racona_work.leave_requests
		 SET status = 'rejected', updated_at = NOW()
		 WHERE id = $1
		 RETURNING id, employee_id, leave_type, start_date, end_date, days, status, reason, approved_by, child_id, created_at, updated_at`,
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
		childId: row.child_id ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};

	// Értesítés az érintett dolgozónak (8.9)
	await notifyLeaveRequestDecision(
		context,
		{
			id: row.id,
			employeeId: row.employee_id,
			organizationId: req.organization_id,
			leaveType: row.leave_type,
			startDate: toIsoDay(row.start_date),
			endDate: toIsoDay(row.end_date),
			days: row.days
		},
		'rejected'
	);

	return leaveRequest;
}

/**
 * Függő kérelem visszavonása a beadó dolgozó által.
 *
 * A kérelem `withdrawn` státuszba kerül, hogy a nyoma megmaradjon (nem
 * törlődik). Csak a saját, még függő kérelem vonható vissza; a beadásról
 * értesített dolgozók rendszeren belüli értesítést kapnak a visszavonásról.
 */
export async function withdrawLeaveRequest(
	params: { id: number },
	context: RemoteContext
): Promise<LeaveRequest> {
	const requestResult = await context.db.query(
		`SELECT lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date, lr.days, lr.status,
		        e.organization_id, e.user_id
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON e.id = lr.employee_id
		 WHERE lr.id = $1`,
		[params.id]
	);
	if (requestResult.rows.length === 0) {
		throw new Error(`Nem található szabadságkérelem a megadott azonosítóval: ${params.id}`);
	}
	const req = requestResult.rows[0];

	await requireCapability(context, req.organization_id, 'leave.request');
	if (!isDevMode(context) && !isCoreAdmin(context)) {
		const callerUserId = await resolveUserId(context);
		if (Number(req.user_id) !== Number(callerUserId)) {
			throw new Error('Csak a saját kérelmedet vonhatod vissza.');
		}
	}
	if (req.status !== 'pending') {
		throw new Error(`Csak függő kérelem vonható vissza (jelenlegi státusz: ${req.status}).`);
	}

	const updateResult = await context.db.query(
		`UPDATE app__racona_work.leave_requests
		 SET status = 'withdrawn', updated_at = NOW()
		 WHERE id = $1 AND status = 'pending'
		 RETURNING id, employee_id, leave_type, start_date, end_date, days, status, reason, approved_by, child_id, created_at, updated_at`,
		[params.id]
	);
	if (updateResult.rows.length === 0) {
		throw new Error('A kérelmet közben már elbírálták.');
	}
	const row = updateResult.rows[0];

	await notifyLeaveRequestWithdrawn(context, {
		id: row.id,
		employeeId: row.employee_id,
		organizationId: req.organization_id,
		leaveType: row.leave_type,
		startDate: toIsoDay(row.start_date),
		endDate: toIsoDay(row.end_date),
		days: row.days
	});

	return {
		id: row.id,
		employeeId: row.employee_id,
		leaveType: row.leave_type,
		startDate: row.start_date,
		endDate: row.end_date,
		days: row.days,
		status: row.status,
		reason: row.reason ?? null,
		approvedBy: row.approved_by ?? null,
		childId: row.child_id ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

/**
 * Szabadságkérelem törlése.
 *
 * A napjai a leave_days táblából is törlődnek (CASCADE), utána az éves keret
 * felhasználása újraszámolódik, és az érintett dolgozó értesítést kap. Ez az
 * egyetlen eset, amikor egy beadott kérelem eltűnik (specs/leave-days.md, D14).
 */
export async function deleteLeaveRequest(
	params: { id: number },
	context: RemoteContext
): Promise<void> {
	const requestResult = await context.db.query(
		`SELECT lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date, lr.days, lr.status,
		        e.organization_id
		 FROM app__racona_work.leave_requests lr
		 JOIN app__racona_work.employees e ON e.id = lr.employee_id
		 WHERE lr.id = $1`,
		[params.id]
	);

	if (requestResult.rows.length === 0) {
		throw new Error(`Nem található szabadságkérelem: ${params.id}`);
	}

	const req = requestResult.rows[0];

	await requireCapability(context, req.organization_id, 'leave.approve');
	await ensureNotSelfDecision(context, req.employee_id);

	// Lezárt év jóváhagyott szabadsága nem törölhető; a meg nem nyitott évé igen
	if (req.status === 'approved') {
		await assertDaysOpen(context.db, req.organization_id, [toIsoDay(req.start_date), toIsoDay(req.end_date)], {
			allowUnopened: true
		});
	}

	// A napok a CASCADE miatt a kérelemmel együtt törlődnek
	await context.db.query(`DELETE FROM app__racona_work.leave_requests WHERE id = $1`, [params.id]);

	// Az éves keret felhasználása a megmaradt napokból (az évet átlépő kérelem két évet érint)
	if (req.status === 'approved' && consumesAnnualBalance(req.leave_type)) {
		const startYear = Number(toIsoDay(req.start_date).slice(0, 4));
		const endYear = Number(toIsoDay(req.end_date).slice(0, 4));
		const years: number[] = [];
		for (let y = startYear; y <= endYear; y++) years.push(y);
		await syncAnnualUsedDays(context.db, req.employee_id, years);
	}

	if (req.status === 'approved' && req.leave_type === 'unpaid') {
		await recalculateEmployeeBalances(context, req.employee_id);
	}

	// Jóváhagyott szabadság törlése más szöveggel megy, mint egy függő kérelemé
	const notice = {
		id: req.id,
		employeeId: req.employee_id,
		organizationId: req.organization_id,
		leaveType: req.leave_type,
		startDate: toIsoDay(req.start_date),
		endDate: toIsoDay(req.end_date),
		days: req.days
	};
	if (req.status === 'approved') await notifyLeaveDeleted(context, notice);
	else await notifyLeaveRequestDecision(context, notice, 'deleted');
}

/**
 * Dolgozó szabadságkeretei évenként, a számítás bontásával.
 *
 * A bontásból kiderül a gyerekek száma és az egészségkárosodás ténye, ezért a
 * dolgozó csak a sajátját látja, másét csak leave.balance.manage joggal.
 * Követelmény: 8.10
 */
export async function getLeaveBalances(
	params: { employeeId: number },
	context: RemoteContext
): Promise<LeaveBalance[]> {
	await requireSelfOrCapability(context, params.employeeId, 'leave.balance.manage');

	const result = await context.db.query(
		`SELECT ${BALANCE_COLUMNS}
		 FROM app__racona_work.leave_balances
		 WHERE employee_id = $1
		 ORDER BY year DESC`,
		[params.employeeId]
	);

	return enrichCarryOver(context, result.rows.map(mapBalanceRow));
}
