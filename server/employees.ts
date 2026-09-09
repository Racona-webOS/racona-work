/**
 * Dolgozókezelés — szerver oldali függvények.
 *
 * Dolgozó rekordok (app__racona_work.employees) és a dolgozói adatlap
 * (employee_details) kezelése, plusz az összekapcsolható auth.users listája.
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin, resolveUserId } from './context.js';
import { requireCapability } from './permissions.js';
import type { PaginatedResult } from './types.js';

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

export interface EmployeeListParams {
	organizationId: number;
	page?: number;
	pageSize?: number;
	sortBy?: string;
	sortOrder?: 'asc' | 'desc';
	search?: string;
	status?: string;
}

export interface UnlinkedUser {
	id: number;
	name: string;
	email: string;
	image: string | null;
}

export async function getUnlinkedUsers(
	params: { organizationId?: number },
	context: RemoteContext
): Promise<UnlinkedUser[]> {
	// Védelem: core admin bármikor lekérdezheti; egyéb esetben a hívónak
	// employee.manage képességgel kell rendelkeznie a megadott szervezetre.
	if (!isDevMode(context) && !isCoreAdmin(context)) {
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
	params: {
		name: string;
		email: string;
		organizationId: number;
		position?: string;
		department?: string;
	},
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

		// Szervezet neve, amibe a dolgozót felvették.
		const orgResult = await context.db.query(
			`SELECT name FROM ${schemaName}.organizations WHERE id = $1`,
			[params.organizationId]
		);
		const organizationName = orgResult.rows[0]?.name ?? '';

		// A plugin megjelenített neve (HU lokalizált) a platform.apps táblából.
		// Fallback a pluginId-ra, ha nincs bejegyzés vagy hiba lép fel.
		let pluginName = context.pluginId;
		try {
			const appResult = await context.db.query(`SELECT name FROM platform.apps WHERE app_id = $1`, [
				context.pluginId
			]);
			const nameJson = appResult.rows[0]?.name as Record<string, string> | null | undefined;
			if (nameJson && typeof nameJson === 'object') {
				pluginName = nameJson['hu'] ?? nameJson['en'] ?? context.pluginId;
			}
		} catch (lookupErr) {
			console.warn('[Work] Plugin név lekérése sikertelen:', lookupErr);
		}

		// A template engine csak {{var}} szintaxist támogat (nincs {{#if}}),
		// ezért a feltételes blokkokat itt formázzuk előre. Ha nincs érték,
		// üres string megy át, és a placeholder eltűnik a kimenetből.
		const positionHtml = params.position
			? `<p style="margin: 0 0 4px; font-size: 14px; color: #18181b;"><strong>Beosztás:</strong> ${params.position}</p>`
			: '';
		const departmentHtml = params.department
			? `<p style="margin: 0; font-size: 14px; color: #18181b;"><strong>Részleg:</strong> ${params.department}</p>`
			: '';
		const positionText = params.position ? `  Beosztás: ${params.position}\n` : '';
		const departmentText = params.department ? `  Részleg: ${params.department}\n` : '';

		await context.email?.send({
			to: params.email,
			template: 'employee_welcome',
			data: {
				name: params.name,
				email: params.email,
				companyName,
				organizationName,
				pluginName,
				positionHtml,
				departmentHtml,
				positionText,
				departmentText
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
		conditions.push(`(u.full_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`);
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
 * Belső segéd (a functions.ts barrel NEM reexportálja, tehát nem hívható
 * remote-ból) — az organizations.ts is használja.
 *
 * Új szervezeti tagnak (employee) automatikus hozzárendelése az alap
 * 'employee' szerephez, ha még nincs szerep-kapcsolata a szervezetben.
 *
 * Best-effort: ha bármilyen hiba történik (pl. nincs ilyen rendszer szerep),
 * csak logolunk, nem dobunk kifelé — a dolgozó rekord már létrejött.
 */
export async function assignDefaultEmployeeRole(
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
 * Belső segéd (a functions.ts barrel NEM reexportálja) — a leave.ts is használja.
 *
 * Az adott employee szervezeti azonosítóját adja vissza.
 * Throw-ol, ha nem található az employee.
 */
export async function getEmployeeOrganizationId(
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

	await context.db.query(`DELETE FROM app__racona_work.employee_details WHERE id = $1`, [
		params.id
	]);
}

export async function updateEmployee(
	params: { id: number; position?: string; department?: string; status?: string },
	context: RemoteContext
): Promise<Employee> {
	// Legalább egy mezőt meg kell adni
	if (
		params.position === undefined &&
		params.department === undefined &&
		params.status === undefined
	) {
		throw new Error(
			'Legalább egy mezőt meg kell adni a frissítéshez (position, department, status).'
		);
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
	const userId = await resolveUserId(context);

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
