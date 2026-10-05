/**
 * Szerepek megjelenített neve és leírása.
 *
 * A rendszerszerepek (org_admin, project_manager, hr_manager, employee) neve és
 * leírása magyarul van eltárolva, és nem módosítható; a felület ezért a kulcsuk
 * alapján fordítva mutatja őket. Ha egy rendszerszerep tárolt szövege mégis eltér
 * az eredetitől (a zárolás előtt átírták), a tárolt szöveg látszik. Az egyedi
 * szerepek neve és leírása mindig a tárolt szöveg.
 */

import { SYSTEM_ROLE_DEFINITIONS } from '../../server/permissions.js';

type Translate = (key: string) => string;

export interface DisplayRole {
	key: string;
	name: string;
	description?: string | null;
	isSystem: boolean;
}

function systemText(
	t: Translate,
	role: DisplayRole,
	field: 'name' | 'description',
	stored: string | null
): string | null {
	if (!role.isSystem) return stored;
	const definition = SYSTEM_ROLE_DEFINITIONS.find((d) => d.key === role.key);
	// Átírt (vagy ismeretlen) rendszerszerep: a tárolt szöveg marad
	if (!definition || (stored ?? '') !== definition[field]) return stored;
	const key = `permissions.systemRole.${role.key}.${field}`;
	const translated = t(key);
	return translated === key ? stored : translated;
}

export function roleName(t: Translate, role: DisplayRole): string {
	return systemText(t, role, 'name', role.name) ?? role.name;
}

export function roleDescription(t: Translate, role: DisplayRole): string | null {
	return systemText(t, role, 'description', role.description ?? null);
}

/** Rendszerszerepek elöl, azon belül a megjelenített név szerint (a felület nyelvén). */
export function sortRoles<T extends DisplayRole>(t: Translate, roles: T[]): T[] {
	return [...roles].sort(
		(a, b) =>
			Number(b.isSystem) - Number(a.isSystem) || roleName(t, a).localeCompare(roleName(t, b))
	);
}
