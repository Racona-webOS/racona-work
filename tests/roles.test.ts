/**
 * A rendszerszerepek fordított megjelenítésének és zárolásának tesztjei
 * (src/utils/roles.ts, server/permissions.ts updateRole).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { roleDescription, roleName, sortRoles } from '../src/utils/roles.ts';
import { updateRole } from '../server/permissions.ts';
import type { RemoteContext } from '../server/context.ts';

/** Angol felület: csak a rendszerszerep-kulcsok vannak lefordítva. */
const EN: Record<string, string> = {
	'permissions.systemRole.org_admin.name': 'Organization administrator',
	'permissions.systemRole.org_admin.description': 'Full access within the organization',
	'permissions.systemRole.employee.name': 'Employee',
	'permissions.systemRole.employee.description': 'Basic access to own data'
};
const t = (key: string) => EN[key] ?? key;

const orgAdmin = {
	key: 'org_admin',
	name: 'Szervezet adminisztrátor',
	description: 'Teljes hozzáférés a szervezeten belül',
	isSystem: true
};

describe('a szerep megjelenített neve és leírása', () => {
	test('a rendszerszerep a kulcsa alapján, a felület nyelvén látszik', () => {
		expect(roleName(t, orgAdmin)).toBe('Organization administrator');
		expect(roleDescription(t, orgAdmin)).toBe('Full access within the organization');
	});

	test('a korábban átírt rendszerszerep a tárolt szövegét mutatja', () => {
		const renamed = { ...orgAdmin, name: 'Cégvezető', description: 'Saját leírás' };
		expect(roleName(t, renamed)).toBe('Cégvezető');
		expect(roleDescription(t, renamed)).toBe('Saját leírás');
	});

	test('az egyedi szerep mindig a tárolt szöveg, akkor is, ha rendszerkulcsot visel', () => {
		const custom = { key: 'org_admin', name: 'Szervezet adminisztrátor', description: null, isSystem: false };
		expect(roleName(t, custom)).toBe('Szervezet adminisztrátor');
		expect(roleDescription(t, custom)).toBeNull();
	});

	test('hiányzó fordításnál a tárolt szöveg marad', () => {
		const hr = { key: 'hr_manager', name: 'HR felelős', description: 'Dolgozói adatok és szabadságok kezelése', isSystem: true };
		expect(roleName(t, hr)).toBe('HR felelős');
	});

	test('rendezés: rendszerszerepek elöl, a megjelenített név szerint', () => {
		const roles = [
			{ key: 'team_lead', name: 'Csoportvezető', isSystem: false },
			{ key: 'org_admin', name: 'Szervezet adminisztrátor', isSystem: true },
			{ key: 'employee', name: 'Dolgozó', isSystem: true }
		];
		expect(sortRoles(t, roles).map((r) => r.key)).toEqual(['employee', 'org_admin', 'team_lead']);
	});
});

/** Ál-kontextus dev módban (a jogosultság-ellenőrzés kimarad), a 7-es szerep adataival. */
function fakeContext(role: { is_system: boolean; name: string; description: string | null }) {
	const writes: { sql: string; params: unknown[] }[] = [];
	const row = { id: 7, organization_id: 3, key: 'org_admin', ...role };
	const query = async (sql: string, params: unknown[] = []) => {
		if (/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)) writes.push({ sql, params });
		if (sql.includes('FROM app__racona_work.wp_roles')) return { rows: [row] };
		return { rows: [] };
	};
	const context = {
		pluginId: 'racona-work',
		userId: 1,
		permissions: [],
		devMode: true,
		db: { query, connect: async () => ({ query, release: () => {} }) }
	} as unknown as RemoteContext;
	return { context, writes };
}

describe('updateRole', () => {
	test('a rendszerszerep neve nem írható át', async () => {
		const { context, writes } = fakeContext({ is_system: true, ...orgAdmin });
		await expect(updateRole({ id: 7, name: 'Cégvezető' }, context)).rejects.toThrow('nem módosítható');
		expect(writes).toEqual([]);
	});

	test('a rendszerszerep leírása nem írható át', async () => {
		const { context, writes } = fakeContext({ is_system: true, ...orgAdmin });
		await expect(updateRole({ id: 7, description: 'Más' }, context)).rejects.toThrow('nem módosítható');
		expect(writes).toEqual([]);
	});

	test('a változatlan név és leírás elküldése nem hiba, és nem ír a szerep sorába', async () => {
		const { context, writes } = fakeContext({ is_system: true, ...orgAdmin });
		await updateRole({ id: 7, name: orgAdmin.name, description: orgAdmin.description }, context);
		expect(writes.filter((w) => w.sql.includes('UPDATE app__racona_work.wp_roles'))).toEqual([]);
	});

	test('egyedi szerepnél a csak névváltoztatás nem törli a leírást', async () => {
		const { context, writes } = fakeContext({ is_system: false, name: 'Régi', description: 'Megmarad' });
		await updateRole({ id: 7, name: 'Új név' }, context);
		const update = writes.find((w) => w.sql.includes('UPDATE app__racona_work.wp_roles'));
		// $2 = név, $3 = leírás, $4 = a leírás is változik-e
		expect(update?.params).toEqual([7, 'Új név', null, false]);
	});
});
