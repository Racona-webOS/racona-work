/**
 * Szerver oldali függvények — Work plugin
 *
 * Ezek a függvények a Racona szerveren futnak,
 * és a plugin a remote.call()-lal hívhatja őket.
 */

import { requireCapability, seedDefaultRoles, hasCapability } from './permissions.js';

// --- TypeScript típusok ---

export interface PluginEmailService {
	send(params: {
		to: string | string[];
		template: string;
		data: Record<string, unknown>;
		locale?: string;
	}): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

export interface RemoteContext {
	pluginId: string;
	userId: string;
	db: {
		query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
		connect: () => Promise<{
			query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
			release: () => void;
		}>;
	};
	permissions: string[];
	email?: PluginEmailService;
}

export interface Employee {
	id: number;
	userId: number;
	position: string | null;
	department: string | null;
	hireDate: string | null;
	status: string;
	createdAt: string;
	updatedAt: string;
}

export interface EmployeeRow extends Employee {
	userName: string;
	userEmail: string;
	userImage: string | null;
	organizationRole?: string;
}

export interface EmployeeDetail {
	id: number;
	employeeId: number;
	category: string;
	fieldKey: string;
	fieldValue: string;
	createdAt: string;
	updatedAt: string;
}

export interface EmployeeDetailView {
	employee: EmployeeRow;
	details: EmployeeDetail[];
}

export interface PaginatedResult<T> {
	data: T[];
	pagination: {
		page: number;
		pageSize: number;
		totalCount: number;
		totalPages: number;
	};
}

export interface EmployeeListParams {
	organizationId: number;
	page?: number;
	pageSize?: number;
	sortBy?: string;
	sortOrder?: 'asc' | 'desc';
	search?: string;
	status?: string;
}

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

export interface UnlinkedUser {
	id: number;
	name: string;
	email: string;
	image: string | null;
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

export interface DashboardStats {
	totalEmployees: number;
	activeEmployees: number;
	pendingLeaveRequests: number;
	onLeaveThisMonth: number;
	recentPendingRequests: LeaveRequestRow[];
}

export interface Organization {
	id: number;
	name: string;
	slug: string;
	address: string | null;
	phone: string | null;
	email: string | null;
	website: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface OrganizationMember {
	id: number;
	organizationId: number;
	employeeId: number;
	role: string;
	joinedAt: string;
}

export interface OrganizationMemberRow extends OrganizationMember {
	employeeName: string;
	employeeEmail: string;
	employeeImage: string | null;
	employeePosition: string | null;
	employeeDepartment: string | null;
}

// --- Dolgozókezelés ---

export async function getUnlinkedUsers(
	params: { organizationId?: number },
	context: RemoteContext
): Promise<UnlinkedUser[]> {
	// Védelem: core admin bármikor lekérdezheti; egyéb esetben a hívónak
	// employee.manage képességgel kell rendelkeznie a megadott szervezetre.
	const isDev = typeof context.userId === 'string' && isNaN(Number(context.userId));
	const isAdmin = context.permissions?.includes('admin') === true;
	if (!isDev && !isAdmin) {
		if (!params?.organizationId || params.organizationId <= 0) {
			throw new Error('Érvénytelen szervezet azonosító');
		}
		await requireCapability(context, params.organizationId, 'employee.manage');
	}

	// Szervezet-specifikus szűrés: azokat a usereket adjuk vissza, akik még
	// NEM tagjai az adott szervezetnek (de lehetnek tagjai más szervezeteknek).
	// Ha nincs organizationId (core admin globális lekérdezés), akkor azokat,
	// akik egyetlen szervezethez sem tartoznak.
	let result;
	if (params?.organizationId && params.organizationId > 0) {
		result = await context.db.query(
			`SELECT u.id, u.full_name AS name, u.email, u.image
			   FROM auth.users u
			  WHERE u.id NOT IN (
			    SELECT e.user_id
			      FROM app__racona_work.employees e
			     WHERE e.organization_id = $1
			  )
			  ORDER BY u.full_name ASC`,
			[params.organizationId]
		);
	} else {
		result = await context.db.query(
			`SELECT u.id, u.full_name AS name, u.email, u.image
			   FROM auth.users u
			  WHERE u.id NOT IN (SELECT user_id FROM app__racona_work.employees)
			  ORDER BY u.full_name ASC`
		);
	}

	return result.rows.map((row: any) => ({
		id: row.id,
		name: row.name,
		email: row.email,
		image: row.image ?? null
	}));
}

export async function createEmployeeFromUser(
	params: { userId: number; organizationId: number; position?: string; department?: string },
	context: RemoteContext
): Promise<Employee> {
	console.log('[createEmployeeFromUser] Params:', params);

	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'employee.manage');

	// Employee rekord létrehozása organization_id-val
	const empResult = await context.db.query(
		`INSERT INTO app__racona_work.employees (user_id, organization_id, position, department, hire_date, status)
		 VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active')
		 RETURNING id, user_id, position, department, hire_date, status, created_at, updated_at`,
		[params.userId, params.organizationId, params.position ?? null, params.department ?? null]
	);

	const row = empResult.rows[0];

	const employee: Employee = {
		id: row.id,
		userId: row.user_id,
		position: row.position ?? null,
		department: row.department ?? null,
		hireDate: row.hire_date ?? null,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};

	// Új dolgozóhoz automatikusan hozzárendeljük az alap 'employee' szerepet,
	// hogy legyen legalább `leave.request` + `employee.view` + `project.view.own`
	// capability-je a szervezetben.
	await assignDefaultEmployeeRole(context, params.organizationId, params.userId);

	return employee;
}

export async function createEmployeeWithUser(
	params: { name: string; email: string; organizationId: number; position?: string; department?: string },
	context: RemoteContext
): Promise<Employee> {
	console.log('[createEmployeeWithUser] Params:', params);

	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'employee.manage');

	const client = await context.db.connect();
	let employee: Employee;
	try {
		await client.query('BEGIN');

		// 1. Új auth.users rekord létrehozása (email_verified = true)
		const userResult = await client.query(
			`INSERT INTO auth.users (full_name, email, email_verified)
			 VALUES ($1, $2, true)
			 RETURNING id`,
			[params.name, params.email]
		);
		const userId = userResult.rows[0].id;

		// 2. auth.accounts rekord létrehozása (credential provider, jelszó nélkül)
		// A felhasználó az elfelejtett jelszó funkcióval állít be jelszót
		await client.query(
			`INSERT INTO auth.accounts (user_id, provider_account_id, provider_id, is_active)
			 VALUES ($1, $2, 'credential', true)`,
			[userId, String(userId)]
		);

		// 3. Dolgozó rekord létrehozása az új user_id-val és organization_id-val
		const empResult = await client.query(
			`INSERT INTO app__racona_work.employees (user_id, organization_id, position, department, hire_date, status)
			 VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active')
			 RETURNING id, user_id, position, department, hire_date, status, created_at, updated_at`,
			[userId, params.organizationId, params.position ?? null, params.department ?? null]
		);

		const row = empResult.rows[0];
		employee = {
			id: row.id,
			userId: row.user_id,
			position: row.position ?? null,
			department: row.department ?? null,
			hireDate: row.hire_date ?? null,
			status: row.status,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};

		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	// Új dolgozóhoz automatikusan hozzárendeljük az alap 'employee' szerepet.
	// A tranzakción kívül, best-effort: ha hiba van, a dolgozó már létrejött.
	await assignDefaultEmployeeRole(context, params.organizationId, employee.userId);

	// Email küldés a tranzakción kívül — hiba esetén NEM gördíti vissza
	try {
		const schemaName = `app__${context.pluginId.replace(/-/g, '_')}`;
		const companyNameResult = await context.db.query(
			`SELECT value FROM ${schemaName}.kv_store WHERE key = 'settings:company_name'`
		);
		const companyName = companyNameResult.rows[0]?.value ?? 'Racona';

		await context.email?.send({
			to: params.email,
			template: 'employee_welcome',
			data: {
				name: params.name,
				email: params.email,
				position: params.position ?? null,
				department: params.department ?? null,
				companyName
			},
			locale: 'hu'
		});
	} catch (emailErr) {
		console.error('[Work] Üdvözlő email küldése sikertelen:', emailErr);
	}

	return employee;
}

/**
 * Dolgozók listája szervezet szerint szűrve.
 * Követelmények: 6.1, 6.2, 16.1, 16.2
 */
export async function getEmployees(
	params: EmployeeListParams,
	context: RemoteContext
): Promise<PaginatedResult<EmployeeRow>> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'employee.view');

	const page = params.page ?? 1;
	const pageSize = params.pageSize ?? 20;
	const sortOrder = params.sortOrder === 'desc' ? 'DESC' : 'ASC';

	// Engedélyezett rendezési oszlopok (SQL injection elleni védelem)
	const sortColumnMap: Record<string, string> = {
		userName: 'u.full_name',
		userEmail: 'u.email',
		position: 'e.position',
		department: 'e.department',
		status: 'e.status',
		hireDate: 'e.hire_date',
		organizationRole: 'e.status'
	};

	const sortColumn = sortColumnMap[params.sortBy ?? 'userName'] ?? 'u.full_name';

	// WHERE feltételek dinamikus összeállítása
	const conditions: string[] = ['e.organization_id = $1'];
	const queryParams: unknown[] = [params.organizationId];
	let paramIndex = 2;

	if (params.search) {
		conditions.push(
			`(u.full_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`
		);
		queryParams.push(`%${params.search}%`);
		paramIndex++;
	}

	if (params.status) {
		conditions.push(`e.status = $${paramIndex}`);
		queryParams.push(params.status);
		paramIndex++;
	}

	const whereClause = `WHERE ${conditions.join(' AND ')}`;

	// Összes találat száma a lapozáshoz
	const countResult = await context.db.query(
		`SELECT COUNT(*) AS total
		 FROM app__racona_work.employees e
		 JOIN auth.users u ON e.user_id = u.id

		 ${whereClause}`,
		queryParams
	);

	const totalCount = parseInt(countResult.rows[0].total, 10);
	const totalPages = Math.ceil(totalCount / pageSize);
	const offset = (page - 1) * pageSize;

	// Adatok lekérdezése lapozással
	const dataResult = await context.db.query(
		`SELECT
			e.id,
			e.user_id,
			e.position,
			e.department,
			e.hire_date,
			e.status,
			e.created_at,
			e.updated_at,
			u.full_name AS user_name,
			u.email AS user_email,
			u.image AS user_image
		 FROM app__racona_work.employees e
		 JOIN auth.users u ON e.user_id = u.id
		 ${whereClause}
		 ORDER BY ${sortColumn} ${sortOrder}
		 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
		[...queryParams, pageSize, offset]
	);

	const data: EmployeeRow[] = dataResult.rows.map((row: any) => ({
		id: row.id,
		userId: row.user_id,
		position: row.position ?? null,
		department: row.department ?? null,
		hireDate: row.hire_date ?? null,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userName: row.user_name,
		userEmail: row.user_email,
		userImage: row.user_image ?? null,
		organizationRole: row.organization_role ?? 'member'
	}));

	return {
		data,
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages
		}
	};
}

// --- Dolgozó adatlap ---

/**
 * Új szervezeti tagnak (employee) automatikus hozzárendelése az alap
 * 'employee' szerephez, ha még nincs szerep-kapcsolata a szervezetben.
 *
 * Best-effort: ha bármilyen hiba történik (pl. nincs ilyen rendszer szerep),
 * csak logolunk, nem dobunk kifelé — a dolgozó rekord már létrejött.
 */
async function assignDefaultEmployeeRole(
	context: RemoteContext,
	organizationId: number,
	userId: number
): Promise<void> {
	try {
		await context.db.query(
			`INSERT INTO app__racona_work.wp_member_roles (organization_id, user_id, role_id)
			 SELECT $1, $2, r.id
			   FROM app__racona_work.wp_roles r
			  WHERE r.organization_id = $1 AND r.key = 'employee'
			 ON CONFLICT DO NOTHING`,
			[organizationId, userId]
		);
	} catch (err) {
		console.error('[assignDefaultEmployeeRole] Szerep hozzárendelés sikertelen:', err);
	}
}

/**
 * Az adott employee szervezeti azonosítóját adja vissza.
 * Throw-ol, ha nem található az employee.
 */
async function getEmployeeOrganizationId(
	context: RemoteContext,
	employeeId: number
): Promise<number> {
	const r = await context.db.query(
		`SELECT organization_id FROM app__racona_work.employees WHERE id = $1`,
		[employeeId]
	);
	if (r.rows.length === 0) {
		throw new Error(`Nem található dolgozó a megadott azonosítóval: ${employeeId}`);
	}
	return (r.rows[0] as { organization_id: number }).organization_id;
}

export async function getEmployeeDetails(
	params: { employeeId: number },
	context: RemoteContext
): Promise<EmployeeDetailView> {
	const orgId = await getEmployeeOrganizationId(context, params.employeeId);
	await requireCapability(context, orgId, 'employee.view');

	// Dolgozó alapadatok lekérdezése JOIN-olva az auth.users táblával
	const empResult = await context.db.query(
		`SELECT
			e.id,
			e.user_id,
			e.position,
			e.department,
			e.hire_date,
			e.status,
			e.created_at,
			e.updated_at,
			u.full_name AS user_name,
			u.email AS user_email,
			u.image AS user_image
		 FROM app__racona_work.employees e
		 JOIN auth.users u ON e.user_id = u.id
		 WHERE e.id = $1`,
		[params.employeeId]
	);

	if (empResult.rows.length === 0) {
		throw new Error(`Nem található dolgozó a megadott azonosítóval: ${params.employeeId}`);
	}

	const empRow = empResult.rows[0];
	const employee: EmployeeRow = {
		id: empRow.id,
		userId: empRow.user_id,
		position: empRow.position ?? null,
		department: empRow.department ?? null,
		hireDate: empRow.hire_date ?? null,
		status: empRow.status,
		createdAt: empRow.created_at,
		updatedAt: empRow.updated_at,
		userName: empRow.user_name,
		userEmail: empRow.user_email,
		userImage: empRow.user_image ?? null
	};

	// Adatlap részletek lekérdezése
	const detailsResult = await context.db.query(
		`SELECT id, employee_id, category, field_key, field_value, created_at, updated_at
		 FROM app__racona_work.employee_details
		 WHERE employee_id = $1
		 ORDER BY category, field_key`,
		[params.employeeId]
	);

	const details: EmployeeDetail[] = detailsResult.rows.map((row: any) => ({
		id: row.id,
		employeeId: row.employee_id,
		category: row.category,
		fieldKey: row.field_key,
		fieldValue: row.field_value,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}));

	return { employee, details };
}

export async function saveEmployeeDetail(
	params: { employeeId: number; category: string; fieldKey: string; fieldValue: string },
	context: RemoteContext
): Promise<EmployeeDetail> {
	const orgId = await getEmployeeOrganizationId(context, params.employeeId);
	await requireCapability(context, orgId, 'employee.manage');

	// UPSERT az (employee_id, category, field_key) egyedi index alapján
	const result = await context.db.query(
		`INSERT INTO app__racona_work.employee_details (employee_id, category, field_key, field_value)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (employee_id, category, field_key)
		 DO UPDATE SET field_value = EXCLUDED.field_value, updated_at = NOW()
		 RETURNING id, employee_id, category, field_key, field_value, created_at, updated_at`,
		[params.employeeId, params.category, params.fieldKey, params.fieldValue]
	);

	const row = result.rows[0];
	return {
		id: row.id,
		employeeId: row.employee_id,
		category: row.category,
		fieldKey: row.field_key,
		fieldValue: row.field_value,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function deleteEmployeeDetail(
	params: { id: number },
	context: RemoteContext
): Promise<void> {
	const r = await context.db.query(
		`SELECT e.organization_id
		   FROM app__racona_work.employee_details d
		   JOIN app__racona_work.employees e ON e.id = d.employee_id
		  WHERE d.id = $1`,
		[params.id]
	);
	if (r.rows.length === 0) {
		throw new Error('Nem található dolgozó adat a megadott azonosítóval');
	}
	const orgId = (r.rows[0] as { organization_id: number }).organization_id;
	await requireCapability(context, orgId, 'employee.manage');

	await context.db.query(
		`DELETE FROM app__racona_work.employee_details WHERE id = $1`,
		[params.id]
	);
}

export async function updateEmployee(
	params: { id: number; position?: string; department?: string; status?: string },
	context: RemoteContext
): Promise<Employee> {
	// Legalább egy mezőt meg kell adni
	if (params.position === undefined && params.department === undefined && params.status === undefined) {
		throw new Error('Legalább egy mezőt meg kell adni a frissítéshez (position, department, status).');
	}

	const orgId = await getEmployeeOrganizationId(context, params.id);
	await requireCapability(context, orgId, 'employee.manage');

	// Dinamikus SET záradék összeállítása
	const setClauses: string[] = [];
	const queryParams: unknown[] = [];
	let paramIndex = 1;

	if (params.position !== undefined) {
		setClauses.push(`position = $${paramIndex}`);
		queryParams.push(params.position);
		paramIndex++;
	}

	if (params.department !== undefined) {
		setClauses.push(`department = $${paramIndex}`);
		queryParams.push(params.department);
		paramIndex++;
	}

	if (params.status !== undefined) {
		setClauses.push(`status = $${paramIndex}`);
		queryParams.push(params.status);
		paramIndex++;
	}

	// updated_at mindig frissül
	setClauses.push(`updated_at = NOW()`);

	// id paraméter hozzáadása a WHERE feltételhez
	queryParams.push(params.id);

	const result = await context.db.query(
		`UPDATE app__racona_work.employees
		 SET ${setClauses.join(', ')}
		 WHERE id = $${paramIndex}
		 RETURNING id, user_id, position, department, hire_date, status, created_at, updated_at`,
		queryParams
	);

	if (result.rows.length === 0) {
		throw new Error(`Nem található dolgozó a megadott azonosítóval: ${params.id}`);
	}

	const row = result.rows[0];
	return {
		id: row.id,
		userId: row.user_id,
		position: row.position ?? null,
		department: row.department ?? null,
		hireDate: row.hire_date ?? null,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

// --- Szabadság nyilvántartó ---

/**
 * Munkanapok számítása két dátum között (hétvégék kizárásával).
 * Tiszta (pure) segédfüggvény — Property 6 validálja.
 */
export function calculateWorkingDays(startDate: string, endDate: string): number {
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
		const dayOfWeek = new Date(currentMs).getUTCDay();
		// 0 = vasárnap, 6 = szombat
		if (dayOfWeek !== 0 && dayOfWeek !== 6) {
			workingDays++;
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
	const isDevMode = typeof context.userId === 'string' && isNaN(Number(context.userId));
	const isCoreAdmin = context.permissions?.includes('admin') === true;
	if (!isDevMode && !isCoreAdmin) {
		let callerUserId: number;
		if (typeof context.userId === 'number') callerUserId = context.userId;
		else if (typeof context.userId === 'string' && !isNaN(Number(context.userId))) {
			callerUserId = Number(context.userId);
		} else {
			const u = await context.db.query(`SELECT id FROM auth.users ORDER BY id LIMIT 1`);
			callerUserId = (u.rows[0] as { id: number }).id;
		}
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

	const days = calculateWorkingDays(startDate, endDate);

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
`SELECT lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.days, lr.status,
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

	const updateResult = await context.db.query(
`UPDATE app__racona_work.leave_requests
		 SET status = 'approved', updated_at = NOW()
		 WHERE id = $1
		 RETURNING id, employee_id, leave_type, start_date, end_date, days, status, reason, approved_by, created_at, updated_at`,
[params.id]
);

	// leave_balances.used_days frissítése (csak éves szabadságnál)
	if (req.leave_type === 'annual') {
		const year = new Date(req.start_date).getFullYear();
		await context.db.query(
`UPDATE app__racona_work.leave_balances
			 SET used_days = used_days + $1
			 WHERE employee_id = $2 AND year = $3`,
[req.days, req.employee_id, year]
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
): Promise<{ _notifyUserId: number | null; employeeName: string; startDate: string; endDate: string }> {
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

	await context.db.query(
		`DELETE FROM app__racona_work.leave_requests WHERE id = $1`,
		[params.id]
	);

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

// --- Irányítópult ---

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
	const isDev = typeof context.userId === 'string' && isNaN(Number(context.userId));
	const isAdmin = context.permissions?.includes('admin') === true;
	if (!isDev && !isAdmin) {
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
	const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

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

// --- Beállítások ---

/**
 * Alkalmazás beállítás lekérdezése a DataService key-value tárolóból.
 * A plugin adatai a plugin_work.kv_store táblában tárolódnak.
 * Követelmény: 13.2, 13.6
 */
export async function getSettings(
	params: { key: string },
	context: RemoteContext
): Promise<unknown> {
	// Szervezet-specifikus kulcsok esetén (pl. "settings:x:org_123") ellenőrizzük,
	// hogy a hívónak van-e hozzáférése az adott szervezet olvasásához.
	const orgMatch = /:org_(\d+)(?:$|:)/.exec(params.key);
	if (orgMatch) {
		const orgId = Number(orgMatch[1]);
		await requireCapability(context, orgId, 'employee.view');
	}

	// A plugin séma neve: plugin_{pluginId} (kötőjelek aláhúzásra cserélve)
	const schemaName = `app__${context.pluginId.replace(/-/g, '_')}`;

	const result = await context.db.query(
		`SELECT value FROM ${schemaName}.kv_store WHERE key = $1`,
		[params.key]
	);

	if (result.rows.length === 0) {
		return null;
	}

	return result.rows[0].value;
}

/**
 * Alkalmazás beállítás mentése a DataService key-value tárolóba (UPSERT).
 * A plugin adatai a plugin_work.kv_store táblában tárolódnak.
 * Követelmény: 13.2, 13.6
 */
export async function saveSettings(
	params: { key: string; value: unknown },
	context: RemoteContext
): Promise<void> {
	// Szervezet-specifikus kulcsok esetén (pl. "settings:x:org_123") a hívónak
	// az adott szervezetben org.manage vagy leave.balance.manage-szerű írási
	// képességgel kell rendelkeznie. Egyszerűen: members.manage vagy org.manage
	// közelítés — most a leginkább konzervatív: org.manage.
	const orgMatch = /:org_(\d+)(?:$|:)/.exec(params.key);
	if (orgMatch) {
		const orgId = Number(orgMatch[1]);
		await requireCapability(context, orgId, 'org.manage');
	}

	// A plugin séma neve: plugin_{pluginId} (kötőjelek aláhúzásra cserélve)
	const schemaName = `app__${context.pluginId.replace(/-/g, '_')}`;

	await context.db.query(
		`INSERT INTO ${schemaName}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key)
		 DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[params.key, JSON.stringify(params.value)]
	);
}

// --- Szervezet kezelés ---

/**
 * Slug generálás szervezet névből.
 * Követelmény: 2.2
 */
export function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFD') // Ékezetek eltávolítása
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-') // Speciális karakterek cseréje kötőjelre
		.replace(/^-+|-+$/g, ''); // Kezdő és záró kötőjelek eltávolítása
}

/**
 * Ellenőrzi, hogy a felhasználó admin jogosultsággal rendelkezik-e.
 * Követelmény: 2.1
 */
function requireAdmin(context: RemoteContext): void {
	// Dev módban (amikor userId nem numerikus) ne ellenőrizzük a jogosultságot
	const isDevMode = typeof context.userId === 'string' && isNaN(Number(context.userId));

	if (!isDevMode && !context.permissions.includes('admin')) {
		throw new Error('Ez a művelet adminisztrátori jogosultságot igényel');
	}
}


/**
 * Ellenőrzi, hogy a felhasználó tagja-e a megadott szervezetnek.
 * Admin jogosultsággal rendelkező userek esetén a tagság ellenőrzés kihagyásra kerül.
 * ÚJ: Az employees táblában lévő organization_id alapján ellenőrzi a tagságot.
 * Követelmények: 16.3, 16.4
 */
async function requireOrganizationMember(
	context: RemoteContext,
	organizationId: number
): Promise<void> {
	console.log('[requireOrganizationMember] DEBUG - organizationId:', organizationId);
	console.log('[requireOrganizationMember] DEBUG - context.userId:', context.userId, 'type:', typeof context.userId);
	console.log('[requireOrganizationMember] DEBUG - context.permissions:', context.permissions);

	// Admin userek esetén nincs szükség szervezeti tagság ellenőrzésre
	const isDevMode = typeof context.userId === 'string' && isNaN(Number(context.userId));
	console.log('[requireOrganizationMember] DEBUG - isDevMode:', isDevMode);

	if (!isDevMode && context.permissions.includes('admin')) {
		console.log('[requireOrganizationMember] DEBUG - Admin user detected, access granted');
		return; // Admin user, hozzáférés engedélyezve
	}

	console.log('[requireOrganizationMember] DEBUG - Not admin, checking organization membership');

	// context.userId lehet string (dev módban) vagy number
	// Ha nem numerikus string, akkor lekérdezzük a valódi user id-t
	let userId: number | string = context.userId;

	if (typeof context.userId === 'string' && isNaN(Number(context.userId))) {
		// Dev módban a context.userId lehet "dev-user" vagy hasonló
		// Ilyenkor az első user-t használjuk (dev seed)
		const userResult = await context.db.query(
			`SELECT id FROM auth.users ORDER BY id LIMIT 1`
		);

		if (userResult.rows.length > 0) {
			userId = userResult.rows[0].id;
		} else {
			throw new Error('Nincs felhasználó az adatbázisban');
		}
	} else if (typeof context.userId === 'string') {
		// Ha numerikus string, konvertáljuk number-re
		userId = Number(context.userId);
	}

	console.log('[requireOrganizationMember] DEBUG - Resolved userId:', userId);

	// ÚJ: Közvetlenül az employees táblából ellenőrizzük a tagságot organization_id alapján
	const result = await context.db.query(
		`SELECT 1 FROM app__racona_work.employees
		 WHERE organization_id = $1 AND user_id = $2`,
		[organizationId, userId]
	);

	console.log('[requireOrganizationMember] DEBUG - Membership check result:', result.rows.length > 0 ? 'MEMBER' : 'NOT MEMBER');

	if (result.rows.length === 0) {
		throw new Error('Nincs hozzáférésed ehhez a szervezethez');
	}
}

/**
 * Új szervezet létrehozása.
 * Követelmények: 2.1, 2.2, 2.3
 */
export async function createOrganization(
	params: { name: string; address?: string; phone?: string; email?: string; website?: string; notes?: string },
	context: RemoteContext
): Promise<Organization> {
	requireAdmin(context);

	const slug = generateSlug(params.name);

	// Ellenőrizzük, hogy a slug egyedi-e
	const existingResult = await context.db.query(
		`SELECT id FROM app__racona_work.organizations WHERE slug = $1`,
		[slug]
	);

	if (existingResult.rows.length > 0) {
		throw new Error('Már létezik szervezet ezzel a névvel');
	}

	const result = await context.db.query(
		`INSERT INTO app__racona_work.organizations (name, slug, address, phone, email, website, notes, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		 RETURNING id, name, slug, address, phone, email, website, notes, created_at, updated_at`,
		[params.name, slug, params.address ?? null, params.phone ?? null, params.email ?? null, params.website ?? null, params.notes ?? null]
	);

	const row = result.rows[0];

	// Rendszer szerepek seedelése + a létrehozó user org_admin szerephez rendelése.
	// Best-effort: ha hiba van, ne bontsuk vissza a szervezetet, csak logoljunk.
	try {
		let creatorUserId: number | undefined;
		if (typeof context.userId === 'number') {
			creatorUserId = context.userId;
		} else if (typeof context.userId === 'string' && !isNaN(Number(context.userId))) {
			creatorUserId = Number(context.userId);
		}
		await seedDefaultRoles({ organizationId: row.id, creatorUserId }, context);
	} catch (err) {
		console.error('[createOrganization] Szerepek seedelése sikertelen:', err);
	}

	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		address: row.address ?? null,
		phone: row.phone ?? null,
		email: row.email ?? null,
		website: row.website ?? null,
		notes: row.notes ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

/**
 * Ellenőrzi, hogy a felhasználó admin jogosultsággal rendelkezik-e.
 * Követelmény: Admin hozzáférés ellenőrzése
 */
export async function isUserAdmin(
	params: {},
	context: RemoteContext
): Promise<boolean> {
	console.log('[isUserAdmin] DEBUG - context.userId:', context.userId, 'type:', typeof context.userId);
	console.log('[isUserAdmin] DEBUG - context.permissions:', context.permissions);

	const isDevMode = typeof context.userId === 'string' && isNaN(Number(context.userId));
	console.log('[isUserAdmin] DEBUG - isDevMode:', isDevMode);

	// Dev módban ne ellenőrizzük
	if (isDevMode) {
		console.log('[isUserAdmin] DEBUG - Dev mode, returning false');
		return false;
	}

	const isAdmin = context.permissions.includes('admin');
	console.log('[isUserAdmin] DEBUG - isAdmin:', isAdmin);

	return isAdmin;
}

/**
 * Felhasználó szervezeteinek lekérdezése.
 * Admin userek esetén az összes szervezetet visszaadja.
 * Nem-admin userek esetén csak azokat, amelyeknek tagja.
 * ÚJ: Az employees táblából közvetlenül lekérdezi a szervezeteket organization_id alapján.
 * Követelmények: 2.1, 2.2
 */
export async function getUserOrganizations(
	params: {},
	context: RemoteContext
): Promise<Organization[]> {
	const isDevMode = typeof context.userId === 'string' && isNaN(Number(context.userId));
	const isAdmin = !isDevMode && context.permissions.includes('admin');

	// Admin userek az összes szervezetet látják
	if (isAdmin) {
		const result = await context.db.query(
			`SELECT id, name, slug, address, phone, email, website, notes, created_at, updated_at
			 FROM app__racona_work.organizations
			 ORDER BY name ASC`
		);

		// Ha nincs szervezet, hozz létre egy default-ot
		if (result.rows.length === 0) {
			const defaultOrg = await context.db.query(
				`INSERT INTO app__racona_work.organizations (name, slug, created_at, updated_at)
				 VALUES ('Default Organization', 'default-organization', NOW(), NOW())
				 ON CONFLICT (slug) DO NOTHING
				 RETURNING id, name, slug, address, phone, email, website, notes, created_at, updated_at`
			);
			if (defaultOrg.rows.length > 0) {
				return [defaultOrg.rows[0]].map((row: any) => ({
					id: row.id,
					name: row.name,
					slug: row.slug,
					address: row.address ?? null,
					phone: row.phone ?? null,
					email: row.email ?? null,
					website: row.website ?? null,
					notes: row.notes ?? null,
					createdAt: row.created_at,
					updatedAt: row.updated_at
				}));
			}
		}

		return result.rows.map((row: any) => ({
			id: row.id,
			name: row.name,
			slug: row.slug,
			address: row.address ?? null,
			phone: row.phone ?? null,
			email: row.email ?? null,
			website: row.website ?? null,
			notes: row.notes ?? null,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}));
	}

	// Nem-admin userek: csak a saját szervezeteik
	let userId: number | string = context.userId;

	if (typeof context.userId === 'string' && isNaN(Number(context.userId))) {
		const userResult = await context.db.query(
			`SELECT id FROM auth.users ORDER BY id LIMIT 1`
		);
		if (userResult.rows.length > 0) {
			userId = userResult.rows[0].id;
		} else {
			throw new Error('Nincs felhasználó az adatbázisban');
		}
	} else if (typeof context.userId === 'string') {
		userId = Number(context.userId);
	}

	// ÚJ: Közvetlenül az employees táblából lekérdezzük a szervezeteket
	const result = await context.db.query(
		`SELECT DISTINCT o.id, o.name, o.slug, o.address, o.phone, o.email, o.website, o.notes, o.created_at, o.updated_at
		 FROM app__racona_work.organizations o
		 JOIN app__racona_work.employees e ON e.organization_id = o.id
		 WHERE e.user_id = $1
		 ORDER BY o.name ASC`,
		[userId]
	);

	return result.rows.map((row: any) => ({
		id: row.id,
		name: row.name,
		slug: row.slug,
		address: row.address ?? null,
		phone: row.phone ?? null,
		email: row.email ?? null,
		website: row.website ?? null,
		notes: row.notes ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}));
}

/**
 * Összes szervezet lekérdezése (admin funkció).
 * Követelmény: 2.4
 */
export async function getOrganizations(
	params: {},
	context: RemoteContext
): Promise<Organization[]> {
	requireAdmin(context);

	const result = await context.db.query(
		`SELECT id, name, slug, address, phone, email, website, notes, created_at, updated_at
		 FROM app__racona_work.organizations
		 ORDER BY created_at DESC`
	);

	return result.rows.map((row: any) => ({
		id: row.id,
		name: row.name,
		slug: row.slug,
		address: row.address ?? null,
		phone: row.phone ?? null,
		email: row.email ?? null,
		website: row.website ?? null,
		notes: row.notes ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}));
}

/**
 * Szervezet adatainak frissítése.
 * Követelmények: 2.5
 */
export async function updateOrganization(
	params: { id: number; name: string; address?: string | null; phone?: string | null; email?: string | null; website?: string | null; notes?: string | null },
	context: RemoteContext
): Promise<Organization> {
	requireAdmin(context);

	const slug = generateSlug(params.name);

	// Ellenőrizzük, hogy a slug egyedi-e (kivéve az aktuális szervezetet)
	const existingResult = await context.db.query(
		`SELECT id FROM app__racona_work.organizations WHERE slug = $1 AND id != $2`,
		[slug, params.id]
	);

	if (existingResult.rows.length > 0) {
		throw new Error('Már létezik szervezet ezzel a névvel');
	}

	const result = await context.db.query(
		`UPDATE app__racona_work.organizations
		 SET name = $1, slug = $2, address = $3, phone = $4, email = $5, website = $6, notes = $7, updated_at = NOW()
		 WHERE id = $8
		 RETURNING id, name, slug, address, phone, email, website, notes, created_at, updated_at`,
		[params.name, slug, params.address ?? null, params.phone ?? null, params.email ?? null, params.website ?? null, params.notes ?? null, params.id]
	);

	if (result.rows.length === 0) {
		throw new Error(`Nem található szervezet a megadott azonosítóval: ${params.id}`);
	}

	const row = result.rows[0];
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		address: row.address ?? null,
		phone: row.phone ?? null,
		email: row.email ?? null,
		website: row.website ?? null,
		notes: row.notes ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

/**
 * Szervezet törlése.
 * Követelmények: 2.6, 2.7, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 */
export async function deleteOrganization(
	params: { id: number },
	context: RemoteContext
): Promise<{ memberCount: number; projectCount: number }> {
	requireAdmin(context);

	const client = await context.db.connect();

	try {
		await client.query('BEGIN');

		// Ellenőrizzük, hogy vannak-e projektek a szervezetben
		const projectResult = await client.query(
			`SELECT COUNT(*) AS count FROM app__racona_work.projects WHERE organization_id = $1`,
			[params.id]
		);

		const projectCount = parseInt(projectResult.rows[0].count, 10);
		if (projectCount > 0) {
			throw new Error(
				`A szervezet nem törölhető, mert ${projectCount} projekt tartozik hozzá. Először töröld a projekteket.`
			);
		}

		// Lekérdezzük a dolgozók számát a törlés előtt (információs célból)
		const memberResult = await client.query(
			`SELECT COUNT(*) AS count FROM app__racona_work.employees WHERE organization_id = $1`,
			[params.id]
		);

		const memberCount = parseInt(memberResult.rows[0].count, 10);

		// 1. Dolgozók törlése (employees rekordok) - CASCADE törli a kapcsolódó adatokat
		await client.query(
			`DELETE FROM app__racona_work.employees WHERE organization_id = $1`,
			[params.id]
		);

		// 2. Szervezet törlése
		await client.query(
			`DELETE FROM app__racona_work.organizations WHERE id = $1`,
			[params.id]
		);

		await client.query('COMMIT');

		// Visszaadjuk a törölt tagok és projektek számát
		return { memberCount, projectCount };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}



// --- Szervezet tagok kezelése ---

/**
 * Szervezet tagjainak lekérdezése (dolgozók, akik a szervezethez tartoznak).
 * Követelmény: 4.8
 */
export async function getOrganizationMembers(
	params: { organizationId: number; page?: number; pageSize?: number; search?: string },
	context: RemoteContext
): Promise<PaginatedResult<OrganizationMemberRow>> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'members.view');

	const page = params.page ?? 1;
	const pageSize = params.pageSize ?? 20;
	const offset = (page - 1) * pageSize;

	// WHERE feltételek
	const conditions: string[] = ['e.organization_id = $1'];
	const queryParams: unknown[] = [params.organizationId];
	let paramIndex = 2;

	if (params.search) {
		conditions.push(
			`(u.full_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`
		);
		queryParams.push(`%${params.search}%`);
		paramIndex++;
	}

	const whereClause = `WHERE ${conditions.join(' AND ')}`;

	// Összes találat száma
	const countResult = await context.db.query(
		`SELECT COUNT(*) AS total
		 FROM app__racona_work.employees e
		 JOIN auth.users u ON e.user_id = u.id
		 ${whereClause}`,
		queryParams
	);

	const totalCount = parseInt(countResult.rows[0].total, 10);
	const totalPages = Math.ceil(totalCount / pageSize);

	// Adatok lekérdezése
	const dataResult = await context.db.query(
		`SELECT
			e.id,
			e.organization_id,
			e.id AS employee_id,
			'member' AS role,
			e.created_at AS joined_at,
			u.full_name AS employee_name,
			u.email AS employee_email,
			u.image AS employee_image,
			e.position AS employee_position,
			e.department AS employee_department
		 FROM app__racona_work.employees e JOIN auth.users u ON e.user_id = u.id
		 ${whereClause}
		 ORDER BY u.full_name ASC
		 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
		[...queryParams, pageSize, offset]
	);

	const data: OrganizationMemberRow[] = dataResult.rows.map((row: any) => ({
		id: row.id,
		organizationId: row.organization_id,
		employeeId: row.employee_id,
		role: row.role,
		joinedAt: row.joined_at,
		employeeName: row.employee_name,
		employeeEmail: row.employee_email,
		employeeImage: row.employee_image ?? null,
		employeePosition: row.employee_position ?? null,
		employeeDepartment: row.employee_department ?? null
	}));

	return {
		data,
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages
		}
	};
}

/**
 * Dolgozó hozzáadása szervezethez.
 * Követelmény: 4.9
 */
export async function addEmployeeToOrganization(
	params: { organizationId: number; employeeId: number; role?: string },
	context: RemoteContext
): Promise<OrganizationMember & { userId: number }> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'members.manage');

	// Először lekérdezzük a dolgozó user_id-ját az értesítéshez
	const employeeResult = await context.db.query(
		`SELECT user_id FROM app__racona_work.employees WHERE id = $1`,
		[params.employeeId]
	);

	if (employeeResult.rows.length === 0) {
		throw new Error(`Nem található dolgozó a megadott azonosítóval: ${params.employeeId}`);
	}

	const userId = employeeResult.rows[0].user_id;

	// ÚJ: Új employee rekord létrehozása az adott szervezetben
	// (egy user több szervezetben is lehet dolgozó)
	const result = await context.db.query(
		`INSERT INTO app__racona_work.employees (user_id, organization_id, position, department, hire_date, status, created_at, updated_at)
		 SELECT user_id, $1, position, department, hire_date, status, NOW(), NOW()
		 FROM app__racona_work.employees
		 WHERE id = $2
		 RETURNING id, organization_id, id AS employee_id, created_at AS joined_at`,
		[params.organizationId, params.employeeId]
	);

	const row = result.rows[0];

	// Új tag → automatikus 'employee' szerep, hogy legyen alap capability-je.
	await assignDefaultEmployeeRole(context, params.organizationId, userId);

	return {
		id: row.id,
		organizationId: row.organization_id,
		employeeId: row.employee_id,
		role: 'member',
		joinedAt: row.joined_at,
		userId
	};
}

/**
 * Dolgozó eltávolítása szervezetből.
 * Követelmény: 4.10
 */
export async function removeEmployeeFromOrganization(
	params: { organizationId: number; employeeId: number },
	context: RemoteContext
): Promise<{ userId: number }> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'members.manage');

	// Ellenőrizzük, hogy a dolgozó tagja-e ennek a szervezetnek
	const employeeCheck = await context.db.query(
		`SELECT id, user_id FROM app__racona_work.employees
		 WHERE organization_id = $1 AND id = $2`,
		[params.organizationId, params.employeeId]
	);

	if (employeeCheck.rows.length === 0) {
		throw new Error('A dolgozó nem tagja ennek a szervezetnek');
	}

	const userId = employeeCheck.rows[0].user_id;

	// ÚJ: Töröljük az employee rekordot (CASCADE törli a kapcsolódó adatokat)
	await context.db.query(
		`DELETE FROM app__racona_work.employees
		 WHERE organization_id = $1 AND id = $2`,
		[params.organizationId, params.employeeId]
	);

	return { userId };
}

/**
 * Dolgozó szerepkörének frissítése szervezetben.
 * Követelmény: 4.11
 */
export async function updateOrganizationMemberRole(
	params: { organizationId: number; employeeId: number; role: string },
	context: RemoteContext
): Promise<OrganizationMember> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	// Szerepkör validáció
	if (!['member', 'admin'].includes(params.role)) {
		throw new Error('Érvénytelen szerepkör. Csak "member" vagy "admin" lehet.');
	}

	// ÚJ SÉMA: Nincs role mező az employees táblában
	// Ez a függvény már nem releváns, de megtartjuk kompatibilitás miatt
	// Egyszerűen visszaadjuk az employee adatait

	await requireCapability(context, params.organizationId, 'members.manage');

	// Ellenőrizzük hogy a dolgozó tagja-e a szervezetnek
	const result = await context.db.query(
		`SELECT id, organization_id, id AS employee_id, created_at AS joined_at
		 FROM app__racona_work.employees
		 WHERE organization_id = $1 AND id = $2`,
		[params.organizationId, params.employeeId]
	);

	if (result.rows.length === 0) {
		throw new Error('A dolgozó nem tagja ennek a szervezetnek.');
	}

	const row = result.rows[0];
	return {
		id: row.id,
		organizationId: row.organization_id,
		employeeId: row.employee_id,
		role: 'member', // Mindig member, nincs role mező
		joinedAt: row.joined_at
	};
}

/**
 * Azok a dolgozók, akik még nem tagjai az adott szervezetnek.
 * Követelmény: 4.12
 */
export async function getAvailableEmployeesForOrganization(
	params: { organizationId: number; search?: string },
	context: RemoteContext
): Promise<EmployeeRow[]> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'members.manage');

	const conditions: string[] = [
		`e.id NOT IN (
			SELECT employee_id
			FROM app__racona_work.employees WHERE organization_id = $1
		)`
	];
	const queryParams: unknown[] = [params.organizationId];
	let paramIndex = 2;

	if (params.search) {
		conditions.push(
			`(u.full_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`
		);
		queryParams.push(`%${params.search}%`);
		paramIndex++;
	}

	const whereClause = `WHERE ${conditions.join(' AND ')}`;

	const result = await context.db.query(
		`SELECT
			e.id,
			e.user_id,
			e.position,
			e.department,
			e.hire_date,
			e.status,
			e.created_at,
			e.updated_at,
			u.full_name AS user_name,
			u.email AS user_email,
			u.image AS user_image
		 FROM app__racona_work.employees e
		 JOIN auth.users u ON e.user_id = u.id
		 ${whereClause}
		 ORDER BY u.full_name ASC
		 LIMIT 50`,
		queryParams
	);

	return result.rows.map((row: any) => ({
		id: row.id,
		userId: row.user_id,
		position: row.position ?? null,
		department: row.department ?? null,
		hireDate: row.hire_date ?? null,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userName: row.user_name,
		userEmail: row.user_email,
		userImage: row.user_image ?? null
	}));
}

// --- Jogosultságkezelés (szervezet-szintű szerepek, képességek) -------------
// Az implementáció a ./permissions.ts fájlban található; itt reexportáljuk,
// hogy a remote dispatcher (serverModule[functionName]) elérje őket.

export {
	getMyCapabilities,
	listRoles,
	createRole,
	updateRole,
	deleteRole,
	listRoleMembers,
	addRoleMember,
	removeRoleMember,
	seedDefaultRoles
} from './permissions.js';

// --- Projektek --------------------------------------------------------------

export {
	listProjects,
	getProject,
	createProject,
	updateProject,
	deleteProject,
	listProjectMembers,
	addProjectMember,
	removeProjectMember,
	listProjectRoleOverrides,
	setProjectUserRoles,
	clearProjectUserRoles
} from './projects.js';

/**
 * Az aktuális hívó saját employee rekordja egy adott szervezetben, vagy null.
 * Nem dob hibát, ha nincs — a kliens ez alapján dönti el, hogy mit mutasson.
 * Alap jog: leave.request (tehát minden tag hívhatja).
 */
export async function getMyEmployee(
	params: { organizationId: number },
	context: RemoteContext
): Promise<EmployeeRow | null> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'leave.request');

	// User id feloldása (dev mód: az első user)
	let userId: number;
	if (typeof context.userId === 'number') userId = context.userId;
	else if (typeof context.userId === 'string' && !isNaN(Number(context.userId))) {
		userId = Number(context.userId);
	} else {
		const u = await context.db.query(`SELECT id FROM auth.users ORDER BY id LIMIT 1`);
		if (u.rows.length === 0) return null;
		userId = (u.rows[0] as { id: number }).id;
	}

	const result = await context.db.query(
		`SELECT e.id, e.user_id, e.position, e.department, e.hire_date, e.status,
		        e.created_at, e.updated_at,
		        u.full_name AS user_name, u.email AS user_email, u.image AS user_image
		   FROM app__racona_work.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.organization_id = $1 AND e.user_id = $2
		  LIMIT 1`,
		[params.organizationId, userId]
	);
	if (result.rows.length === 0) return null;
	const row = result.rows[0] as any;
	return {
		id: row.id,
		userId: row.user_id,
		position: row.position ?? null,
		department: row.department ?? null,
		hireDate: row.hire_date ?? null,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userName: row.user_name,
		userEmail: row.user_email,
		userImage: row.user_image ?? null
	};
}

// --- Munkabejegyzések (work entries) ---------------------------------------

export {
	listWorkEntries,
	createWorkEntry,
	updateWorkEntry,
	deleteWorkEntry,
	getProjectReport
} from './work-entries.js';

export type {
	WorkEntry,
	WorkEntryRow,
	WorkEntryListParams,
	WorkEntryListResult,
	ProjectReport,
	ProjectReportEmployee,
	ProjectReportDaily
} from './work-entries.js';
