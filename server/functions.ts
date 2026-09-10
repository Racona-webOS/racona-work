/**
 * Szerver oldali függvények — Work plugin (barrel).
 *
 * Ezek a függvények a Racona szerveren futnak, a plugin a `remote.call()`-lal
 * hívja őket. A remote dispatcher `serverModule[functionName]`-ként éri el a
 * függvényeket, ezért MINDEN remote-ból hívható függvényt itt kell
 * reexportálni — a fájl ezen kívül nem tartalmaz logikát.
 *
 * Fontos: amit ez a fájl futásidőben exportál, az remote-ból hívható. A csak
 * modulok közt használt belső segédek (pl. `assignDefaultEmployeeRole`)
 * szándékosan NEM szerepelnek itt.
 *
 * Domain modulok:
 *   context.ts       — remote kontextus típusok és segédek (dev mód, user id)
 *   types.ts         — modulok közt megosztott típusok
 *   employees.ts     — dolgozók és dolgozói adatlap
 *   leave.ts         — szabadságkérelmek és egyenlegek
 *   dashboard.ts     — irányítópult statisztikák
 *   settings.ts      — kv_store alapú beállítások
 *   organizations.ts — szervezetek és szervezeti tagság
 *   permissions.ts   — szerepek és képességek
 *   projects.ts      — projektek, projekt tagok, projekt-szintű szerepek
 *   work-entries.ts  — munkabejegyzések (lista, CRUD, kategóriák)
 *   project-report.ts — projekt riport (munkabejegyzések aggregálása)
 *
 * A kliens kód a típusokat innen importálja (`../../server/functions.js`),
 * ezért a domain modulok típusai is itt vannak reexportálva.
 */

// --- Kontextus --------------------------------------------------------------

export type { RemoteContext, PluginEmailService, PluginNotificationService } from './context.js';

// --- Megosztott típusok -----------------------------------------------------

export type { PaginatedResult } from './types.js';

// --- Dolgozókezelés ---------------------------------------------------------

export {
	getUnlinkedUsers,
	createEmployeeFromUser,
	createEmployeeWithUser,
	getEmployees,
	getEmployeeDetails,
	saveEmployeeDetail,
	deleteEmployeeDetail,
	updateEmployee,
	getMyEmployee
} from './employees.js';

export type {
	Employee,
	EmployeeRow,
	EmployeeDetail,
	EmployeeDetailView,
	EmployeeListParams,
	UnlinkedUser
} from './employees.js';

// --- Szabadság nyilvántartó -------------------------------------------------

export {
	calculateWorkingDays,
	previewLeaveDays,
	getLeaveRequests,
	createLeaveRequest,
	approveLeaveRequest,
	rejectLeaveRequest,
	deleteLeaveRequest,
	getLeaveBalances,
	setLeaveBalance
} from './leave.js';

export type {
	LeaveRequest,
	LeaveRequestRow,
	LeaveRequestListParams,
	CreateLeaveRequestParams,
	LeaveBalance
} from './leave.js';

// --- Irányítópult -----------------------------------------------------------

export { getDashboardStats } from './dashboard.js';
export type { DashboardStats } from './dashboard.js';

// --- Beállítások ------------------------------------------------------------

export { getSettings, saveSettings } from './settings.js';

// --- Szervezetek ------------------------------------------------------------

export {
	generateSlug,
	createOrganization,
	isUserAdmin,
	getUserOrganizations,
	getOrganizations,
	updateOrganization,
	deleteOrganization,
	getOrganizationMembers,
	addEmployeeToOrganization,
	removeEmployeeFromOrganization,
	updateOrganizationMemberRole,
	getAvailableEmployeesForOrganization
} from './organizations.js';

export type { Organization, OrganizationMember, OrganizationMemberRow } from './organizations.js';

// --- Munkanaptár ------------------------------------------------------------

export {
	listCalendarDays,
	upsertCalendarDay,
	deleteCalendarDay,
	generateHungarianHolidays,
	hungarianPublicHolidays
} from './work-calendar.js';

export type { CalendarDay, CalendarDayKind } from './work-calendar.js';

// --- Jogosultságkezelés (szervezet-szintű szerepek, képességek) -------------

export {
	getMyCapabilities,
	listRoles,
	createRole,
	updateRole,
	deleteRole,
	listRoleMembers,
	addRoleMember,
	removeRoleMember,
	seedDefaultRoles
} from './permissions.js';

export type { Capability, RoleRow, RoleMemberRow } from './permissions.js';

// --- Projektek --------------------------------------------------------------

export {
	listProjects,
	getProject,
	createProject,
	updateProject,
	deleteProject,
	listProjectMembers,
	addProjectMember,
	removeProjectMember,
	listProjectRoleOverrides,
	setProjectUserRoles,
	clearProjectUserRoles
} from './projects.js';

export type {
	Project,
	ProjectRow,
	ProjectStatus,
	ProjectListParams,
	ProjectListResult,
	ProjectMemberRow,
	ProjectRoleOverrideRow
} from './projects.js';

// --- Munkabejegyzések (work entries) ---------------------------------------

export {
	listWorkEntries,
	createWorkEntry,
	updateWorkEntry,
	deleteWorkEntry,
	getWorkEntryCategories
} from './work-entries.js';

export type {
	WorkEntry,
	WorkEntryRow,
	WorkEntryCategory,
	WorkEntryListParams,
	WorkEntryListResult
} from './work-entries.js';

// --- Projekt riport ---------------------------------------------------------

export { getProjectReport } from './project-report.js';

export type {
	ProjectReport,
	ProjectReportEmployee,
	ProjectReportEmployeeCategory,
	ProjectReportCategory,
	ProjectReportDaily
} from './project-report.js';
