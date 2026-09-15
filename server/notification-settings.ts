/**
 * Email értesítések beállítása — szervezetenként, eseményenként egy kapcsoló
 * (specs/notifications.md).
 *
 * A rendszeren belüli értesítések mindig mennek; ez a beállítás csak azt
 * dönti el, hogy az eseményről email is menjen-e. Az olvasás a küldéshez
 * jogosultság-ellenőrzés nélkül történik (`isEmailEnabled`), a lekérés és a
 * mentés a felületről `org.manage` joggal.
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import { SCHEMA, requireOrganizationId } from './trip-access.js';

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
	'trip.settlementSubmitted': false,
	'trip.settlementStatus': false,
	'trip.ordererChanged': false
} as const satisfies Record<string, boolean>;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENT_DEFAULTS;

export const NOTIFICATION_EVENTS = Object.keys(NOTIFICATION_EVENT_DEFAULTS) as NotificationEvent[];

export interface NotificationSettings {
	email: Record<NotificationEvent, boolean>;
}

function settingsKey(organizationId: number): string {
	return `settings:notifications:org_${organizationId}`;
}

/**
 * A tárolt értékből teljes beállítás: az ismeretlen kulcsok kimaradnak, a
 * hiányzó vagy nem logikai értékű események az alapértéküket kapják.
 */
export function normalizeNotificationSettings(raw: unknown): NotificationSettings {
	const stored = (raw as { email?: unknown } | null)?.email;
	const source = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
	const email = {} as Record<NotificationEvent, boolean>;
	for (const event of NOTIFICATION_EVENTS) {
		const value = source[event];
		email[event] = typeof value === 'boolean' ? value : NOTIFICATION_EVENT_DEFAULTS[event];
	}
	return { email };
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

/** Menjen-e email az eseményről a szervezetben. */
export async function isEmailEnabled(
	context: RemoteContext,
	organizationId: number,
	event: NotificationEvent
): Promise<boolean> {
	return (await loadNotificationSettings(context, organizationId)).email[event];
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
	params: { organizationId: number; email: Partial<Record<NotificationEvent, boolean>> },
	context: RemoteContext
): Promise<NotificationSettings> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'org.manage');

	const current = await loadNotificationSettings(context, organizationId);
	const settings = normalizeNotificationSettings({ email: { ...current.email, ...params.email } });
	await context.db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[settingsKey(organizationId), JSON.stringify(settings)]
	);
	return settings;
}
