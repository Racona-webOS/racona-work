/**
 * Lejárati emlékeztetők (specs/employee-documents.md, K9). A napi ütemezett
 * feladat (jobs.ts) hívja, rendszer-kontextusban.
 *
 * Minden aktív, lejárattal rendelkező dokumentumra a típus emlékeztető napjain
 * (pl. 30 és 7 nappal előtte) és a lejárat napján megy jelzés; egy eltolásra
 * egyszer (employee_document_reminders). Ha a feladat kimaradt, a legsürgősebb
 * elért eltolásról megy egy jelzés, a korábbiak is küldöttnek számítanak.
 *
 * Címzettek: a szervezetben `employee.documents.manage` joggal rendelkezők
 * (napi összesítő), és ha a típus látható a dolgozónak, maga a dolgozó.
 * Kilépett (inaktív) dolgozó dokumentumára nem megy jelzés.
 */

import type { LocalizedText, RemoteContext } from './context.js';
import { daysBetween } from './employee-documents.js';
import {
	escapeHtml,
	itemsHtml,
	itemsText,
	loadOrganizationName,
	RECIPIENT_LOCALE_SQL,
	sendEmails,
	toRecipient,
	type EmailLocale,
	type Recipient
} from './notification-email.js';

const SCHEMA = 'app__racona_work';

/** Az értesítésben legfeljebb ennyi tétel szerepel felsorolva. */
const MAX_LISTED = 5;

export interface DueReminder {
	/** A most elért (legsürgősebb) eltolás; 0 = a lejárat napja vagy utána */
	offset: number;
	/** Ezeket jelöljük küldöttnek (a korábbi, kimaradt eltolásokat is) */
	markOffsets: number[];
}

/**
 * Esedékes-e emlékeztető (tiszta függvény).
 *
 * @param daysLeft - Napok a lejáratig (negatív: már lejárt)
 * @param reminderDays - A típus emlékeztetői (napok a lejárat előtt)
 * @param sent - A dokumentumhoz már elküldött eltolások
 */
export function dueReminder(daysLeft: number, reminderDays: number[], sent: number[]): DueReminder | null {
	const offsets = [...new Set([...reminderDays.filter((d) => d > 0), 0])];
	const reached = offsets.filter((o) => daysLeft <= o);
	if (reached.length === 0) return null;
	if (reached.every((o) => sent.includes(o))) return null;
	return { offset: Math.min(...reached), markOffsets: reached.sort((a, b) => b - a) };
}

/** „2026. 10. 20.” / „20 Oct 2026” */
export function formatDayLabel(day: string, locale: EmailLocale): string {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', {
		year: 'numeric',
		month: locale === 'hu' ? '2-digit' : 'short',
		day: '2-digit',
		timeZone: 'UTC'
	}).format(date);
}

/** Az állapot rövid szövege: „14 nap múlva lejár (2026. 10. 20.)”. */
export function expiryPhrase(daysLeft: number, validUntil: string, locale: EmailLocale): string {
	const date = formatDayLabel(validUntil, locale);
	if (locale === 'hu') {
		if (daysLeft < 0) return `lejárt (${date})`;
		if (daysLeft === 0) return `ma lejár (${date})`;
		return `${daysLeft} nap múlva lejár (${date})`;
	}
	if (daysLeft < 0) return `expired (${date})`;
	if (daysLeft === 0) return `expires today (${date})`;
	return `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${date})`;
}

interface DueDocument {
	documentId: number;
	organizationId: number;
	employeeId: number;
	employeeUserId: number;
	employeeName: string;
	title: string;
	validUntil: string;
	daysLeft: number;
	visibleToEmployee: boolean;
	reminder: DueReminder;
}

function itemLine(doc: DueDocument, locale: EmailLocale, withEmployee: boolean): string {
	const phrase = expiryPhrase(doc.daysLeft, doc.validUntil, locale);
	return withEmployee ? `${doc.employeeName} – ${doc.title}: ${phrase}` : `${doc.title}: ${phrase}`;
}

function brief(docs: DueDocument[], locale: EmailLocale, withEmployee: boolean): string {
	const lines = docs.slice(0, MAX_LISTED).map((d) => itemLine(d, locale, withEmployee));
	const more = docs.length - MAX_LISTED;
	if (more > 0) lines.push(locale === 'hu' ? `és még ${more}` : `and ${more} more`);
	return lines.join('; ');
}

function anyExpired(docs: DueDocument[]): boolean {
	return docs.some((d) => d.daysLeft <= 0);
}

async function sendInApp(
	context: RemoteContext,
	params: Parameters<NonNullable<RemoteContext['notifications']>['send']>[0]
): Promise<void> {
	if (!context.notifications) return;
	try {
		const result = await context.notifications.send(params);
		if (!result.success) console.error('[Work] Dokumentum emlékeztető sikertelen:', result.error);
	} catch (err) {
		console.error('[Work] Dokumentum emlékeztető sikertelen:', err);
	}
}

/** Az esedékes dokumentumok (minden szervezetben). */
async function loadDueDocuments(context: RemoteContext, today: string): Promise<DueDocument[]> {
	const r = await context.db.query(
		`SELECT d.id, d.organization_id, d.employee_id, d.title,
		        to_char(d.valid_until, 'YYYY-MM-DD') AS valid_day,
		        t.reminder_days, t.visible_to_employee,
		        e.user_id, COALESCE(NULLIF(trim(u.full_name), ''), u.email) AS employee_name,
		        ARRAY(SELECT r.offset_days FROM ${SCHEMA}.employee_document_reminders r
		               WHERE r.document_id = d.id) AS sent
		   FROM ${SCHEMA}.employee_documents d
		   JOIN ${SCHEMA}.document_types t ON t.id = d.type_id
		   JOIN ${SCHEMA}.employees e ON e.id = d.employee_id
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE d.status = 'active' AND t.has_expiry AND d.valid_until IS NOT NULL
		    AND e.status <> 'inactive'
		    AND d.valid_until <= $1::date + GREATEST(
		        COALESCE((SELECT MAX(x) FROM unnest(t.reminder_days) AS x), 0), 0)
		  ORDER BY d.organization_id, d.valid_until, employee_name`,
		[today]
	);
	const due: DueDocument[] = [];
	for (const row of r.rows) {
		const daysLeft = daysBetween(today, row.valid_day);
		const reminder = dueReminder(daysLeft, (row.reminder_days ?? []).map(Number), (row.sent ?? []).map(Number));
		if (!reminder) continue;
		due.push({
			documentId: row.id,
			organizationId: row.organization_id,
			employeeId: row.employee_id,
			employeeUserId: Number(row.user_id),
			employeeName: row.employee_name ?? '—',
			title: row.title,
			validUntil: row.valid_day,
			daysLeft,
			visibleToEmployee: row.visible_to_employee === true,
			reminder
		});
	}
	return due;
}

/** A szervezet dokumentumkezelői (nem külsős, nem kilépett tagok). */
export async function loadManagers(context: RemoteContext, organizationId: number): Promise<Recipient[]> {
	const r = await context.db.query(
		`SELECT DISTINCT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
		   FROM ${SCHEMA}.wp_member_roles mr
		   JOIN ${SCHEMA}.wp_role_capabilities rc ON rc.role_id = mr.role_id
		   JOIN auth.users u ON u.id = mr.user_id
		  WHERE mr.organization_id = $1 AND rc.capability = 'employee.documents.manage'
		    AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.employees x
		                     WHERE x.organization_id = mr.organization_id AND x.user_id = mr.user_id
		                       AND (x.is_external OR x.status = 'inactive'))`,
		[organizationId]
	);
	return r.rows.map(toRecipient);
}

async function markSent(context: RemoteContext, docs: DueDocument[]): Promise<void> {
	const documentIds: number[] = [];
	const offsets: number[] = [];
	for (const doc of docs) {
		for (const offset of doc.reminder.markOffsets) {
			documentIds.push(doc.documentId);
			offsets.push(offset);
		}
	}
	if (documentIds.length === 0) return;
	await context.db.query(
		`INSERT INTO ${SCHEMA}.employee_document_reminders (document_id, offset_days)
		 SELECT * FROM unnest($1::int[], $2::int[])
		 ON CONFLICT DO NOTHING`,
		[documentIds, offsets]
	);
}

async function notifyManagers(context: RemoteContext, organizationId: number, docs: DueDocument[]): Promise<number> {
	const managers = await loadManagers(context, organizationId);
	if (managers.length === 0) return 0;

	const title: LocalizedText = { hu: 'Lejáró dokumentumok', en: 'Expiring documents' };
	await sendInApp(context, {
		userIds: managers.map((m) => m.userId),
		title,
		message: { hu: brief(docs, 'hu', true), en: brief(docs, 'en', true) },
		type: anyExpired(docs) ? 'warning' : 'info',
		data: { organizationId, documentIds: docs.map((d) => d.documentId) }
	});

	const organizationName = await loadOrganizationName(context, organizationId);
	await sendEmails(context, {
		organizationId,
		event: 'document.expiring',
		template: 'document_expiring',
		recipients: managers,
		buildData: (recipient) => {
			const lines = docs.map((d) => itemLine(d, recipient.locale, true));
			return {
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				count: String(docs.length),
				itemsHtml: itemsHtml(lines),
				itemsText: itemsText(lines)
			};
		}
	});
	return managers.length;
}

async function notifyEmployees(context: RemoteContext, organizationId: number, docs: DueDocument[]): Promise<number> {
	const byUser = new Map<number, DueDocument[]>();
	for (const doc of docs.filter((d) => d.visibleToEmployee)) {
		if (!byUser.has(doc.employeeUserId)) byUser.set(doc.employeeUserId, []);
		byUser.get(doc.employeeUserId)!.push(doc);
	}
	if (byUser.size === 0) return 0;

	const r = await context.db.query(
		`SELECT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
		   FROM auth.users u WHERE u.id = ANY($1::int[])`,
		[[...byUser.keys()]]
	);
	const recipients: Recipient[] = r.rows.map(toRecipient);
	const organizationName = await loadOrganizationName(context, organizationId);

	for (const recipient of recipients) {
		const own = byUser.get(recipient.userId) ?? [];
		if (own.length === 0) continue;
		await sendInApp(context, {
			userId: recipient.userId,
			title: { hu: 'Lejáró dokumentumod', en: 'Your document expires' },
			message: { hu: brief(own, 'hu', false), en: brief(own, 'en', false) },
			type: anyExpired(own) ? 'warning' : 'info',
			data: { organizationId, documentIds: own.map((d) => d.documentId) }
		});
		await sendEmails(context, {
			organizationId,
			event: 'document.expiringEmployee',
			template: 'document_expiring_employee',
			recipients: [recipient],
			buildData: (rcp) => {
				const lines = own.map((d) => itemLine(d, rcp.locale, false));
				return {
					recipientName: rcp.name,
					recipientNameHtml: escapeHtml(rcp.name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					itemsHtml: itemsHtml(lines),
					itemsText: itemsText(lines)
				};
			}
		});
	}
	return recipients.length;
}

export interface DocumentReminderTotals {
	organizations: number;
	documents: number;
	managerNotices: number;
	employeeNotices: number;
	failed: Array<{ organizationId: number; error: string }>;
}

/** Minden szervezet esedékes emlékeztetői. Szervezetenként külön; egy hiba nem állítja meg a többit. */
export async function runDocumentRemindersForAll(
	context: RemoteContext,
	today: string
): Promise<DocumentReminderTotals> {
	const due = await loadDueDocuments(context, today);
	const byOrganization = new Map<number, DueDocument[]>();
	for (const doc of due) {
		if (!byOrganization.has(doc.organizationId)) byOrganization.set(doc.organizationId, []);
		byOrganization.get(doc.organizationId)!.push(doc);
	}

	const totals: DocumentReminderTotals = {
		organizations: byOrganization.size,
		documents: due.length,
		managerNotices: 0,
		employeeNotices: 0,
		failed: []
	};

	for (const [organizationId, docs] of byOrganization) {
		if (context.signal?.aborted) break;
		try {
			totals.managerNotices += await notifyManagers(context, organizationId, docs);
			totals.employeeNotices += await notifyEmployees(context, organizationId, docs);
			// Küldöttnek jelöljük akkor is, ha nincs címzett: különben minden nap újra próbálná
			await markSent(context, docs);
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			context.logger?.error(`Dokumentum emlékeztető hiba (#${organizationId}): ${error}`);
			totals.failed.push({ organizationId, error });
		}
	}
	return totals;
}
