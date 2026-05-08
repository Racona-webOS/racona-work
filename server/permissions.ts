/**
 * Szervezet-szintű jogosultságkezelés a racona-work pluginhoz.
 *
 * Szerepek és képességek a plugin saját sémájában (app__racona_work.wp_*).
 * A core admin jogosultság (context.permissions.includes('admin')) felülírja ezeket.
 *
 * Publikus remote funkciók (a functions.ts reexportálja őket):
 *   - getMyCapabilities({ organizationId })
 *   - listRoles({ organizationId })
 *   - createRole({ organizationId, key?, name, description?, capabilities[] })
 *   - updateRole({ id, name?, description?, capabilities? })
 *   - deleteRole({ id })                  // is_system=true nem törölhető
 *   - listRoleMembers({ roleId })
 *   - addRoleMember({ roleId, userId })
 *   - removeRoleMember({ roleId, userId })
 *   - seedDefaultRoles({ organizationId }) // új szervezethez (createOrganization hívja)
 */

import type { RemoteContext } from './functions.js';

/** Képesség-kulcsok whitelist. Új képesség hozzáadása: bővítsd a tömböt és a UI-t. */
export const CAPABILITIES = [
	'org.manage',
	'members.view',
	'members.manage',
	'roles.manage',

	'project.create',
	'project.manage',
	'project.view.all',
	'project.view.own',

	'work.log',
	'work.view.all',

	'leave.request',
	'leave.approve',
	'leave.balance.manage',

	'employee.view',
	'employee.manage'
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: Set<string> = new Set(CAPABILITIES);

/** Rendszer szerep kulcsok — ezekhez a createOrganization automatikusan létrehoz szerepet. */
export const SYSTEM_ROLE_DEFINITIONS: Array<{
	key: string;
	name: string;
	description: string;
	capabilities: Capability[];
}> = [
	{
		key: 'org_admin',
		name: 'Szervezet adminisztrátor',
		description: 'Teljes hozzáférés a szervezeten belül',
		capabilities: [
			'org.manage',
			'members.view',
			'members.manage',
			'roles.manage',
			'project.create',
			'project.manage',
			'project.view.all',
			'work.log',
			'work.view.all',
			'leave.request',
			'leave.approve',
			'leave.balance.manage',
			'employee.view',
			'employee.manage'
		]
	},
	{
		key: 'project_manager',
		name: 'Projektkezelő',
		description: 'Projektek létrehozása és kezelése',
		capabilities: [
			'project.create',
			'project.manage',
			'project.view.all',
			'work.log',
			'work.view.all',
			'employee.view',
			'members.view'
		]
	},
	{
		key: 'hr_manager',
		name: 'HR felelős',
		description: 'Dolgozói adatok és szabadságok kezelése',
		capabilities: [
			'leave.approve',
			'leave.balance.manage',
			'employee.manage',
			'employee.view',
			'members.view',
			'work.view.all'
		]
	},
	{
		key: 'employee',
		name: 'Dolgozó',
		description: 'Alap hozzáférés a saját adatokhoz',
		capabilities: ['leave.request', 'project.view.own', 'employee.view', 'work.log']
	}
];

// --- Közös segédfüggvények ---------------------------------------------------

function isDevMode(context: RemoteContext): boolean {
	return typeof context.userId === 'string' && isNaN(Number(context.userId));
}

function isCoreAdmin(context: RemoteContext): boolean {
	return context.permissions?.includes('admin') === true;
}

/**
 * Feloldja a context.userId-t numerikus user id-ra.
 * Dev módban az első auth.users rekordot használja.
 */
async function resolveUserId(context: RemoteContext): Promise<number> {
	if (typeof context.userId === 'number') return context.userId;
	if (typeof context.userId === 'string' && !isNaN(Number(context.userId))) {
		return Number(context.userId);
	}
	const result = await context.db.query(`SELECT id FROM auth.users ORDER BY id LIMIT 1`);
	if (result.rows.length === 0) throw new Error('Nincs felhasználó az adatbázisban');
	return (result.rows[0] as { id: number }).id;
}

// --- Capability lekérdezés ---------------------------------------------------

/**
 * Kliens hívja: lekéri, hogy az aktuális felhasználó milyen képességekkel rendelkezik
 * a megadott szervezetben. Ha core admin vagy dev mód, mindet visszaadja.
 */
export async function getMyCapabilities(
	params: { organizationId: number },
	context: RemoteContext
): Promise<{ capabilities: string[]; isCoreAdmin: boolean; isDevMode: boolean }> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	const devMode = isDevMode(context);
	const coreAdmin = isCoreAdmin(context);

	if (devMode || coreAdmin) {
		return {
			capabilities: [...CAPABILITIES],
			isCoreAdmin: coreAdmin,
			isDevMode: devMode
		};
	}

	const userId = await resolveUserId(context);

	const result = await context.db.query(
		`SELECT DISTINCT rc.capability
		   FROM app__racona_work.wp_member_roles mr
		   JOIN app__racona_work.wp_role_capabilities rc ON rc.role_id = mr.role_id
		  WHERE mr.organization_id = $1 AND mr.user_id = $2`,
		[params.organizationId, userId]
	);

	return {
		capabilities: result.rows.map((r: any) => String(r.capability)),
		isCoreAdmin: false,
		isDevMode: false
	};
}

/**
 * Szerver oldali segéd: adott user képességei egy szervezetben (opcionálisan projektben).
 * Core admin / dev mód automatikusan minden képességgel rendelkezik.
 */
export async function hasCapability(
	context: RemoteContext,
	organizationId: number,
	capability: Capability,
	projectId?: number
): Promise<boolean> {
	if (isDevMode(context) || isCoreAdmin(context)) return true;

	const userId = await resolveUserId(context);

	// Projektszintű felülbírálás (ha van)
	if (projectId) {
		const pr = await context.db.query(
			`SELECT 1
			   FROM app__racona_work.wp_project_member_roles pmr
			   JOIN app__racona_work.wp_role_capabilities rc ON rc.role_id = pmr.role_id
			  WHERE pmr.project_id = $1 AND pmr.user_id = $2 AND rc.capability = $3
			  LIMIT 1`,
			[projectId, userId, capability]
		);
		if (pr.rows.length > 0) return true;
	}

	// Szervezet-szintű szerepek
	const org = await context.db.query(
		`SELECT 1
		   FROM app__racona_work.wp_member_roles mr
		   JOIN app__racona_work.wp_role_capabilities rc ON rc.role_id = mr.role_id
		  WHERE mr.organization_id = $1 AND mr.user_id = $2 AND rc.capability = $3
		  LIMIT 1`,
		[organizationId, userId, capability]
	);
	return org.rows.length > 0;
}

export async function requireCapability(
	context: RemoteContext,
	organizationId: number,
	capability: Capability,
	projectId?: number
): Promise<void> {
	if (!(await hasCapability(context, organizationId, capability, projectId))) {
		throw new Error('Nincs jogosultságod ehhez a művelethez');
	}
}

// --- Rendszer szerepek seedelése (új szervezethez) --------------------------

/**
 * Rendszer szerepek létrehozása egy szervezethez (idempotens).
 * A createOrganization remote hívja új szervezet létrehozásakor.
 * A hívót ('creator') felveszi `org_admin` szerepbe, ha van userId.
 */
export async function seedDefaultRoles(
	params: { organizationId: number; creatorUserId?: number },
	context: RemoteContext
): Promise<{ ok: true }> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	const client = await context.db.connect();
	try {
		await client.query('BEGIN');

		for (const def of SYSTEM_ROLE_DEFINITIONS) {
			const upsert = await client.query(
				`INSERT INTO app__racona_work.wp_roles (organization_id, key, name, description, is_system)
				 VALUES ($1, $2, $3, $4, TRUE)
				 ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name
				 RETURNING id`,
				[params.organizationId, def.key, def.name, def.description]
			);
			const roleId = (upsert.rows[0] as { id: number }).id;

			// Capability-k idempotens hozzárendelése (új szerep + létező szerep
			// kibővítése egyaránt). ON CONFLICT DO NOTHING biztosítja, hogy
			// meglévő kapcsolatok ne ütközzenek.
			for (const cap of def.capabilities) {
				await client.query(
					`INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability)
					 VALUES ($1, $2)
					 ON CONFLICT DO NOTHING`,
					[roleId, cap]
				);
			}
		}

		// Creator user → org_admin
		if (params.creatorUserId && params.creatorUserId > 0) {
			await client.query(
				`INSERT INTO app__racona_work.wp_member_roles (organization_id, user_id, role_id)
				 SELECT $1, $2, r.id
				   FROM app__racona_work.wp_roles r
				  WHERE r.organization_id = $1 AND r.key = 'org_admin'
				 ON CONFLICT DO NOTHING`,
				[params.organizationId, params.creatorUserId]
			);
		}

		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	return { ok: true };
}

// --- Role CRUD (UI által hívott remote-ok) -----------------------------------

export interface RoleRow {
	id: number;
	organizationId: number;
	key: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	capabilities: string[];
	memberCount: number;
}

export async function listRoles(
	params: { organizationId: number },
	context: RemoteContext
): Promise<RoleRow[]> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	// Core admin + dev mode: hozzáférés. Egyébként: members.view képesség kell.
	if (!isCoreAdmin(context) && !isDevMode(context)) {
		await requireCapability(context, params.organizationId, 'members.view');
	}

	const rolesResult = await context.db.query(
		`SELECT id, organization_id, key, name, description, is_system
		   FROM app__racona_work.wp_roles
		  WHERE organization_id = $1
		  ORDER BY is_system DESC, name ASC`,
		[params.organizationId]
	);

	const roleIds = rolesResult.rows.map((r: any) => r.id);
	if (roleIds.length === 0) return [];

	const capsResult = await context.db.query(
		`SELECT role_id, capability
		   FROM app__racona_work.wp_role_capabilities
		  WHERE role_id = ANY($1::int[])`,
		[roleIds]
	);

	const countsResult = await context.db.query(
		`SELECT role_id, COUNT(*)::int AS member_count
		   FROM app__racona_work.wp_member_roles
		  WHERE role_id = ANY($1::int[])
		  GROUP BY role_id`,
		[roleIds]
	);

	const capsByRole = new Map<number, string[]>();
	for (const row of capsResult.rows as any[]) {
		const arr = capsByRole.get(row.role_id) ?? [];
		arr.push(row.capability);
		capsByRole.set(row.role_id, arr);
	}

	const countsByRole = new Map<number, number>();
	for (const row of countsResult.rows as any[]) {
		countsByRole.set(row.role_id, row.member_count);
	}

	return rolesResult.rows.map((r: any) => ({
		id: r.id,
		organizationId: r.organization_id,
		key: r.key,
		name: r.name,
		description: r.description,
		isSystem: r.is_system,
		capabilities: capsByRole.get(r.id) ?? [],
		memberCount: countsByRole.get(r.id) ?? 0
	}));
}

function validateCapabilities(caps: unknown): string[] {
	if (!Array.isArray(caps)) throw new Error('Érvénytelen capabilities lista');
	const unique = new Set<string>();
	for (const c of caps) {
		if (typeof c !== 'string' || !CAPABILITY_SET.has(c)) {
			throw new Error(`Ismeretlen capability: ${String(c)}`);
		}
		unique.add(c);
	}
	return [...unique];
}

function slugifyKey(input: string): string {
	return input
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 64);
}

export async function createRole(
	params: {
		organizationId: number;
		key?: string;
		name: string;
		description?: string;
		capabilities: string[];
	},
	context: RemoteContext
): Promise<RoleRow> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!params.name || !params.name.trim()) {
		throw new Error('A szerep neve kötelező');
	}

	// Jogosultság: org_admin-nak (roles.manage) van joga. Core admin felülbírál.
	if (!isCoreAdmin(context) && !isDevMode(context)) {
		await requireCapability(context, params.organizationId, 'roles.manage');
	}

	const caps = validateCapabilities(params.capabilities);
	const rawKey = params.key?.trim() || slugifyKey(params.name);
	const key = slugifyKey(rawKey);
	if (!key) throw new Error('Érvénytelen szerep kulcs');

	const client = await context.db.connect();
	try {
		await client.query('BEGIN');

		const insertResult = await client.query(
			`INSERT INTO app__racona_work.wp_roles (organization_id, key, name, description, is_system)
			 VALUES ($1, $2, $3, $4, FALSE)
			 RETURNING id`,
			[params.organizationId, key, params.name.trim(), params.description?.trim() || null]
		);
		const roleId = (insertResult.rows[0] as { id: number }).id;

		for (const cap of caps) {
			await client.query(
				`INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability) VALUES ($1, $2)`,
				[roleId, cap]
			);
		}

		await client.query('COMMIT');
	} catch (err: any) {
		await client.query('ROLLBACK');
		if (err?.code === '23505') {
			throw new Error('Már létezik szerep ezzel a kulccsal a szervezetben');
		}
		throw err;
	} finally {
		client.release();
	}

	const rows = await listRoles({ organizationId: params.organizationId }, context);
	const created = rows.find((r) => r.key === key);
	if (!created) throw new Error('Szerep létrehozása sikertelen');
	return created;
}

export async function updateRole(
	params: {
		id: number;
		name?: string;
		description?: string | null;
		capabilities?: string[];
	},
	context: RemoteContext
): Promise<RoleRow> {
	if (!params?.id) throw new Error('Érvénytelen szerep azonosító');

	// Szerep lekérése + org azonosítása
	const roleResult = await context.db.query(
		`SELECT id, organization_id, is_system
		   FROM app__racona_work.wp_roles WHERE id = $1`,
		[params.id]
	);
	if (roleResult.rows.length === 0) throw new Error('Szerep nem található');
	const role = roleResult.rows[0] as {
		id: number;
		organization_id: number;
		is_system: boolean;
	};

	if (!isCoreAdmin(context) && !isDevMode(context)) {
		await requireCapability(context, role.organization_id, 'roles.manage');
	}

	const client = await context.db.connect();
	try {
		await client.query('BEGIN');

		if (params.name !== undefined || params.description !== undefined) {
			await client.query(
				`UPDATE app__racona_work.wp_roles
				    SET name = COALESCE($2, name),
				        description = $3,
				        updated_at = NOW()
				  WHERE id = $1`,
				[
					role.id,
					params.name?.trim() ?? null,
					params.description === undefined
						? null
						: params.description === null
							? null
							: String(params.description).trim() || null
				]
			);
		}

		if (params.capabilities !== undefined) {
			const caps = validateCapabilities(params.capabilities);
			await client.query(
				`DELETE FROM app__racona_work.wp_role_capabilities WHERE role_id = $1`,
				[role.id]
			);
			for (const cap of caps) {
				await client.query(
					`INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability) VALUES ($1, $2)`,
					[role.id, cap]
				);
			}
		}

		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	const rows = await listRoles({ organizationId: role.organization_id }, context);
	const updated = rows.find((r) => r.id === role.id);
	if (!updated) throw new Error('Szerep frissítése sikertelen');
	return updated;
}

export async function deleteRole(
	params: { id: number },
	context: RemoteContext
): Promise<{ ok: true }> {
	if (!params?.id) throw new Error('Érvénytelen szerep azonosító');

	const roleResult = await context.db.query(
		`SELECT id, organization_id, is_system FROM app__racona_work.wp_roles WHERE id = $1`,
		[params.id]
	);
	if (roleResult.rows.length === 0) throw new Error('Szerep nem található');
	const role = roleResult.rows[0] as {
		id: number;
		organization_id: number;
		is_system: boolean;
	};
	if (role.is_system) throw new Error('Rendszer szerep nem törölhető');

	if (!isCoreAdmin(context) && !isDevMode(context)) {
		await requireCapability(context, role.organization_id, 'roles.manage');
	}

	await context.db.query(`DELETE FROM app__racona_work.wp_roles WHERE id = $1`, [role.id]);
	return { ok: true };
}

// --- Role members -----------------------------------------------------------

export interface RoleMemberRow {
	userId: number;
	userName: string;
	userEmail: string;
	userImage: string | null;
	assignedAt: string;
}

export async function listRoleMembers(
	params: { roleId: number },
	context: RemoteContext
): Promise<RoleMemberRow[]> {
	if (!params?.roleId) throw new Error('Érvénytelen szerep azonosító');

	const roleResult = await context.db.query(
		`SELECT id, organization_id FROM app__racona_work.wp_roles WHERE id = $1`,
		[params.roleId]
	);
	if (roleResult.rows.length === 0) throw new Error('Szerep nem található');
	const role = roleResult.rows[0] as { id: number; organization_id: number };

	if (!isCoreAdmin(context) && !isDevMode(context)) {
		await requireCapability(context, role.organization_id, 'members.view');
	}

	const result = await context.db.query(
		`SELECT u.id AS user_id,
		        u.full_name AS user_name,
		        u.email AS user_email,
		        u.image AS user_image,
		        mr.assigned_at
		   FROM app__racona_work.wp_member_roles mr
		   JOIN auth.users u ON u.id = mr.user_id
		  WHERE mr.role_id = $1 AND mr.organization_id = $2
		  ORDER BY u.full_name ASC`,
		[role.id, role.organization_id]
	);

	return result.rows.map((r: any) => ({
		userId: r.user_id,
		userName: r.user_name,
		userEmail: r.user_email,
		userImage: r.user_image ?? null,
		assignedAt: r.assigned_at
	}));
}

export async function addRoleMember(
	params: { roleId: number; userId: number },
	context: RemoteContext
): Promise<{ ok: true }> {
	if (!params?.roleId || !params?.userId) {
		throw new Error('Érvénytelen paraméter');
	}

	const roleResult = await context.db.query(
		`SELECT id, organization_id FROM app__racona_work.wp_roles WHERE id = $1`,
		[params.roleId]
	);
	if (roleResult.rows.length === 0) throw new Error('Szerep nem található');
	const role = roleResult.rows[0] as { id: number; organization_id: number };

	if (!isCoreAdmin(context) && !isDevMode(context)) {
		await requireCapability(context, role.organization_id, 'roles.manage');
	}

	// Csak olyan user-t lehet hozzáadni, aki a szervezet tagja (employee rekorddal).
	const memberCheck = await context.db.query(
		`SELECT 1 FROM app__racona_work.employees
		  WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
		[role.organization_id, params.userId]
	);
	if (memberCheck.rows.length === 0) {
		throw new Error('A felhasználó nem tagja a szervezetnek');
	}

	await context.db.query(
		`INSERT INTO app__racona_work.wp_member_roles (organization_id, user_id, role_id)
		 VALUES ($1, $2, $3)
		 ON CONFLICT DO NOTHING`,
		[role.organization_id, params.userId, role.id]
	);
	return { ok: true };
}

export async function removeRoleMember(
	params: { roleId: number; userId: number },
	context: RemoteContext
): Promise<{ ok: true }> {
	if (!params?.roleId || !params?.userId) {
		throw new Error('Érvénytelen paraméter');
	}

	const roleResult = await context.db.query(
		`SELECT id, organization_id, key, is_system
		   FROM app__racona_work.wp_roles WHERE id = $1`,
		[params.roleId]
	);
	if (roleResult.rows.length === 0) throw new Error('Szerep nem található');
	const role = roleResult.rows[0] as {
		id: number;
		organization_id: number;
		key: string;
		is_system: boolean;
	};

	if (!isCoreAdmin(context) && !isDevMode(context)) {
		await requireCapability(context, role.organization_id, 'roles.manage');
	}

	// Védelem: ne maradjon a szervezet org_admin nélkül.
	if (role.key === 'org_admin') {
		const adminCount = await context.db.query(
			`SELECT COUNT(*)::int AS c FROM app__racona_work.wp_member_roles
			  WHERE role_id = $1`,
			[role.id]
		);
		if ((adminCount.rows[0] as { c: number }).c <= 1) {
			throw new Error('Legalább egy szervezet-adminisztrátornak maradnia kell');
		}
	}

	await context.db.query(
		`DELETE FROM app__racona_work.wp_member_roles
		  WHERE role_id = $1 AND user_id = $2`,
		[role.id, params.userId]
	);
	return { ok: true };
}
