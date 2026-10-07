/**
 * A szerepszerkesztő (Beállítások → Jogosultságok) képesség-csoportjai.
 *
 * Minden server/permissions.ts CAPABILITIES-beli képességnek szerepelnie kell
 * valamelyik csoportban, különben a szerepszerkesztőben nem adható meg és nem
 * vehető el. Címkék: `capabilities.group.*` és `capability.<kulcs>` a locales/
 * fájlokban. Tesztek: tests/capability-groups.test.ts.
 */

export const CAPABILITY_GROUPS: Array<{ labelKey: string; items: string[] }> = [
	{ labelKey: 'capabilities.group.org', items: ['org.manage'] },
	{
		labelKey: 'capabilities.group.members',
		items: ['members.view', 'members.manage', 'roles.manage']
	},
	{
		labelKey: 'capabilities.group.projects',
		items: ['project.create', 'project.manage', 'project.close', 'project.view.all', 'project.view.own']
	},
	{
		labelKey: 'capabilities.group.worklog',
		items: ['work.log', 'work.view.all']
	},
	{
		labelKey: 'capabilities.group.leave',
		items: ['leave.request', 'leave.approve', 'leave.balance.manage', 'leave.calendar.manage']
	},
	{
		labelKey: 'capabilities.group.employees',
		items: [
			'employee.view',
			'employee.manage',
			'employee.documents.view',
			'employee.documents.manage',
			'employee.documents.own'
		]
	},
	{
		labelKey: 'capabilities.group.trips',
		items: ['trip.record', 'trip.approve', 'trip.manage']
	}
];
