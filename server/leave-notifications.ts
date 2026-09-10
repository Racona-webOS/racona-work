/**
 * Szabadságkérelem értesítések — rendszeren belüli értesítés és email.
 *
 * Két esemény van:
 *   - új kérelem → a szervezet beállításaiban megjelölt dolgozók kapják (8.8)
 *   - elbírálás / törlés → a kérelmet beadó dolgozó kapja (8.9)
 *
 * Minden küldés best-effort: a hibát naplózzuk, de a kérelem művelete nem
 * gördül vissza, és a hívó nem kap hibát. A műveletet végző felhasználó nem
 * kap értesítést a saját lépéséről.
 */

import type { RemoteContext, LocalizedText } from './context.js';
import { resolveUserId } from './context.js';

/** Az email nyelve. A felhasználóknak nincs tárolt nyelvi beállítása, ezért fix. */
const EMAIL_LOCALE: keyof LocalizedText = 'hu';

const SCHEMA = 'app__racona_work';

/** Az értesítendő dolgozók listájának kulcsa (LeaveSettings ezzel menti). */
function notifiersSettingsKey(organizationId: number): string {
	return `settings:leave_request_notifiers:org_${organizationId}`;
}

const LEAVE_TYPE_LABELS: Record<string, LocalizedText> = {
	annual: { hu: 'Éves szabadság', en: 'Annual leave' },
	sick: { hu: 'Betegszabadság', en: 'Sick leave' },
	unpaid: { hu: 'Fizetés nélküli szabadság', en: 'Unpaid leave' },
	other: { hu: 'Egyéb távollét', en: 'Other leave' }
};

export type LeaveDecision = 'approved' | 'rejected' | 'deleted';

const DECISION_TEXTS: Record<
	LeaveDecision,
	{
		title: LocalizedText;
		label: LocalizedText;
		sentence: LocalizedText;
		color: string;
		type: 'success' | 'warning' | 'info';
	}
> = {
	approved: {
		title: { hu: 'Szabadságkérelem jóváhagyva', en: 'Leave request approved' },
		label: { hu: 'jóváhagyva', en: 'approved' },
		sentence: { hu: 'jóváhagyták', en: 'has been approved' },
		color: '#16a34a',
		type: 'success'
	},
	rejected: {
		title: { hu: 'Szabadságkérelem elutasítva', en: 'Leave request rejected' },
		label: { hu: 'elutasítva', en: 'rejected' },
		sentence: { hu: 'elutasították', en: 'has been rejected' },
		color: '#dc2626',
		type: 'warning'
	},
	deleted: {
		title: { hu: 'Szabadság törölve', en: 'Leave deleted' },
		label: { hu: 'törölve', en: 'deleted' },
		sentence: { hu: 'törölték', en: 'has been deleted' },
		color: '#71717a',
		type: 'info'
	}
};

/** Az értesítéshez szükséges kérelem adatok. */
export interface LeaveNotificationRequest {
	id: number;
	employeeId: number;
	organizationId: number;
	leaveType: string;
	/** YYYY-MM-DD */
	startDate: string;
	/** YYYY-MM-DD */
	endDate: string;
	days: number;
	reason?: string | null;
}

interface Recipient {
	userId: number;
	name: string;
	email: string | null;
}

/**
 * Új kérelem értesítés a szervezet beállításaiban megjelölt dolgozóknak.
 *
 * @param context - Remote hívás kontextus.
 * @param request - A létrehozott kérelem.
 */
export async function notifyLeaveRequestCreated(
	context: RemoteContext,
	request: LeaveNotificationRequest
): Promise<void> {
	try {
		const settingsResult = await context.db.query(
			`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`,
			[notifiersSettingsKey(request.organizationId)]
		);
		const notifierEmployeeIds = toIdList(settingsResult.rows[0]?.value);
		if (notifierEmployeeIds.length === 0) return;

		const actorUserId = await resolveActorUserId(context);

		// Csak az adott szervezet aktív dolgozói — egy másik szervezetből
		// bekerült vagy azóta kilépett dolgozó nem kap értesítést.
		const recipientResult = await context.db.query(
			`SELECT DISTINCT u.id AS user_id, u.full_name, u.email
			   FROM ${SCHEMA}.employees e
			   JOIN auth.users u ON u.id = e.user_id
			  WHERE e.id = ANY($1::int[])
			    AND e.organization_id = $2
			    AND e.status = 'active'`,
			[notifierEmployeeIds, request.organizationId]
		);
		const recipients = recipientResult.rows
			.map(toRecipient)
			.filter((r) => r.userId !== actorUserId);
		if (recipients.length === 0) return;

		const employee = await loadEmployee(context, request.employeeId);
		const organizationName = await loadOrganizationName(context, request.organizationId);
		const employeeName = employee?.name ?? '—';
		const leaveType = leaveTypeLabel(request.leaveType);
		const period = formatPeriod(request.startDate, request.endDate);

		await sendInApp(context, {
			userIds: recipients.map((r) => r.userId),
			title: { hu: 'Új szabadságkérelem', en: 'New leave request' },
			message: {
				hu: `${employeeName}: ${leaveType.hu}, ${period.hu} (${request.days} munkanap)`,
				en: `${employeeName}: ${leaveType.en}, ${period.en} (${workingDaysEn(request.days)})`
			},
			type: 'info',
			data: { leaveRequestId: request.id, organizationId: request.organizationId }
		});

		const reason = request.reason?.trim() || '';
		await sendEmails(
			context,
			recipients,
			'leave_request_new',
			(recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				employeeName,
				employeeNameHtml: escapeHtml(employeeName),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				leaveTypeLabel: leaveType[EMAIL_LOCALE],
				period: period[EMAIL_LOCALE],
				days: request.days,
				reasonHtml: reason ? reasonBlockHtml(reason) : '',
				reasonText: reason ? `${EMAIL_LOCALE === 'hu' ? 'Indoklás' : 'Reason'}: ${reason}\n` : ''
			})
		);
	} catch (err) {
		console.error('[Work] Új szabadságkérelem értesítés sikertelen:', err);
	}
}

/**
 * Elbírálás / törlés értesítés a kérelmet beadó dolgozónak.
 *
 * @param context - Remote hívás kontextus.
 * @param request - Az érintett kérelem.
 * @param decision - Mi történt a kérelemmel.
 */
export async function notifyLeaveRequestDecision(
	context: RemoteContext,
	request: LeaveNotificationRequest,
	decision: LeaveDecision
): Promise<void> {
	try {
		const employee = await loadEmployee(context, request.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		const texts = DECISION_TEXTS[decision];
		const leaveType = leaveTypeLabel(request.leaveType);
		const period = formatPeriod(request.startDate, request.endDate);

		await sendInApp(context, {
			userIds: [employee.userId],
			title: texts.title,
			message: {
				hu: `${leaveType.hu}, ${period.hu} (${request.days} munkanap)`,
				en: `${leaveType.en}, ${period.en} (${workingDaysEn(request.days)})`
			},
			type: texts.type,
			data: { leaveRequestId: request.id, organizationId: request.organizationId }
		});

		const organizationName = await loadOrganizationName(context, request.organizationId);
		await sendEmails(context, [employee], 'leave_request_status', (recipient) => ({
			recipientName: recipient.name,
			recipientNameHtml: escapeHtml(recipient.name),
			organizationName,
			organizationNameHtml: escapeHtml(organizationName),
			statusLabel: texts.label[EMAIL_LOCALE],
			statusSentence: texts.sentence[EMAIL_LOCALE],
			statusColor: texts.color,
			leaveTypeLabel: leaveType[EMAIL_LOCALE],
			period: period[EMAIL_LOCALE],
			days: request.days
		}));
	} catch (err) {
		console.error(`[Work] Szabadságkérelem értesítés sikertelen (${decision}):`, err);
	}
}

// ---------------------------------------------------------------------------
// Küldés
// ---------------------------------------------------------------------------

async function sendInApp(
	context: RemoteContext,
	params: Parameters<NonNullable<RemoteContext['notifications']>['send']>[0]
): Promise<void> {
	if (!context.notifications) {
		console.warn(
			'[Work] A core nem ad át notifications szolgáltatást — a rendszeren belüli értesítés kimarad.'
		);
		return;
	}
	// Saját hibakezelés, hogy egy sikertelen értesítés után az email még kimenjen.
	try {
		const result = await context.notifications.send(params);
		if (!result.success) {
			console.error('[Work] Rendszeren belüli értesítés sikertelen:', result.error);
		}
	} catch (err) {
		console.error('[Work] Rendszeren belüli értesítés sikertelen:', err);
	}
}

/**
 * Címzettenként külön email, hogy egy hibás cím ne akassza meg a többit.
 * Email cím nélküli címzett kimarad.
 */
async function sendEmails(
	context: RemoteContext,
	recipients: Recipient[],
	template: string,
	buildData: (recipient: Recipient) => Record<string, unknown>
): Promise<void> {
	if (!context.email) return;

	const withEmail = recipients.filter((r): r is Recipient & { email: string } => !!r.email);
	const results = await Promise.allSettled(
		withEmail.map((recipient) =>
			context.email!.send({
				to: recipient.email,
				template,
				data: buildData(recipient),
				locale: EMAIL_LOCALE
			})
		)
	);

	results.forEach((result, i) => {
		const failed = result.status === 'rejected' || !result.value.success;
		if (failed) {
			const reason = result.status === 'rejected' ? result.reason : result.value.error;
			console.error(`[Work] ${template} email sikertelen (${withEmail[i].email}):`, reason);
		}
	});
}

// ---------------------------------------------------------------------------
// Adatok
// ---------------------------------------------------------------------------

/** A műveletet végző felhasználó; ha nem oldható fel, senkit nem szűrünk ki. */
async function resolveActorUserId(context: RemoteContext): Promise<number | null> {
	try {
		return await resolveUserId(context);
	} catch {
		return null;
	}
}

async function loadEmployee(context: RemoteContext, employeeId: number): Promise<Recipient | null> {
	const result = await context.db.query(
		`SELECT u.id AS user_id, u.full_name, u.email
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.id = $1`,
		[employeeId]
	);
	return result.rows[0] ? toRecipient(result.rows[0]) : null;
}

async function loadOrganizationName(context: RemoteContext, organizationId: number): Promise<string> {
	const result = await context.db.query(`SELECT name FROM ${SCHEMA}.organizations WHERE id = $1`, [
		organizationId
	]);
	return result.rows[0]?.name ?? '';
}

function toRecipient(row: { user_id: number; full_name: string | null; email: string | null }): Recipient {
	return {
		userId: Number(row.user_id),
		name: row.full_name?.trim() || row.email || '—',
		email: row.email ?? null
	};
}

/** A kv_store-ban tárolt értéket pozitív egész ID listává alakítja. */
function toIdList(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

// ---------------------------------------------------------------------------
// Formázás
// ---------------------------------------------------------------------------

function workingDaysEn(days: number): string {
	return `${days} working ${days === 1 ? 'day' : 'days'}`;
}

function leaveTypeLabel(type: string): LocalizedText {
	return LEAVE_TYPE_LABELS[type] ?? { hu: type, en: type };
}

function formatDay(isoDay: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: 'UTC'
	}).format(new Date(`${isoDay}T00:00:00Z`));
}

/** Az időszak olvasható formában; egynapos távollétnél csak a nap. */
function formatPeriod(startDay: string, endDay: string): LocalizedText {
	if (startDay === endDay) {
		return { hu: formatDay(startDay, 'hu-HU'), en: formatDay(startDay, 'en-GB') };
	}
	return {
		hu: `${formatDay(startDay, 'hu-HU')} – ${formatDay(endDay, 'hu-HU')}`,
		en: `${formatDay(startDay, 'en-GB')} – ${formatDay(endDay, 'en-GB')}`
	};
}

/**
 * A core template engine nem escape-el, ezért minden felhasználói szöveget
 * (név, indoklás) itt kell HTML-biztossá tenni.
 */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function reasonBlockHtml(reason: string): string {
	const label = EMAIL_LOCALE === 'hu' ? 'Indoklás' : 'Reason';
	return (
		`<p style="margin: 8px 0 0; font-size: 14px; color: #18181b;"><strong>${label}:</strong> ` +
		`${escapeHtml(reason).replace(/\n/g, '<br>')}</p>`
	);
}
