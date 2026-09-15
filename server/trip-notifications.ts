/**
 * Kiküldetések — rendszeren belüli értesítések (12. fejezet).
 *
 *   - beküldött rendelvény → a `trip.approve` joggal rendelkezők
 *   - jóváhagyás, visszaküldés, kifizetés, visszanyitás → a dolgozó
 *   - az elrendelő felülbírálása → a dolgozó (műveletenként egy értesítés)
 *
 * Mint a leave-notifications.ts: minden küldés best-effort, a hibát naplózzuk,
 * a művelet nem gördül vissza, és a műveletet végző nem kap értesítést.
 * Email csak akkor megy, ha a szervezet az eseményhez bekapcsolta
 * (specs/notifications.md, alapból ki).
 */

import type { LocalizedText, RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { SCHEMA, loadEmployeeRef } from './trip-access.js';
import { periodLabel } from './trip-calc.js';
import {
	EMAIL_LOCALE,
	escapeHtml,
	itemsHtml,
	itemsText,
	loadOrganizationName,
	loadRecipientsByUserIds,
	sendEmails
} from './notification-email.js';

export type SettlementEvent = 'approved' | 'returned' | 'paid' | 'reopened';

const EVENT_TEXTS: Record<
	SettlementEvent,
	{
		title: LocalizedText;
		type: 'success' | 'warning' | 'info';
		/** Az emailben: az állapot címkéje, mondata („… rendelvényedet jóváhagyták”) és színe. */
		label: LocalizedText;
		sentence: LocalizedText;
		color: string;
	}
> = {
	approved: {
		title: { hu: 'Kiküldetési rendelvény jóváhagyva', en: 'Business trip settlement approved' },
		type: 'success',
		label: { hu: 'jóváhagyva', en: 'approved' },
		sentence: { hu: 'jóváhagyták', en: 'has been approved' },
		color: '#16a34a'
	},
	returned: {
		title: { hu: 'Kiküldetési rendelvény visszaküldve', en: 'Business trip settlement returned' },
		type: 'warning',
		label: { hu: 'visszaküldve', en: 'returned' },
		sentence: { hu: 'javításra visszaküldték', en: 'has been returned for correction' },
		color: '#d97706'
	},
	paid: {
		title: { hu: 'Kiküldetési rendelvény kifizetve', en: 'Business trip settlement paid' },
		type: 'success',
		label: { hu: 'kifizetve', en: 'paid' },
		sentence: { hu: 'kifizették', en: 'has been paid' },
		color: '#16a34a'
	},
	reopened: {
		title: { hu: 'Kiküldetési rendelvény visszanyitva', en: 'Business trip settlement reopened' },
		type: 'info',
		label: { hu: 'visszanyitva', en: 'reopened' },
		sentence: { hu: 'visszanyitották', en: 'has been reopened' },
		color: '#71717a'
	}
};

export interface SettlementNotice {
	id: number;
	organizationId: number;
	employeeId: number;
	year: number;
	month: number;
	plateNumber: string;
}

async function actorUserId(context: RemoteContext): Promise<number | null> {
	try {
		return await resolveUserId(context);
	} catch {
		return null;
	}
}

async function send(
	context: RemoteContext,
	params: Parameters<NonNullable<RemoteContext['notifications']>['send']>[0]
): Promise<void> {
	if (!context.notifications) return;
	// Saját hibakezelés, hogy egy sikertelen értesítés után az email még kimenjen.
	try {
		const result = await context.notifications.send(params);
		if (!result.success) console.error('[Work] Kiküldetés értesítés sikertelen:', result.error);
	} catch (err) {
		console.error('[Work] Kiküldetés értesítés sikertelen:', err);
	}
}

/** A rendelvény hónapja: „2025. augusztus” / „2025-08”. */
function monthOf(notice: SettlementNotice): LocalizedText {
	// „2025. év augusztus hó” → „2025. augusztus”
	const hu = periodLabel(notice.year, notice.month).replace(' év', '').replace(' hó', '');
	return { hu, en: `${notice.year}-${String(notice.month).padStart(2, '0')}` };
}

function period(notice: SettlementNotice): LocalizedText {
	const month = monthOf(notice);
	return { hu: `${notice.plateNumber}, ${month.hu}`, en: `${notice.plateNumber}, ${month.en}` };
}

export async function notifySettlementSubmitted(
	context: RemoteContext,
	notice: SettlementNotice,
	warningCount: number
): Promise<void> {
	try {
		const actor = await actorUserId(context);
		const r = await context.db.query(
			`SELECT DISTINCT mr.user_id
			   FROM ${SCHEMA}.wp_member_roles mr
			   JOIN ${SCHEMA}.wp_role_capabilities rc ON rc.role_id = mr.role_id
			  WHERE mr.organization_id = $1 AND rc.capability = 'trip.approve'
			    AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.employees x
			                     WHERE x.organization_id = mr.organization_id AND x.user_id = mr.user_id AND x.is_external)`,
			[notice.organizationId]
		);
		const userIds = r.rows.map((row: any) => Number(row.user_id)).filter((id: number) => id !== actor);
		if (userIds.length === 0) return;

		const employee = await loadEmployeeRef(context, notice.employeeId);
		const p = period(notice);
		const warnHu = warningCount > 0 ? ` — ${warningCount} hiányzó adat` : '';
		const warnEn = warningCount > 0 ? ` — ${warningCount} missing item(s)` : '';
		await send(context, {
			userIds,
			title: { hu: 'Új kiküldetési rendelvény', en: 'New business trip settlement' },
			message: { hu: `${employee.name}: ${p.hu}${warnHu}`, en: `${employee.name}: ${p.en}${warnEn}` },
			type: 'info',
			data: { tripSettlementId: notice.id, organizationId: notice.organizationId }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		const warning =
			warningCount === 0
				? ''
				: EMAIL_LOCALE === 'hu'
					? `Figyelem: ${warningCount} hiányzó adat van a rendelvényen.`
					: `Note: the settlement has ${warningCount} missing item(s).`;
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'trip.settlementSubmitted',
			template: 'trip_settlement_submitted',
			recipients: await loadRecipientsByUserIds(context, userIds),
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				employeeName: employee.name,
				employeeNameHtml: escapeHtml(employee.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				period: monthOf(notice)[EMAIL_LOCALE],
				plateNumber: notice.plateNumber,
				plateNumberHtml: escapeHtml(notice.plateNumber),
				warningHtml: warning
					? `<p style="margin: 8px 0 0; font-size: 14px; color: #b45309;"><strong>${warning}</strong></p>`
					: '',
				warningText: warning ? `\n  ${warning}` : ''
			})
		});
	} catch (err) {
		console.error('[Work] Kiküldetés beküldés értesítés sikertelen:', err);
	}
}

export async function notifySettlementEvent(
	context: RemoteContext,
	notice: SettlementNotice,
	event: SettlementEvent,
	extra: { documentNumber?: string | null; note?: string | null } = {}
): Promise<void> {
	try {
		const employee = await loadEmployeeRef(context, notice.employeeId);
		if (employee.userId === (await actorUserId(context))) return;
		const p = period(notice);
		const parts = (locale: 'hu' | 'en') =>
			[p[locale], extra.documentNumber ?? '', extra.note?.trim() ?? ''].filter(Boolean).join(' — ');
		await send(context, {
			userIds: [employee.userId],
			title: EVENT_TEXTS[event].title,
			message: { hu: parts('hu'), en: parts('en') },
			type: EVENT_TEXTS[event].type,
			data: { tripSettlementId: notice.id, organizationId: notice.organizationId }
		});

		const texts = EVENT_TEXTS[event];
		const hu = EMAIL_LOCALE === 'hu';
		const note = extra.note?.trim();
		const lines = [
			`${hu ? 'Időszak' : 'Period'}: ${monthOf(notice)[EMAIL_LOCALE]}`,
			`${hu ? 'Rendszám' : 'Plate number'}: ${notice.plateNumber}`,
			extra.documentNumber ? `${hu ? 'Bizonylatszám' : 'Document number'}: ${extra.documentNumber}` : '',
			note ? `${hu ? 'Megjegyzés' : 'Note'}: ${note}` : ''
		].filter(Boolean);
		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'trip.settlementStatus',
			template: 'trip_settlement_status',
			recipients: await loadRecipientsByUserIds(context, [employee.userId]),
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				statusLabel: texts.label[EMAIL_LOCALE],
				statusSentence: texts.sentence[EMAIL_LOCALE],
				statusColor: texts.color,
				period: monthOf(notice)[EMAIL_LOCALE],
				itemsHtml: itemsHtml(lines),
				itemsText: itemsText(lines)
			})
		});
	} catch (err) {
		console.error(`[Work] Kiküldetés értesítés sikertelen (${event}):`, err);
	}
}

export async function notifyOrderedByOverridden(
	context: RemoteContext,
	params: { organizationId: number; employeeId: number; count: number }
): Promise<void> {
	try {
		const employee = await loadEmployeeRef(context, params.employeeId);
		if (employee.userId === (await actorUserId(context))) return;
		await send(context, {
			userIds: [employee.userId],
			title: { hu: 'Módosult az elrendelő', en: 'Trip orderer changed' },
			message: {
				hu: `A HR ${params.count} útnál módosította az elrendelőt.`,
				en: `HR changed the orderer on ${params.count} trip(s).`
			},
			type: 'info',
			data: { organizationId: params.organizationId }
		});

		const organizationName = await loadOrganizationName(context, params.organizationId);
		await sendEmails(context, {
			organizationId: params.organizationId,
			event: 'trip.ordererChanged',
			template: 'trip_orderer_changed',
			recipients: await loadRecipientsByUserIds(context, [employee.userId]),
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				count: params.count
			})
		});
	} catch (err) {
		console.error('[Work] Elrendelő-módosítás értesítés sikertelen:', err);
	}
}
