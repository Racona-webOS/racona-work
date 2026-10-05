/**
 * Havi szabadság-ellenőrzés — értesítések (specs/leave-month-confirmation.md, 8. fejezet).
 *
 * Események:
 *   - kiküldés, újraküldés → a dolgozó kapja az összesítőt
 *   - eltérés → a kiküldő és a Szabadság beállításoknál kijelöltek
 *   - lezárás elfogadás nélkül → a dolgozó
 *
 * Minden küldés best-effort: a hibát naplózzuk, a művelet nem gördül vissza.
 * A műveletet végző felhasználó nem kap értesítést a saját lépéséről (a HR a
 * saját összesítőjét az irányítópulton így is látja). Az email csak akkor megy
 * ki, ha a szervezet az eseményhez bekapcsolta.
 */

import type { LocalizedText, RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import {
	RECIPIENT_LOCALE_SQL,
	escapeHtml,
	itemsHtml,
	itemsText,
	loadOrganizationName,
	noteBlockHtml,
	sendEmails,
	toRecipient
} from './notification-email.js';
import type { Recipient } from './notification-email.js';
import { notifiersSettingsKey } from './leave-notifications.js';
import { isLeaveType, LEAVE_TYPE_LABELS } from './leave-types.js';
import { formatMonthLabel, summarizeSnapshot } from './leave-month-confirmation-utils.js';
import type { DisputeItem, MonthSnapshot, SnapshotPeriod } from './leave-month-confirmation-utils.js';
import { SCHEMA } from './trip-access.js';

type Locale = keyof LocalizedText;

interface ConfirmationRef {
	id: number;
	employeeId: number;
	organizationId: number;
	year: number;
	month: number;
}

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

async function sendInApp(
	context: RemoteContext,
	params: Parameters<NonNullable<RemoteContext['notifications']>['send']>[0]
): Promise<void> {
	if (!context.notifications) {
		console.warn('[Work] A core nem ad át notifications szolgáltatást — a rendszeren belüli értesítés kimarad.');
		return;
	}
	try {
		const result = await context.notifications.send(params);
		if (!result.success) console.error('[Work] Rendszeren belüli értesítés sikertelen:', result.error);
	} catch (err) {
		console.error('[Work] Rendszeren belüli értesítés sikertelen:', err);
	}
}

async function actorUserId(context: RemoteContext): Promise<number | null> {
	try {
		return await resolveUserId(context);
	} catch {
		return null;
	}
}

async function loadEmployee(context: RemoteContext, employeeId: number): Promise<Recipient | null> {
	const result = await context.db.query(
		`SELECT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.id = $1`,
		[employeeId]
	);
	return result.rows[0] ? toRecipient(result.rows[0]) : null;
}

function typeLabel(type: string, locale: Locale): string {
	return isLeaveType(type) ? LEAVE_TYPE_LABELS[type][locale] : type;
}

function formatDay(isoDay: string, locale: Locale): string {
	return new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: 'UTC'
	}).format(new Date(`${isoDay}T00:00:00Z`));
}

function daysText(days: number, locale: Locale): string {
	return locale === 'hu' ? `${days} munkanap` : `${days} working ${days === 1 ? 'day' : 'days'}`;
}

function periodLine(p: SnapshotPeriod, locale: Locale): string {
	const range =
		p.startDate === p.endDate
			? formatDay(p.startDate, locale)
			: `${formatDay(p.startDate, locale)} – ${formatDay(p.endDate, locale)}`;
	return `${range} · ${typeLabel(p.leaveType, locale)} · ${daysText(p.days, locale)}`;
}

function byTypeText(byType: { leaveType: string; days: number }[], locale: Locale): string {
	return byType.map((t) => `${typeLabel(t.leaveType, locale)} ${t.days}`).join(', ');
}

/** Egy eltérés-tétel olvasható formában. */
function disputeLine(item: DisputeItem, snapshot: MonthSnapshot, locale: Locale): string {
	const day = formatDay(item.day, locale);
	const recorded = snapshot.days.find((d) => d.day === item.day)?.leaveType;
	const recordedLabel = recorded ? typeLabel(recorded, locale) : '—';
	const correct = item.leaveType ? typeLabel(item.leaveType, locale) : '—';
	switch (item.kind) {
		case 'not_on_leave':
			return locale === 'hu'
				? `${day}: nem volt szabadságon (rögzítve: ${recordedLabel})`
				: `${day}: was not on leave (recorded: ${recordedLabel})`;
		case 'wrong_type':
			return locale === 'hu'
				? `${day}: más a típusa (${recordedLabel} helyett ${correct})`
				: `${day}: wrong type (${correct} instead of ${recordedLabel})`;
		case 'missing':
			return locale === 'hu' ? `${day}: hiányzik (${correct})` : `${day}: missing (${correct})`;
	}
}

// ---------------------------------------------------------------------------
// Kiküldés és újraküldés
// ---------------------------------------------------------------------------

/**
 * Az összesítő a dolgozónak, rendszeren belül és emailben (K4).
 *
 * @param notice.resent - Újraküldés: a korábbi összesítő frissített változata.
 * @param notice.note - A HR megjegyzése (újraküldésnél a válasz az eltérésre).
 */
export async function notifyMonthConfirmationRequested(
	context: RemoteContext,
	notice: ConfirmationRef & { snapshot: MonthSnapshot; note: string | null; resent: boolean }
): Promise<void> {
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee || employee.userId === (await actorUserId(context))) return;

		const summary = summarizeSnapshot(notice.snapshot);
		const label: LocalizedText = {
			hu: formatMonthLabel(notice.year, notice.month, 'hu'),
			en: formatMonthLabel(notice.year, notice.month, 'en')
		};
		const recorded: LocalizedText =
			summary.dayCount === 0
				? { hu: 'nincs rögzített szabadságod', en: 'no leave is recorded for you' }
				: {
						hu: `${summary.dayCount} nap rögzítve (${byTypeText(summary.byType, 'hu')})`,
						en: `${summary.dayCount} ${summary.dayCount === 1 ? 'day' : 'days'} recorded (${byTypeText(summary.byType, 'en')})`
					};

		await sendInApp(context, {
			userIds: [employee.userId],
			title: notice.resent
				? { hu: 'Frissített havi szabadság-összesítő', en: 'Updated monthly leave summary' }
				: { hu: 'Ellenőrizd a havi szabadságaidat', en: 'Please check your monthly leave' },
			message: {
				hu: `${label.hu}: ${recorded.hu}. Az irányítópulton elfogadhatod, vagy jelezheted, ha valami nem stimmel.${notice.note ? ` HR: ${notice.note}` : ''}`,
				en: `${label.en}: ${recorded.en}. Accept it on the dashboard, or report if something is wrong.${notice.note ? ` HR: ${notice.note}` : ''}`
			},
			type: 'info',
			data: { monthConfirmationId: notice.id, organizationId: notice.organizationId }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);

		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.monthConfirmationRequested',
			template: 'leave_month_confirmation_request',
			recipients: [employee],
			buildData: (recipient) => {
				const locale = recipient.locale;
				const lines =
					summary.dayCount === 0
						? [locale === 'hu' ? 'Erre a hónapra nincs rögzített szabadságod.' : 'No leave is recorded for you this month.']
						: [
								...summary.periods.map((p) => periodLine(p, locale)),
								locale === 'hu'
									? `Összesen ${daysText(summary.dayCount, locale)}: ${byTypeText(summary.byType, locale)}`
									: `Total ${daysText(summary.dayCount, locale)}: ${byTypeText(summary.byType, locale)}`
							];
				const pendingLabel = locale === 'hu' ? 'Függő kérelmek (még nincsenek benne)' : 'Pending requests (not included yet)';
				const pendingValue = summary.pendingPeriods.map((p) => periodLine(p, locale)).join('; ');
				const noteLabel = locale === 'hu' ? 'A HR megjegyzése' : 'Note from HR';
				const updateNotice = notice.resent
					? locale === 'hu'
						? 'Ez a korábbi összesítő frissített változata, a régit nem kell figyelembe venned.'
						: 'This is an updated version of the earlier summary; you can ignore the previous one.'
					: '';
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					periodLabel: label[locale],
					dayCount: summary.dayCount,
					itemsHtml: itemsHtml(lines),
					itemsText: itemsText(lines),
					pendingHtml: pendingValue ? noteBlockHtml(pendingLabel, pendingValue) : '',
					pendingText: pendingValue ? `\n${pendingLabel}: ${pendingValue}\n` : '',
					noteHtml: notice.note ? noteBlockHtml(noteLabel, notice.note) : '',
					noteText: notice.note ? `\n${noteLabel}: ${notice.note}\n` : '',
					updateNoticeHtml: escapeHtml(updateNotice),
					updateNoticeText: updateNotice
				};
			}
		});
	} catch (err) {
		console.error('[Work] Havi szabadság-összesítő értesítés sikertelen:', err);
	}
}

// ---------------------------------------------------------------------------
// Eltérés
// ---------------------------------------------------------------------------

/**
 * A dolgozó eltérést jelzett: értesítés a kiküldőnek és a kijelölt
 * értesítendőknek (K7).
 */
export async function notifyMonthConfirmationDisputed(
	context: RemoteContext,
	notice: ConfirmationRef & {
		snapshot: MonthSnapshot;
		items: DisputeItem[];
		note: string | null;
		sentBy: number | null;
	}
): Promise<void> {
	try {
		const settings = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
			notifiersSettingsKey(notice.organizationId)
		]);
		const stored = settings.rows[0]?.value;
		const notifierEmployeeIds = Array.isArray(stored)
			? stored.map(Number).filter((id) => Number.isInteger(id) && id > 0)
			: [];

		const recipientResult = await context.db.query(
			`SELECT DISTINCT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
			   FROM auth.users u
			  WHERE u.id = $1
			     OR u.id IN (SELECT e.user_id FROM ${SCHEMA}.employees e
			                  WHERE e.id = ANY($2::int[]) AND e.organization_id = $3 AND e.status = 'active' AND e.is_external = FALSE)`,
			[notice.sentBy ?? 0, notifierEmployeeIds, notice.organizationId]
		);
		const actor = await actorUserId(context);
		const recipients: Recipient[] = recipientResult.rows.map(toRecipient).filter((r: Recipient) => r.userId !== actor);
		if (recipients.length === 0) return;

		const employee = await loadEmployee(context, notice.employeeId);
		const name = employee?.name ?? '—';
		const label: LocalizedText = {
			hu: formatMonthLabel(notice.year, notice.month, 'hu'),
			en: formatMonthLabel(notice.year, notice.month, 'en')
		};
		const lines = (locale: Locale) => notice.items.map((item) => disputeLine(item, notice.snapshot, locale));
		const brief = (locale: Locale) =>
			[
				locale === 'hu' ? `${notice.items.length} tétel` : `${notice.items.length} item(s)`,
				notice.note ? `„${notice.note}”` : ''
			]
				.filter(Boolean)
				.join(' · ');

		await sendInApp(context, {
			userIds: recipients.map((r) => r.userId),
			title: { hu: 'Eltérés a havi szabadság-összesítőben', en: 'Discrepancy in a monthly leave summary' },
			message: { hu: `${name}, ${label.hu}: ${brief('hu')}`, en: `${name}, ${label.en}: ${brief('en')}` },
			type: 'warning',
			data: {
				monthConfirmationId: notice.id,
				employeeId: notice.employeeId,
				organizationId: notice.organizationId
			}
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.monthConfirmationDisputed',
			template: 'leave_month_confirmation_disputed',
			recipients,
			buildData: (recipient) => {
				const locale = recipient.locale;
				const emailLines = notice.items.length
					? lines(locale)
					: [locale === 'hu' ? 'Tételt nem jelölt meg, lásd a megjegyzést.' : 'No items marked, see the note.'];
				const noteLabel = locale === 'hu' ? 'A dolgozó megjegyzése' : "Employee's note";
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					employeeName: name,
					employeeNameHtml: escapeHtml(name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					periodLabel: label[locale],
					itemsHtml: itemsHtml(emailLines),
					itemsText: itemsText(emailLines),
					noteHtml: notice.note ? noteBlockHtml(noteLabel, notice.note) : '',
					noteText: notice.note ? `\n${noteLabel}: ${notice.note}\n` : ''
				};
			}
		});
	} catch (err) {
		console.error('[Work] Havi összesítő eltérés értesítés sikertelen:', err);
	}
}

// ---------------------------------------------------------------------------
// Lezárás elfogadás nélkül
// ---------------------------------------------------------------------------

/** A HR a dolgozó elfogadása nélkül lezárta az ellenőrzést (K8). */
export async function notifyMonthConfirmationClosed(
	context: RemoteContext,
	notice: ConfirmationRef & { note: string }
): Promise<void> {
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee || employee.userId === (await actorUserId(context))) return;

		const label: LocalizedText = {
			hu: formatMonthLabel(notice.year, notice.month, 'hu'),
			en: formatMonthLabel(notice.year, notice.month, 'en')
		};
		await sendInApp(context, {
			userIds: [employee.userId],
			title: { hu: 'A HR lezárta a havi szabadság-ellenőrzést', en: 'HR closed the monthly leave check' },
			message: { hu: `${label.hu}: ${notice.note}`, en: `${label.en}: ${notice.note}` },
			type: 'info',
			data: { monthConfirmationId: notice.id, organizationId: notice.organizationId }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.monthConfirmationClosed',
			template: 'leave_month_confirmation_closed',
			recipients: [employee],
			buildData: (recipient) => {
				const noteLabel = recipient.locale === 'hu' ? 'Indoklás' : 'Reason';
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					periodLabel: label[recipient.locale],
					noteHtml: noteBlockHtml(noteLabel, notice.note),
					noteText: `${noteLabel}: ${notice.note}`
				};
			}
		});
	} catch (err) {
		console.error('[Work] Havi ellenőrzés lezárás értesítés sikertelen:', err);
	}
}
