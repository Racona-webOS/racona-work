/**
 * Szervezetek — szerver oldali függvények.
 *
 * Szervezetek (organizations) CRUD-ja és a szervezeti tagság kezelése.
 * A tagság az employees.organization_id oszlopon alapul: egy dolgozó
 * pontosan egy szervezethez tartozik.
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin, resolveUserId } from './context.js';
import { requireCapability, seedDefaultRoles } from './permissions.js';
import { assignDefaultEmployeeRole } from './employees.js';
import type { EmployeeRow } from './employees.js';
import type { PaginatedResult } from './types.js';

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
	// Dev módban ne ellenőrizzük a jogosultságot
	if (!isDevMode(context) && !isCoreAdmin(context)) {
		throw new Error('Ez a művelet adminisztrátori jogosultságot igényel');
	}
}

/**
 * Új szervezet létrehozása.
 * Követelmények: 2.1, 2.2, 2.3
 */
export async function createOrganization(
	params: {
		name: string;
		address?: string;
		phone?: string;
		email?: string;
		website?: string;
		notes?: string;
	},
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
		[
			params.name,
			slug,
			params.address ?? null,
			params.phone ?? null,
			params.email ?? null,
			params.website ?? null,
			params.notes ?? null
		]
	);

	const row = result.rows[0];

	// Rendszer szerepek seedelése + a létrehozó user org_admin szerephez rendelése.
	// Best-effort: ha hiba van, ne bontsuk vissza a szervezetet, csak logoljunk.
	try {
		// Dev módban nincs valódi hívó, ilyenkor nem rendelünk org_admin-t.
		const creatorUserId = isDevMode(context) ? undefined : await resolveUserId(context);
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
export async function isUserAdmin(params: {}, context: RemoteContext): Promise<boolean> {
	// Dev módban nincs core admin
	if (isDevMode(context)) return false;
	return isCoreAdmin(context);
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
	// Admin userek az összes szervezetet látják
	if (!isDevMode(context) && isCoreAdmin(context)) {
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
	const userId = await resolveUserId(context);

	// Közvetlenül az employees táblából lekérdezzük a szervezeteket
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
	params: {
		id: number;
		name: string;
		address?: string | null;
		phone?: string | null;
		email?: string | null;
		website?: string | null;
		notes?: string | null;
	},
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
		[
			params.name,
			slug,
			params.address ?? null,
			params.phone ?? null,
			params.email ?? null,
			params.website ?? null,
			params.notes ?? null,
			params.id
		]
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
		await client.query(`DELETE FROM app__racona_work.employees WHERE organization_id = $1`, [
			params.id
		]);

		// 2. Szervezet törlése
		await client.query(`DELETE FROM app__racona_work.organizations WHERE id = $1`, [params.id]);

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
		conditions.push(`(u.full_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`);
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

	// A szervezeti tagságot maga az employees.organization_id hordozza, és egy user
	// szervezetenként csak egyszer szerepelhet (UNIQUE(user_id, organization_id)),
	// ezért user_id alapján zárjuk ki azokat, akiknek már van rekordja a szervezetben.
	const conditions: string[] = [
		`NOT EXISTS (
			SELECT 1
			FROM app__racona_work.employees m
			WHERE m.organization_id = $1 AND m.user_id = e.user_id
		)`
	];
	const queryParams: unknown[] = [params.organizationId];
	let paramIndex = 2;

	if (params.search) {
		conditions.push(`(u.full_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`);
		queryParams.push(`%${params.search}%`);
		paramIndex++;
	}

	const whereClause = `WHERE ${conditions.join(' AND ')}`;

	const result = await context.db.query(
		`SELECT * FROM (
			SELECT DISTINCT ON (e.user_id)
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
			ORDER BY e.user_id, e.id
		 ) AS available
		 ORDER BY user_name ASC
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
