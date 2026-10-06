/**
 * A dolgozói beküldés és a HR döntésének értesítései (specs/employee-documents.md,
 * K8, 6. fejezet). Best-effort: a hibát naplózzuk, a művelet nem bukik el miatta.
 */

import type { RemoteContext } from './context.js';
import { loadManagers } from './document-reminders.js';
import {
	escapeHtml,
	loadOrganizationName,
	loadRecipientsByUserIds,
	noteBlockHtml,
	sendEmails
} from './notification-email.js';

async function sendInApp(
	context: RemoteContext,
	params: Parameters<NonNullable<RemoteContext['notifications']>['send']>[0]
): Promise<void> {
	if (!context.notifications) return;
	try {
		const result = await context.notifications.send(params);
		if (!result.success) console.error('[Work] Dokumentum értesítés sikertelen:', result.error);
	} catch (err) {
		console.error('[Work] Dokumentum értesítés sikertelen:', err);
	}
}

/** A dolgozó dokumentumot küldött be ellenőrzésre → a dokumentumkezelők. */
export async function notifyDocumentSubmitted(
	context: RemoteContext,
	notice: { organizationId: number; employeeId: number; employeeName: string; documentId: number; title: string; fileCount: number }
): Promise<void> {
	try {
		const managers = await loadManagers(context, notice.organizationId);
		if (managers.length === 0) return;
		await sendInApp(context, {
			userIds: managers.map((m) => m.userId),
			title: { hu: 'Ellenőrzésre váró dokumentum', en: 'Document waiting for review' },
			message: {
				hu: `${notice.employeeName} feltöltötte: ${notice.title} (${notice.fileCount} fájl).`,
				en: `${notice.employeeName} uploaded: ${notice.title} (${notice.fileCount} file(s)).`
			},
			type: 'info',
			data: { organizationId: notice.organizationId, employeeId: notice.employeeId, documentId: notice.documentId }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'document.submitted',
			template: 'document_submitted',
			recipients: managers,
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				employeeName: notice.employeeName,
				employeeNameHtml: escapeHtml(notice.employeeName),
				documentTitle: notice.title,
				documentTitleHtml: escapeHtml(notice.title),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				fileCount: String(notice.fileCount)
			})
		});
	} catch (err) {
		console.error('[Work] Beküldés értesítés sikertelen:', err);
	}
}

/** A HR elfogadta vagy elutasította a beküldést → a dolgozó. */
export async function notifyDocumentReviewed(
	context: RemoteContext,
	notice: {
		organizationId: number;
		employeeUserId: number;
		documentId: number;
		title: string;
		approved: boolean;
		note: string | null;
	}
): Promise<void> {
	try {
		const reason = notice.note ? { hu: ` Indoklás: ${notice.note}`, en: ` Reason: ${notice.note}` } : { hu: '', en: '' };
		await sendInApp(context, {
			userId: notice.employeeUserId,
			title: notice.approved
				? { hu: 'Dokumentum elfogadva', en: 'Document accepted' }
				: { hu: 'Dokumentum elutasítva', en: 'Document rejected' },
			message: notice.approved
				? { hu: `Elfogadták a feltöltött dokumentumodat: ${notice.title}.`, en: `Your uploaded document was accepted: ${notice.title}.` }
				: {
						hu: `Elutasították a feltöltött dokumentumodat: ${notice.title}.${reason.hu}`,
						en: `Your uploaded document was rejected: ${notice.title}.${reason.en}`
					},
			type: notice.approved ? 'success' : 'warning',
			data: { organizationId: notice.organizationId, documentId: notice.documentId }
		});

		const recipients = await loadRecipientsByUserIds(context, [notice.employeeUserId]);
		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'document.reviewed',
			template: 'document_reviewed',
			recipients,
			buildData: (recipient) => {
				const hu = recipient.locale === 'hu';
				const decision = notice.approved ? (hu ? 'elfogadta' : 'accepted') : hu ? 'elutasította' : 'rejected';
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					documentTitle: notice.title,
					documentTitleHtml: escapeHtml(notice.title),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					decision,
					noteText: notice.note ? `${hu ? 'Indoklás' : 'Reason'}: ${notice.note}` : '',
					noteHtml: notice.note ? noteBlockHtml(hu ? 'Indoklás' : 'Reason', notice.note) : ''
				};
			}
		});
	} catch (err) {
		console.error('[Work] Döntés értesítés sikertelen:', err);
	}
}
