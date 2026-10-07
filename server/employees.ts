/**
 * Dolgozókezelés — szerver oldali függvények.
 *
 * Dolgozó rekordok (app__racona_work.employees) és a dolgozói adatlap
 * (employee_details) kezelése, plusz az összekapcsolható auth.users listája.
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin, resolveUserId } from './context.js';
import { hasCapability, LEAVE_VIEW_CAPABILITIES, requireAnyCapability, requireCapability } from './permissions.js';
import {
	canViewOrganizationDocuments,
	emptyCounts,
	loadDocumentIssues,
	type DocumentIssueCounts
} from './document-overview.js';
import { parseDay, todayInBudapest } from './dates.js';
import { recalculateEmployeeBalances } from './leave-profile.js';
import { geocodeAddress } from './geo.js';
import { validateTaxId } from './trip-calc.js';
import { loadNotificationSettings, replyToFor } from './notification-settings.js';
import { DEFAULT_EMAIL_LOCALE, escapeHtml } from './notification-email.js';
import type { RecalculatedBalance } from './leave-profile.js';
import type { PaginatedResult } from './types.js';

export interface Employee {
	id: number;
	userId: number;
	position: string | null;
	hireDate: string | null;
	status: string;
	createdAt: string;
	updatedAt: string;
	/** Külsős dolgozó: csak a projektekben vesz részt (specs/external-employees.md). */
	isExternal?: boolean;
}

export interface EmployeeRow extends Employee {
	userName: string;
	userEmail: string;
	userImage: string | null;
	/**
	 * A Jogosultságoknál kiosztott szervezeti szerepek (csak a getEmployees tölti).
	 * A kulcs és az isSystem a rendszerszerepek fordított nevéhez kell (src/utils/roles.ts).
	 */
	roles?: Array<{ key: string; name: string; isSystem: boolean }>;
	/**
	 * Lejárt, lejáró, hiányzó kötelező és fájl nélküli dokumentumok száma
	 * (specs/employee-documents.md, K11). Csak `withDocumentIssues` kérésre és
	 * dokumentum-olvasási joggal.
	 */
	documentIssues?: DocumentIssueCounts;
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
	/**
	 * Az adatlap kulcs-érték sorai. Csak a dolgozó maga és a HR (employee.manage
	 * vagy leave.balance.manage) kapja meg; másnak üres tömb.
	 */
	details: EmployeeDetail[];
	/** A hívó láthatja-e az adatlapot (details); ha nem, csak az alapadatok jönnek. */
	detailsVisible: boolean;
	/** A munkaviszony dátumai YYYY-MM-DD formában (a szabadság arányosításához is kellenek). */
	employment: {
		hireDate: string | null;
		employmentEndDate: string | null;
		/** A HR ellenőrizte-e a belépés dátumát (létrehozáskor az aznapi dátum került be). */
		hireDateConfirmed: boolean;
	};
	/**
	 * Személyes adatok, amelyeket csak a dolgozó maga és a HR (employee.manage
	 * vagy leave.balance.manage) láthat; másnak null.
	 */
	personal: EmployeePersonalData | null;
}

/**
 * Fix személyes mezők. A születési dátum a szabadságkerethez, a többi a
 * kiküldetési rendelvényhez kell (specs/business-trips.md, D16). Egyik sem kötelező.
 */
export interface EmployeePersonalData {
	birthDate: string | null;
	homeAddress: string | null;
	/** A lakcím koordinátái (mentéskor geokódolva); null, ha nem találtuk. */
	homeLocation: { lat: number; lng: number } | null;
	birthPlace: string | null;
	motherName: string | null;
	taxId: string | null;
}

/** A dolgozó személyes adatait láthatja-e a hívó: saját rekord, vagy HR. */
async function canSeePersonalData(
	context: RemoteContext,
	organizationId: number,
	employeeUserId: number
): Promise<boolean> {
	if (await hasCapability(context, organizationId, 'employee.manage')) return true;
	if (await hasCapability(context, organizationId, 'leave.balance.manage')) return true;
	return (await resolveUserId(context)) === employeeUserId;
}

async function requireEmployeeOrLeaveManager(context: RemoteContext, organizationId: number): Promise<void> {
	if (await hasCapability(context, organizationId, 'employee.manage')) return;
	await requireCapability(context, organizationId, 'leave.balance.manage');
}

export interface EmployeeListParams {
	organizationId: number;
	page?: number;
	pageSize?: number;
	sortBy?: string;
	sortOrder?: 'asc' | 'desc';
	search?: string;
	status?: string;
	/**
	 * A külsős dolgozók is kellenek-e (Dolgozók lista, projekt tagválasztó,
	 * szerepek). Alapból kimaradnak, mert a többi funkcióra nem vonatkoznak.
	 */
	includeExternal?: boolean;
	/** A sorok kapják meg a dokumentumproblémák számát (dokumentum-olvasási joggal). */
	withDocumentIssues?: boolean;
	/** Csak a dokumentumproblémás dolgozók (dokumentum-olvasási joggal; különben figyelmen kívül marad). */
	documentIssuesOnly?: boolean;
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
	params: { userId: number; organizationId: number; position?: string },
	context: RemoteContext
): Promise<Employee> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'employee.manage');

	// Employee rekord létrehozása organization_id-val
	const empResult = await context.db.query(
		`INSERT INTO app__racona_work.employees (user_id, organization_id, position, hire_date, status)
		 VALUES ($1, $2, $3, CURRENT_DATE, 'active')
		 RETURNING id, user_id, position, hire_date, status, created_at, updated_at`,
		[params.userId, params.organizationId, params.position ?? null]
	);

	const row = empResult.rows[0];

	const employee: Employee = {
		id: row.id,
		userId: row.user_id,
		position: row.position ?? null,
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
	},
	context: RemoteContext
): Promise<Employee> {
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
			`INSERT INTO app__racona_work.employees (user_id, organization_id, position, hire_date, status)
			 VALUES ($1, $2, $3, CURRENT_DATE, 'active')
			 RETURNING id, user_id, position, hire_date, status, created_at, updated_at`,
			[userId, params.organizationId, params.position ?? null]
		);

		const row = empResult.rows[0];
		employee = {
			id: row.id,
			userId: row.user_id,
			position: row.position ?? null,
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

	// Email küldés a tranzakción kívül — hiba esetén NEM gördíti vissza.
	// A szervezet kikapcsolhatja (specs/notifications.md).
	try {
		const notificationSettings = await loadNotificationSettings(context, params.organizationId);
		if (!notificationSettings.email['employee.welcome']) {
			return employee;
		}
		const schemaName = `app__${context.pluginId.replace(/-/g, '_')}`;

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
			? `<p style="margin: 0 0 4px; font-size: 14px; color: #18181b;"><strong>Beosztás:</strong> ${escapeHtml(params.position)}</p>`
			: '';
		const positionText = params.position ? `  Beosztás: ${params.position}\n` : '';

		await context.email?.send({
			to: params.email,
			template: 'employee_welcome',
			data: {
				// A HTML változat a *Html mezőket kapja (a core sablonmotorja nem escapel)
				name: params.name,
				nameHtml: escapeHtml(params.name),
				email: params.email,
				emailHtml: escapeHtml(params.email),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				pluginName,
				pluginNameHtml: escapeHtml(pluginName),
				positionHtml,
				positionText
			},
			// Az épp most létrehozott felhasználónak még nincs nyelvi beállítása
			locale: DEFAULT_EMAIL_LOCALE,
			replyTo: replyToFor(notificationSettings, 'employee.welcome')
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
		status: 'e.status',
		hireDate: 'e.hire_date',
		roles: 'role_names'
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

	if (!params.includeExternal) {
		conditions.push('e.is_external = FALSE');
	}

	// Dokumentumproblémák (jelvény és szűrő) — csak dokumentum-olvasási joggal
	const wantsIssues = params.withDocumentIssues === true || params.documentIssuesOnly === true;
	const issueCounts = new Map<number, DocumentIssueCounts>();
	const issuesAllowed = wantsIssues && (await canViewOrganizationDocuments(context, params.organizationId));
	if (issuesAllowed) {
		for (const issue of await loadDocumentIssues(context, params.organizationId)) {
			const counts = issueCounts.get(issue.employeeId) ?? emptyCounts();
			counts[issue.kind]++;
			issueCounts.set(issue.employeeId, counts);
		}
		if (params.documentIssuesOnly) {
			conditions.push(`e.id = ANY($${paramIndex}::int[])`);
			queryParams.push([...issueCounts.keys()]);
			paramIndex++;
		}
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
			e.hire_date,
			e.status,
			e.is_external,
			e.created_at,
			e.updated_at,
			u.full_name AS user_name,
			u.email AS user_email,
			u.image AS user_image,
			ARRAY(
				SELECT r.name
				  FROM app__racona_work.wp_member_roles mr
				  JOIN app__racona_work.wp_roles r ON r.id = mr.role_id
				 WHERE mr.organization_id = e.organization_id AND mr.user_id = e.user_id
				 ORDER BY r.is_system DESC, r.name ASC
			) AS role_names,
			COALESCE((
				SELECT json_agg(
						json_build_object('key', r.key, 'name', r.name, 'isSystem', r.is_system)
						ORDER BY r.is_system DESC, r.name ASC
					)
				  FROM app__racona_work.wp_member_roles mr
				  JOIN app__racona_work.wp_roles r ON r.id = mr.role_id
				 WHERE mr.organization_id = e.organization_id AND mr.user_id = e.user_id
			), '[]'::json) AS role_list
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
		hireDate: row.hire_date ?? null,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userName: row.user_name,
		userEmail: row.user_email,
		userImage: row.user_image ?? null,
		isExternal: row.is_external === true,
		roles: row.role_list ?? [],
		...(issuesAllowed && params.withDocumentIssues
			? { documentIssues: issueCounts.get(row.id) ?? emptyCounts() }
			: {})
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
			e.hire_date,
			e.status,
			e.is_external,
			e.created_at,
			e.updated_at,
			to_char(e.hire_date, 'YYYY-MM-DD') AS hire_day,
			to_char(e.employment_end_date, 'YYYY-MM-DD') AS employment_end_day,
			to_char(e.birth_date, 'YYYY-MM-DD') AS birth_day,
			e.home_address,
			e.home_lat,
			e.home_lng,
			e.birth_place,
			e.mother_name,
			e.tax_id,
			e.hire_date_confirmed,
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
		hireDate: empRow.hire_date ?? null,
		status: empRow.status,
		createdAt: empRow.created_at,
		updatedAt: empRow.updated_at,
		userName: empRow.user_name,
		userEmail: empRow.user_email,
		userImage: empRow.user_image ?? null,
		isExternal: empRow.is_external === true
	};

	const employment = {
		hireDate: empRow.hire_day ?? null,
		employmentEndDate: empRow.employment_end_day ?? null,
		hireDateConfirmed: empRow.hire_date_confirmed === true
	};

	// Az adatlap és a személyes adatok csak a dolgozónak és a HR-nek járnak;
	// a többi employee.view jogú hívó (pl. kiküldetés jóváhagyó) csak az alapadatokat kapja.
	if (!(await canSeePersonalData(context, orgId, empRow.user_id))) {
		return { employee, details: [], detailsVisible: false, employment, personal: null };
	}

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

	return {
		employee,
		details,
		detailsVisible: true,
		employment,
		personal: mapPersonal(empRow)
	};
}

function mapPersonal(row: any): EmployeePersonalData {
	const lat = row.home_lat === null || row.home_lat === undefined ? null : Number(row.home_lat);
	const lng = row.home_lng === null || row.home_lng === undefined ? null : Number(row.home_lng);
	return {
		birthDate: row.birth_day ?? null,
		homeAddress: row.home_address ?? null,
		homeLocation: lat !== null && lng !== null ? { lat, lng } : null,
		birthPlace: row.birth_place ?? null,
		motherName: row.mother_name ?? null,
		taxId: row.tax_id ?? null
	};
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim().replace(/\s+/g, ' ');
	if (trimmed.length > maxLength) throw new Error(`${label}: legfeljebb ${maxLength} karakter.`);
	return trimmed || null;
}

/**
 * A kiküldetési rendelvényhez szükséges személyes adatok mentése (K17). Csak a
 * megadott mezők változnak. A lakcímet mentéskor geokódoljuk; ha nem találjuk,
 * a cím akkor is mentődik, csak kiindulópontként nem használható.
 */
export async function saveEmployeePersonalData(
	params: {
		employeeId: number;
		homeAddress?: string | null;
		birthPlace?: string | null;
		motherName?: string | null;
		taxId?: string | null;
	},
	context: RemoteContext
): Promise<{
	personal: EmployeePersonalData;
	/** A lakcím, ahogy a térképen megtaláltuk (ellenőrzéshez), ha változott. */
	geocodedAddress: string | null;
	geocodeFailed: boolean;
	taxIdBirthDateMismatch: boolean;
}> {
	const orgId = await getEmployeeOrganizationId(context, params.employeeId);
	await requireCapability(context, orgId, 'employee.manage');

	const current = await context.db.query(
		`SELECT home_address, to_char(birth_date, 'YYYY-MM-DD') AS birth_day FROM app__racona_work.employees WHERE id = $1`,
		[params.employeeId]
	);
	const birthDay: string | null = current.rows[0]?.birth_day ?? null;

	const sets: string[] = [];
	const values: unknown[] = [params.employeeId];
	const set = (column: string, value: unknown) => {
		values.push(value);
		sets.push(`${column} = $${values.length}`);
	};

	let geocodedAddress: string | null = null;
	let geocodeFailed = false;
	if (params.homeAddress !== undefined) {
		const address = optionalText(params.homeAddress, 'Lakcím', 300);
		set('home_address', address);
		if (address !== (current.rows[0]?.home_address ?? null)) {
			const found = address ? await geocodeAddress(context, orgId, address) : null;
			geocodeFailed = address !== null && found === null;
			geocodedAddress = found?.address ?? null;
			set('home_lat', found?.lat ?? null);
			set('home_lng', found?.lng ?? null);
		}
	}
	if (params.birthPlace !== undefined) set('birth_place', optionalText(params.birthPlace, 'Születési hely', 100));
	if (params.motherName !== undefined) set('mother_name', optionalText(params.motherName, 'Anyja neve', 150));

	let taxIdBirthDateMismatch = false;
	if (params.taxId !== undefined) {
		const taxId = optionalText(params.taxId, 'Adóazonosító jel', 20)?.replace(/[\s-]/g, '') ?? null;
		if (taxId) {
			const check = validateTaxId(taxId, birthDay);
			if (!check.valid) {
				throw new Error('Adóazonosító jel: 10 számjegy, 8-cal kezdődik, és az ellenőrző jegy nem stimmel.');
			}
			taxIdBirthDateMismatch = check.birthDateMismatch;
		}
		set('tax_id', taxId);
	}

	if (sets.length > 0) {
		await context.db.query(
			`UPDATE app__racona_work.employees SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
			values
		);
	}
	const updated = await context.db.query(
		`SELECT to_char(birth_date, 'YYYY-MM-DD') AS birth_day, home_address, home_lat, home_lng,
		        birth_place, mother_name, tax_id
		   FROM app__racona_work.employees WHERE id = $1`,
		[params.employeeId]
	);
	return { personal: mapPersonal(updated.rows[0]), geocodedAddress, geocodeFailed, taxIdBirthDateMismatch };
}

/**
 * A dolgozó születési dátuma (személyes adat). HR menti (employee.manage vagy
 * leave.balance.manage); a dolgozó adatbejelentésben kérheti a változtatást.
 * Utána a nyitott szabadságkeretek újraszámolódnak (életkor szerinti pótszabadság).
 */
export async function saveEmployeeBirthDate(
	params: { employeeId: number; birthDate: string | null },
	context: RemoteContext
): Promise<{ birthDate: string | null; recalculated: RecalculatedBalance[] }> {
	const orgId = await getEmployeeOrganizationId(context, params.employeeId);
	await requireEmployeeOrLeaveManager(context, orgId);

	const birthDate = parseDay(params.birthDate, 'Születési dátum');
	if (birthDate && (birthDate > todayInBudapest() || birthDate < '1900-01-01')) {
		throw new Error('Születési dátum: nem lehet a jövőben.');
	}
	await context.db.query(
		`UPDATE app__racona_work.employees SET birth_date = $2, updated_at = NOW() WHERE id = $1`,
		[params.employeeId, birthDate]
	);
	return { birthDate, recalculated: await recalculateEmployeeBalances(context, params.employeeId) };
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
	params: {
		id: number;
		position?: string;
		status?: string;
		/** A belépés napja. Mentéskor ellenőrzöttnek számít (hire_date_confirmed). */
		hireDate?: string;
		/** A kilépés napja; null törli. */
		employmentEndDate?: string | null;
		/** Külsős dolgozó: csak a projektekben vesz részt. */
		isExternal?: boolean;
	},
	context: RemoteContext
): Promise<Employee & { recalculated: RecalculatedBalance[] }> {
	// Legalább egy mezőt meg kell adni
	if (
		params.position === undefined &&
		params.status === undefined &&
		params.hireDate === undefined &&
		params.employmentEndDate === undefined &&
		params.isExternal === undefined
	) {
		throw new Error(
			'Legalább egy mezőt meg kell adni a frissítéshez (position, status, hireDate, employmentEndDate, isExternal).'
		);
	}

	const orgId = await getEmployeeOrganizationId(context, params.id);
	await requireCapability(context, orgId, 'employee.manage');

	// A munkaviszony dátumai a szabadság arányosításához is kellenek
	const hireDate = params.hireDate === undefined ? undefined : parseDay(params.hireDate, 'Belépés dátuma', true)!;
	const endDate =
		params.employmentEndDate === undefined ? undefined : parseDay(params.employmentEndDate, 'Kilépés dátuma');
	if (hireDate !== undefined || endDate !== undefined) {
		const current = await context.db.query(
			`SELECT to_char(hire_date, 'YYYY-MM-DD') AS hire_date,
			        to_char(employment_end_date, 'YYYY-MM-DD') AS end_date
			   FROM app__racona_work.employees WHERE id = $1`,
			[params.id]
		);
		const effectiveHire = hireDate ?? current.rows[0]?.hire_date ?? null;
		const effectiveEnd = endDate === undefined ? (current.rows[0]?.end_date ?? null) : endDate;
		if (effectiveHire && effectiveEnd && effectiveEnd < effectiveHire) {
			throw new Error('A kilépés dátuma nem lehet korábbi a belépésnél.');
		}
	}

	// Dinamikus SET záradék összeállítása
	const setClauses: string[] = [];
	const queryParams: unknown[] = [];
	let paramIndex = 1;

	if (params.position !== undefined) {
		setClauses.push(`position = $${paramIndex}`);
		queryParams.push(params.position);
		paramIndex++;
	}

	if (params.status !== undefined) {
		setClauses.push(`status = $${paramIndex}`);
		queryParams.push(params.status);
		paramIndex++;
	}

	if (hireDate !== undefined) {
		setClauses.push(`hire_date = $${paramIndex}`, `hire_date_confirmed = TRUE`);
		queryParams.push(hireDate);
		paramIndex++;
	}

	if (endDate !== undefined) {
		setClauses.push(`employment_end_date = $${paramIndex}`);
		queryParams.push(endDate);
		paramIndex++;
	}

	if (params.isExternal !== undefined) {
		setClauses.push(`is_external = $${paramIndex}`);
		queryParams.push(params.isExternal === true);
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
		 RETURNING id, user_id, position, hire_date, status, created_at, updated_at`,
		queryParams
	);

	if (result.rows.length === 0) {
		throw new Error(`Nem található dolgozó a megadott azonosítóval: ${params.id}`);
	}

	const row = result.rows[0];
	const datesChanged = hireDate !== undefined || endDate !== undefined;
	return {
		id: row.id,
		userId: row.user_id,
		position: row.position ?? null,
		hireDate: row.hire_date ?? null,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		recalculated: datesChanged ? await recalculateEmployeeBalances(context, params.id) : []
	};
}

/**
 * Az aktuális hívó saját employee rekordja egy adott szervezetben, vagy null.
 * Nem dob hibát, ha nincs — a kliens ez alapján dönti el, hogy mit mutasson.
 * Jog: leave.request vagy work.log. A külsős dolgozónak nincs leave.request
 * képessége, de a mobil munkanaplóhoz neki is kell a saját rekordja. A jóváhagyó
 * és a HR (leave.approve, leave.balance.manage) kérelem-jog nélkül is lekéri,
 * mert a szabadság-nyilvántartó és az irányítópult a sajátját ez alapján mutatja.
 */
export async function getMyEmployee(
	params: { organizationId: number },
	context: RemoteContext
): Promise<EmployeeRow | null> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireAnyCapability(context, params.organizationId, [...LEAVE_VIEW_CAPABILITIES, 'work.log']);

	// User id feloldása (dev mód: az első user)
	const userId = await resolveUserId(context);

	const result = await context.db.query(
		`SELECT e.id, e.user_id, e.position, e.hire_date, e.status, e.is_external,
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
		hireDate: row.hire_date ?? null,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		userName: row.user_name,
		userEmail: row.user_email,
		userImage: row.user_image ?? null,
		isExternal: row.is_external === true
	};
}
