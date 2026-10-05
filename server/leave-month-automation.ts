/**
 * Havi szabadság-ellenőrzés automatizálása (specs/leave-month-automation.md).
 *
 * - Beállítás szervezetenként (`leave.approve`): automatikus kiküldés, emlékeztetők,
 *   zárási összesítő.
 * - `processOrganization`: a napi ütemezett feladat (server/jobs.ts) szervezetenkénti
 *   lépései: automatikus kiküldés, emlékeztetők a zárás napjáig, zárási összesítő.
 *
 * A belső függvények jogosultság-ellenőrzés nélkül futnak, ezért a functions.ts
 * csak a beállítás lekérését és mentését exportálja.
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import { SCHEMA, requireOrganizationId } from './trip-access.js';
import { todayInBudapest } from './dates.js';
import { getWorkCalendarOverrides } from './work-calendar.js';
import { isWorkingDay, listWorkingDays } from './leave-day-utils.js';
import { loadClosedYear } from './leave-closing.js';
import { notifiersSettingsKey } from './leave-notifications.js';
import { monthBounds } from './leave-month-confirmation-utils.js';
import type { MonthSnapshot } from './leave-month-confirmation-utils.js';
import {
	currentFingerprint,
	loadMonthOverview,
	performMonthConfirmationSend,
	type MonthConfirmationSendResult
} from './leave-month-confirmations.js';
import {
	notifyMonthConfirmationClosingSummary,
	notifyMonthConfirmationReminder
} from './leave-month-confirmation-notifications.js';
import {
	automationActive,
	autoSendDay,
	closingDay,
	doneThisMonth,
	normalizeAutomationSettings,
	reminderDue,
	responseDeadline,
	shouldAutoSend,
	shouldSendClosingNotice,
	withReminderEnabledAt
} from './leave-month-automation-utils.js';
import type {
	LastAutoSend,
	LastClosingNotice,
	LeaveMonthAutomationSettings
} from './leave-month-automation-utils.js';

/** Lekérdezés-képes kapcsolat: a pool vagy egy tranzakció kliense. */
interface Queryable {
	query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** A szervezet automatizmus-állapota a kv_store-ban. */
interface AutomationState {
	lastAutoSend?: LastAutoSend;
	lastClosingNotice?: LastClosingNotice;
}

function settingsKey(organizationId: number): string {
	return `settings:leave_month_automation:org_${organizationId}`;
}

function stateKey(organizationId: number): string {
	return `state:leave_month_automation:org_${organizationId}`;
}

async function readKv(db: Queryable, key: string): Promise<unknown> {
	const r = await db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [key]);
	return r.rows[0]?.value ?? null;
}

async function writeKv(db: Queryable, key: string, value: unknown): Promise<void> {
	await db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[key, JSON.stringify(value)]
	);
}

/** Belső segéd: a szervezet beállítása jogosultság-ellenőrzés nélkül. */
export async function loadAutomationSettings(
	db: Queryable,
	organizationId: number
): Promise<LeaveMonthAutomationSettings> {
	return normalizeAutomationSettings(await readKv(db, settingsKey(organizationId)));
}

function validMonthMarker<T extends { year: number; month: number }>(value: unknown): T | undefined {
	const v = value as T | undefined;
	return v && Number.isInteger(v.year) && Number.isInteger(v.month) ? v : undefined;
}

async function loadState(db: Queryable, organizationId: number): Promise<AutomationState> {
	const raw = ((await readKv(db, stateKey(organizationId))) ?? {}) as AutomationState;
	return {
		lastAutoSend: validMonthMarker<LastAutoSend>(raw.lastAutoSend),
		lastClosingNotice: validMonthMarker<LastClosingNotice>(raw.lastClosingNotice)
	};
}

async function saveState(db: Queryable, organizationId: number, patch: AutomationState): Promise<void> {
	const current = await loadState(db, organizationId);
	await writeKv(db, stateKey(organizationId), { ...current, ...patch });
}

/** Egy hónap munkanapjai a szervezet munkanaptára szerint. */
async function monthWorkingDays(
	context: RemoteContext,
	organizationId: number,
	year: number,
	month: number
): Promise<string[]> {
	const { from, to } = monthBounds(year, month);
	const overrides = await getWorkCalendarOverrides(context, organizationId, from, to);
	return listWorkingDays(from, to, overrides);
}

function yearMonthOf(day: string): { year: number; month: number } {
	return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

function nextMonth(year: number, month: number): { year: number; month: number } {
	return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

// ---------------------------------------------------------------------------
// Beállítás (K1)
// ---------------------------------------------------------------------------

export interface LeaveMonthAutomationInfo {
	settings: LeaveMonthAutomationSettings;
	/**
	 * A következő automatikus kiküldés napja (bekapcsolt kiküldésnél): a folyó
	 * hónapé, ha még nem ment ki, egyébként a következő hónapé. Ha korábbi a mai
	 * napnál, a következő napi futás küldi ki.
	 */
	nextAutoSendDay: string | null;
	/** A következő zárás napja (a folyó hónapé, ha még nem volt, egyébként a következőé) */
	nextClosingDay: string | null;
	lastAutoSend: LastAutoSend | null;
	/** Van-e kijelölt értesítendő (automatikus kiküldésnél és a zárási összesítőnél csak ők kapnak jelzést) */
	hasNotifiers: boolean;
}

async function buildInfo(
	context: RemoteContext,
	organizationId: number,
	settings: LeaveMonthAutomationSettings
): Promise<LeaveMonthAutomationInfo> {
	const today = todayInBudapest();
	const { year, month } = yearMonthOf(today);
	const next = nextMonth(year, month);
	const state = await loadState(context.db, organizationId);
	const notifiers = await readKv(context.db, notifiersSettingsKey(organizationId));
	const thisMonthDays = await monthWorkingDays(context, organizationId, year, month);
	const nextMonthDays = await monthWorkingDays(context, organizationId, next.year, next.month);

	let nextAutoSendDay: string | null = null;
	if (settings.autoSend.enabled) {
		const thisMonth = autoSendDay(year, month, settings.autoSend, thisMonthDays);
		nextAutoSendDay =
			thisMonth && !doneThisMonth(state.lastAutoSend ?? null, year, month)
				? thisMonth
				: autoSendDay(next.year, next.month, settings.autoSend, nextMonthDays);
	}

	const thisClosing = closingDay(year, month, settings.closing, thisMonthDays);
	const nextClosingDay =
		thisClosing && today <= thisClosing ? thisClosing : closingDay(next.year, next.month, settings.closing, nextMonthDays);

	return {
		settings,
		nextAutoSendDay,
		nextClosingDay,
		lastAutoSend: state.lastAutoSend ?? null,
		hasNotifiers: Array.isArray(notifiers) && notifiers.length > 0
	};
}

export async function getLeaveMonthAutomation(
	params: { organizationId: number },
	context: RemoteContext
): Promise<LeaveMonthAutomationInfo> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'leave.approve');
	return buildInfo(context, organizationId, await loadAutomationSettings(context.db, organizationId));
}

export async function saveLeaveMonthAutomation(
	params: { organizationId: number; settings: unknown },
	context: RemoteContext
): Promise<LeaveMonthAutomationInfo> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'leave.approve');

	const previous = await loadAutomationSettings(context.db, organizationId);
	const settings = withReminderEnabledAt(
		normalizeAutomationSettings(params?.settings),
		previous,
		new Date().toISOString()
	);
	await writeKv(context.db, settingsKey(organizationId), settings);
	return buildInfo(context, organizationId, settings);
}

/** A havi ellenőrzés blokkjához (MonthConfirmationPanel): az automatizmus állapota a megjelenített hónapra. */
export interface MonthAutomationStatus {
	autoSendEnabled: boolean;
	/** A megjelenített hónap automatikus kiküldésének napja, vagy null */
	autoSendDay: string | null;
	/** A megjelenített hónapra már ment automatikus kiküldés */
	autoSent: boolean;
	remindersEnabled: boolean;
	/** A hónap zárásának napja: addig mennek az emlékeztetők */
	closingDay: string | null;
	/** Zárási összesítő a szabadságkezelőknek */
	closingNotifyHr: boolean;
}

export async function loadMonthAutomationStatus(
	db: Queryable,
	organizationId: number,
	year: number,
	month: number,
	workingDays: string[]
): Promise<MonthAutomationStatus> {
	const settings = await loadAutomationSettings(db, organizationId);
	const state = await loadState(db, organizationId);
	return {
		autoSendEnabled: settings.autoSend.enabled,
		autoSendDay: settings.autoSend.enabled ? autoSendDay(year, month, settings.autoSend, workingDays) : null,
		autoSent: doneThisMonth(state.lastAutoSend ?? null, year, month),
		remindersEnabled: settings.reminders.enabled,
		closingDay: closingDay(year, month, settings.closing, workingDays),
		closingNotifyHr: settings.closing.notifyHr
	};
}

// ---------------------------------------------------------------------------
// A napi futás egy szervezetre (3. fejezet)
// ---------------------------------------------------------------------------

export interface OrganizationRunResult {
	autoSent: MonthConfirmationSendResult | null;
	reminders: number;
	/** Ment-e ma zárási összesítő */
	closingNotice: boolean;
}

interface PendingRow {
	id: number;
	employee_id: number;
	year: number;
	month: number;
	snapshot: MonthSnapshot;
	fingerprint: string;
	sent_at: string | Date;
	last_reminded_at: string | Date | null;
	reminder_count: number;
}

const iso = (value: string | Date | null): string | null =>
	value === null ? null : new Date(value).toISOString();

/**
 * Egy szervezet napi teendői: automatikus kiküldés, emlékeztetők, zárási összesítő.
 *
 * @param today - A mai nap (YYYY-MM-DD, budapesti).
 * @param now - A futás ideje: ezt kapják a rögzített időbélyegek (kiküldés,
 *   emlékeztető). Élesben a valódi idő; a dev-server szimulált napjánál annak reggele,
 *   hogy a napok közötti számítás a szimulációban is helyes legyen.
 */
export async function processOrganization(
	context: RemoteContext,
	organizationId: number,
	today: string,
	now: Date = new Date()
): Promise<OrganizationRunResult> {
	const result: OrganizationRunResult = { autoSent: null, reminders: 0, closingNotice: false };
	const settings = await loadAutomationSettings(context.db, organizationId);
	if (!automationActive(settings)) return result;

	const { year, month } = yearMonthOf(today);
	const closedYear = await loadClosedYear(context.db, organizationId);
	const workingDaysCache = new Map<string, Promise<string[]>>();
	const workingDaysOf = (y: number, m: number) => {
		const key = `${y}-${m}`;
		if (!workingDaysCache.has(key)) workingDaysCache.set(key, monthWorkingDays(context, organizationId, y, m));
		return workingDaysCache.get(key)!;
	};

	// 1. Automatikus kiküldés (D2–D5)
	if (settings.autoSend.enabled) {
		const sendDay = autoSendDay(year, month, settings.autoSend, await workingDaysOf(year, month));
		const state = await loadState(context.db, organizationId);
		const alreadySent = doneThisMonth(state.lastAutoSend ?? null, year, month);
		if (shouldAutoSend({ today, year, month, sendDay, alreadySent, closedYear })) {
			const sent = await performMonthConfirmationSend(context, {
				organizationId,
				year,
				month,
				employeeId: null,
				note: settings.autoSend.note,
				actorUserId: null,
				source: 'automatic',
				today,
				now
			});
			await saveState(context.db, organizationId, {
				lastAutoSend: { year, month, at: now.toISOString(), ...sent }
			});
			result.autoSent = sent;
		}
	}

	// 2. Emlékeztetők a tétel hónapjának zárásáig (D7, D8)
	if (settings.reminders.enabled) {
		const overrides = await getWorkCalendarOverrides(context, organizationId, today, today);
		const todayIsWorkingDay = isWorkingDay(today, overrides);
		const rows = (
			await context.db.query(
				`SELECT c.id, c.employee_id, c.year, c.month, c.snapshot, c.fingerprint,
				        c.sent_at, c.last_reminded_at, c.reminder_count
				   FROM ${SCHEMA}.leave_month_confirmations c
				   JOIN ${SCHEMA}.employees e ON e.id = c.employee_id
				  WHERE c.organization_id = $1 AND c.status = 'pending' AND e.status = 'active'
				    AND ($2::int IS NULL OR c.year > $2::int)
				  ORDER BY c.year, c.month, c.id`,
				[organizationId, closedYear]
			)
		).rows as PendingRow[];

		for (const row of rows) {
			if (context.signal?.aborted) break;
			const days = await workingDaysOf(row.year, row.month);
			const closing = closingDay(row.year, row.month, settings.closing, days);
			const sentAt = iso(row.sent_at)!;
			// A zárás utáni (és a régebbi hónapok) tételeinél az ujjlenyomatot sem kell számolni
			if (!closing || today >= closing) continue;
			const stale = (await currentFingerprint(context.db, row.employee_id, row.year, row.month)) !== row.fingerprint;
			if (
				!reminderDue({
					today,
					todayIsWorkingDay,
					sentAt,
					lastRemindedAt: iso(row.last_reminded_at),
					closing,
					stale,
					settings: settings.reminders
				})
			) {
				continue;
			}
			// Atomikus foglalás: egy nap kétszeri futása sem küld dupla emlékeztetőt
			const claimed = await context.db.query(
				`UPDATE ${SCHEMA}.leave_month_confirmations
				    SET reminder_count = reminder_count + 1, last_reminded_at = $3
				  WHERE id = $1 AND reminder_count = $2 AND status = 'pending'
				  RETURNING reminder_count`,
				[row.id, row.reminder_count, now]
			);
			const reminderNumber: number | undefined = claimed.rows[0]?.reminder_count;
			if (reminderNumber === undefined) continue;
			await notifyMonthConfirmationReminder(context, {
				id: row.id,
				employeeId: row.employee_id,
				organizationId,
				year: row.year,
				month: row.month,
				snapshot: row.snapshot,
				reminderNumber,
				deadline: responseDeadline(closing, days)
			});
			result.reminders++;
		}
	}

	// 3. Zárási összesítő a szabadságkezelőknek (D10)
	if (settings.closing.notifyHr && !(closedYear !== null && year <= closedYear)) {
		const closing = closingDay(year, month, settings.closing, await workingDaysOf(year, month));
		const state = await loadState(context.db, organizationId);
		const alreadySent = doneThisMonth(state.lastClosingNotice ?? null, year, month);
		if (shouldSendClosingNotice({ today, year, month, closing, alreadySent })) {
			const overview = await loadMonthOverview(context, organizationId, year, month);
			// Ha a hónapra semmi nem ment ki, nincs miről összesítőt küldeni
			if (overview.rows.some((r) => r.confirmation)) {
				result.closingNotice = await notifyMonthConfirmationClosingSummary(context, {
					organizationId,
					year,
					month,
					overview
				});
			}
			await saveState(context.db, organizationId, {
				lastClosingNotice: { year, month, at: now.toISOString() }
			});
		}
	}

	return result;
}

/** A napi futás összes szervezetre: szervezetenként külön, egy hibája nem állítja meg a többit (D13). */
export async function runLeaveMonthAutomationForAll(
	context: RemoteContext,
	today: string,
	now: Date = new Date()
): Promise<{
	organizations: number;
	autoSent: number;
	reminders: number;
	closingNotices: number;
	failed: { organizationId: number; error: string }[];
}> {
	const orgs = (await context.db.query(`SELECT id, name FROM ${SCHEMA}.organizations ORDER BY id`)).rows as {
		id: number;
		name: string;
	}[];
	const totals = {
		organizations: orgs.length,
		autoSent: 0,
		reminders: 0,
		closingNotices: 0,
		failed: [] as { organizationId: number; error: string }[]
	};

	for (const org of orgs) {
		if (context.signal?.aborted) {
			context.logger?.warn('Időtúllépés: a futás megszakadt, a többi szervezet a következő napi futáskor jön.');
			break;
		}
		try {
			const r = await processOrganization(context, org.id, today, now);
			if (r.autoSent) {
				totals.autoSent += r.autoSent.sent + r.autoSent.resent;
				context.logger?.info(
					`${org.name}: automatikus kiküldés — ${r.autoSent.sent} új, ${r.autoSent.resent} frissített, ${r.autoSent.skipped} kimaradt`
				);
			}
			if (r.reminders > 0) context.logger?.info(`${org.name}: ${r.reminders} emlékeztető`);
			if (r.closingNotice) context.logger?.info(`${org.name}: zárási összesítő a szabadságkezelőknek`);
			totals.reminders += r.reminders;
			if (r.closingNotice) totals.closingNotices++;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			context.logger?.error(`${org.name}: ${message}`);
			console.error(`[Work] Havi ellenőrzés automatizálás hiba (szervezet ${org.id}):`, err);
			totals.failed.push({ organizationId: org.id, error: message });
		}
	}
	return totals;
}
