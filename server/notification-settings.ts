/**
 * Email értesítések beállítása — szervezetenként, eseményenként egy kapcsoló
 * (specs/notifications.md).
 *
 * A rendszeren belüli értesítések mindig mennek; ez a beállítás csak azt
 * dönti el, hogy az eseményről email is menjen-e. Az olvasás a küldéshez
 * jogosultság-ellenőrzés nélkül történik (`loadNotificationSettings`), a lekérés és a
 * mentés a felületről `org.manage` joggal.
 *
 * Kategóriánként (dolgozók, szabadság, dokumentumok, kiküldetések, munkanapló) egy
 * válaszcím (Reply-To) is megadható; üresen a rendszerszintű érvényes.
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import { SCHEMA, requireOrganizationId } from './trip-access.js';
import { isValidReplyTo } from './reply-to.js';

/**
 * Az események és az alapértékük (D2): ami eddig emailt küldött, alapból be
 * van kapcsolva, az új emailek alapból ki. A sorrend a felület sorrendje.
 */
export const NOTIFICATION_EVENT_DEFAULTS = {
	'employee.welcome': true,
	'leave.requestCreated': true,
	'leave.requestWithdrawn': false,
	'leave.requestDecided': true,
	'leave.deleted': true,
	'leave.calendarChanged': true,
	'leave.mandatoryAssigned': true,
	'leave.dataRequestCreated': false,
	'leave.dataRequestDecided': false,
	// Havi ellenőrzés (specs/leave-month-confirmation.md, D12): az összesítő emailje a funkció lényege
	'leave.monthConfirmationRequested': true,
	'leave.monthConfirmationDisputed': true,
	'leave.monthConfirmationClosed': false,
	// Havi ellenőrzés automatizálása (specs/leave-month-automation.md): csak bekapcsolt automatizmusnál megy bármi
	'leave.monthConfirmationReminder': true,
	'leave.monthConfirmationSummary': true,
	'trip.settlementSubmitted': false,
	'trip.settlementStatus': false,
	'trip.ordererChanged': false,
	// Dolgozói dokumentumok (specs/employee-documents.md, 6. fejezet): a HR összesítője a funkció lényege
	'document.expiring': true,
	'document.expiringEmployee': false,
	'document.submitted': false,
	'document.reviewed': false,
	// Hiányzó munkanapló-bejegyzések (specs/work-log-check.md): csak bekapcsolt figyelésnél megy bármi
	'worklog.missingEntriesEmployee': true,
	'worklog.missingEntries': true
} as const satisfies Record<string, boolean>;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENT_DEFAULTS;

export const NOTIFICATION_EVENTS = Object.keys(NOTIFICATION_EVENT_DEFAULTS) as NotificationEvent[];

/** Az események kategóriái: a felület csoportjai és a válaszcím egysége. */
export const NOTIFICATION_GROUPS = ['employees', 'leave', 'documents', 'trips', 'worklog'] as const;

export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

const EVENT_PREFIX_GROUP: Record<string, NotificationGroup> = {
	employee: 'employees',
	leave: 'leave',
	document: 'documents',
	trip: 'trips',
	worklog: 'worklog'
};

/** Az esemény kategóriája a kulcs előtagjából (`leave.requestCreated` → leave). */
export function eventGroup(event: NotificationEvent): NotificationGroup {
	return EVENT_PREFIX_GROUP[event.split('.')[0]];
}

export interface NotificationSettings {
	email: Record<NotificationEvent, boolean>;
	/** Kategóriánkénti válaszcím; null = a rendszerszintű érvényes. */
	replyTo: Record<NotificationGroup, string | null>;
}

function settingsKey(organizationId: number): string {
	return `settings:notifications:org_${organizationId}`;
}

/**
 * A tárolt értékből teljes beállítás: az ismeretlen kulcsok kimaradnak, a
 * hiányzó vagy nem logikai értékű események az alapértéküket kapják. A
 * válaszcím üres vagy érvénytelen értéke null (a rendszerszintű érvényes).
 */
export function normalizeNotificationSettings(raw: unknown): NotificationSettings {
	const stored = raw as { email?: unknown; replyTo?: unknown } | null;
	const source = asRecord(stored?.email);
	const email = {} as Record<NotificationEvent, boolean>;
	for (const event of NOTIFICATION_EVENTS) {
		const value = source[event];
		email[event] = typeof value === 'boolean' ? value : NOTIFICATION_EVENT_DEFAULTS[event];
	}
	const replySource = asRecord(stored?.replyTo);
	const replyTo = {} as Record<NotificationGroup, string | null>;
	for (const group of NOTIFICATION_GROUPS) {
		const value = typeof replySource[group] === 'string' ? (replySource[group] as string).trim() : '';
		replyTo[group] = value && isValidReplyTo(value) ? value : null;
	}
	return { email, replyTo };
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Belső segéd: a szervezet beállítása jogosultság-ellenőrzés nélkül. */
export async function loadNotificationSettings(
	context: RemoteContext,
	organizationId: number
): Promise<NotificationSettings> {
	const r = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
		settingsKey(organizationId)
	]);
	return normalizeNotificationSettings(r.rows[0]?.value);
}

/** Az esemény kategóriájának válaszcíme, vagy undefined (rendszerszintű). */
export function replyToFor(settings: NotificationSettings, event: NotificationEvent): string | undefined {
	return settings.replyTo[eventGroup(event)] ?? undefined;
}

export async function getNotificationSettings(
	params: { organizationId: number },
	context: RemoteContext
): Promise<NotificationSettings> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'org.manage');
	return loadNotificationSettings(context, organizationId);
}

export async function saveNotificationSettings(
	params: {
		organizationId: number;
		email?: Partial<Record<NotificationEvent, boolean>>;
		replyTo?: Partial<Record<NotificationGroup, string | null>>;
	},
	context: RemoteContext
): Promise<NotificationSettings> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'org.manage');

	// Érvénytelen címet nem dobunk el csendben: a felhasználó javítsa ki
	for (const group of NOTIFICATION_GROUPS) {
		const value = params.replyTo?.[group];
		if (typeof value === 'string' && value.trim() && !isValidReplyTo(value.trim())) {
			throw new Error(`Érvénytelen válaszcím: ${value.trim()}`);
		}
	}

	const current = await loadNotificationSettings(context, organizationId);
	const settings = normalizeNotificationSettings({
		email: { ...current.email, ...params.email },
		replyTo: { ...current.replyTo, ...params.replyTo }
	});
	await context.db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[settingsKey(organizationId), JSON.stringify(settings)]
	);
	return settings;
}
