/**
 * Havi szabadság-ellenőrzés — kiküldés, a dolgozó válasza és a HR kezelése
 * (specs/leave-month-confirmation.md).
 *
 * A HR (`leave.approve`) a hónapra kiküldi a dolgozóknak a jóváhagyott napjaik
 * pillanatképét. A dolgozó elfogadja vagy tételesen eltérést jelez; a HR javít
 * és újraküld, vagy elfogadás nélkül lezár. A pillanatkép ujjlenyomatából
 * látszik, ha a hónap napjai a kiküldés óta változtak.
 *
 * A tiszta rész (összegzés, ellenőrzés): leave-month-confirmation-utils.ts.
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { requireCapability } from './permissions.js';
import { SCHEMA, requireId, requireOrganizationId } from './trip-access.js';
import { todayInBudapest } from './dates.js';
import { getWorkCalendarOverrides } from './work-calendar.js';
import { listWorkingDays } from './leave-day-utils.js';
import { loadClosedYear } from './leave-closing.js';
import {
	buildMonthSnapshot,
	isMonthClosable,
	monthBounds,
	monthSendBlocker,
	parseDisputeItems,
	parseYearMonth,
	planSendAction,
	snapshotFingerprint,
	trimConfirmationNote
} from './leave-month-confirmation-utils.js';
import type {
	DisputeItem,
	MonthConfirmationStatus,
	MonthSnapshot,
	SendAction,
	SnapshotDay
} from './leave-month-confirmation-utils.js';
import {
	notifyMonthConfirmationClosed,
	notifyMonthConfirmationDisputed,
	notifyMonthConfirmationRequested
} from './leave-month-confirmation-notifications.js';

/** Lekérdezés-képes kapcsolat: a pool vagy egy tranzakció kliense. */
interface Queryable {
	query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

// ---------------------------------------------------------------------------
// Típusok
// ---------------------------------------------------------------------------

export interface MonthConfirmation {
	id: number;
	employeeId: number;
	year: number;
	/** 1–12 */
	month: number;
	status: MonthConfirmationStatus;
	snapshot: MonthSnapshot;
	/** A hónap napjai a kiküldés óta változtak (D5). */
	stale: boolean;
	hrNote: string | null;
	sentAt: string;
	sentByName: string | null;
	respondedAt: string | null;
	disputeItems: DisputeItem[];
	employeeNote: string | null;
	resolvedAt: string | null;
	resolvedByName: string | null;
	resolutionNote: string | null;
}

export interface MonthConfirmationRow {
	employeeId: number;
	employeeName: string;
	/** Címzett lehet-e: aktív, és nem a hónap után lépett be (D2). */
	eligible: boolean;
	/** A mostani jóváhagyott napok száma a hónapban. */
	dayCount: number;
	pendingDayCount: number;
	confirmation: MonthConfirmation | null;
	/** Mit tenne vele a kiküldés gomb (D6). */
	action: SendAction;
}

export interface MonthConfirmationOverview {
	year: number;
	month: number;
	/** Miért nem küldhető ki (D3), vagy null. */
	blocker: 'future' | 'closed' | null;
	/** Hány címzettnek van függő kérelme a hónapban (D7). */
	pendingEmployeeCount: number;
	counts: {
		accepted: number;
		pending: number;
		disputed: number;
		closed: number;
		stale: number;
		notSent: number;
		toSend: number;
		toResend: number;
	};
	/** D10: minden címzett elfogadta vagy le van zárva, és semmi nem változott. */
	closable: boolean;
	rows: MonthConfirmationRow[];
}

export interface MonthConfirmationSendResult {
	sent: number;
	resent: number;
	skipped: number;
}

// ---------------------------------------------------------------------------
// Adatok
// ---------------------------------------------------------------------------

interface EmployeeMonth {
	employeeId: number;
	employeeName: string;
	eligible: boolean;
	days: SnapshotDay[];
	pending: SnapshotDay[];
}

interface MonthData {
	from: string;
	to: string;
	workingDays: string[];
	employees: EmployeeMonth[];
}

/**
 * A hónap napjai dolgozónként: a jóváhagyott napok és a függő kérelmek munkanapjai.
 *
 * @param db - Kapcsolat (a kiküldésnél a tranzakció kliense).
 * @param employeeId - Csak ez a dolgozó; null: a szervezet minden dolgozója.
 */
async function loadMonthData(
	db: Queryable,
	context: RemoteContext,
	organizationId: number,
	year: number,
	month: number,
	employeeId: number | null
): Promise<MonthData> {
	const { from, to } = monthBounds(year, month);
	const filter = employeeId ? 'AND e.id = $4' : '';
	const params: unknown[] = employeeId ? [organizationId, from, to, employeeId] : [organizationId, from, to];

	// Egymás után: a kiküldésnél a `db` egy tranzakció kliense, azon nem futhat egyszerre több lekérdezés
	const employeesResult = await db.query(
		`SELECT e.id, u.full_name,
		        (e.status = 'active' AND NOT (COALESCE(e.hire_date_confirmed, FALSE) AND e.hire_date > $2::date)) AS eligible
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.organization_id = $1 ${employeeId ? 'AND e.id = $3' : ''}
		  ORDER BY u.full_name, e.id`,
		employeeId ? [organizationId, to, employeeId] : [organizationId, to]
	);
	const daysResult = await db.query(
		`SELECT ld.employee_id, to_char(ld.day, 'YYYY-MM-DD') AS day, ld.leave_type
		   FROM ${SCHEMA}.leave_days ld
		   JOIN ${SCHEMA}.employees e ON e.id = ld.employee_id
		  WHERE e.organization_id = $1 AND ld.day >= $2::date AND ld.day <= $3::date ${filter}
		  ORDER BY ld.day`,
		params
	);
	const pendingResult = await db.query(
		`SELECT lr.employee_id, lr.leave_type,
		        to_char(lr.start_date, 'YYYY-MM-DD') AS start_date,
		        to_char(lr.end_date, 'YYYY-MM-DD') AS end_date
		   FROM ${SCHEMA}.leave_requests lr
		   JOIN ${SCHEMA}.employees e ON e.id = lr.employee_id
		  WHERE e.organization_id = $1 AND lr.status = 'pending'
		    AND lr.start_date <= $3::date AND lr.end_date >= $2::date ${filter}`,
		params
	);
	const overrides = await getWorkCalendarOverrides(context, organizationId, from, to);

	const byEmployee = new Map<number, EmployeeMonth>();
	for (const row of employeesResult.rows) {
		byEmployee.set(row.id, {
			employeeId: row.id,
			employeeName: row.full_name ?? '—',
			eligible: row.eligible === true,
			days: [],
			pending: []
		});
	}
	for (const row of daysResult.rows) {
		byEmployee.get(row.employee_id)?.days.push({ day: row.day, leaveType: row.leave_type });
	}
	for (const row of pendingResult.rows) {
		const start = row.start_date < from ? from : row.start_date;
		const end = row.end_date > to ? to : row.end_date;
		for (const day of listWorkingDays(start, end, overrides)) {
			byEmployee.get(row.employee_id)?.pending.push({ day, leaveType: row.leave_type });
		}
	}

	return { from, to, workingDays: listWorkingDays(from, to, overrides), employees: [...byEmployee.values()] };
}

const CONFIRMATION_SELECT = `
	SELECT c.id, c.employee_id, c.organization_id, c.year, c.month, c.status, c.snapshot, c.fingerprint,
	       c.hr_note, c.sent_by, c.sent_at, c.responded_at, c.dispute_items, c.employee_note,
	       c.resolved_at, c.resolution_note,
	       su.full_name AS sent_by_name, ru.full_name AS resolved_by_name, e.user_id AS employee_user_id
	  FROM ${SCHEMA}.leave_month_confirmations c
	  JOIN ${SCHEMA}.employees e ON e.id = c.employee_id
	  LEFT JOIN auth.users su ON su.id = c.sent_by
	  LEFT JOIN auth.users ru ON ru.id = c.resolved_by`;

function mapConfirmation(row: any, currentFingerprint: string | null): MonthConfirmation {
	return {
		id: row.id,
		employeeId: row.employee_id,
		year: row.year,
		month: row.month,
		status: row.status,
		snapshot: row.snapshot,
		stale: currentFingerprint !== null && currentFingerprint !== row.fingerprint,
		hrNote: row.hr_note ?? null,
		sentAt: row.sent_at,
		sentByName: row.sent_by_name ?? null,
		respondedAt: row.responded_at ?? null,
		disputeItems: row.dispute_items ?? [],
		employeeNote: row.employee_note ?? null,
		resolvedAt: row.resolved_at ?? null,
		resolvedByName: row.resolved_by_name ?? null,
		resolutionNote: row.resolution_note ?? null
	};
}

function parseEmployeeFilter(value: unknown): number | null {
	return value === undefined || value === null || value === '' ? null : requireId(value, 'dolgozó azonosító');
}

function blockerMessage(blocker: 'future' | 'closed'): string {
	return blocker === 'future'
		? 'Jövőbeli hónapra még nem küldhető ellenőrzés.'
		: 'Lezárt évre nem küldhető ellenőrzés, ott az eltérés már nem javítható.';
}

/** Egy hónap ellenőrzéseinek egyszerre egy kiküldése vagy kezelése fusson. */
async function lockMonth(db: Queryable, organizationId: number, year: number, month: number): Promise<void> {
	await db.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [organizationId, year * 100 + month]);
}

async function insertConfirmation(
	db: Queryable,
	params: {
		organizationId: number;
		employeeId: number;
		year: number;
		month: number;
		snapshot: MonthSnapshot;
		note: string | null;
		userId: number;
		previousId: number | null;
	}
): Promise<number> {
	const r = await db.query(
		`INSERT INTO ${SCHEMA}.leave_month_confirmations
			(organization_id, employee_id, year, month, status, snapshot, fingerprint, hr_note, sent_by, previous_id)
		 VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, $7, $8, $9)
		 RETURNING id`,
		[
			params.organizationId,
			params.employeeId,
			params.year,
			params.month,
			JSON.stringify(params.snapshot),
			snapshotFingerprint(params.snapshot.days),
			params.note,
			params.userId,
			params.previousId
		]
	);
	return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// A HR nézete
// ---------------------------------------------------------------------------

/**
 * A hónap ellenőrzéseinek állapota dolgozónként (K1–K3).
 */
export async function getMonthConfirmations(
	params: { organizationId: number; year: number; month: number; employeeId?: number | null },
	context: RemoteContext
): Promise<MonthConfirmationOverview> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const { year, month } = parseYearMonth(params.year, params.month);
	const employeeId = parseEmployeeFilter(params.employeeId);
	await requireCapability(context, organizationId, 'leave.approve');

	const [data, current, closedYear] = await Promise.all([
		loadMonthData(context.db, context, organizationId, year, month, employeeId),
		context.db.query(
			`${CONFIRMATION_SELECT}
			  WHERE c.organization_id = $1 AND c.year = $2 AND c.month = $3 AND c.status <> 'superseded'
			    AND ($4::int IS NULL OR c.employee_id = $4::int)`,
			[organizationId, year, month, employeeId]
		),
		loadClosedYear(context.db, organizationId)
	]);
	const byEmployee = new Map(current.rows.map((row: any) => [row.employee_id as number, row]));

	const rows: MonthConfirmationRow[] = [];
	for (const emp of data.employees) {
		const row = byEmployee.get(emp.employeeId);
		if (!emp.eligible && !row) continue;
		const fingerprint = snapshotFingerprint(emp.days);
		const confirmation = row ? mapConfirmation(row, fingerprint) : null;
		const approvedDays = new Set(emp.days.map((d) => d.day));
		rows.push({
			employeeId: emp.employeeId,
			employeeName: emp.employeeName,
			eligible: emp.eligible,
			dayCount: emp.days.length,
			pendingDayCount: new Set(emp.pending.map((d) => d.day).filter((d) => !approvedDays.has(d))).size,
			confirmation,
			action: emp.eligible ? planSendAction(row ?? null, fingerprint) : 'none'
		});
	}

	const counts = { accepted: 0, pending: 0, disputed: 0, closed: 0, stale: 0, notSent: 0, toSend: 0, toResend: 0 };
	for (const r of rows) {
		const status = r.confirmation?.status;
		if (status === 'accepted' || status === 'pending' || status === 'disputed' || status === 'closed') {
			counts[status]++;
		} else {
			counts.notSent++;
		}
		if (r.confirmation?.stale) counts.stale++;
		if (r.action === 'send') counts.toSend++;
		if (r.action === 'resend') counts.toResend++;
	}

	return {
		year,
		month,
		blocker: monthSendBlocker(year, month, todayInBudapest(), closedYear),
		pendingEmployeeCount: rows.filter((r) => r.eligible && r.pendingDayCount > 0).length,
		counts,
		closable: isMonthClosable(
			rows.map((r) => ({ status: r.confirmation?.status ?? null, stale: r.confirmation?.stale ?? false }))
		),
		rows
	};
}

/**
 * Az ellenőrzés kiküldése a hónapra (D6): új tétel, akinek nincs, és újraküldés,
 * akinél az adat változott. Egy tranzakcióban; utána értesítések.
 */
export async function sendMonthConfirmations(
	params: { organizationId: number; year: number; month: number; employeeId?: number | null; note?: string | null },
	context: RemoteContext
): Promise<MonthConfirmationSendResult> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const { year, month } = parseYearMonth(params.year, params.month);
	const employeeId = parseEmployeeFilter(params.employeeId);
	const note = trimConfirmationNote(params.note);
	await requireCapability(context, organizationId, 'leave.approve');

	const blocker = monthSendBlocker(year, month, todayInBudapest(), await loadClosedYear(context.db, organizationId));
	if (blocker) throw new Error(blockerMessage(blocker));
	const userId = await resolveUserId(context);

	const notices: Parameters<typeof notifyMonthConfirmationRequested>[1][] = [];
	const result: MonthConfirmationSendResult = { sent: 0, resent: 0, skipped: 0 };

	const client = await context.db.connect();
	try {
		await client.query('BEGIN');
		await lockMonth(client, organizationId, year, month);

		const data = await loadMonthData(client, context, organizationId, year, month, employeeId);
		const recipients = data.employees.filter((e) => e.eligible);
		if (employeeId && recipients.length === 0) {
			throw new Error('A kiválasztott dolgozónak nem küldhető ellenőrzés: nem aktív, vagy a hónap után lépett be.');
		}
		const current = await client.query(
			`SELECT id, employee_id, status, fingerprint
			   FROM ${SCHEMA}.leave_month_confirmations
			  WHERE organization_id = $1 AND year = $2 AND month = $3 AND status <> 'superseded'
			  FOR UPDATE`,
			[organizationId, year, month]
		);
		const byEmployee = new Map(current.rows.map((row: any) => [row.employee_id as number, row]));

		for (const emp of recipients) {
			const existing = byEmployee.get(emp.employeeId) ?? null;
			const action = planSendAction(existing, snapshotFingerprint(emp.days));
			if (action === 'none') {
				result.skipped++;
				continue;
			}
			if (existing) {
				await client.query(
					`UPDATE ${SCHEMA}.leave_month_confirmations SET status = 'superseded' WHERE id = $1`,
					[existing.id]
				);
			}
			const snapshot = buildMonthSnapshot({
				from: data.from,
				to: data.to,
				workingDays: data.workingDays,
				days: emp.days,
				pending: emp.pending
			});
			const id = await insertConfirmation(client, {
				organizationId,
				employeeId: emp.employeeId,
				year,
				month,
				snapshot,
				note,
				userId,
				previousId: existing?.id ?? null
			});
			notices.push({ id, employeeId: emp.employeeId, organizationId, year, month, snapshot, note, resent: !!existing });
			if (existing) result.resent++;
			else result.sent++;
		}
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	for (const notice of notices) {
		await notifyMonthConfirmationRequested(context, notice);
	}
	return result;
}

/**
 * Az eltérés vagy a válaszra váró tétel kezelése (D9):
 *  - `resend`: új változat a mostani adatokkal (eltérést jelzett tételnél);
 *    ha a napok nem változtak, kötelező a válasz a dolgozónak;
 *  - `close`: lezárás a dolgozó elfogadása nélkül, kötelező indoklással.
 */
export async function resolveMonthConfirmation(
	params: { id: number; action: 'resend' | 'close'; note?: string | null },
	context: RemoteContext
): Promise<{ id: number }> {
	const id = requireId(params?.id);
	if (params.action !== 'resend' && params.action !== 'close') throw new Error('Érvénytelen művelet.');
	const note = trimConfirmationNote(params.note);

	const loaded = await context.db.query(
		`SELECT organization_id, employee_id, year, month FROM ${SCHEMA}.leave_month_confirmations WHERE id = $1`,
		[id]
	);
	if (loaded.rows.length === 0) throw new Error('Nem található az ellenőrzés.');
	const { organization_id: organizationId, employee_id: employeeId, year, month } = loaded.rows[0];
	await requireCapability(context, organizationId, 'leave.approve');
	const userId = await resolveUserId(context);

	if (params.action === 'close') {
		if (!note) throw new Error('Írd meg az indoklást: a dolgozó ezt kapja meg.');
		const closed = await context.db.query(
			`UPDATE ${SCHEMA}.leave_month_confirmations
			    SET status = 'closed', resolved_by = $2, resolved_at = NOW(), resolution_note = $3
			  WHERE id = $1 AND status IN ('pending', 'disputed')
			  RETURNING id`,
			[id, userId, note]
		);
		if (closed.rows.length === 0) throw new Error('Csak válaszra váró vagy eltérést jelzett tétel zárható le.');
		await notifyMonthConfirmationClosed(context, { id, employeeId, organizationId, year, month, note });
		return { id };
	}

	const blocker = monthSendBlocker(year, month, todayInBudapest(), await loadClosedYear(context.db, organizationId));
	if (blocker) throw new Error(blockerMessage(blocker));

	let notice: Parameters<typeof notifyMonthConfirmationRequested>[1] | null = null;
	const client = await context.db.connect();
	try {
		await client.query('BEGIN');
		await lockMonth(client, organizationId, year, month);
		const row = (
			await client.query(
				`SELECT status, fingerprint FROM ${SCHEMA}.leave_month_confirmations WHERE id = $1 FOR UPDATE`,
				[id]
			)
		).rows[0];
		if (row?.status !== 'disputed') throw new Error('Csak eltérést jelzett tétel küldhető újra egyenként.');

		const data = await loadMonthData(client, context, organizationId, year, month, employeeId);
		const emp = data.employees[0];
		if (!emp?.eligible) {
			throw new Error('A dolgozó már nem aktív, neki nem küldhető újra. Zárd le elfogadás nélkül.');
		}
		const snapshot = buildMonthSnapshot({
			from: data.from,
			to: data.to,
			workingDays: data.workingDays,
			days: emp.days,
			pending: emp.pending
		});
		if (snapshotFingerprint(snapshot.days) === row.fingerprint && !note) {
			throw new Error(
				'A hónap napjai nem változtak. Javítsd a naptárban, vagy írd meg a dolgozónak, miért helyes a rögzítés.'
			);
		}
		await client.query(
			`UPDATE ${SCHEMA}.leave_month_confirmations
			    SET status = 'superseded', resolved_by = $2, resolved_at = NOW(), resolution_note = $3
			  WHERE id = $1`,
			[id, userId, note]
		);
		const newId = await insertConfirmation(client, {
			organizationId,
			employeeId,
			year,
			month,
			snapshot,
			note,
			userId,
			previousId: id
		});
		notice = { id: newId, employeeId, organizationId, year, month, snapshot, note, resent: true };
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	if (!notice) throw new Error('Az újraküldés nem sikerült.');
	await notifyMonthConfirmationRequested(context, notice);
	return { id: notice.id };
}

// ---------------------------------------------------------------------------
// A dolgozó
// ---------------------------------------------------------------------------

/** A tétel mostani ujjlenyomata a dolgozó napjaiból. */
async function currentFingerprint(
	db: Queryable,
	employeeId: number,
	year: number,
	month: number
): Promise<string> {
	const { from, to } = monthBounds(year, month);
	const r = await db.query(
		`SELECT to_char(day, 'YYYY-MM-DD') AS day, leave_type
		   FROM ${SCHEMA}.leave_days
		  WHERE employee_id = $1 AND day >= $2::date AND day <= $3::date`,
		[employeeId, from, to]
	);
	return snapshotFingerprint(r.rows.map((row: any) => ({ day: row.day, leaveType: row.leave_type })));
}

/**
 * A hívó válaszra váró és eltérést jelzett tételei az irányítópulthoz (K5).
 */
export async function getMyMonthConfirmations(
	params: { organizationId: number },
	context: RemoteContext
): Promise<MonthConfirmation[]> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const userId = await resolveUserId(context);
	const employee = await context.db.query(
		`SELECT id FROM ${SCHEMA}.employees WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
		[userId, organizationId]
	);
	const employeeId: number | undefined = employee.rows[0]?.id;
	if (!employeeId) return [];

	const r = await context.db.query(
		`${CONFIRMATION_SELECT}
		  WHERE c.employee_id = $1 AND c.status IN ('pending', 'disputed')
		  ORDER BY c.year, c.month`,
		[employeeId]
	);
	const result: MonthConfirmation[] = [];
	for (const row of r.rows) {
		result.push(mapConfirmation(row, await currentFingerprint(context.db, employeeId, row.year, row.month)));
	}
	return result;
}

/**
 * A dolgozó válasza: elfogadás vagy eltérés (D4, D5, D8). Csak a saját
 * tételére, és csak amíg a hónap napjai a kiküldés óta nem változtak.
 */
export async function respondMonthConfirmation(
	params: { id: number; decision: 'accept' | 'dispute'; items?: DisputeItem[]; note?: string | null },
	context: RemoteContext
): Promise<MonthConfirmation> {
	const id = requireId(params?.id);
	if (params.decision !== 'accept' && params.decision !== 'dispute') throw new Error('Érvénytelen válasz.');

	const loaded = await context.db.query(`${CONFIRMATION_SELECT} WHERE c.id = $1`, [id]);
	const row = loaded.rows[0];
	if (!row) throw new Error('Nem található az ellenőrzés.');
	const userId = await resolveUserId(context);
	if (Number(row.employee_user_id) !== userId) {
		throw new Error('Csak a saját havi összesítődre válaszolhatsz.');
	}
	if (row.status !== 'pending') {
		throw new Error('Erre az összesítőre már válaszoltál, vagy a HR időközben lezárta.');
	}
	if ((await currentFingerprint(context.db, row.employee_id, row.year, row.month)) !== row.fingerprint) {
		throw new Error(
			'A HR a kiküldés óta módosította a hónap szabadságait. Frissített összesítőt fogsz kapni, addig nincs teendőd.'
		);
	}

	if (params.decision === 'accept') {
		const accepted = await context.db.query(
			`UPDATE ${SCHEMA}.leave_month_confirmations
			    SET status = 'accepted', responded_by = $2, responded_at = NOW()
			  WHERE id = $1 AND status = 'pending'
			  RETURNING id`,
			[id, userId]
		);
		if (accepted.rows.length === 0) throw new Error('Erre az összesítőre már válaszoltál.');
	} else {
		const { items, note } = parseDisputeItems(params.items, params.note, row.snapshot);
		const disputed = await context.db.query(
			`UPDATE ${SCHEMA}.leave_month_confirmations
			    SET status = 'disputed', responded_by = $2, responded_at = NOW(),
			        dispute_items = $3::jsonb, employee_note = $4
			  WHERE id = $1 AND status = 'pending'
			  RETURNING id`,
			[id, userId, JSON.stringify(items), note]
		);
		if (disputed.rows.length === 0) throw new Error('Erre az összesítőre már válaszoltál.');
		await notifyMonthConfirmationDisputed(context, {
			id,
			employeeId: row.employee_id,
			organizationId: row.organization_id,
			year: row.year,
			month: row.month,
			snapshot: row.snapshot,
			items,
			note,
			sentBy: row.sent_by ?? null
		});
	}

	const reloaded = await context.db.query(`${CONFIRMATION_SELECT} WHERE c.id = $1`, [id]);
	return mapConfirmation(reloaded.rows[0], row.fingerprint);
}
