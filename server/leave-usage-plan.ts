/**
 * Szabadságfelhasználási terv — tárolás és remote függvények
 * (specs/leave-balance-overview.md, K6–K9, D4, D15).
 *
 * A terv évhez kötött, a kv_store-ban él: `settings:leave_usage_plan:org_<id>:<év>`.
 * Ha egy évnek nincs saját terve, a legközelebbi korábbi év terve érvényes, ha
 * az sincs, az egyenletes eloszlás. Az évnyitás az éppen érvényes tervet saját
 * tervként átmásolja az új évre (copyUsagePlanToYear).
 */

import type { RemoteContext } from './context.js';
import { hasCapability, requireCapability } from './permissions.js';
import { currentYear } from './dates.js';
import { loadLeaveYearState } from './leave-closing.js';
import { normalizeStoredPlan, planErrorMessage, uniformPlan, validatePlan } from './leave-usage-plan-utils.js';
import type { UsagePlan } from './leave-usage-plan-utils.js';

const SCHEMA = 'app__racona_work';

/** Lekérdezés-képes kapcsolat: a pool vagy egy tranzakció kliense. */
interface Queryable {
	query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** Honnan jön az év terve: saját, egy korábbi évtől örökölt, vagy az egyenletes eloszlás. */
export type UsagePlanSource = 'own' | 'inherited' | 'default';

export interface ResolvedUsagePlan extends UsagePlan {
	year: number;
	source: UsagePlanSource;
	/** Örökölt tervnél az az év, amelyiknek a terve érvényes. */
	inheritedFromYear: number | null;
}

export interface LeaveUsagePlanView extends ResolvedUsagePlan {
	/** Lezárt év: a terve nem módosítható (D15). */
	closed: boolean;
	openedYear: number | null;
	closedYear: number | null;
}

function keyPrefix(organizationId: number): string {
	return `settings:leave_usage_plan:org_${organizationId}:`;
}

function planKey(organizationId: number, year: number): string {
	return `${keyPrefix(organizationId)}${year}`;
}

function parseParams(params: { organizationId: number; year: number }): { organizationId: number; year: number } {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	const year = Number(params.year);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Érvénytelen év.');
	return { organizationId: params.organizationId, year };
}

/** A tervet a HR és a jóváhagyók láthatják (D10). */
export async function requireUsagePlanViewAccess(context: RemoteContext, organizationId: number): Promise<void> {
	if (await hasCapability(context, organizationId, 'leave.balance.manage')) return;
	await requireCapability(context, organizationId, 'leave.approve');
}

/**
 * Az év érvényes terve (K7).
 *
 * @param db - Kapcsolat; évnyitásnál a tranzakció kliense.
 * @param organizationId - A szervezet.
 * @param year - Az év.
 */
export async function resolveUsagePlan(db: Queryable, organizationId: number, year: number): Promise<ResolvedUsagePlan> {
	const prefix = keyPrefix(organizationId);
	const r = await db.query(`SELECT key, value FROM ${SCHEMA}.kv_store WHERE key LIKE $1`, [`${prefix}%`]);

	let own: UsagePlan | null = null;
	let inherited: { year: number; plan: UsagePlan } | null = null;
	for (const row of r.rows) {
		const key = String(row.key);
		if (!key.startsWith(prefix)) continue;
		const planYear = Number(key.slice(prefix.length));
		const plan = normalizeStoredPlan(row.value);
		if (!Number.isInteger(planYear) || !plan) continue;
		if (planYear === year) own = plan;
		else if (planYear < year && (!inherited || planYear > inherited.year)) inherited = { year: planYear, plan };
	}

	if (own) return { ...own, year, source: 'own', inheritedFromYear: null };
	if (inherited) return { ...inherited.plan, year, source: 'inherited', inheritedFromYear: inherited.year };
	return { ...uniformPlan(), year, source: 'default', inheritedFromYear: null };
}

async function writePlan(db: Queryable, organizationId: number, year: number, plan: UsagePlan): Promise<void> {
	const value: UsagePlan = { months: plan.months, tolerancePct: plan.tolerancePct, criticalPct: plan.criticalPct };
	await db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[planKey(organizationId, year), JSON.stringify(value)]
	);
}

/**
 * Évnyitáskor (K8): ha az évnek még nincs saját terve, az éppen érvényes terv
 * saját tervként elmentődik, hogy a korábbi év későbbi módosítása ne hasson rá.
 *
 * @returns Az év terve a másolás előtt (a forrásával).
 */
export async function copyUsagePlanToYear(
	db: Queryable,
	organizationId: number,
	year: number
): Promise<ResolvedUsagePlan> {
	const resolved = await resolveUsagePlan(db, organizationId, year);
	if (resolved.source !== 'own') await writePlan(db, organizationId, year, resolved);
	return resolved;
}

async function loadView(db: Queryable, organizationId: number, year: number): Promise<LeaveUsagePlanView> {
	const plan = await resolveUsagePlan(db, organizationId, year);
	const state = await loadLeaveYearState(db, organizationId);
	return {
		...plan,
		closed: state.closedYear !== null && year <= state.closedYear,
		openedYear: state.openedYear,
		closedYear: state.closedYear
	};
}

// --- Remote függvények -------------------------------------------------------

/** Az év érvényes terve, a forrásával és az év állapotával. */
export async function getLeaveUsagePlan(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<LeaveUsagePlanView> {
	const { organizationId, year } = parseParams(params);
	await requireUsagePlanViewAccess(context, organizationId);
	return loadView(context.db, organizationId, year);
}

/** Az év saját tervének mentése (felülírja a meglévőt). */
export async function saveLeaveUsagePlan(
	params: { organizationId: number; year: number; months: number[]; tolerancePct: number; criticalPct: number },
	context: RemoteContext
): Promise<LeaveUsagePlanView> {
	const { organizationId, year } = parseParams(params);
	await requireCapability(context, organizationId, 'leave.balance.manage');

	const maxYear = currentYear() + 1;
	if (year > maxYear) throw new Error(`Legfeljebb a jövő év (${maxYear}) terve állítható be.`);
	const state = await loadLeaveYearState(context.db, organizationId);
	if (state.closedYear !== null && year <= state.closedYear) {
		throw new Error(`A(z) ${year}. év le van zárva, a terve nem módosítható.`);
	}

	const { plan, errors } = validatePlan(params);
	if (!plan) throw new Error(planErrorMessage(errors[0]));

	await writePlan(context.db, organizationId, year, plan);
	return loadView(context.db, organizationId, year);
}
