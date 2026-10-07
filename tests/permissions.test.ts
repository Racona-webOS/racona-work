/**
 * A szerepkezelés felső korlátjának tesztjei (server/permissions.ts):
 * `roles.manage` joggal csak a saját képességeken belül lehet szerepet
 * módosítani, törölni és tagot kezelni.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	addRoleMember,
	CAPABILITIES,
	capabilitiesBeyond,
	createRole,
	deleteRole,
	removeRoleMember,
	requireAnyCapability,
	SYSTEM_ROLE_DEFINITIONS,
	updateRole
} from '../server/permissions.ts';
import type { RemoteContext } from '../server/context.ts';

describe('capabilitiesBeyond', () => {
	const own = new Set(['roles.manage', 'leave.approve', 'employee.view']);

	test('a saját képességek hozzáadása és elvétele megengedett', () => {
		expect(capabilitiesBeyond(own, ['employee.view'], ['leave.approve'])).toEqual([]);
	});

	test('idegen képességet nem lehet hozzáadni', () => {
		expect(capabilitiesBeyond(own, [], ['org.manage', 'leave.approve'])).toEqual(['org.manage']);
	});

	test('idegen képességet nem lehet elvenni', () => {
		expect(capabilitiesBeyond(own, ['org.manage', 'trip.manage'], [])).toEqual(['org.manage', 'trip.manage']);
	});

	test('a változatlanul hagyott idegen képesség nem számít', () => {
		expect(capabilitiesBeyond(own, ['org.manage'], ['org.manage', 'leave.approve'])).toEqual([]);
	});
});

/**
 * Ál-kontextus: a hívó (user 7) képességei `own`, az 1-es szerep képességei
 * `roleCaps`. Az írásokat gyűjti, hogy lássuk, történt-e módosítás.
 */
function fakeContext(own: string[], roleCaps: string[], opts: { coreAdmin?: boolean } = {}) {
	const writes: string[] = [];
	const query = async (sql: string, params: unknown[] = []) => {
		if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
			writes.push(sql.trim().split(/\s+/)[0]);
			return { rows: [{ id: 1 }] };
		}
		// getMyCapabilities
		if (sql.includes('DISTINCT rc.capability')) {
			return { rows: own.map((capability) => ({ capability })) };
		}
		// hasCapability (szervezet-szint)
		if (sql.includes('wp_member_roles mr') && sql.includes('rc.capability = $3')) {
			return { rows: own.includes(String(params[2])) ? [{ ok: 1 }] : [] };
		}
		if (sql.includes('FROM app__racona_work.wp_role_capabilities WHERE role_id = $1')) {
			return { rows: roleCaps.map((capability) => ({ capability })) };
		}
		if (sql.includes('FROM app__racona_work.wp_roles WHERE id')) {
			return { rows: [{ id: 1, organization_id: 3, key: 'custom', is_system: false }] };
		}
		if (sql.includes('FROM app__racona_work.employees')) return { rows: [{ '?column?': 1 }] };
		if (sql.includes('COUNT(*)')) return { rows: [{ c: 2 }] };
		return { rows: [] };
	};
	const client = { query, release: () => {} };
	const context = {
		pluginId: 'racona-work',
		userId: 7,
		permissions: opts.coreAdmin ? ['admin'] : [],
		db: { query, connect: async () => client }
	} as unknown as RemoteContext;
	return { context, writes };
}

const MANAGER = ['roles.manage', 'members.view', 'leave.approve'];
const ADMIN_ROLE = ['org.manage', 'roles.manage', 'members.view', 'leave.approve'];

describe('szerepkezelés felső korlátja', () => {
	test('nem vehet fel senkit (magát sem) olyan szerepbe, amelynek több joga van', async () => {
		const { context, writes } = fakeContext(MANAGER, ADMIN_ROLE);
		await expect(addRoleMember({ roleId: 1, userId: 7 }, context)).rejects.toThrow('org.manage');
		expect(writes).toEqual([]);
	});

	test('a saját jogain belüli szerepbe felvehet tagot', async () => {
		const { context, writes } = fakeContext(MANAGER, ['leave.approve']);
		await addRoleMember({ roleId: 1, userId: 9 }, context);
		expect(writes).toEqual(['INSERT']);
	});

	test('több jogú szerepből nem távolíthat el tagot, és nem törölheti', async () => {
		const { context, writes } = fakeContext(MANAGER, ADMIN_ROLE);
		await expect(removeRoleMember({ roleId: 1, userId: 2 }, context)).rejects.toThrow('org.manage');
		await expect(deleteRole({ id: 1 }, context)).rejects.toThrow('org.manage');
		expect(writes).toEqual([]);
	});

	test('szerephez nem adhat olyan képességet, amellyel nem rendelkezik', async () => {
		const { context, writes } = fakeContext(MANAGER, ['leave.approve']);
		await expect(
			updateRole({ id: 1, capabilities: ['leave.approve', 'org.manage'] }, context)
		).rejects.toThrow('org.manage');
		await expect(
			createRole({ organizationId: 3, name: 'Kiskapu', capabilities: ['trip.manage'] }, context)
		).rejects.toThrow('trip.manage');
		expect(writes).toEqual([]);
	});

	test('több jogú szerepből sem veheti el az idegen képességet', async () => {
		const { context } = fakeContext(MANAGER, ADMIN_ROLE);
		await expect(
			updateRole({ id: 1, capabilities: ['roles.manage', 'members.view', 'leave.approve'] }, context)
		).rejects.toThrow('org.manage');
	});

	test('a core admint a korlát nem köti', async () => {
		const { context, writes } = fakeContext([], ADMIN_ROLE, { coreAdmin: true });
		await addRoleMember({ roleId: 1, userId: 7 }, context);
		expect(writes).toEqual(['INSERT']);
	});
});

describe('alapszerepek', () => {
	const role = (key: string) => SYSTEM_ROLE_DEFINITIONS.find((r) => r.key === key)!;

	test('a szervezet adminisztrátor minden képességet megkap, így mindet tovább is adhatja', () => {
		const admin = new Set<string>(role('org_admin').capabilities);
		expect(CAPABILITIES.filter((c) => !admin.has(c))).toEqual([]);
		const others = SYSTEM_ROLE_DEFINITIONS.flatMap((r) => r.capabilities);
		expect(capabilitiesBeyond(admin, [], others)).toEqual([]);
	});

	test('új szervezetben a munkanaptárat a szervezet adminisztrátor kezeli', () => {
		expect(role('org_admin').capabilities).toContain('leave.calendar.manage');
	});

	test('csak ismert képességeket tartalmaznak', () => {
		const known = new Set<string>(CAPABILITIES);
		for (const r of SYSTEM_ROLE_DEFINITIONS) {
			expect(r.capabilities.filter((c) => !known.has(c))).toEqual([]);
		}
	});
});

describe('requireAnyCapability', () => {
	test('elég az egyik képesség', async () => {
		const { context } = fakeContext(['leave.approve'], []);
		await expect(
			requireAnyCapability(context, 3, ['leave.request', 'leave.approve'])
		).resolves.toBeUndefined();
	});

	test('egyik nélkül sem engedi', async () => {
		const { context } = fakeContext(['work.log'], []);
		await expect(requireAnyCapability(context, 3, ['leave.request', 'leave.approve'])).rejects.toThrow(
			'Nincs jogosultságod'
		);
	});
});
