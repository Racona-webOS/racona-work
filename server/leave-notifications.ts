/**
 * Szabadságkérelem értesítések — rendszeren belüli értesítés és email.
 *
 * Események:
 *   - új kérelem → a szervezet beállításaiban megjelölt dolgozók kapják (8.8)
 *   - elbírálás / törlés → a kérelmet beadó dolgozó kapja (8.9)
 *   - naptáras mentés (napok törölve, szabadság rögzítve) → a dolgozó kapja
 *   - visszavonás → a beadásról értesített dolgozók kapják (csak rendszeren belül)
 *
 * Minden küldés best-effort: a hibát naplózzuk, de a kérelem művelete nem
 * gördül vissza, és a hívó nem kap hibát. A műveletet végző felhasználó nem
 * kap értesítést a saját lépéséről.
 */

import type { RemoteContext, LocalizedText } from './context.js';
import { resolveUserId } from './context.js';
import { isLeaveType, LEAVE_TYPE_LABELS } from './leave-types.js';

/** Az email nyelve. A felhasználóknak nincs tárolt nyelvi beállítása, ezért fix. */
const EMAIL_LOCALE: keyof LocalizedText = 'hu';

const SCHEMA = 'app__racona_work';

/** Az értesítendő dolgozók listájának kulcsa (LeaveSettings ezzel menti). */
function notifiersSettingsKey(organizationId: number): string {
	return `settings:leave_request_notifiers:org_${organizationId}`;
}

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
	return isLeaveType(type) ? LEAVE_TYPE_LABELS[type] : { hu: type, en: type };
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

/**
 * A dolgozó visszavonta a függő kérelmét: rendszeren belüli értesítés azoknak,
 * akik a beadásról is értesültek. Email nincs, mert nincs teendő.
 *
 * @param context - Remote hívás kontextus.
 * @param request - A visszavont kérelem.
 */
export async function notifyLeaveRequestWithdrawn(
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
		const recipientResult = await context.db.query(
			`SELECT DISTINCT u.id AS user_id, u.full_name, u.email
			   FROM ${SCHEMA}.employees e
			   JOIN auth.users u ON u.id = e.user_id
			  WHERE e.id = ANY($1::int[])
			    AND e.organization_id = $2
			    AND e.status = 'active'`,
			[notifierEmployeeIds, request.organizationId]
		);
		const userIds = recipientResult.rows
			.map(toRecipient)
			.filter((r) => r.userId !== actorUserId)
			.map((r) => r.userId);
		if (userIds.length === 0) return;

		const employee = await loadEmployee(context, request.employeeId);
		const employeeName = employee?.name ?? '—';
		const leaveType = leaveTypeLabel(request.leaveType);
		const period = formatPeriod(request.startDate, request.endDate);

		await sendInApp(context, {
			userIds,
			title: { hu: 'Szabadságkérelem visszavonva', en: 'Leave request withdrawn' },
			message: {
				hu: `${employeeName}: ${leaveType.hu}, ${period.hu} (${request.days} munkanap)`,
				en: `${employeeName}: ${leaveType.en}, ${period.en} (${workingDaysEn(request.days)})`
			},
			type: 'info',
			data: { leaveRequestId: request.id, organizationId: request.organizationId }
		});
	} catch (err) {
		console.error('[Work] Szabadságkérelem visszavonás értesítés sikertelen:', err);
	}
}

// --- Naptáras mentés ----------------------------------------------------------
// Mentésenként egy-egy összefoglaló a törölt napokról és a felvett szakaszokról
// (specs/leave-days.md, D16). A HR nem kap értesítést a saját napjairól.

export interface LeaveDaysRemovedNotice {
	employeeId: number;
	organizationId: number;
	/** A törölt napok a típusukkal (YYYY-MM-DD). */
	days: { day: string; leaveType: string }[];
}

export interface LeaveDaysAddedNotice {
	employeeId: number;
	organizationId: number;
	leaveType: string;
	/** A létrehozott kérelmek időszakai. */
	periods: { startDate: string; endDate: string; days: number }[];
}

/**
 * A HR a naptárból törölte a dolgozó napjait: értesítés a dolgozónak.
 *
 * @param context - Remote hívás kontextus.
 * @param notice - A törölt napok.
 */
export async function notifyLeaveDaysRemoved(
	context: RemoteContext,
	notice: LeaveDaysRemovedNotice
): Promise<void> {
	if (notice.days.length === 0) return;
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		// Típusonként csoportosítva, hogy a lista rövid és olvasható legyen
		const byType = new Map<string, string[]>();
		for (const d of notice.days) {
			if (!byType.has(d.leaveType)) byType.set(d.leaveType, []);
			byType.get(d.leaveType)!.push(d.day);
		}
		const lines: LocalizedText[] = [...byType].map(([type, days]) => {
			const label = leaveTypeLabel(type);
			return {
				hu: `${label.hu}: ${days.map((d) => formatDay(d, 'hu-HU')).join(', ')}`,
				en: `${label.en}: ${days.map((d) => formatDay(d, 'en-GB')).join(', ')}`
			};
		});
		const count = notice.days.length;

		await sendInApp(context, {
			userIds: [employee.userId],
			title: { hu: 'Szabadságnapok törölve', en: 'Leave days removed' },
			message: {
				hu: `${count} nap törölve a naptárból. ${lines.map((l) => l.hu).join(' ')}`,
				en: `${count} ${count === 1 ? 'day' : 'days'} removed from the calendar. ${lines.map((l) => l.en).join(' ')}`
			},
			type: 'warning',
			data: { employeeId: notice.employeeId, organizationId: notice.organizationId }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, [employee], 'leave_days_removed', (recipient) => ({
			recipientName: recipient.name,
			recipientNameHtml: escapeHtml(recipient.name),
			organizationName,
			organizationNameHtml: escapeHtml(organizationName),
			dayCount: count,
			itemsHtml: itemsHtml(lines.map((l) => l[EMAIL_LOCALE])),
			itemsText: lines.map((l) => `  ${l[EMAIL_LOCALE]}`).join('\n')
		}));
	} catch (err) {
		console.error('[Work] Szabadságnapok törlése értesítés sikertelen:', err);
	}
}

/**
 * A HR a naptárból szabadságot rögzített a dolgozónak: értesítés a dolgozónak.
 *
 * @param context - Remote hívás kontextus.
 * @param notice - A létrehozott időszakok.
 */
export async function notifyLeaveDaysAdded(
	context: RemoteContext,
	notice: LeaveDaysAddedNotice
): Promise<void> {
	if (notice.periods.length === 0) return;
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		const leaveType = leaveTypeLabel(notice.leaveType);
		const count = notice.periods.reduce((sum, p) => sum + p.days, 0);
		const lines: LocalizedText[] = notice.periods.map((p) => {
			const period = formatPeriod(p.startDate, p.endDate);
			return {
				hu: `${period.hu} (${p.days} munkanap)`,
				en: `${period.en} (${workingDaysEn(p.days)})`
			};
		});

		await sendInApp(context, {
			userIds: [employee.userId],
			title: { hu: 'Szabadság rögzítve', en: 'Leave recorded' },
			message: {
				hu: `${leaveType.hu}: ${lines.map((l) => l.hu).join(', ')}`,
				en: `${leaveType.en}: ${lines.map((l) => l.en).join(', ')}`
			},
			type: 'success',
			data: { employeeId: notice.employeeId, organizationId: notice.organizationId }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, [employee], 'leave_days_added', (recipient) => ({
			recipientName: recipient.name,
			recipientNameHtml: escapeHtml(recipient.name),
			organizationName,
			organizationNameHtml: escapeHtml(organizationName),
			leaveTypeLabel: leaveType[EMAIL_LOCALE],
			dayCount: count,
			itemsHtml: itemsHtml(lines.map((l) => l[EMAIL_LOCALE])),
			itemsText: lines.map((l) => `  ${l[EMAIL_LOCALE]}`).join('\n')
		}));
	} catch (err) {
		console.error('[Work] Szabadság rögzítése értesítés sikertelen:', err);
	}
}

/** Felsorolás az emailbe; a sorok saját formázásból jönnek, de a nevek miatt escape-elünk. */
function itemsHtml(lines: string[]): string {
	return lines
		.map(
			(line) =>
				`<p style="margin: 0 0 4px; font-size: 14px; color: #18181b;">${escapeHtml(line)}</p>`
		)
		.join('');
}

// --- Dolgozói adatbejelentések ------------------------------------------------
// Csak rendszeren belüli értesítés (email nincs): az adatbejelentés ritka és nem sürgős.

export interface LeaveDataRequestNotice {
	id: number;
	employeeId: number;
	organizationId: number;
	/** Rövid leírás, pl. „Új gyerek: 2026. 07. 01.” */
	summary: LocalizedText;
}

/**
 * Új adatbejelentés értesítés mindenkinek, akinek a szervezetben
 * leave.balance.manage joga van (a bejelentőt kivéve).
 */
export async function notifyLeaveDataRequestCreated(
	context: RemoteContext,
	request: LeaveDataRequestNotice
): Promise<void> {
	try {
		const actorUserId = await resolveActorUserId(context);
		const result = await context.db.query(
			`SELECT DISTINCT mr.user_id
			   FROM ${SCHEMA}.wp_member_roles mr
			   JOIN ${SCHEMA}.wp_role_capabilities rc ON rc.role_id = mr.role_id
			  WHERE mr.organization_id = $1 AND rc.capability = 'leave.balance.manage'`,
			[request.organizationId]
		);
		const userIds = result.rows
			.map((row: { user_id: number }) => Number(row.user_id))
			.filter((id: number) => id !== actorUserId);
		if (userIds.length === 0) return;

		const employee = await loadEmployee(context, request.employeeId);
		const name = employee?.name ?? '—';
		await sendInApp(context, {
			userIds,
			title: { hu: 'Új adatbejelentés', en: 'New data change request' },
			message: { hu: `${name}: ${request.summary.hu}`, en: `${name}: ${request.summary.en}` },
			type: 'info',
			data: {
				leaveDataRequestId: request.id,
				employeeId: request.employeeId,
				organizationId: request.organizationId
			}
		});
	} catch (err) {
		console.error('[Work] Adatbejelentés értesítés sikertelen:', err);
	}
}

/** Döntés az adatbejelentésről: értesítés a bejelentő dolgozónak. */
export async function notifyLeaveDataRequestDecision(
	context: RemoteContext,
	request: LeaveDataRequestNotice,
	decision: 'approved' | 'rejected',
	decisionNote: string | null
): Promise<void> {
	try {
		const employee = await loadEmployee(context, request.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		const approved = decision === 'approved';
		const note = decisionNote?.trim();
		await sendInApp(context, {
			userIds: [employee.userId],
			title: approved
				? { hu: 'Adatbejelentés jóváhagyva', en: 'Data change approved' }
				: { hu: 'Adatbejelentés elutasítva', en: 'Data change rejected' },
			message: {
				hu: note ? `${request.summary.hu} — ${note}` : request.summary.hu,
				en: note ? `${request.summary.en} — ${note}` : request.summary.en
			},
			type: approved ? 'success' : 'warning',
			data: { leaveDataRequestId: request.id, organizationId: request.organizationId }
		});
	} catch (err) {
		console.error('[Work] Adatbejelentés döntés értesítés sikertelen:', err);
	}
}
