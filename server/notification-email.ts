/**
 * Email értesítések — közös küldés és formázás (specs/notifications.md).
 *
 * Minden értesítő modul ezen keresztül küld emailt: a küldés előtt megnézi,
 * hogy a szervezet beállításaiban az eseményhez be van-e kapcsolva az email.
 * A küldés best-effort: a hibát naplózzuk, a hívó nem kap hibát.
 */

import type { LocalizedText, RemoteContext } from './context.js';
import { SCHEMA } from './trip-access.js';
import { isEmailEnabled } from './notification-settings.js';
import type { NotificationEvent } from './notification-settings.js';

/** Az email nyelve. A felhasználóknak nincs tárolt nyelvi beállítása, ezért fix. */
export const EMAIL_LOCALE: keyof LocalizedText = 'hu';

export interface Recipient {
	userId: number;
	name: string;
	email: string | null;
}

export function toRecipient(row: {
	user_id: number;
	full_name: string | null;
	email: string | null;
}): Recipient {
	return {
		userId: Number(row.user_id),
		name: row.full_name?.trim() || row.email || '—',
		email: row.email ?? null
	};
}

/** Felhasználók a user id-juk alapján, az emailhez szükséges adatokkal. */
export async function loadRecipientsByUserIds(
	context: RemoteContext,
	userIds: number[]
): Promise<Recipient[]> {
	if (userIds.length === 0) return [];
	const r = await context.db.query(
		`SELECT id AS user_id, full_name, email FROM auth.users WHERE id = ANY($1::int[])`,
		[userIds]
	);
	return r.rows.map(toRecipient);
}

export async function loadOrganizationName(
	context: RemoteContext,
	organizationId: number
): Promise<string> {
	const result = await context.db.query(`SELECT name FROM ${SCHEMA}.organizations WHERE id = $1`, [
		organizationId
	]);
	return result.rows[0]?.name ?? '';
}

/**
 * Címzettenként külön email, hogy egy hibás cím ne akassza meg a többit.
 * Email cím nélküli címzett kimarad; ha az eseményhez ki van kapcsolva az
 * email, semmi nem megy ki.
 */
export async function sendEmails(
	context: RemoteContext,
	params: {
		organizationId: number;
		event: NotificationEvent;
		template: string;
		recipients: Recipient[];
		buildData: (recipient: Recipient) => Record<string, unknown>;
	}
): Promise<void> {
	if (!context.email) return;
	const withEmail = params.recipients.filter(
		(r): r is Recipient & { email: string } => !!r.email
	);
	if (withEmail.length === 0) return;
	if (!(await isEmailEnabled(context, params.organizationId, params.event))) return;

	const results = await Promise.allSettled(
		withEmail.map((recipient) =>
			context.email!.send({
				to: recipient.email,
				template: params.template,
				data: params.buildData(recipient),
				locale: EMAIL_LOCALE
			})
		)
	);

	results.forEach((result, i) => {
		const failed = result.status === 'rejected' || !result.value.success;
		if (failed) {
			const reason = result.status === 'rejected' ? result.reason : result.value.error;
			console.error(`[Work] ${params.template} email sikertelen (${withEmail[i].email}):`, reason);
		}
	});
}

/**
 * A core template engine nem escape-el, ezért minden felhasználói szöveget
 * (név, indoklás) itt kell HTML-biztossá tenni.
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Felsorolás az emailbe; a sorok saját formázásból jönnek, de a nevek miatt escape-elünk. */
export function itemsHtml(lines: string[]): string {
	return lines
		.map(
			(line) =>
				`<p style="margin: 0 0 4px; font-size: 14px; color: #18181b;">${escapeHtml(line)}</p>`
		)
		.join('');
}

/** A felsorolás szöveges (text/plain) változata. */
export function itemsText(lines: string[]): string {
	return lines.map((l) => `  ${l}`).join('\n');
}

/** Címkézett, többsoros szöveg (indoklás, megjegyzés) az email adatblokkjába. */
export function noteBlockHtml(label: string, note: string): string {
	return (
		`<p style="margin: 8px 0 0; font-size: 14px; color: #18181b;"><strong>${escapeHtml(label)}:</strong> ` +
		`${escapeHtml(note).replace(/\n/g, '<br>')}</p>`
	);
}
