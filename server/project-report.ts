/**
 * Projekt riport — a munkabejegyzések aggregált nézete.
 *
 * Egy hívásban adja vissza a projekt összesítőit (összes óra, bejegyzések
 * száma, aktív tagok), a dolgozónkénti és kategóriánkénti bontást, a napi
 * időbeli lefutást, az inaktív tagokat és a legutóbbi bejegyzéseket.
 *
 * Jog: `work.view.all` vagy `project.manage` (a részleteket a függvény
 * ellenőrzi). A nyers bejegyzés-lista és a CRUD a work-entries.ts-ben van.
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin } from './context.js';
import { hasCapability } from './permissions.js';
import { validateWorkDate, mapRow } from './work-entries.js';
import type { WorkEntryRow } from './work-entries.js';

export interface ProjectReportEmployeeCategory {
	categoryId: number | null;
	categoryName: string;
	totalHours: number;
	entryCount: number;
}

export interface ProjectReportEmployee {
	employeeId: number;
	userId: number;
	userName: string;
	userEmail: string;
	userImage: string | null;
	totalHours: number;
	entryCount: number;
	lastEntryDate: string | null;
	/** Kategóriánkénti bontás az adott dolgozóhoz */
	byCategory: ProjectReportEmployeeCategory[];
}

export interface ProjectReportDaily {
	date: string;
	hours: number;
	entries: number;
}

export interface ProjectReportCategory {
	categoryId: number | null;
	categoryName: string;
	totalHours: number;
	entryCount: number;
}

export interface ProjectReport {
	project: {
		id: number;
		name: string;
		status: string;
		startDate: string | null;
		endDate: string | null;
		daysSinceStart: number | null;
		daysUntilEnd: number | null;
		isOverdue: boolean;
		progressPercent: number | null;
	};
	totals: {
		totalHours: number;
		totalEntries: number;
		activeMemberCount: number;
		totalMemberCount: number;
		firstEntryDate: string | null;
		lastEntryDate: string | null;
		activeDayCount: number;
		avgHoursPerActiveDay: number;
	};
	byEmployee: ProjectReportEmployee[];
	/** Kategóriánkénti összesítés. */
	byCategory: ProjectReportCategory[];
	/** Utolsó 30 nap napi bontásban. */
	daily: ProjectReportDaily[];
	/** Top 10 legutóbbi bejegyzés. */
	recentEntries: WorkEntryRow[];
	/** Azok a projekt-tagok, akik az utolsó 14 napban nem logoltak. */
	inactiveMembers: ProjectReportEmployee[];
}

function daysBetween(a: Date, b: Date): number {
	const msPerDay = 24 * 60 * 60 * 1000;
	const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
	const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
	return Math.round((utcB - utcA) / msPerDay);
}

export async function getProjectReport(
	params: { projectId: number; from?: string; to?: string },
	context: RemoteContext
): Promise<ProjectReport> {
	if (!params?.projectId) throw new Error('Érvénytelen projekt azonosító');

	if (params.from) validateWorkDate(params.from);
	if (params.to) validateWorkDate(params.to);

	const projR = await context.db.query(
		`SELECT id, organization_id, name, status, start_date, end_date
		   FROM app__racona_work.projects WHERE id = $1`,
		[params.projectId]
	);
	if (projR.rows.length === 0) throw new Error('Projekt nem található');
	const proj = projR.rows[0] as {
		id: number;
		organization_id: number;
		name: string;
		status: string;
		start_date: string | null;
		end_date: string | null;
	};

	// Jogosultság: work.view.all vagy project.manage (vagy core admin / dev mode)
	const dev = isDevMode(context);
	const coreAdmin = isCoreAdmin(context);
	if (!dev && !coreAdmin) {
		const canAll = await hasCapability(context, proj.organization_id, 'work.view.all');
		const canManage = canAll
			? true
			: await hasCapability(context, proj.organization_id, 'project.manage', proj.id);
		if (!canAll && !canManage) {
			throw new Error('Nincs jogosultságod a projekt riportjának megtekintéséhez');
		}
	}

	// Dátumszűrő feltételek a work_entries lekérdezésekhez
	const dateParams: unknown[] = [];
	const dateWhereAlias: string[] = []; // JOIN-os lekérdezésekhez (we. alias)
	const dateWhereDirect: string[] = []; // Közvetlen work_entries lekérdezésekhez

	if (params.from) {
		dateParams.push(params.from);
		const idx = dateParams.length + 1; // $1 = projectId, ezért +1
		dateWhereAlias.push(`we.work_date >= $${idx}`);
		dateWhereDirect.push(`work_date >= $${idx}`);
	}
	if (params.to) {
		dateParams.push(params.to);
		const idx = dateParams.length + 1;
		dateWhereAlias.push(`we.work_date <= $${idx}`);
		dateWhereDirect.push(`work_date <= $${idx}`);
	}
	const dateWhere = dateWhereAlias.length > 0 ? ` AND ${dateWhereAlias.join(' AND ')}` : '';
	const dateWhereDirect_ =
		dateWhereDirect.length > 0 ? ` AND ${dateWhereDirect.join(' AND ')}` : '';

	// --- Összesítés: dolgozónként ---
	const perEmp = await context.db.query(
		`SELECT e.id AS employee_id,
		        e.user_id,
		        u.full_name AS user_name,
		        u.email AS user_email,
		        u.image AS user_image,
		        COALESCE(SUM(we.hours), 0) AS total_hours,
		        COUNT(we.id)::int AS entry_count,
		        MAX(we.work_date) AS last_entry_date
		   FROM app__racona_work.project_members pm
		   JOIN app__racona_work.employees e ON e.id = pm.employee_id
		   JOIN auth.users u ON u.id = e.user_id
		   LEFT JOIN app__racona_work.work_entries we ON we.employee_id = e.id AND we.project_id = pm.project_id${dateWhere}
		  WHERE pm.project_id = $1
		  GROUP BY e.id, e.user_id, u.full_name, u.email, u.image
		  ORDER BY total_hours DESC, u.full_name ASC`,
		[params.projectId, ...dateParams]
	);

	const byEmployee: ProjectReportEmployee[] = perEmp.rows.map((r: any) => ({
		employeeId: r.employee_id,
		userId: r.user_id,
		userName: r.user_name,
		userEmail: r.user_email,
		userImage: r.user_image ?? null,
		totalHours:
			typeof r.total_hours === 'string' ? parseFloat(r.total_hours) : Number(r.total_hours),
		entryCount: r.entry_count,
		lastEntryDate: r.last_entry_date ?? null,
		byCategory: []
	}));

	// --- Dolgozónkénti + kategóriánkénti bontás ---
	const perEmpCatR = await context.db.query(
		`SELECT e.id AS employee_id,
		        wec.id AS category_id,
		        COALESCE(wec.name, 'Kategória nélkül') AS category_name,
		        COALESCE(SUM(we.hours), 0) AS total_hours,
		        COUNT(we.id)::int AS entry_count
		   FROM app__racona_work.project_members pm
		   JOIN app__racona_work.employees e ON e.id = pm.employee_id
		   JOIN app__racona_work.work_entries we ON we.employee_id = e.id AND we.project_id = pm.project_id${dateWhere}
		   LEFT JOIN app__racona_work.work_entry_categories wec ON wec.id = we.category_id
		  WHERE pm.project_id = $1
		  GROUP BY e.id, wec.id, wec.name
		  ORDER BY e.id ASC, total_hours DESC`,
		[params.projectId, ...dateParams]
	);

	// Hozzárendeljük a kategória-bontást az egyes dolgozókhoz
	for (const row of perEmpCatR.rows as any[]) {
		const emp = byEmployee.find((e) => e.employeeId === row.employee_id);
		if (emp) {
			emp.byCategory.push({
				categoryId: row.category_id ?? null,
				categoryName: row.category_name,
				totalHours:
					typeof row.total_hours === 'string'
						? parseFloat(row.total_hours)
						: Number(row.total_hours),
				entryCount: row.entry_count
			});
		}
	}

	// --- Globális összesítés ---
	const totalsR = await context.db.query(
		`SELECT COALESCE(SUM(hours), 0) AS total_hours,
		        COUNT(*)::int AS total_entries,
		        MIN(work_date) AS first_date,
		        MAX(work_date) AS last_date,
		        COUNT(DISTINCT work_date)::int AS active_days
		   FROM app__racona_work.work_entries we
		  WHERE project_id = $1${dateWhereDirect_}`,
		[params.projectId, ...dateParams]
	);
	const totalsRow = totalsR.rows[0] as any;
	const totalHours =
		typeof totalsRow.total_hours === 'string'
			? parseFloat(totalsRow.total_hours)
			: Number(totalsRow.total_hours);
	const activeDayCount = totalsRow.active_days ?? 0;

	const totalMemberCount = byEmployee.length;
	const activeMemberCount = byEmployee.filter((e) => e.entryCount > 0).length;

	// --- Utolsó 30 nap napi bontás (vagy szűrt időszak) ---
	// Minden napot visszaadunk az intervallumban (0 órával is), hogy a chart
	// folytonos legyen, ne csak az aktív napokat mutassa.
	let dailyFromExpr: string;
	let dailyToExpr: string;
	const dailyParams: unknown[] = [params.projectId];
	if (params.from || params.to) {
		if (params.from) {
			dailyParams.push(params.from);
			dailyFromExpr = `$${dailyParams.length}::date`;
		} else {
			// Nincs from → a projekten belüli legkorábbi bejegyzés (vagy ma, ha üres)
			dailyFromExpr = `(SELECT COALESCE(MIN(work_date), CURRENT_DATE) FROM app__racona_work.work_entries WHERE project_id = $1)`;
		}
		if (params.to) {
			dailyParams.push(params.to);
			dailyToExpr = `$${dailyParams.length}::date`;
		} else {
			dailyToExpr = `CURRENT_DATE`;
		}
	} else {
		dailyFromExpr = `(CURRENT_DATE - INTERVAL '29 days')::date`;
		dailyToExpr = `CURRENT_DATE`;
	}

	const dailyR = await context.db.query(
		`SELECT to_char(d::date, 'YYYY-MM-DD') AS date,
		        COALESCE(SUM(we.hours), 0) AS hours,
		        COUNT(we.id)::int AS entries
		   FROM generate_series(${dailyFromExpr}, ${dailyToExpr}, INTERVAL '1 day') d
		   LEFT JOIN app__racona_work.work_entries we
		          ON we.work_date = d::date AND we.project_id = $1
		  GROUP BY d
		  ORDER BY d ASC`,
		dailyParams
	);
	const daily: ProjectReportDaily[] = dailyR.rows.map((r: any) => ({
		date: r.date,
		hours: typeof r.hours === 'string' ? parseFloat(r.hours) : Number(r.hours),
		entries: r.entries
	}));

	// --- Top 10 legutóbbi bejegyzés ---
	const recentR = await context.db.query(
		`SELECT we.id, we.project_id, we.employee_id, we.title, we.description,
		        we.hours, we.work_date, we.status, we.created_at, we.updated_at,
		        we.category_id, wec.name AS category_name,
		        u.full_name AS employee_name, u.email AS employee_email,
		        p.name AS project_name
		   FROM app__racona_work.work_entries we
		   JOIN app__racona_work.projects p ON p.id = we.project_id
		   JOIN app__racona_work.employees e ON e.id = we.employee_id
		   JOIN auth.users u ON u.id = e.user_id
		   LEFT JOIN app__racona_work.work_entry_categories wec ON wec.id = we.category_id
		  WHERE we.project_id = $1${dateWhere}
		  ORDER BY we.work_date DESC, we.created_at DESC
		  LIMIT 10`,
		[params.projectId, ...dateParams]
	);
	const recentEntries: WorkEntryRow[] = recentR.rows.map(mapRow);

	// --- Kategóriánkénti összesítés ---
	const byCatR = await context.db.query(
		`SELECT
		        wec.id         AS category_id,
		        COALESCE(wec.name, 'Kategória nélkül') AS category_name,
		        COALESCE(SUM(we.hours), 0) AS total_hours,
		        COUNT(we.id)::int AS entry_count
		   FROM app__racona_work.work_entries we
		   LEFT JOIN app__racona_work.work_entry_categories wec ON wec.id = we.category_id
		  WHERE we.project_id = $1${dateWhere}
		  GROUP BY wec.id, wec.name
		  ORDER BY total_hours DESC, wec.name ASC NULLS LAST`,
		[params.projectId, ...dateParams]
	);
	const byCategory: ProjectReportCategory[] = byCatR.rows.map((r: any) => ({
		categoryId: r.category_id ?? null,
		categoryName: r.category_name,
		totalHours:
			typeof r.total_hours === 'string' ? parseFloat(r.total_hours) : Number(r.total_hours),
		entryCount: r.entry_count
	}));

	// --- Inaktív tagok (14+ nap nincs bejegyzés, vagy soha nem logoltak) ---
	const inactivityThreshold = new Date();
	inactivityThreshold.setDate(inactivityThreshold.getDate() - 14);
	const thresholdStr = inactivityThreshold.toISOString().slice(0, 10);

	const inactiveMembers = byEmployee.filter((e) => {
		if (!e.lastEntryDate) return true;
		return e.lastEntryDate < thresholdStr;
	});

	// --- Projekt állapot-meta ---
	const today = new Date();
	const startDate = proj.start_date ? new Date(proj.start_date) : null;
	const endDate = proj.end_date ? new Date(proj.end_date) : null;
	const daysSinceStart = startDate ? daysBetween(startDate, today) : null;
	const daysUntilEnd = endDate ? daysBetween(today, endDate) : null;
	const isOverdue = !!(
		endDate &&
		endDate < today &&
		proj.status !== 'completed' &&
		proj.status !== 'archived'
	);
	let progressPercent: number | null = null;
	if (startDate && endDate && endDate >= startDate) {
		const total = daysBetween(startDate, endDate) || 1;
		const elapsed = Math.max(0, daysBetween(startDate, today));
		progressPercent = Math.min(100, Math.round((elapsed / total) * 100));
	}

	return {
		project: {
			id: proj.id,
			name: proj.name,
			status: proj.status,
			startDate: proj.start_date,
			endDate: proj.end_date,
			daysSinceStart,
			daysUntilEnd,
			isOverdue,
			progressPercent
		},
		totals: {
			totalHours,
			totalEntries: totalsRow.total_entries ?? 0,
			activeMemberCount,
			totalMemberCount,
			firstEntryDate: totalsRow.first_date ?? null,
			lastEntryDate: totalsRow.last_date ?? null,
			activeDayCount,
			avgHoursPerActiveDay:
				activeDayCount > 0 ? Math.round((totalHours / activeDayCount) * 100) / 100 : 0
		},
		byEmployee,
		byCategory,
		daily,
		recentEntries,
		inactiveMembers
	};
}
