/**
 * A projekt lezárásának tesztjei (specs/project-closing.md): lezárt projekthez
 * nem rögzíthető, nem módosítható és nem törölhető feladat, a lezárás és a
 * visszanyitás a `project.close` képességhez kötött.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	addProjectMember,
	closeProject,
	deleteProject,
	removeProjectMember,
	reopenProject,
	setProjectUserRoles,
	updateProject
} from '../server/projects.ts';
import { createWorkEntry, deleteWorkEntry, updateWorkEntry } from '../server/work-entries.ts';
import type { RemoteContext } from '../server/context.ts';

/**
 * Ál-kontextus egy projekttel (id 5, szervezet 3) és egy bejegyzéssel (id 1).
 * A hívó (user 7) szervezeti képességei `own`; core admin esetén minden.
 * Az írásokat gyűjti, hogy lássuk, történt-e módosítás.
 */
function fakeContext(opts: { closed: boolean; own?: string[]; coreAdmin?: boolean }) {
	const writes: string[] = [];
	const closedAt = opts.closed ? '2026-09-01T10:00:00Z' : null;
	const own = opts.own ?? [];
	const query = async (sql: string, params: unknown[] = []) => {
		if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
			writes.push(sql.trim().split(/\s+/)[0]);
			return { rows: [{ id: 1 }] };
		}
		// hasCapability (szervezet-szint)
		if (sql.includes('wp_member_roles mr') && sql.includes('rc.capability = $3')) {
			return { rows: own.includes(String(params[2])) ? [{ ok: 1 }] : [] };
		}
		// getProject
		if (sql.includes('FROM app__racona_work.projects p')) {
			return { rows: [{ id: 5, organization_id: 3, name: 'P', status: 'active', closed_at: closedAt }] };
		}
		if (sql.includes('FROM app__racona_work.projects WHERE id')) {
			return { rows: [{ id: 5, organization_id: 3, closed_at: closedAt }] };
		}
		if (sql.includes('FROM app__racona_work.work_entries we') && sql.includes('WHERE we.id')) {
			return {
				rows: [{ id: 1, project_id: 5, employee_id: 2, organization_id: 3, closed_at: closedAt, user_id: 7 }]
			};
		}
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

describe('lezárt projekt feladatai', () => {
	test('nem rögzíthető új feladat (core adminnak sem)', async () => {
		const { context, writes } = fakeContext({ closed: true, coreAdmin: true });
		await expect(
			createWorkEntry(
				{ projectId: 5, categoryId: 1, title: 'Feladat', hours: 2, workDate: '2026-09-10' },
				context
			)
		).rejects.toThrow('le van zárva');
		expect(writes).toEqual([]);
	});

	test('a meglévő feladat nem módosítható és nem törölhető', async () => {
		const { context, writes } = fakeContext({ closed: true, coreAdmin: true });
		await expect(updateWorkEntry({ id: 1, title: 'Új cím' }, context)).rejects.toThrow('le van zárva');
		await expect(deleteWorkEntry({ id: 1 }, context)).rejects.toThrow('le van zárva');
		expect(writes).toEqual([]);
	});

	test('nyitott projektnél a feladat módosítható és törölhető', async () => {
		const { context, writes } = fakeContext({ closed: false, coreAdmin: true });
		await updateWorkEntry({ id: 1, title: 'Új cím' }, context);
		await deleteWorkEntry({ id: 1 }, context);
		expect(writes).toEqual(['UPDATE', 'DELETE']);
	});

	test('a lezárt projekt nem törölhető', async () => {
		const { context, writes } = fakeContext({ closed: true, own: ['project.manage'] });
		await expect(deleteProject({ id: 5 }, context)).rejects.toThrow('Lezárt projekt');
		expect(writes).toEqual([]);
	});
});

describe('lezárás és visszanyitás', () => {
	test('project.close nélkül nem zárható le és nem nyitható vissza', async () => {
		const open = fakeContext({ closed: false, own: ['project.manage'] });
		await expect(closeProject({ id: 5 }, open.context)).rejects.toThrow('Nincs jogosultságod');
		const closed = fakeContext({ closed: true, own: ['project.manage'] });
		await expect(reopenProject({ id: 5 }, closed.context)).rejects.toThrow('Nincs jogosultságod');
		expect([...open.writes, ...closed.writes]).toEqual([]);
	});

	test('project.close képességgel lezárható és visszanyitható', async () => {
		const open = fakeContext({ closed: false, own: ['project.close', 'project.view.all'] });
		await closeProject({ id: 5 }, open.context);
		expect(open.writes).toEqual(['UPDATE']);

		const closed = fakeContext({ closed: true, own: ['project.close', 'project.view.all'] });
		await reopenProject({ id: 5 }, closed.context);
		expect(closed.writes).toEqual(['UPDATE']);
	});

	test('a lezárt projekt nem zárható le újra, a nyitott nem nyitható vissza', async () => {
		const closed = fakeContext({ closed: true, own: ['project.close', 'project.view.all'] });
		await expect(closeProject({ id: 5 }, closed.context)).rejects.toThrow('már le van zárva');
		const open = fakeContext({ closed: false, own: ['project.close', 'project.view.all'] });
		await expect(reopenProject({ id: 5 }, open.context)).rejects.toThrow('nincs lezárva');
		expect([...closed.writes, ...open.writes]).toEqual([]);
	});
});

describe('lezárt projekt adatai, tagjai és jogosultságai', () => {
	test('az adatai nem módosíthatók', async () => {
		const { context, writes } = fakeContext({ closed: true, own: ['project.manage'] });
		await expect(updateProject({ id: 5, name: 'Új név' }, context)).rejects.toThrow('le van zárva');
		expect(writes).toEqual([]);
	});

	test('tag nem vehető fel és nem távolítható el', async () => {
		const { context, writes } = fakeContext({ closed: true, own: ['project.manage'] });
		await expect(addProjectMember({ projectId: 5, employeeId: 2 }, context)).rejects.toThrow('le van zárva');
		await expect(removeProjectMember({ projectId: 5, employeeId: 2 }, context)).rejects.toThrow('le van zárva');
		expect(writes).toEqual([]);
	});

	test('a projekt-szintű szerepek nem módosíthatók', async () => {
		const { context, writes } = fakeContext({ closed: true, own: ['project.manage'] });
		await expect(setProjectUserRoles({ projectId: 5, userId: 9, roleIds: [] }, context)).rejects.toThrow('le van zárva');
		expect(writes).toEqual([]);
	});

	test('nyitott projektnél a tag eltávolítható', async () => {
		const { context, writes } = fakeContext({ closed: false, own: ['project.manage'] });
		await removeProjectMember({ projectId: 5, employeeId: 2 }, context);
		expect(writes).toEqual(['DELETE']);
	});
});
