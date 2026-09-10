/**
 * Dolgozói adatbejelentések — a dolgozó bejelenti a szabadságkeretét érintő
 * adatai változását, a HR jóváhagyja vagy elutasítja.
 *
 * Bejelenthető: születési dátum; gyerek felvétele, módosítása, törlése;
 * egyéb pótszabadság (egészségkárosodás, föld alatti / ionizáló sugárzásos munka).
 * Jóváhagyáskor a HR mentőfüggvényei futnak (leave-profile.ts), így a
 * validáció és a keretek újraszámolása ugyanaz, mint amikor a HR maga rögzít.
 *
 * Jogosultság: bejelenteni és a saját bejelentéseket látni a dolgozó maga
 * tudja (vagy leave.balance.manage joggal más nevében); elbírálni csak
 * leave.balance.manage joggal lehet. Részletek: specs/leave-entitlement.md
 */

import type { LocalizedText, RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { requireCapability, requireSelfOrCapability } from './permissions.js';
import { parseDay, todayInBudapest } from './dates.js';
import {
	deleteEmployeeChild,
	recalculateEmployeeBalances,
	saveEmployeeChild,
	saveExtraLeave
} from './leave-profile.js';
import type { RecalculatedBalance } from './leave-profile.js';
import {
	notifyLeaveDataRequestCreated,
	notifyLeaveDataRequestDecision
} from './leave-notifications.js';
import { deleteFilesOfRequest, loadFilesFor } from './leave-data-request-files.js';
import type { LeaveDataRequestFile } from './leave-data-request-files.js';

const SCHEMA = 'app__racona_work';

export type LeaveDataRequestKind = 'birth_date' | 'child_add' | 'child_update' | 'child_remove' | 'extra_add';
export type LeaveDataRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
/** A dolgozó csak a törvényi jogcímeket jelentheti be; a céges egyedi pótszabadság a HR dolga. */
export type ReportableExtraKind = 'health_impaired' | 'underground_radiation';

export interface ChildData {
	label: string | null;
	birthDate: string;
	isDisabled: boolean;
	paternityEligible: boolean;
	/** Örökbefogadásnál a határozat véglegessé válásának napja (a régebbi bejelentésekben nincs). */
	adoptionDate?: string | null;
}

export interface LeaveDataRequestPayload {
	/** birth_date */
	birthDate?: string;
	/** child_add, child_update */
	child?: ChildData;
	/** extra_add */
	extra?: { kind: ReportableExtraKind; validFrom: string | null; validTo: string | null };
	/** Módosításnál és törlésnél a beadáskori állapot, hogy a HR lássa, mi változik. */
	previous?: { birthDate?: string | null; child?: ChildData };
}

export interface LeaveDataRequest {
	id: number;
	employeeId: number;
	employeeName: string;
	organizationId: number;
	kind: LeaveDataRequestKind;
	childId: number | null;
	payload: LeaveDataRequestPayload;
	employeeNote: string | null;
	status: LeaveDataRequestStatus;
	decisionNote: string | null;
	decidedByName: string | null;
	decidedAt: string | null;
	createdAt: string;
	/** A csatolt igazolások adatai (tartalom nélkül). */
	files: LeaveDataRequestFile[];
}

const KINDS: ReadonlySet<string> = new Set<LeaveDataRequestKind>([
	'birth_date',
	'child_add',
	'child_update',
	'child_remove',
	'extra_add'
]);
const EXTRA_KINDS: ReadonlySet<string> = new Set<ReportableExtraKind>(['health_impaired', 'underground_radiation']);

/** Ennyi függő bejelentése lehet egy dolgozónak egyszerre. */
const MAX_PENDING_PER_EMPLOYEE = 20;
const MAX_NOTE_LENGTH = 1000;

const REQUEST_SELECT = `
	SELECT r.id, r.employee_id, r.organization_id, r.kind, r.child_id, r.payload, r.employee_note,
	       r.status, r.decision_note, r.decided_at, r.created_at,
	       u.full_name AS employee_name, d.full_name AS decided_by_name
	  FROM ${SCHEMA}.leave_data_requests r
	  JOIN ${SCHEMA}.employees e ON e.id = r.employee_id
	  JOIN auth.users u ON u.id = e.user_id
	  LEFT JOIN auth.users d ON d.id = r.decided_by`;

function mapRequest(row: any): LeaveDataRequest {
	return {
		id: row.id,
		employeeId: row.employee_id,
		employeeName: row.employee_name,
		organizationId: row.organization_id,
		kind: row.kind,
		childId: row.child_id ?? null,
		payload: row.payload ?? {},
		employeeNote: row.employee_note ?? null,
		status: row.status,
		decisionNote: row.decision_note ?? null,
		decidedByName: row.decided_by_name ?? null,
		decidedAt: row.decided_at ?? null,
		createdAt: row.created_at,
		files: []
	};
}

/** A bejelentésekhez hozzáteszi a csatolt igazolások adatait. */
async function withFiles(context: RemoteContext, requests: LeaveDataRequest[]): Promise<LeaveDataRequest[]> {
	const files = await loadFilesFor(context, requests.map((r) => r.id));
	return requests.map((r) => ({ ...r, files: files.get(r.id) ?? [] }));
}

async function loadRequest(context: RemoteContext, id: number): Promise<LeaveDataRequest> {
	const r = await context.db.query(`${REQUEST_SELECT} WHERE r.id = $1`, [id]);
	if (r.rows.length === 0) throw new Error('Nem található az adatbejelentés.');
	return (await withFiles(context, [mapRequest(r.rows[0])]))[0];
}

function trimNote(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_NOTE_LENGTH) : null;
}

function parseChild(value: unknown): ChildData {
	const child = (value ?? {}) as Partial<ChildData>;
	const birthDate = parseDay(child.birthDate, 'A gyerek születési dátuma', true)!;
	if (birthDate > todayInBudapest()) {
		throw new Error('A gyerek születési dátuma nem lehet a jövőben.');
	}
	const adoptionDate = parseDay(child.adoptionDate, 'Az örökbefogadás napja');
	if (adoptionDate && (adoptionDate < birthDate || adoptionDate > todayInBudapest())) {
		throw new Error('Az örökbefogadás napja a születés és a mai nap közé essen.');
	}
	return {
		label: typeof child.label === 'string' && child.label.trim() ? child.label.trim().slice(0, 255) : null,
		birthDate,
		isDisabled: child.isDisabled === true,
		paternityEligible: child.paternityEligible === true,
		adoptionDate
	};
}

async function loadChild(context: RemoteContext, employeeId: number, childId: unknown): Promise<ChildData> {
	const id = Number(childId);
	if (!Number.isInteger(id) || id <= 0) throw new Error('Válaszd ki a gyereket.');
	const r = await context.db.query(
		`SELECT label, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, is_disabled, paternity_eligible,
		        to_char(adoption_date, 'YYYY-MM-DD') AS adoption_date
		   FROM ${SCHEMA}.employee_children WHERE id = $1 AND employee_id = $2`,
		[id, employeeId]
	);
	if (r.rows.length === 0) throw new Error('A gyerek nem található a dolgozó adatai között.');
	const row = r.rows[0];
	return {
		label: row.label ?? null,
		birthDate: row.birth_date,
		isDisabled: row.is_disabled === true,
		paternityEligible: row.paternity_eligible === true,
		adoptionDate: row.adoption_date ?? null
	};
}

function formatDay(day: string | null | undefined, locale: 'hu' | 'en'): string {
	if (!day) return '—';
	const [y, m, d] = day.split('-').map(Number);
	return new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', { timeZone: 'UTC' }).format(
		new Date(Date.UTC(y, m - 1, d))
	);
}

/** Rövid, kétnyelvű leírás az értesítésekhez. */
function summarize(request: Pick<LeaveDataRequest, 'kind' | 'payload'>): LocalizedText {
	const { payload } = request;
	const child = payload.child ?? payload.previous?.child;
	const childName = (locale: 'hu' | 'en') =>
		child?.label ? `${child.label} (${formatDay(child.birthDate, locale)})` : formatDay(child?.birthDate, locale);
	switch (request.kind) {
		case 'birth_date':
			return {
				hu: `Születési dátum: ${formatDay(payload.birthDate, 'hu')}`,
				en: `Birth date: ${formatDay(payload.birthDate, 'en')}`
			};
		case 'child_add':
			return { hu: `Új gyerek: ${childName('hu')}`, en: `New child: ${childName('en')}` };
		case 'child_update':
			return { hu: `Gyerek adatainak módosítása: ${childName('hu')}`, en: `Child details change: ${childName('en')}` };
		case 'child_remove':
			return { hu: `Gyerek törlése: ${childName('hu')}`, en: `Remove child: ${childName('en')}` };
		case 'extra_add':
			return payload.extra?.kind === 'underground_radiation'
				? { hu: 'Pótszabadság: föld alatti / ionizáló sugárzásos munka', en: 'Extra leave: underground / radiation work' }
				: { hu: 'Pótszabadság: egészségkárosodás', en: 'Extra leave: health impairment' };
	}
}

// --- Beadás és visszavonás ---------------------------------------------------

/**
 * Adatváltozás bejelentése. A HR-jogosultak rendszeren belüli értesítést kapnak.
 */
export async function submitLeaveDataRequest(
	params: {
		employeeId: number;
		kind: LeaveDataRequestKind;
		childId?: number | null;
		birthDate?: string;
		child?: ChildData;
		extra?: { kind: ReportableExtraKind; validFrom?: string | null; validTo?: string | null };
		note?: string | null;
	},
	context: RemoteContext
): Promise<LeaveDataRequest> {
	const organizationId = await requireSelfOrCapability(context, params.employeeId, 'leave.balance.manage');
	if (!KINDS.has(params.kind)) throw new Error('Érvénytelen bejelentéstípus.');

	const pending = await context.db.query(
		`SELECT child_id FROM ${SCHEMA}.leave_data_requests WHERE employee_id = $1 AND status = 'pending'`,
		[params.employeeId]
	);
	if (pending.rows.length >= MAX_PENDING_PER_EMPLOYEE) {
		throw new Error('Túl sok függő bejelentésed van. Várd meg, amíg a HR elbírálja őket.');
	}

	let childId: number | null = null;
	const payload: LeaveDataRequestPayload = {};

	switch (params.kind) {
		case 'birth_date': {
			const birthDate = parseDay(params.birthDate, 'Születési dátum', true)!;
			if (birthDate > todayInBudapest() || birthDate < '1900-01-01') {
				throw new Error('Születési dátum: nem lehet a jövőben.');
			}
			const current = await context.db.query(
				`SELECT to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM ${SCHEMA}.employees WHERE id = $1`,
				[params.employeeId]
			);
			payload.birthDate = birthDate;
			payload.previous = { birthDate: current.rows[0]?.birth_date ?? null };
			break;
		}
		case 'child_add':
			payload.child = parseChild(params.child);
			break;
		case 'child_update':
		case 'child_remove': {
			const previous = await loadChild(context, params.employeeId, params.childId);
			childId = Number(params.childId);
			if (pending.rows.some((row: { child_id: number | null }) => row.child_id === childId)) {
				throw new Error('Erre a gyerekre már van függő bejelentés.');
			}
			payload.previous = { child: previous };
			if (params.kind === 'child_update') payload.child = parseChild(params.child);
			break;
		}
		case 'extra_add': {
			const extra = params.extra;
			if (!extra || !EXTRA_KINDS.has(extra.kind)) throw new Error('Érvénytelen pótszabadság-típus.');
			const validFrom = parseDay(extra.validFrom, 'Érvényesség kezdete');
			const validTo = parseDay(extra.validTo, 'Érvényesség vége');
			if (validFrom && validTo && validTo < validFrom) {
				throw new Error('Az érvényesség vége nem lehet korábbi a kezdeténél.');
			}
			payload.extra = { kind: extra.kind, validFrom, validTo };
			break;
		}
	}

	const inserted = await context.db.query(
		`INSERT INTO ${SCHEMA}.leave_data_requests
			(employee_id, organization_id, kind, child_id, payload, employee_note, requested_by)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
		 RETURNING id`,
		[
			params.employeeId,
			organizationId,
			params.kind,
			childId,
			JSON.stringify(payload),
			trimNote(params.note),
			await resolveUserId(context)
		]
	);
	const request = await loadRequest(context, inserted.rows[0].id);

	await notifyLeaveDataRequestCreated(context, {
		id: request.id,
		employeeId: request.employeeId,
		organizationId,
		summary: summarize(request)
	});
	return request;
}

/** Függő bejelentés visszavonása (a dolgozó maga, vagy a HR). */
export async function cancelLeaveDataRequest(
	params: { id: number },
	context: RemoteContext
): Promise<LeaveDataRequest> {
	const request = await loadRequest(context, params.id);
	await requireSelfOrCapability(context, request.employeeId, 'leave.balance.manage');
	const r = await context.db.query(
		`UPDATE ${SCHEMA}.leave_data_requests SET status = 'cancelled'
		  WHERE id = $1 AND status = 'pending' RETURNING id`,
		[params.id]
	);
	if (r.rows.length === 0) throw new Error('Csak függő bejelentés vonható vissza.');
	// A visszavont bejelentés igazolásaira nincs szükség (különleges adat lehet)
	await deleteFilesOfRequest(context, params.id);
	return loadRequest(context, params.id);
}

// --- Listázás ----------------------------------------------------------------

/**
 * Bejelentések listája, a legújabb elöl.
 *  - `employeeId`: egy dolgozó bejelentései (saját, vagy leave.balance.manage);
 *  - különben `organizationId`: a szervezet bejelentései (leave.balance.manage).
 * Alapból csak a függők; `status: 'all'` esetén a lezártak is.
 */
export async function getLeaveDataRequests(
	params: { organizationId?: number; employeeId?: number; status?: 'pending' | 'all' },
	context: RemoteContext
): Promise<LeaveDataRequest[]> {
	const onlyPending = params.status !== 'all';

	if (params.employeeId) {
		await requireSelfOrCapability(context, params.employeeId, 'leave.balance.manage');
		const r = await context.db.query(
			`${REQUEST_SELECT}
			  WHERE r.employee_id = $1 AND ($2::boolean = FALSE OR r.status = 'pending')
			  ORDER BY r.created_at DESC, r.id DESC
			  LIMIT 50`,
			[params.employeeId, onlyPending]
		);
		return withFiles(context, r.rows.map(mapRequest));
	}

	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'leave.balance.manage');
	const r = await context.db.query(
		`${REQUEST_SELECT}
		  WHERE r.organization_id = $1 AND ($2::boolean = FALSE OR r.status = 'pending')
		  ORDER BY r.created_at ${onlyPending ? 'ASC' : 'DESC'}, r.id
		  LIMIT 200`,
		[params.organizationId, onlyPending]
	);
	return withFiles(context, r.rows.map(mapRequest));
}

// --- Elbírálás ---------------------------------------------------------------

/** A jóváhagyott változás rögzítése a HR mentőfüggvényeivel. */
async function applyRequest(
	context: RemoteContext,
	request: LeaveDataRequest
): Promise<RecalculatedBalance[]> {
	const { payload, employeeId } = request;
	switch (request.kind) {
		case 'birth_date':
			await context.db.query(
				`UPDATE ${SCHEMA}.employees SET birth_date = $2, updated_at = NOW() WHERE id = $1`,
				[employeeId, payload.birthDate]
			);
			return recalculateEmployeeBalances(context, employeeId);
		case 'child_add':
			return (await saveEmployeeChild({ employeeId, ...payload.child! }, context)).recalculated;
		case 'child_update':
			if (!request.childId) throw new Error('A gyereket időközben törölték, a módosítás nem alkalmazható.');
			return (await saveEmployeeChild({ employeeId, id: request.childId, ...payload.child! }, context))
				.recalculated;
		case 'child_remove':
			// Ha időközben már törölték, nincs teendő
			if (!request.childId) return recalculateEmployeeBalances(context, employeeId);
			return (await deleteEmployeeChild({ id: request.childId }, context)).recalculated;
		case 'extra_add':
			return (
				await saveExtraLeave(
					{
						employeeId,
						kind: payload.extra!.kind,
						validFrom: payload.extra!.validFrom,
						validTo: payload.extra!.validTo
					},
					context
				)
			).recalculated;
	}
}

/**
 * Jóváhagyás vagy elutasítás. Jóváhagyáskor a változás bekerül a dolgozó
 * adatai közé, és a nyitott keretek újraszámolódnak. Elutasításhoz kötelező
 * az indoklás (a dolgozó ezt kapja meg értesítésben).
 */
export async function decideLeaveDataRequest(
	params: { id: number; decision: 'approve' | 'reject'; decisionNote?: string | null },
	context: RemoteContext
): Promise<{ request: LeaveDataRequest; recalculated: RecalculatedBalance[] }> {
	const request = await loadRequest(context, params.id);
	await requireCapability(context, request.organizationId, 'leave.balance.manage');
	if (params.decision !== 'approve' && params.decision !== 'reject') {
		throw new Error('Érvénytelen döntés.');
	}
	const decisionNote = trimNote(params.decisionNote);
	if (params.decision === 'reject' && !decisionNote) {
		throw new Error('Az elutasításhoz írj indoklást a dolgozónak.');
	}
	const status: LeaveDataRequestStatus = params.decision === 'approve' ? 'approved' : 'rejected';

	// Előbb lefoglaljuk a döntést, hogy két HR-es ne bírálja el kétszer
	const claimed = await context.db.query(
		`UPDATE ${SCHEMA}.leave_data_requests
		    SET status = $2, decision_note = $3, decided_by = $4, decided_at = NOW()
		  WHERE id = $1 AND status = 'pending'
		  RETURNING id`,
		[params.id, status, decisionNote, await resolveUserId(context)]
	);
	if (claimed.rows.length === 0) throw new Error('A bejelentést már elbírálták vagy visszavonták.');

	let recalculated: RecalculatedBalance[] = [];
	if (status === 'rejected') {
		// Elutasításkor az igazolások törlődnek; jóváhagyáskor megmaradnak bizonyítéknak
		await deleteFilesOfRequest(context, params.id);
	}
	if (status === 'approved') {
		try {
			recalculated = await applyRequest(context, request);
		} catch (err) {
			await context.db.query(
				`UPDATE ${SCHEMA}.leave_data_requests
				    SET status = 'pending', decision_note = NULL, decided_by = NULL, decided_at = NULL
				  WHERE id = $1`,
				[params.id]
			);
			throw err;
		}
	}

	await notifyLeaveDataRequestDecision(
		context,
		{
			id: request.id,
			employeeId: request.employeeId,
			organizationId: request.organizationId,
			summary: summarize(request)
		},
		status,
		decisionNote
	);

	return { request: await loadRequest(context, params.id), recalculated };
}
