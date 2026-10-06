/**
 * Hiányzó munkanapló-bejegyzések figyelése (specs/work-log-check.md).
 *
 * - Beállítás szervezetenként (`project.manage`): be/ki, visszatekintés
 *   napokban, az eszkaláció címzettjei, kihagyott dolgozók.
 * - `runWorkLogCheckForAll`: a napi ütemezett feladat (server/jobs.ts) hívja,
 *   rendszer-kontextusban, 23:55-kor.
 *
 * Vizsgált dolgozó: aktív, nem külsős, nincs kihagyva. Hiányzó nap: munkanap
 * (a szervezet munkanaptára szerint) a munkaviszonya alatt, jóváhagyott
 * szabadság nélkül, és egyik projektben sincs rá bejegyzése.
 *
 * - Emlékeztető: a dolgozó minden este emailt kap a mai és az előtte lévő
 *   `lookbackDays` nap hiányzó munkanapjairól.
 * - Eszkaláció: ha egy nap úgy esik ki az ablakból, hogy még mindig hiányzik,
 *   a beállított címzettek egyszer kapnak róla jelzést (work_log_alerts).
 *
 * A belső függvények jogosultság-ellenőrzés nélkül futnak, ezért a functions.ts
 * csak a beállítás lekérését és mentését exportálja.
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import { SCHEMA, requireOrganizationId } from './trip-access.js';
import { todayInBudapest } from './dates.js';
import { getWorkCalendarOverrides } from './work-calendar.js';
import { listWorkingDays } from './leave-day-utils.js';
import { formatDayLabel } from './document-reminders.js';
import {
	escapeHtml,
	itemsHtml,
	itemsText,
	loadOrganizationName,
	RECIPIENT_LOCALE_SQL,
	sendEmails,
	toRecipient,
	DEFAULT_EMAIL_LOCALE,
	type EmailLocale,
	type Recipient
} from './notification-email.js';
import {
	escalationWindow,
	invalidRecipients,
	missingDays,
	normalizeWorkLogCheckSettings,
	reminderWindow,
	splitRecipients,
	withEnabledOn,
	WORK_LOG_CHECK_LIMITS,
	type DayRange,
	type WorkLogCheckSettings
} from './work-log-check-utils.js';

/** Az értesítésben legfeljebb ennyi tétel szerepel felsorolva. */
const MAX_LISTED = 5;

const SETTINGS_PREFIX = 'settings:work_log_check:org_';

function settingsKey(organizationId: number): string {
	return `${SETTINGS_PREFIX}${organizationId}`;
}

function stateKey(organizationId: number): string {
	return `state:work_log_check:org_${organizationId}`;
}

async function readKv(context: RemoteContext, key: string): Promise<unknown> {
	const r = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [key]);
	return r.rows[0]?.value ?? null;
}

async function writeKv(context: RemoteContext, key: string, value: unknown): Promise<void> {
	await context.db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[key, JSON.stringify(value)]
	);
}

/** Belső segéd: a szervezet beállítása jogosultság-ellenőrzés nélkül. */
export async function loadWorkLogCheckSettings(
	context: RemoteContext,
	organizationId: number
): Promise<WorkLogCheckSettings> {
	return normalizeWorkLogCheckSettings(await readKv(context, settingsKey(organizationId)));
}

/** Az utolsó futás eredménye (a szervezet állapota a kv_store-ban). */
export interface WorkLogCheckLastRun {
	/** ISO időbélyeg */
	at: string;
	/** A futás napja */
	day: string;
	/** Emlékeztetőt kapott dolgozók */
	reminded: number;
	/** Eszkalált dolgozók */
	escalatedEmployees: number;
	/** Eszkalált (dolgozó, nap) párok */
	escalatedDays: number;
}

async function loadLastRun(context: RemoteContext, organizationId: number): Promise<WorkLogCheckLastRun | null> {
	const raw = (await readKv(context, stateKey(organizationId))) as { lastRun?: WorkLogCheckLastRun } | null;
	const last = raw?.lastRun;
	return last && typeof last.at === 'string' && typeof last.reminded === 'number' ? last : null;
}

// ---------------------------------------------------------------------------
// Beállítás
// ---------------------------------------------------------------------------

export interface WorkLogCheckEmployee {
	id: number;
	name: string;
	email: string | null;
	position: string | null;
}

export interface WorkLogCheckInfo {
	settings: WorkLogCheckSettings;
	/** A vizsgálható dolgozók (aktív, nem külsős) — közülük lehet kihagyni */
	employees: WorkLogCheckEmployee[];
	lastRun: WorkLogCheckLastRun | null;
}

async function loadCandidateEmployees(
	context: RemoteContext,
	organizationId: number
): Promise<WorkLogCheckEmployee[]> {
	const r = await context.db.query(
		`SELECT e.id, e.position, u.email,
		        COALESCE(NULLIF(trim(u.full_name), ''), u.email) AS name
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.organization_id = $1 AND e.status = 'active' AND NOT e.is_external
		  ORDER BY name`,
		[organizationId]
	);
	return r.rows.map((row: any) => ({
		id: Number(row.id),
		name: row.name ?? '—',
		email: row.email ?? null,
		position: row.position ?? null
	}));
}

async function buildInfo(
	context: RemoteContext,
	organizationId: number,
	settings: WorkLogCheckSettings
): Promise<WorkLogCheckInfo> {
	return {
		settings,
		employees: await loadCandidateEmployees(context, organizationId),
		lastRun: await loadLastRun(context, organizationId)
	};
}

export async function getWorkLogCheck(
	params: { organizationId: number },
	context: RemoteContext
): Promise<WorkLogCheckInfo> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'project.manage');
	return buildInfo(context, organizationId, await loadWorkLogCheckSettings(context, organizationId));
}

export async function saveWorkLogCheck(
	params: { organizationId: number; settings: unknown },
	context: RemoteContext
): Promise<WorkLogCheckInfo> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'project.manage');

	// Érvénytelen címet nem dobunk el csendben: a felhasználó javítsa ki
	const raw = (params?.settings ?? {}) as Record<string, unknown>;
	const recipients = splitRecipients(raw.recipients);
	const invalid = invalidRecipients(recipients);
	if (invalid.length > 0) throw new Error(`Érvénytelen email cím: ${invalid.join(', ')}`);
	if (recipients.length > WORK_LOG_CHECK_LIMITS.recipients) {
		throw new Error(`Legfeljebb ${WORK_LOG_CHECK_LIMITS.recipients} címzett adható meg.`);
	}

	const previous = await loadWorkLogCheckSettings(context, organizationId);
	const settings = withEnabledOn(normalizeWorkLogCheckSettings(raw), previous, todayInBudapest());
	await writeKv(context, settingsKey(organizationId), settings);
	return buildInfo(context, organizationId, settings);
}

// ---------------------------------------------------------------------------
// Napi futás
// ---------------------------------------------------------------------------

export interface MissingWorkLog {
	employeeId: number;
	/** A dolgozó mint címzett (felhasználó, email, nyelv) */
	recipient: Recipient;
	days: string[];
}

interface MissingWorkLogs {
	/** A dolgozói emlékeztető ablakának hiányzó napjai */
	reminders: MissingWorkLog[];
	/** Az ablakból kiesett, még nem eszkalált hiányzó napok */
	escalations: MissingWorkLog[];
}

/** A vizsgált dolgozók hiányzó napjai az emlékeztető ablakában és az eszkaláció tartományában. */
export async function findMissingWorkLogs(
	context: RemoteContext,
	organizationId: number,
	settings: WorkLogCheckSettings,
	reminder: DayRange,
	escalation: DayRange | null
): Promise<MissingWorkLogs> {
	const from = escalation && escalation.from < reminder.from ? escalation.from : reminder.from;
	const to = reminder.to;
	const overrides = await getWorkCalendarOverrides(context, organizationId, from, to);
	const workingDays = listWorkingDays(from, to, overrides);
	const reminderDays = workingDays.filter((d) => d >= reminder.from && d <= reminder.to);
	const escalationDays = escalation ? workingDays.filter((d) => d >= escalation.from && d <= escalation.to) : [];
	if (reminderDays.length === 0 && escalationDays.length === 0) return { reminders: [], escalations: [] };

	const r = await context.db.query(
		`SELECT e.id, u.id AS user_id, u.email, ${RECIPIENT_LOCALE_SQL},
		        COALESCE(NULLIF(trim(u.full_name), ''), u.email) AS full_name,
		        to_char(GREATEST(e.hire_date, (e.created_at AT TIME ZONE 'Europe/Budapest')::date), 'YYYY-MM-DD') AS first_day,
		        to_char(e.employment_end_date, 'YYYY-MM-DD') AS last_day,
		        ARRAY(SELECT DISTINCT to_char(w.work_date, 'YYYY-MM-DD') FROM ${SCHEMA}.work_entries w
		               WHERE w.employee_id = e.id AND w.work_date BETWEEN $2::date AND $3::date) AS logged,
		        ARRAY(SELECT to_char(ld.day, 'YYYY-MM-DD') FROM ${SCHEMA}.leave_days ld
		               WHERE ld.employee_id = e.id AND ld.day BETWEEN $2::date AND $3::date) AS on_leave,
		        ARRAY(SELECT to_char(a.day, 'YYYY-MM-DD') FROM ${SCHEMA}.work_log_alerts a
		               WHERE a.employee_id = e.id AND a.day BETWEEN $2::date AND $3::date) AS alerted
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.organization_id = $1 AND e.status = 'active' AND NOT e.is_external
		    AND NOT (e.id = ANY($4::int[]))
		  ORDER BY full_name`,
		[organizationId, from, to, settings.excludedEmployeeIds]
	);

	const result: MissingWorkLogs = { reminders: [], escalations: [] };
	for (const row of r.rows) {
		const state = {
			firstDay: row.first_day ?? null,
			lastDay: row.last_day ?? null,
			logged: row.logged ?? [],
			onLeave: row.on_leave ?? [],
			alerted: []
		};
		const recipient = toRecipient(row);
		const employeeId = Number(row.id);
		// Az emlékeztető minden este megy, amíg a nap az ablakban van és hiányzik
		const remind = missingDays(reminderDays, state);
		if (remind.length > 0) result.reminders.push({ employeeId, recipient, days: remind });
		const escalate = missingDays(escalationDays, { ...state, alerted: row.alerted ?? [] });
		if (escalate.length > 0) result.escalations.push({ employeeId, recipient, days: escalate });
	}
	return result;
}

function daysText(days: string[], locale: EmailLocale): string {
	return days.map((d) => formatDayLabel(d, locale)).join(', ');
}

function itemLine(item: MissingWorkLog, locale: EmailLocale): string {
	return `${item.recipient.name}: ${daysText(item.days, locale)}`;
}

function brief(items: MissingWorkLog[], locale: EmailLocale): string {
	const lines = items.slice(0, MAX_LISTED).map((i) => itemLine(i, locale));
	const more = items.length - MAX_LISTED;
	if (more > 0) lines.push(locale === 'hu' ? `és még ${more} dolgozó` : `and ${more} more employee(s)`);
	return lines.join('; ');
}

async function sendInApp(
	context: RemoteContext,
	params: Parameters<NonNullable<RemoteContext['notifications']>['send']>[0]
): Promise<void> {
	if (!context.notifications) return;
	try {
		const result = await context.notifications.send(params);
		if (!result.success) console.error('[Work] Munkanapló értesítés sikertelen:', result.error);
	} catch (err) {
		console.error('[Work] Munkanapló értesítés sikertelen:', err);
	}
}

/** A dolgozó emlékeztetője a saját hiányzó napjairól. */
async function remindEmployee(
	context: RemoteContext,
	organizationId: number,
	organizationName: string,
	settings: WorkLogCheckSettings,
	item: MissingWorkLog
): Promise<void> {
	const escalates = settings.recipients.length > 0;
	await sendInApp(context, {
		userId: item.recipient.userId,
		title: { hu: 'Hiányzó munkanapló-bejegyzés', en: 'Missing work log entry' },
		message: {
			hu: `Még nem rögzítettél bejegyzést: ${daysText(item.days, 'hu')}`,
			en: `No entry recorded yet for: ${daysText(item.days, 'en')}`
		},
		type: 'warning',
		data: { organizationId, days: item.days }
	});

	await sendEmails(context, {
		organizationId,
		event: 'worklog.missingEntriesEmployee',
		template: 'work_log_missing_employee',
		recipients: [item.recipient],
		buildData: (recipient) => {
			const lines = item.days.map((d) => formatDayLabel(d, recipient.locale));
			const hu = recipient.locale === 'hu';
			const escalationNote = !escalates
				? ''
				: settings.lookbackDays === 0
					? hu
						? 'Ha ma nem pótolod, a projektvezető értesítést kap róla.'
						: 'If you do not add it today, your project lead will be notified.'
					: hu
						? `Ha egy napot ${settings.lookbackDays} napon belül nem pótolsz, a projektvezető értesítést kap róla.`
						: `If a day is not filled in within ${settings.lookbackDays} day(s), your project lead will be notified.`;
			return {
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				count: String(item.days.length),
				itemsHtml: itemsHtml(lines),
				itemsText: itemsText(lines),
				escalationNoteHtml: escalationNote
					? `<p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #52525b;">${escapeHtml(escalationNote)}</p>`
					: '',
				escalationNoteText: escalationNote ? `${escalationNote}\n\n` : ''
			};
		}
	});
}

/**
 * Az eszkaláció címzettjei: az email címekhez tartozó felhasználók a nevükön,
 * a saját nyelvükön kapják, és a rendszeren belül is értesülnek. A többi cím
 * név nélkül, alapnyelven.
 */
async function resolveRecipients(context: RemoteContext, emails: string[]): Promise<Recipient[]> {
	const r = await context.db.query(
		`SELECT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
		   FROM auth.users u WHERE lower(u.email) = ANY($1::text[])`,
		[emails.map((e) => e.toLowerCase())]
	);
	const users = new Map<string, Recipient>();
	for (const row of r.rows) users.set(String(row.email).toLowerCase(), toRecipient(row));
	return emails.map((email) => {
		const user = users.get(email.toLowerCase());
		return user ? { ...user, email } : { userId: 0, name: '', email, locale: DEFAULT_EMAIL_LOCALE };
	});
}

/** Összesítő a beállított címzetteknek az ablakból kiesett, még hiányzó napokról. */
async function escalate(
	context: RemoteContext,
	organizationId: number,
	organizationName: string,
	settings: WorkLogCheckSettings,
	items: MissingWorkLog[]
): Promise<void> {
	const recipients = await resolveRecipients(context, settings.recipients);
	const dayCount = items.reduce((sum, i) => sum + i.days.length, 0);

	const userIds = recipients.filter((r) => r.userId > 0).map((r) => r.userId);
	if (userIds.length > 0) {
		await sendInApp(context, {
			userIds,
			title: { hu: 'Pótolatlan munkanapló-bejegyzések', en: 'Work log entries still missing' },
			message: { hu: brief(items, 'hu'), en: brief(items, 'en') },
			type: 'warning',
			data: { organizationId, employeeIds: items.map((i) => i.employeeId) }
		});
	}

	await sendEmails(context, {
		organizationId,
		event: 'worklog.missingEntries',
		template: 'work_log_missing',
		recipients,
		buildData: (recipient) => {
			const name = recipient.name || (recipient.locale === 'hu' ? 'Címzett' : 'Recipient');
			const lines = items.map((i) => itemLine(i, recipient.locale));
			return {
				recipientName: name,
				recipientNameHtml: escapeHtml(name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				employeeCount: String(items.length),
				dayCount: String(dayCount),
				itemsHtml: itemsHtml(lines),
				itemsText: itemsText(lines)
			};
		}
	});
}

async function markAlerted(context: RemoteContext, organizationId: number, items: MissingWorkLog[]): Promise<void> {
	const employeeIds: number[] = [];
	const days: string[] = [];
	for (const item of items) {
		for (const day of item.days) {
			employeeIds.push(item.employeeId);
			days.push(day);
		}
	}
	if (employeeIds.length === 0) return;
	await context.db.query(
		`INSERT INTO ${SCHEMA}.work_log_alerts (organization_id, employee_id, day)
		 SELECT $1, x.employee_id, x.day
		   FROM unnest($2::int[], $3::date[]) AS x(employee_id, day)
		 ON CONFLICT DO NOTHING`,
		[organizationId, employeeIds, days]
	);
}

/** Bekapcsolt figyelésű, létező szervezetek beállításai. */
async function loadEnabledOrganizations(
	context: RemoteContext
): Promise<Array<{ organizationId: number; settings: WorkLogCheckSettings }>> {
	const r = await context.db.query(
		`SELECT k.key, k.value
		   FROM ${SCHEMA}.kv_store k
		   JOIN ${SCHEMA}.organizations o ON k.key = '${SETTINGS_PREFIX}' || o.id
		  WHERE k.key LIKE '${SETTINGS_PREFIX}%'
		  ORDER BY o.id`
	);
	const result: Array<{ organizationId: number; settings: WorkLogCheckSettings }> = [];
	for (const row of r.rows) {
		const organizationId = Number(String(row.key).slice(SETTINGS_PREFIX.length));
		const settings = normalizeWorkLogCheckSettings(row.value);
		if (Number.isInteger(organizationId) && settings.enabled) result.push({ organizationId, settings });
	}
	return result;
}

export interface WorkLogCheckTotals {
	organizations: number;
	reminded: number;
	escalatedEmployees: number;
	escalatedDays: number;
	failed: Array<{ organizationId: number; error: string }>;
}

/** Minden bekapcsolt szervezet vizsgálata. Szervezetenként külön; egy hiba nem állítja meg a többit. */
export async function runWorkLogCheckForAll(
	context: RemoteContext,
	today: string,
	now: Date = new Date()
): Promise<WorkLogCheckTotals> {
	const organizations = await loadEnabledOrganizations(context);
	const totals: WorkLogCheckTotals = {
		organizations: organizations.length,
		reminded: 0,
		escalatedEmployees: 0,
		escalatedDays: 0,
		failed: []
	};

	for (const { organizationId, settings } of organizations) {
		if (context.signal?.aborted) break;
		try {
			const reminder = reminderWindow(settings, today)!;
			// Címzett nélkül nincs eszkaláció (és nem is jelöljük a napokat jelzettnek)
			const escalation = settings.recipients.length > 0 ? escalationWindow(settings, today) : null;
			const missing = await findMissingWorkLogs(context, organizationId, settings, reminder, escalation);

			const organizationName =
				missing.reminders.length + missing.escalations.length > 0
					? await loadOrganizationName(context, organizationId)
					: '';
			for (const item of missing.reminders) {
				if (context.signal?.aborted) break;
				await remindEmployee(context, organizationId, organizationName, settings, item);
			}
			if (missing.escalations.length > 0) {
				await escalate(context, organizationId, organizationName, settings, missing.escalations);
				// Jelzettnek jelöljük akkor is, ha az email ki van kapcsolva: különben minden nap újra próbálná
				await markAlerted(context, organizationId, missing.escalations);
			}

			const lastRun: WorkLogCheckLastRun = {
				at: now.toISOString(),
				day: today,
				reminded: missing.reminders.length,
				escalatedEmployees: missing.escalations.length,
				escalatedDays: missing.escalations.reduce((sum, i) => sum + i.days.length, 0)
			};
			totals.reminded += lastRun.reminded;
			totals.escalatedEmployees += lastRun.escalatedEmployees;
			totals.escalatedDays += lastRun.escalatedDays;
			await writeKv(context, stateKey(organizationId), { lastRun });
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			context.logger?.error(`Munkanapló figyelés hiba (#${organizationId}): ${error}`);
			totals.failed.push({ organizationId, error });
		}
	}
	return totals;
}
