/**
 * Kiküldetések — közös jogosultsági segédek (belső modul, a functions.ts nem exportálja).
 *
 * „Saját vagy HR” minta, a work-entries.ts szerint: a saját adatokhoz `trip.record`
 * kell, és a hívó dolgozói sorát mindig a szerver keresi ki; másét csak emelt
 * joggal (`trip.approve` / `trip.manage`) lehet elérni.
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { hasCapability, ensureNotExternalEmployee } from './permissions.js';
import type { Capability } from './permissions.js';

export const SCHEMA = 'app__racona_work';

export interface EmployeeRef {
	id: number;
	organizationId: number;
	userId: number;
	name: string;
}

export function requireOrganizationId(value: unknown): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id <= 0) throw new Error('Érvénytelen szervezet azonosító');
	return id;
}

export function requireId(value: unknown, label = 'azonosító'): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id <= 0) throw new Error(`Érvénytelen ${label}`);
	return id;
}

export async function loadEmployeeRef(context: RemoteContext, employeeId: number): Promise<EmployeeRef> {
	const r = await context.db.query(
		`SELECT e.id, e.organization_id, e.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.email) AS name
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.id = $1`,
		[employeeId]
	);
	if (r.rows.length === 0) throw new Error(`Nem található dolgozó a megadott azonosítóval: ${employeeId}`);
	const row = r.rows[0];
	return { id: row.id, organizationId: row.organization_id, userId: row.user_id, name: row.name ?? '—' };
}

/** A hívó dolgozói sora a szervezetben, vagy null. */
export async function callerEmployee(context: RemoteContext, organizationId: number): Promise<EmployeeRef | null> {
	const userId = await resolveUserId(context);
	const r = await context.db.query(
		`SELECT e.id FROM ${SCHEMA}.employees e WHERE e.user_id = $1 AND e.organization_id = $2 AND e.is_external = FALSE LIMIT 1`,
		[userId, organizationId]
	);
	return r.rows.length === 0 ? null : loadEmployeeRef(context, r.rows[0].id);
}

/** Mint a callerEmployee, de hibát dob, ha a hívó nem dolgozója a szervezetnek. */
export async function requireCallerEmployee(context: RemoteContext, organizationId: number): Promise<EmployeeRef> {
	const me = await callerEmployee(context, organizationId);
	if (!me) throw new Error('Nem vagy dolgozója ennek a szervezetnek.');
	return me;
}

async function hasAny(context: RemoteContext, organizationId: number, caps: Capability[]): Promise<boolean> {
	for (const cap of caps) {
		if (await hasCapability(context, organizationId, cap)) return true;
	}
	return false;
}

/**
 * A dolgozó kiküldetési adataihoz fér-e hozzá a hívó: a saját adatához
 * `trip.record` joggal, másééhoz a megadott emelt joggal.
 *
 * @returns a dolgozó és hogy a hívó maga-e
 */
export async function requireTripAccess(
	context: RemoteContext,
	employeeId: number,
	elevated: Capability | Capability[]
): Promise<{ employee: EmployeeRef; isSelf: boolean }> {
	const employee = await loadEmployeeRef(context, employeeId);
	await ensureNotExternalEmployee(context, employeeId);
	const isSelf = employee.userId === (await resolveUserId(context));
	const caps = Array.isArray(elevated) ? elevated : [elevated];

	if (isSelf && (await hasCapability(context, employee.organizationId, 'trip.record'))) {
		return { employee, isSelf };
	}
	if (await hasAny(context, employee.organizationId, caps)) return { employee, isSelf };
	throw new Error('Nincs jogosultságod ehhez a művelethez');
}

/** Legalább az egyik képesség kell a szervezetben. */
export async function requireAnyCapability(
	context: RemoteContext,
	organizationId: number,
	caps: Capability[]
): Promise<void> {
	if (!(await hasAny(context, organizationId, caps))) {
		throw new Error('Nincs jogosultságod ehhez a művelethez');
	}
}

/**
 * `scope` feloldása listázáshoz: `mine` → a hívó saját dolgozói sora (`trip.record`),
 * `all` → a megadott emelt jog kell; ilyenkor az `employeeId` szűrő opcionális.
 *
 * @returns a szűrendő dolgozó azonosítója (null = mindenki), vagy undefined, ha a
 *   hívónak nincs dolgozói sora (üres eredmény)
 */
export async function resolveScope(
	context: RemoteContext,
	organizationId: number,
	scope: unknown,
	employeeId: unknown,
	elevated: Capability[]
): Promise<number | null | undefined> {
	if (scope === 'all') {
		await requireAnyCapability(context, organizationId, elevated);
		if (employeeId === undefined || employeeId === null || employeeId === '') return null;
		const id = requireId(employeeId, 'dolgozó azonosító');
		const ref = await loadEmployeeRef(context, id);
		if (ref.organizationId !== organizationId) throw new Error('A dolgozó nem ennek a szervezetnek a tagja.');
		await ensureNotExternalEmployee(context, id);
		return id;
	}
	await requireAnyCapability(context, organizationId, ['trip.record']);
	const me = await callerEmployee(context, organizationId);
	return me ? me.id : undefined;
}

/** Egy felhasználó neve (jóváhagyó, elrendelő). */
export async function userName(context: RemoteContext, userId: number | null): Promise<string | null> {
	if (!userId) return null;
	const r = await context.db.query(
		`SELECT COALESCE(NULLIF(TRIM(full_name), ''), email) AS name FROM auth.users WHERE id = $1`,
		[userId]
	);
	return r.rows[0]?.name ?? null;
}

/** Szám vagy null egy NUMERIC oszlopból (a pg stringként adja vissza). */
export function num(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const n = typeof value === 'number' ? value : parseFloat(String(value));
	return Number.isFinite(n) ? n : null;
}

/** Trimelt szöveg, üres → null, a hosszt levágja. */
export function text(value: unknown, maxLength: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed ? trimmed.slice(0, maxLength) : null;
}
