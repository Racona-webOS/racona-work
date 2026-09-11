/**
 * Kiküldetések — rendszeren belüli értesítések (12. fejezet).
 *
 *   - beküldött rendelvény → a `trip.approve` joggal rendelkezők
 *   - jóváhagyás, visszaküldés, kifizetés, visszanyitás → a dolgozó
 *   - az elrendelő felülbírálása → a dolgozó (műveletenként egy értesítés)
 *
 * Mint a leave-notifications.ts: minden küldés best-effort, a hibát naplózzuk,
 * a művelet nem gördül vissza, és a műveletet végző nem kap értesítést.
 */

import type { LocalizedText, RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { SCHEMA, loadEmployeeRef } from './trip-access.js';
import { periodLabel } from './trip-calc.js';

export type SettlementEvent = 'approved' | 'returned' | 'paid' | 'reopened';

const EVENT_TEXTS: Record<SettlementEvent, { title: LocalizedText; type: 'success' | 'warning' | 'info' }> = {
	approved: { title: { hu: 'Kiküldetési rendelvény jóváhagyva', en: 'Business trip settlement approved' }, type: 'success' },
	returned: { title: { hu: 'Kiküldetési rendelvény visszaküldve', en: 'Business trip settlement returned' }, type: 'warning' },
	paid: { title: { hu: 'Kiküldetési rendelvény kifizetve', en: 'Business trip settlement paid' }, type: 'success' },
	reopened: { title: { hu: 'Kiküldetési rendelvény visszanyitva', en: 'Business trip settlement reopened' }, type: 'info' }
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
	const result = await context.notifications.send(params);
	if (!result.success) console.error('[Work] Kiküldetés értesítés sikertelen:', result.error);
}

function period(notice: SettlementNotice): LocalizedText {
	// „2025. év augusztus hó” → „2025. augusztus”
	const hu = periodLabel(notice.year, notice.month).replace(' év', '').replace(' hó', '');
	return {
		hu: `${notice.plateNumber}, ${hu}`,
		en: `${notice.plateNumber}, ${notice.year}-${String(notice.month).padStart(2, '0')}`
	};
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
			  WHERE mr.organization_id = $1 AND rc.capability = 'trip.approve'`,
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
	} catch (err) {
		console.error('[Work] Elrendelő-módosítás értesítés sikertelen:', err);
	}
}
