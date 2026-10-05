/**
 * Biztonsági javítások tesztjei: escapelés, a szabadságkérelmek láthatósága,
 * a projektszerepek kiosztása és a saját ügyben hozott döntés tiltása.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { escapeHtml, safeImageUrl } from '../src/utils/html.ts';
import { ensureNotSelfDecision, SELF_DECISION_ERROR } from '../server/permissions.ts';
import { getLeaveRequests } from '../server/leave.ts';
import { setProjectUserRoles } from '../server/projects.ts';
import type { RemoteContext } from '../server/context.ts';

describe('escapelés', () => {
	test('a HTML-jelentésű karakterek', () => {
		expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
			'&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;'
		);
		expect(escapeHtml(null)).toBe('');
		expect(escapeHtml(5)).toBe('5');
	});

	test('profilkép: csak http(s), relatív útvonal vagy raszteres data URL', () => {
		expect(safeImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
		expect(safeImageUrl('/uploads/a.png')).toBe('/uploads/a.png');
		expect(safeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
		expect(safeImageUrl('javascript:alert(1)')).toBeNull();
		expect(safeImageUrl('//evil.example/a.png')).toBeNull();
		expect(safeImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
		expect(safeImageUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
		expect(safeImageUrl('')).toBeNull();
	});
});

/**
 * Ál-kontextus a 3-as szervezetben, a hívó a 7-es felhasználó (a 70-es dolgozó).
 * `caps`: a hívó szervezeti képességei; `projectCaps`: a 9-es projekten kapott
 * képességei; `roleCaps`: szerepazonosító → képességek.
 */
function fakeContext(opts: {
	caps: string[];
	projectCaps?: string[];
	roleCaps?: Record<number, string[]>;
	members?: number[];
	currentProjectRoles?: number[];
	coreAdmin?: boolean;
}) {
	const queries: { sql: string; params: unknown[] }[] = [];
	const query = async (sql: string, params: unknown[] = []) => {
		queries.push({ sql, params });
		if (/^\s*(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
		if (sql.includes('SELECT is_external FROM')) return { rows: [{ is_external: false }] };
		if (sql.includes('rc.capability = $3')) {
			const cap = String(params[2]);
			const fromProject = sql.includes('wp_project_member_roles') && (opts.projectCaps ?? []).includes(cap);
			return { rows: fromProject || (!sql.includes('wp_project_member_roles') && opts.caps.includes(cap)) ? [{ ok: 1 }] : [] };
		}
		if (sql.includes('SELECT DISTINCT rc.capability') && sql.includes('wp_project_member_roles')) {
			return { rows: (opts.projectCaps ?? []).map((capability) => ({ capability })) };
		}
		if (sql.includes('SELECT DISTINCT rc.capability')) {
			return { rows: opts.caps.map((capability) => ({ capability })) };
		}
		if (sql.includes('FROM app__racona_work.wp_role_capabilities WHERE role_id')) {
			return { rows: (opts.roleCaps?.[Number(params[0])] ?? []).map((capability) => ({ capability })) };
		}
		if (sql.includes('SELECT id FROM app__racona_work.wp_roles')) {
			return { rows: (params[0] as number[]).map((id) => ({ id })) };
		}
		if (sql.includes('SELECT role_id FROM app__racona_work.wp_project_member_roles')) {
			return { rows: (opts.currentProjectRoles ?? []).map((role_id) => ({ role_id })) };
		}
		if (sql.includes('SELECT id, organization_id, closed_at FROM app__racona_work.projects')) {
			return { rows: [{ id: 9, organization_id: 3, closed_at: null }] };
		}
		if (sql.includes('SELECT 1 FROM app__racona_work.employees')) {
			return { rows: (opts.members ?? []).includes(Number(params[1])) ? [{ ok: 1 }] : [] };
		}
		if (sql.includes('SELECT id FROM') && sql.includes('employees WHERE user_id = $1')) {
			return { rows: Number(params[0]) === 7 ? [{ id: 70 }] : [] };
		}
		if (sql.includes('SELECT user_id FROM app__racona_work.employees WHERE id = $1')) {
			return { rows: [{ user_id: Number(params[0]) === 70 ? 7 : 8 }] };
		}
		if (sql.includes('COUNT(*) AS total')) return { rows: [{ total: '0' }] };
		return { rows: [] };
	};
	const context = {
		pluginId: 'racona-work',
		userId: 7,
		permissions: opts.coreAdmin ? ['admin'] : [],
		db: { query, connect: async () => ({ query, release: () => {} }) }
	} as unknown as RemoteContext;
	return { context, queries };
}

describe('a szabadságkérelmek láthatósága', () => {
	test('jóváhagyói jog nélkül csak a saját kérelmek jönnek, akármit kér a kliens', async () => {
		const { context, queries } = fakeContext({ caps: ['leave.request'] });
		await getLeaveRequests({ organizationId: 3 }, context);
		const list = queries.find((q) => q.sql.includes('COUNT(*) AS total'))!;
		expect(list.sql).toContain('lr.employee_id = $2');
		expect(list.params).toEqual([3, 70]);
	});

	test('más dolgozó kérelmei jóváhagyói jog nélkül hibát adnak', async () => {
		const { context } = fakeContext({ caps: ['leave.request'] });
		await expect(getLeaveRequests({ organizationId: 3, employeeId: 71 }, context)).rejects.toThrow('saját');
	});

	test('a jóváhagyó a szervezet összes kérelmét látja', async () => {
		const { context, queries } = fakeContext({ caps: ['leave.request', 'leave.approve'] });
		await getLeaveRequests({ organizationId: 3 }, context);
		const list = queries.find((q) => q.sql.includes('COUNT(*) AS total'))!;
		expect(list.params).toEqual([3]);
	});
});

describe('saját ügyben nincs döntés', () => {
	test('a saját ügy hibát ad, a másé nem', async () => {
		const { context } = fakeContext({ caps: ['leave.approve'] });
		await expect(ensureNotSelfDecision(context, 70)).rejects.toThrow(SELF_DECISION_ERROR);
		await expect(ensureNotSelfDecision(context, 71)).resolves.toBeUndefined();
	});

	test('a rendszergazda a saját ügyében is dönthet', async () => {
		const { context } = fakeContext({ caps: [], coreAdmin: true });
		await expect(ensureNotSelfDecision(context, 70)).resolves.toBeUndefined();
	});
});

describe('projektszerepek kiosztása', () => {
	const roleCaps = { 1: ['project.manage', 'work.log'], 2: ['project.close', 'org.manage'] };

	test('a szervezeten kívüli felhasználó nem kaphat projektszerepet', async () => {
		const { context } = fakeContext({ caps: ['project.manage', 'work.log'], roleCaps, members: [7] });
		await expect(setProjectUserRoles({ projectId: 9, userId: 99, roleIds: [1] }, context)).rejects.toThrow(
			'nem tagja a szervezetnek'
		);
	});

	test('a hívó képességein túli szerepet nem adhat, magának sem', async () => {
		const { context } = fakeContext({ caps: ['project.manage', 'work.log'], roleCaps, members: [7, 8] });
		await expect(setProjectUserRoles({ projectId: 9, userId: 7, roleIds: [2] }, context)).rejects.toThrow(
			'org.manage, project.close'
		);
	});

	test('a hívó képességein túli szerepet el sem vehet', async () => {
		const { context } = fakeContext({
			caps: ['project.manage', 'work.log'],
			roleCaps,
			members: [7, 8],
			currentProjectRoles: [2]
		});
		await expect(setProjectUserRoles({ projectId: 9, userId: 8, roleIds: [] }, context)).rejects.toThrow('hiányzik');
	});

	test('a saját képességein belüli szerep kiosztható', async () => {
		const { context, queries } = fakeContext({ caps: ['project.manage', 'work.log'], roleCaps, members: [7, 8] });
		await setProjectUserRoles({ projectId: 9, userId: 8, roleIds: [1] }, context);
		expect(queries.some((q) => q.sql.includes('INSERT INTO app__racona_work.wp_project_member_roles'))).toBe(true);
	});

	test('a projekten kapott képesség is beleszámít a felső korlátba', async () => {
		const { context } = fakeContext({
			caps: ['project.manage', 'work.log'],
			projectCaps: ['project.close', 'org.manage'],
			roleCaps,
			members: [7, 8]
		});
		await expect(setProjectUserRoles({ projectId: 9, userId: 8, roleIds: [2] }, context)).resolves.toEqual({ ok: true });
	});
});
