/**
 * Dolgozói dokumentumok (specs/employee-documents.md).
 *
 * A fájlok a core fájltárolójában vannak (`context.files`, a lemezen), itt
 * csak a hivatkozásuk. Feltöltés: `prepareDocumentUpload` (aláírt link) →
 * a böngésző `sdk.files.upload` → `attachDocumentFile` (claim + mentés).
 * Megnyitás: `getDocumentFileUrl` (rövid életű, a felhasználóhoz kötött link).
 *
 * Hozzáférés: `employee.documents.view` olvas, `employee.documents.manage`
 * kezel; a dolgozó `employee.documents.own` joggal a saját, neki látható
 * típusú, nem archivált dokumentumait olvashatja. Az `employee.view` nem ad
 * hozzáférést. Minden műveletet naplózunk (`employee_document_events`).
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { todayInBudapest, parseDay } from './dates.js';
import {
	loadDocumentSettings,
	loadDocumentType,
	mapDocumentType,
	type DocumentFileMode,
	type DocumentType
} from './document-types.js';
import { hasCapability, requireCapability } from './permissions.js';
import { notifyDocumentReviewed, notifyDocumentSubmitted } from './document-notifications.js';

const SCHEMA = 'app__racona_work';

export const MAX_FILES_PER_DOCUMENT = 5;
export const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = [
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/webp',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.oasis.opendocument.text',
	'application/vnd.oasis.opendocument.spreadsheet'
];

/** Ha a típusnak nincs emlékeztetője, ennyi nappal előtte jelezzük „hamarosan lejár”-ként. */
const DEFAULT_EXPIRING_DAYS = 30;

export type DocumentStatus = 'active' | 'pending' | 'rejected' | 'archived';
export type DocumentExpiryStatus = 'valid' | 'expiring' | 'expired';
export type DocumentEventAction =
	| 'create'
	| 'update'
	| 'file_add'
	| 'file_delete'
	| 'view'
	| 'download'
	| 'delete'
	| 'archive'
	| 'submit'
	| 'approve'
	| 'reject'
	| 'withdraw';

export interface EmployeeDocumentFile {
	id: number;
	documentId: number;
	originalName: string;
	mimeType: string;
	sizeBytes: number;
	createdAt: string;
}

export interface EmployeeDocument {
	id: number;
	employeeId: number;
	typeId: number;
	typeName: string;
	fileMode: DocumentFileMode;
	hasExpiry: boolean;
	title: string;
	issuedOn: string | null;
	validUntil: string | null;
	note: string | null;
	status: DocumentStatus;
	replacedById: number | null;
	createdByName: string | null;
	createdAt: string;
	updatedAt: string;
	files: EmployeeDocumentFile[];
	/** Csak lejárattal rendelkező, aktív dokumentumnál */
	expiryStatus: DocumentExpiryStatus | null;
	daysLeft: number | null;
	/** Kötelező fájlú típus, de nincs fájl */
	fileMissing: boolean;
	/** A HR döntésének indoklása (elutasításnál) */
	reviewNote: string | null;
	reviewedByName: string | null;
	reviewedAt: string | null;
	/** A hívó a saját, még függő beküldését visszavonhatja (és a fájljait kezelheti) */
	canWithdraw: boolean;
}

export interface EmployeeDocumentsView {
	employeeId: number;
	documents: EmployeeDocument[];
	/** Kötelező típusok, amelyekből nincs aktív dokumentum */
	missingRequiredTypes: Array<{ id: number; name: string }>;
	/** A szervezet dokumentumtípusai (az archiváltak is, a meglévő dokumentumok miatt) */
	types: DocumentType[];
	canManage: boolean;
	/**
	 * A dolgozó saját nézete (specs/employee-documents.md, K7, K8): feltölthet-e,
	 * és milyen típusokhoz. Csak a dolgozó magának kapja, a HR nem.
	 */
	selfService: { uploadEnabled: boolean; uploadTypes: Array<{ id: number; name: string }> } | null;
	limits: { maxFilesPerDocument: number; maxFileBytes: number; mimeTypes: string[] };
}

export interface EmployeeDocumentEvent {
	id: number;
	documentId: number | null;
	action: DocumentEventAction;
	actorName: string | null;
	details: Record<string, unknown> | null;
	createdAt: string;
}

// --- Tiszta segédek (tesztelhetők) ---------------------------------------------

/** Napok száma két YYYY-MM-DD között (b − a). */
export function daysBetween(a: string, b: string): number {
	const toUtc = (d: string) => {
		const [y, m, day] = d.split('-').map(Number);
		return Date.UTC(y, m - 1, day);
	};
	return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * A lejárati állapot: lejárt (a lejárat napja már elmúlt), hamarosan lejár
 * (a legkorábbi emlékeztetőn belül), vagy érvényes.
 */
export function computeExpiry(
	validUntil: string | null,
	today: string,
	reminderDays: number[]
): { expiryStatus: DocumentExpiryStatus | null; daysLeft: number | null } {
	if (!validUntil) return { expiryStatus: null, daysLeft: null };
	const daysLeft = daysBetween(today, validUntil);
	const window = reminderDays.length > 0 ? Math.max(...reminderDays) : DEFAULT_EXPIRING_DAYS;
	const expiryStatus = daysLeft < 0 ? 'expired' : daysLeft <= window ? 'expiring' : 'valid';
	return { expiryStatus, daysLeft };
}

/** A core fájltárolás hibakódjai magyar üzenetre. */
export function fileErrorMessage(err: unknown): string | null {
	switch ((err as { code?: string })?.code) {
		case 'FILE_TOO_LARGE':
			return 'A fájl túl nagy, legfeljebb 10 MB lehet.';
		case 'INVALID_MIME':
			return 'Ez a fájltípus nem tölthető fel. Engedett: PDF, JPG, PNG, WEBP, DOCX, XLSX, ODT, ODS.';
		case 'FILE_NOT_FOUND':
			return 'A fájl nem található. Lehet, hogy a feltöltés lejárt, próbáld újra.';
		case 'PERMISSION_DENIED':
			return 'Nincs jogosultságod ehhez a fájlhoz.';
		default:
			return null;
	}
}

function rethrowFileError(err: unknown): never {
	const message = fileErrorMessage(err);
	if (message) throw new Error(message);
	throw err;
}

function requireFiles(context: RemoteContext) {
	if (!context.files) {
		throw new Error('A dokumentumok fájljaihoz frissebb Racona verzió kell (plugin fájltárolás).');
	}
	return context.files;
}

function optionalText(value: unknown, label: string, max: number): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	if (text.length > max) throw new Error(`${label}: legfeljebb ${max} karakter.`);
	return text || null;
}

// --- Hozzáférés ------------------------------------------------------------------

interface EmployeeRef {
	employeeId: number;
	organizationId: number;
	userId: number;
}

async function loadEmployeeRef(context: RemoteContext, employeeId: number): Promise<EmployeeRef> {
	if (!Number.isInteger(employeeId) || employeeId <= 0) throw new Error('Érvénytelen dolgozó azonosító.');
	const r = await context.db.query(
		`SELECT id, organization_id, user_id FROM ${SCHEMA}.employees WHERE id = $1`,
		[employeeId]
	);
	if (r.rows.length === 0) throw new Error('Nem található a dolgozó.');
	return { employeeId: r.rows[0].id, organizationId: r.rows[0].organization_id, userId: r.rows[0].user_id };
}

interface DocumentAccess {
	canManage: boolean;
	canView: boolean;
	/** Csak a saját, látható típusú dokumentumait látja */
	ownOnly: boolean;
	callerUserId: number;
	/** A hívó maga a dolgozó, és van saját-dokumentum joga */
	isOwner: boolean;
}

/** A hívó jogai egy dolgozó dokumentumaihoz. */
async function documentAccess(context: RemoteContext, employee: EmployeeRef): Promise<DocumentAccess> {
	const callerUserId = await resolveUserId(context);
	const isOwner =
		callerUserId === employee.userId &&
		(await hasCapability(context, employee.organizationId, 'employee.documents.own'));
	const canManage = await hasCapability(context, employee.organizationId, 'employee.documents.manage');
	if (canManage) return { canManage: true, canView: true, ownOnly: false, callerUserId, isOwner };
	if (await hasCapability(context, employee.organizationId, 'employee.documents.view')) {
		return { canManage: false, canView: true, ownOnly: false, callerUserId, isOwner };
	}
	return { canManage: false, canView: isOwner, ownOnly: isOwner, callerUserId, isOwner };
}

/** A saját, még függő beküldés: ezt a dolgozó kezelheti (fájlok, visszavonás). */
function isOwnPending(access: DocumentAccess, row: any): boolean {
	return access.isOwner && row.status === 'pending' && Number(row.created_by) === access.callerUserId;
}

/** A saját beküldés, amit a dolgozó törölhet: függő (visszavonás) vagy elutasított. */
function isOwnSubmission(access: DocumentAccess, row: any): boolean {
	return (
		access.isOwner &&
		(row.status === 'pending' || row.status === 'rejected') &&
		Number(row.created_by) === access.callerUserId
	);
}

/** Fájlt csatolhat / törölhet: a HR, vagy a dolgozó a saját függő beküldésénél. */
async function requireFileWrite(context: RemoteContext, employee: EmployeeRef, row: any): Promise<DocumentAccess> {
	const access = await documentAccess(context, employee);
	if (access.canManage || isOwnPending(access, row)) return access;
	throw new Error('Nincs jogosultságod ehhez a művelethez');
}

async function requireManage(context: RemoteContext, employee: EmployeeRef): Promise<void> {
	if (!(await documentAccess(context, employee)).canManage) {
		throw new Error('Nincs jogosultságod ehhez a művelethez');
	}
}

// --- Napló -------------------------------------------------------------------------

type Queryable = Pick<RemoteContext['db'], 'query'>;

async function logEvent(
	db: Queryable,
	event: {
		organizationId: number;
		employeeId: number;
		documentId: number | null;
		action: DocumentEventAction;
		actorUserId: number | null;
		details?: Record<string, unknown>;
	}
): Promise<void> {
	await db.query(
		`INSERT INTO ${SCHEMA}.employee_document_events
		    (organization_id, employee_id, document_id, action, actor_user_id, details)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[
			event.organizationId,
			event.employeeId,
			event.documentId,
			event.action,
			event.actorUserId,
			event.details ? JSON.stringify(event.details) : null
		]
	);
}

// --- Betöltés ------------------------------------------------------------------------

const DOCUMENT_SELECT = `
	SELECT d.id, d.employee_id, d.organization_id, d.type_id, d.title, d.note, d.status,
	       d.replaced_by_id, d.created_at, d.updated_at,
	       to_char(d.issued_on, 'YYYY-MM-DD') AS issued_day,
	       to_char(d.valid_until, 'YYYY-MM-DD') AS valid_day,
	       t.name AS type_name, t.file_mode, t.has_expiry, t.reminder_days, t.sort_order AS type_sort,
	       t.visible_to_employee,
	       d.created_by, d.review_note, d.reviewed_at,
	       u.full_name AS created_by_name,
	       ru.full_name AS reviewed_by_name
	  FROM ${SCHEMA}.employee_documents d
	  JOIN ${SCHEMA}.document_types t ON t.id = d.type_id
	  LEFT JOIN auth.users u ON u.id = d.created_by
	  LEFT JOIN auth.users ru ON ru.id = d.reviewed_by`;

function mapFile(row: any): EmployeeDocumentFile {
	return {
		id: row.id,
		documentId: row.document_id,
		originalName: row.original_name,
		mimeType: row.mime_type,
		sizeBytes: Number(row.size_bytes),
		createdAt: row.created_at
	};
}

function mapDocument(
	row: any,
	files: EmployeeDocumentFile[],
	today: string,
	access?: DocumentAccess
): EmployeeDocument {
	const active = row.status === 'active';
	const expiry = active && row.has_expiry
		? computeExpiry(row.valid_day ?? null, today, (row.reminder_days ?? []).map(Number))
		: { expiryStatus: null, daysLeft: null };
	return {
		id: row.id,
		employeeId: row.employee_id,
		typeId: row.type_id,
		typeName: row.type_name,
		fileMode: row.file_mode,
		hasExpiry: row.has_expiry === true,
		title: row.title,
		issuedOn: row.issued_day ?? null,
		validUntil: row.valid_day ?? null,
		note: row.note ?? null,
		status: row.status,
		replacedById: row.replaced_by_id ?? null,
		createdByName: row.created_by_name ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		files,
		expiryStatus: expiry.expiryStatus,
		daysLeft: expiry.daysLeft,
		fileMissing: active && row.file_mode === 'required' && files.length === 0,
		reviewNote: row.review_note ?? null,
		reviewedByName: row.reviewed_by_name ?? null,
		reviewedAt: row.reviewed_at ?? null,
		canWithdraw: access ? isOwnSubmission(access, row) : false
	};
}

async function loadFiles(context: RemoteContext, documentIds: number[]): Promise<Map<number, EmployeeDocumentFile[]>> {
	const byDocument = new Map<number, EmployeeDocumentFile[]>();
	if (documentIds.length === 0) return byDocument;
	const r = await context.db.query(
		`SELECT id, document_id, original_name, mime_type, size_bytes, created_at
		   FROM ${SCHEMA}.employee_document_files
		  WHERE document_id = ANY($1::int[])
		  ORDER BY created_at, id`,
		[documentIds]
	);
	for (const row of r.rows) {
		if (!byDocument.has(row.document_id)) byDocument.set(row.document_id, []);
		byDocument.get(row.document_id)!.push(mapFile(row));
	}
	return byDocument;
}

async function loadDocumentRow(context: RemoteContext, documentId: number): Promise<any> {
	if (!Number.isInteger(documentId) || documentId <= 0) throw new Error('Érvénytelen dokumentum azonosító.');
	const r = await context.db.query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [documentId]);
	if (r.rows.length === 0) throw new Error('A dokumentum nem található.');
	return r.rows[0];
}

async function loadDocument(
	context: RemoteContext,
	documentId: number,
	access?: DocumentAccess
): Promise<EmployeeDocument> {
	const row = await loadDocumentRow(context, documentId);
	const files = await loadFiles(context, [row.id]);
	return mapDocument(row, files.get(row.id) ?? [], todayInBudapest(), access);
}

/** A dolgozó láthatja-e a saját dokumentumát (own jog). */
function visibleToOwner(row: any): boolean {
	return row.visible_to_employee === true && row.status !== 'archived';
}

// --- Remote függvények: olvasás --------------------------------------------------------

/** Egy dolgozó dokumentumai típus szerint rendezve, a hiányzó kötelező típusokkal. */
export async function listEmployeeDocuments(
	params: { employeeId: number; includeArchived?: boolean },
	context: RemoteContext
): Promise<EmployeeDocumentsView> {
	const employee = await loadEmployeeRef(context, params?.employeeId);
	const access = await documentAccess(context, employee);
	if (!access.canView) throw new Error('Nincs jogosultságod ehhez a művelethez');

	const includeArchived = params.includeArchived === true && !access.ownOnly;
	const r = await context.db.query(
		`${DOCUMENT_SELECT}
		  WHERE d.employee_id = $1 AND ($2::boolean OR d.status <> 'archived')
		  ORDER BY t.sort_order, lower(t.name), d.created_at DESC`,
		[employee.employeeId, includeArchived]
	);
	const rows = access.ownOnly ? r.rows.filter(visibleToOwner) : r.rows;
	const files = await loadFiles(context, rows.map((row: any) => row.id));
	const today = todayInBudapest();

	const missing = await context.db.query(
		`SELECT t.id, t.name
		   FROM ${SCHEMA}.document_types t
		  WHERE t.organization_id = $1 AND t.is_required AND t.archived_at IS NULL
		    AND ($3::boolean IS FALSE OR t.visible_to_employee)
		    AND NOT EXISTS (
		        SELECT 1 FROM ${SCHEMA}.employee_documents d
		         WHERE d.type_id = t.id AND d.employee_id = $2 AND d.status = 'active')
		  ORDER BY t.sort_order, lower(t.name)`,
		[employee.organizationId, employee.employeeId, access.ownOnly]
	);

	const types = await context.db.query(
		`SELECT * FROM ${SCHEMA}.document_types
		  WHERE organization_id = $1 AND ($2::boolean IS FALSE OR visible_to_employee)
		  ORDER BY archived_at IS NOT NULL, sort_order, lower(name)`,
		[employee.organizationId, access.ownOnly]
	);

	return {
		employeeId: employee.employeeId,
		documents: rows.map((row: any) => mapDocument(row, files.get(row.id) ?? [], today, access)),
		missingRequiredTypes: missing.rows.map((row: any) => ({ id: row.id, name: row.name })),
		types: types.rows.map(mapDocumentType),
		canManage: access.canManage,
		selfService: await selfServiceFor(context, employee, access, types.rows.map(mapDocumentType)),
		limits: {
			maxFilesPerDocument: MAX_FILES_PER_DOCUMENT,
			maxFileBytes: MAX_DOCUMENT_FILE_BYTES,
			mimeTypes: DOCUMENT_MIME_TYPES
		}
	};
}

/** A dokumentumok naplója (legfrissebb elöl). */
export async function getEmployeeDocumentEvents(
	params: { employeeId: number; limit?: number },
	context: RemoteContext
): Promise<EmployeeDocumentEvent[]> {
	const employee = await loadEmployeeRef(context, params?.employeeId);
	await requireManage(context, employee);
	const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500);
	const r = await context.db.query(
		`SELECT e.id, e.document_id, e.action, e.details, e.created_at, u.full_name AS actor_name
		   FROM ${SCHEMA}.employee_document_events e
		   LEFT JOIN auth.users u ON u.id = e.actor_user_id
		  WHERE e.employee_id = $1
		  ORDER BY e.created_at DESC, e.id DESC
		  LIMIT $2`,
		[employee.employeeId, limit]
	);
	return r.rows.map((row: any) => ({
		id: Number(row.id),
		documentId: row.document_id ?? null,
		action: row.action,
		actorName: row.actor_name ?? null,
		details: row.details ?? null,
		createdAt: row.created_at
	}));
}

// --- Remote függvények: írás --------------------------------------------------------------

export interface SaveEmployeeDocumentInput {
	id?: number;
	employeeId: number;
	typeId: number;
	title?: string;
	issuedOn?: string | null;
	validUntil?: string | null;
	note?: string | null;
	/** Új verzió: ennek a dokumentumnak a helyére lép (a régi archivált lesz) */
	replacesId?: number;
}

/**
 * Dokumentum felvétele, módosítása, vagy új verzió egy meglévő helyére.
 * A fájlok külön mennek (`prepareDocumentUpload` + `attachDocumentFile`).
 */
export async function saveEmployeeDocument(
	params: SaveEmployeeDocumentInput,
	context: RemoteContext
): Promise<EmployeeDocument> {
	const existing = params.id ? await loadDocumentRow(context, params.id) : null;
	const employee = await loadEmployeeRef(context, existing ? existing.employee_id : params.employeeId);
	await requireManage(context, employee);
	const actorUserId = await resolveUserId(context);

	if (existing?.status === 'archived') throw new Error('Az archivált dokumentum nem módosítható.');

	let replaced: any = null;
	if (!existing && params.replacesId) {
		replaced = await loadDocumentRow(context, params.replacesId);
		if (replaced.employee_id !== employee.employeeId) throw new Error('A régi dokumentum másik dolgozóé.');
		if (replaced.status !== 'active') throw new Error('Csak aktív dokumentumnak lehet új verziója.');
	}

	const typeId = replaced ? replaced.type_id : Number(params.typeId);
	const type = await loadDocumentType(context, typeId);
	if (type.organizationId !== employee.organizationId) throw new Error('A dokumentumtípus másik szervezeté.');
	if (type.archived && (!existing || existing.type_id !== type.id)) {
		throw new Error('Archivált típushoz nem vehető fel dokumentum.');
	}

	const title = optionalText(params.title, 'Megnevezés', 200) ?? type.name;
	const issuedOn = parseDay(params.issuedOn, type.fileMode === 'none' ? 'Bemutatás napja' : 'Kiállítás napja');
	const validUntil = type.hasExpiry ? parseDay(params.validUntil, 'Érvényesség vége') : null;
	if (issuedOn && validUntil && validUntil < issuedOn) {
		throw new Error('Az érvényesség vége nem lehet korábbi a kiállítás napjánál.');
	}
	const note = optionalText(params.note, 'Megjegyzés', 2000);

	if (existing && type.fileMode === 'none' && existing.type_id !== type.id) {
		const files = await context.db.query(
			`SELECT 1 FROM ${SCHEMA}.employee_document_files WHERE document_id = $1 LIMIT 1`,
			[existing.id]
		);
		if (files.rows.length > 0) {
			throw new Error('Fájl nélküli típushoz nem tartozhat fájl. Előbb töröld a csatolt fájlokat.');
		}
	}

	const client = await context.db.connect();
	let documentId: number;
	try {
		await client.query('BEGIN');
		if (existing) {
			await client.query(
				`UPDATE ${SCHEMA}.employee_documents
				    SET type_id = $2, title = $3, issued_on = $4, valid_until = $5, note = $6, updated_at = NOW()
				  WHERE id = $1`,
				[existing.id, type.id, title, issuedOn, validUntil, note]
			);
			documentId = existing.id;
			await logEvent(client, {
				organizationId: employee.organizationId,
				employeeId: employee.employeeId,
				documentId,
				action: 'update',
				actorUserId,
				details: { title }
			});
		} else {
			const inserted = await client.query(
				`INSERT INTO ${SCHEMA}.employee_documents
				    (organization_id, employee_id, type_id, title, issued_on, valid_until, note, status, created_by)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
				 RETURNING id`,
				[employee.organizationId, employee.employeeId, type.id, title, issuedOn, validUntil, note, actorUserId]
			);
			documentId = inserted.rows[0].id;
			await logEvent(client, {
				organizationId: employee.organizationId,
				employeeId: employee.employeeId,
				documentId,
				action: 'create',
				actorUserId,
				details: { title, typeName: type.name, ...(replaced ? { replacesId: replaced.id } : {}) }
			});
			if (replaced) {
				await client.query(
					`UPDATE ${SCHEMA}.employee_documents
					    SET status = 'archived', replaced_by_id = $2, updated_at = NOW()
					  WHERE id = $1`,
					[replaced.id, documentId]
				);
				await logEvent(client, {
					organizationId: employee.organizationId,
					employeeId: employee.employeeId,
					documentId: replaced.id,
					action: 'archive',
					actorUserId,
					details: { title: replaced.title, replacedById: documentId }
				});
			}
		}
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	return loadDocument(context, documentId);
}

/** Dokumentum törlése a fájljaival együtt (a fájlok a core tárolójából is törlődnek). */
export async function deleteEmployeeDocument(params: { id: number }, context: RemoteContext): Promise<void> {
	const row = await loadDocumentRow(context, params?.id);
	const employee = await loadEmployeeRef(context, row.employee_id);
	const access = await documentAccess(context, employee);
	if (!access.canManage && !isOwnSubmission(access, row)) throw new Error('Nincs jogosultságod ehhez a művelethez');
	const actorUserId = await resolveUserId(context);

	const client = await context.db.connect();
	let fileIds: string[] = [];
	try {
		await client.query('BEGIN');
		const files = await client.query(
			`SELECT file_id FROM ${SCHEMA}.employee_document_files WHERE document_id = $1`,
			[row.id]
		);
		fileIds = files.rows.map((f: any) => String(f.file_id));
		// Az új verzió hivatkozása a régire (replaced_by_id) SET NULL-ra vált
		await client.query(`DELETE FROM ${SCHEMA}.employee_documents WHERE id = $1`, [row.id]);
		await logEvent(client, {
			organizationId: employee.organizationId,
			employeeId: employee.employeeId,
			documentId: row.id,
			// A dolgozó a saját függő beküldését vonja vissza
			action: access.canManage ? 'delete' : 'withdraw',
			actorUserId,
			details: { title: row.title, typeName: row.type_name, fileCount: fileIds.length }
		});
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	await deleteStoredFiles(context, fileIds);
}

/** Feltöltési link egy dokumentum újabb fájljához. */
export async function prepareDocumentUpload(
	params: { documentId: number },
	context: RemoteContext
): Promise<{ uploadUrl: string; maxBytes: number; mimeTypes: string[] }> {
	const files = requireFiles(context);
	const row = await loadDocumentRow(context, params?.documentId);
	const employee = await loadEmployeeRef(context, row.employee_id);
	await requireFileWrite(context, employee, row);
	await assertCanAddFile(context, row);

	try {
		const { uploadUrl } = await files.createUploadUrl({
			allowedMimeTypes: DOCUMENT_MIME_TYPES,
			maxBytes: MAX_DOCUMENT_FILE_BYTES,
			ref: `employee-document:${row.id}`
		});
		return { uploadUrl, maxBytes: MAX_DOCUMENT_FILE_BYTES, mimeTypes: DOCUMENT_MIME_TYPES };
	} catch (err) {
		rethrowFileError(err);
	}
}

async function assertCanAddFile(context: RemoteContext, row: any): Promise<void> {
	if (row.file_mode === 'none') throw new Error('Ehhez a dokumentumtípushoz nem tartozik fájl.');
	if (row.status === 'archived') throw new Error('Az archivált dokumentumhoz nem csatolható fájl.');
	if (row.status === 'rejected') throw new Error('Az elutasított dokumentumhoz nem csatolható fájl.');
	const count = await context.db.query(
		`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.employee_document_files WHERE document_id = $1`,
		[row.id]
	);
	if ((count.rows[0]?.n ?? 0) >= MAX_FILES_PER_DOCUMENT) {
		throw new Error(`Egy dokumentumhoz legfeljebb ${MAX_FILES_PER_DOCUMENT} fájl tartozhat.`);
	}
}

/** A feltöltött fájl a dokumentumhoz kötve (claim a core-ban, mentés itt). */
export async function attachDocumentFile(
	params: { documentId: number; fileId: string },
	context: RemoteContext
): Promise<EmployeeDocumentFile> {
	const files = requireFiles(context);
	const row = await loadDocumentRow(context, params?.documentId);
	const employee = await loadEmployeeRef(context, row.employee_id);
	await requireFileWrite(context, employee, row);
	await assertCanAddFile(context, row);
	const actorUserId = await resolveUserId(context);

	let info;
	try {
		info = await files.claim(String(params.fileId), { ref: `employee-document:${row.id}` });
	} catch (err) {
		rethrowFileError(err);
	}

	try {
		const inserted = await context.db.query(
			`INSERT INTO ${SCHEMA}.employee_document_files
			    (document_id, file_id, original_name, mime_type, size_bytes, uploaded_by)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING id, document_id, original_name, mime_type, size_bytes, created_at`,
			[row.id, info.id, info.originalName, info.mimeType, info.size, actorUserId]
		);
		await logEvent(context.db, {
			organizationId: employee.organizationId,
			employeeId: employee.employeeId,
			documentId: row.id,
			action: 'file_add',
			actorUserId,
			details: { title: row.title, fileName: info.originalName }
		});
		return mapFile(inserted.rows[0]);
	} catch (err) {
		// Ne maradjon gazdátlan fájl a core tárolójában
		await files.delete(info.id).catch(() => {});
		if ((err as { code?: string })?.code === '23505') throw new Error('Ez a fájl már csatolva van.');
		throw err;
	}
}

/** Egy csatolt fájl törlése. */
export async function deleteDocumentFile(params: { fileRowId: number }, context: RemoteContext): Promise<void> {
	const file = await loadFileRow(context, params?.fileRowId);
	const row = await loadDocumentRow(context, file.document_id);
	const employee = await loadEmployeeRef(context, row.employee_id);
	await requireFileWrite(context, employee, row);
	const actorUserId = await resolveUserId(context);

	await context.db.query(`DELETE FROM ${SCHEMA}.employee_document_files WHERE id = $1`, [file.id]);
	await logEvent(context.db, {
		organizationId: employee.organizationId,
		employeeId: employee.employeeId,
		documentId: row.id,
		action: 'file_delete',
		actorUserId,
		details: { title: row.title, fileName: file.original_name }
	});
	await deleteStoredFiles(context, [String(file.file_id)]);
}

async function loadFileRow(context: RemoteContext, fileRowId: number): Promise<any> {
	if (!Number.isInteger(fileRowId) || fileRowId <= 0) throw new Error('Érvénytelen fájl azonosító.');
	const r = await context.db.query(
		`SELECT id, document_id, file_id, original_name FROM ${SCHEMA}.employee_document_files WHERE id = $1`,
		[fileRowId]
	);
	if (r.rows.length === 0) throw new Error('A fájl nem található.');
	return r.rows[0];
}

/**
 * Rövid életű link egy csatolt fájlhoz. `inline`: megnyitás a böngészőben
 * (PDF, kép), `attachment`: letöltés. Minden megnyitás naplózódik.
 */
export async function getDocumentFileUrl(
	params: { fileRowId: number; disposition?: 'inline' | 'attachment' },
	context: RemoteContext
): Promise<{ url: string }> {
	const files = requireFiles(context);
	const file = await loadFileRow(context, params?.fileRowId);
	const row = await loadDocumentRow(context, file.document_id);
	const employee = await loadEmployeeRef(context, row.employee_id);
	const access = await documentAccess(context, employee);
	if (!access.canView || (access.ownOnly && !visibleToOwner(row))) {
		throw new Error('Nincs jogosultságod ehhez a művelethez');
	}
	const disposition = params.disposition === 'inline' ? 'inline' : 'attachment';

	let url: string;
	try {
		({ url } = await files.createDownloadUrl(String(file.file_id), { disposition }));
	} catch (err) {
		rethrowFileError(err);
	}
	await logEvent(context.db, {
		organizationId: employee.organizationId,
		employeeId: employee.employeeId,
		documentId: row.id,
		action: disposition === 'inline' ? 'view' : 'download',
		actorUserId: await resolveUserId(context),
		details: { title: row.title, fileName: file.original_name }
	});
	return { url };
}

// --- Belső segédek más moduloknak --------------------------------------------------------

/** A core tárolóból törli a fájlokat; a hibát csak naplózza (a sor már nincs meg). */
export async function deleteStoredFiles(context: RemoteContext, fileIds: string[]): Promise<void> {
	if (!context.files || fileIds.length === 0) return;
	for (const fileId of fileIds) {
		try {
			await context.files.delete(fileId);
		} catch (err) {
			console.error(`[Work] Dokumentum fájl törlése sikertelen (${fileId}):`, err);
		}
	}
}

/** Egy szervezet összes dokumentumfájljának core azonosítója (a szervezet törlése előtt). */
export async function collectOrganizationDocumentFileIds(
	db: Queryable,
	organizationId: number
): Promise<string[]> {
	const r = await db.query(
		`SELECT f.file_id
		   FROM ${SCHEMA}.employee_document_files f
		   JOIN ${SCHEMA}.employee_documents d ON d.id = f.document_id
		  WHERE d.organization_id = $1`,
		[organizationId]
	);
	return r.rows.map((row: any) => String(row.file_id));
}

// --- Dolgozói önkiszolgálás és jóváhagyás (K7, K8) -----------------------------------

/** A dolgozó saját nézetének feltöltési adatai; a HR-nek (és másnak) null. */
async function selfServiceFor(
	context: RemoteContext,
	employee: EmployeeRef,
	access: DocumentAccess,
	types: DocumentType[]
): Promise<EmployeeDocumentsView['selfService']> {
	if (!access.isOwner || access.canManage) return null;
	const settings = await loadDocumentSettings(context, employee.organizationId);
	const uploadTypes = settings.employeeUploadEnabled
		? types
				.filter((t) => !t.archived && t.employeeCanUpload && t.visibleToEmployee && t.fileMode !== 'none')
				.map((t) => ({ id: t.id, name: t.name }))
		: [];
	return { uploadEnabled: uploadTypes.length > 0, uploadTypes };
}

/** A hívó dolgozói rekordja a szervezetben (a Saját dokumentumaim oldalhoz). */
export async function getMyDocumentsEmployee(
	params: { organizationId: number },
	context: RemoteContext
): Promise<{ employeeId: number } | null> {
	const organizationId = Number(params?.organizationId);
	if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error('Érvénytelen szervezet azonosító');
	await requireCapability(context, organizationId, 'employee.documents.own');
	const userId = await resolveUserId(context);
	const r = await context.db.query(
		`SELECT id FROM ${SCHEMA}.employees WHERE organization_id = $1 AND user_id = $2`,
		[organizationId, userId]
	);
	return r.rows[0] ? { employeeId: r.rows[0].id } : null;
}

/**
 * A dolgozó dokumentumot küld be ellenőrzésre: függő állapotban jön létre,
 * utána a fájlok (prepareDocumentUpload + attachDocumentFile), végül
 * `confirmMyDocumentSubmission` értesíti a HR-t.
 */
export async function submitMyDocument(
	params: {
		employeeId: number;
		typeId: number;
		title?: string;
		issuedOn?: string | null;
		validUntil?: string | null;
		note?: string | null;
	},
	context: RemoteContext
): Promise<EmployeeDocument> {
	const employee = await loadEmployeeRef(context, params?.employeeId);
	const access = await documentAccess(context, employee);
	if (!access.isOwner) throw new Error('Csak a saját dokumentumodat töltheted fel.');

	const settings = await loadDocumentSettings(context, employee.organizationId);
	if (!settings.employeeUploadEnabled) throw new Error('A szervezetben a dolgozók nem tölthetnek fel dokumentumot.');

	const type = await loadDocumentType(context, Number(params.typeId));
	if (
		type.organizationId !== employee.organizationId ||
		type.archived ||
		!type.employeeCanUpload ||
		!type.visibleToEmployee ||
		type.fileMode === 'none'
	) {
		throw new Error('Ehhez a dokumentumtípushoz nem tölthetsz fel dokumentumot.');
	}

	const title = optionalText(params.title, 'Megnevezés', 200) ?? type.name;
	const issuedOn = parseDay(params.issuedOn, 'Kiállítás napja');
	const validUntil = type.hasExpiry ? parseDay(params.validUntil, 'Érvényesség vége') : null;
	if (issuedOn && validUntil && validUntil < issuedOn) {
		throw new Error('Az érvényesség vége nem lehet korábbi a kiállítás napjánál.');
	}
	const note = optionalText(params.note, 'Megjegyzés', 2000);

	const inserted = await context.db.query(
		`INSERT INTO ${SCHEMA}.employee_documents
		    (organization_id, employee_id, type_id, title, issued_on, valid_until, note, status, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
		 RETURNING id`,
		[employee.organizationId, employee.employeeId, type.id, title, issuedOn, validUntil, note, access.callerUserId]
	);
	const documentId = inserted.rows[0].id;
	await logEvent(context.db, {
		organizationId: employee.organizationId,
		employeeId: employee.employeeId,
		documentId,
		action: 'submit',
		actorUserId: access.callerUserId,
		details: { title, typeName: type.name }
	});
	return loadDocument(context, documentId, access);
}

/** A beküldés lezárása, miután a fájlok feltöltődtek: értesíti a dokumentumkezelőket. */
export async function confirmMyDocumentSubmission(
	params: { documentId: number },
	context: RemoteContext
): Promise<EmployeeDocument> {
	const row = await loadDocumentRow(context, params?.documentId);
	const employee = await loadEmployeeRef(context, row.employee_id);
	const access = await documentAccess(context, employee);
	if (!isOwnPending(access, row)) throw new Error('Nincs jogosultságod ehhez a művelethez');
	const files = await loadFiles(context, [row.id]);
	const fileCount = files.get(row.id)?.length ?? 0;
	if (fileCount === 0) throw new Error('Legalább egy fájlt fel kell tölteni.');

	const name = await context.db.query(
		`SELECT COALESCE(NULLIF(trim(full_name), ''), email) AS name FROM auth.users WHERE id = $1`,
		[employee.userId]
	);
	await notifyDocumentSubmitted(context, {
		organizationId: employee.organizationId,
		employeeId: employee.employeeId,
		employeeName: name.rows[0]?.name ?? '—',
		documentId: row.id,
		title: row.title,
		fileCount
	});
	return loadDocument(context, row.id, access);
}

/**
 * A HR döntése a dolgozó beküldéséről. Elfogadáskor a dátumok javíthatók, és
 * (alapból) a típus korábbi aktív dokumentuma archivált lesz, mint egy új
 * verziónál. Elutasításkor az indoklás kötelező, a fájlok törlődnek.
 */
export async function reviewEmployeeDocument(
	params: {
		id: number;
		decision: 'approve' | 'reject';
		note?: string | null;
		title?: string;
		issuedOn?: string | null;
		validUntil?: string | null;
		replaceExisting?: boolean;
	},
	context: RemoteContext
): Promise<EmployeeDocument> {
	const row = await loadDocumentRow(context, params?.id);
	const employee = await loadEmployeeRef(context, row.employee_id);
	await requireManage(context, employee);
	if (row.status !== 'pending') throw new Error('Csak ellenőrzésre váró dokumentumról lehet dönteni.');
	if (params.decision !== 'approve' && params.decision !== 'reject') throw new Error('Érvénytelen döntés.');
	const actorUserId = await resolveUserId(context);
	const note = optionalText(params.note, 'Indoklás', 2000);
	const approve = params.decision === 'approve';
	if (!approve && !note) throw new Error('Az elutasítás indoklása kötelező.');

	let title = row.title as string;
	let issuedOn = row.issued_day ?? null;
	let validUntil = row.valid_day ?? null;
	if (approve) {
		title = optionalText(params.title, 'Megnevezés', 200) ?? title;
		if (params.issuedOn !== undefined) issuedOn = parseDay(params.issuedOn, 'Kiállítás napja');
		if (params.validUntil !== undefined) validUntil = row.has_expiry ? parseDay(params.validUntil, 'Érvényesség vége') : null;
		if (issuedOn && validUntil && validUntil < issuedOn) {
			throw new Error('Az érvényesség vége nem lehet korábbi a kiállítás napjánál.');
		}
	}

	const client = await context.db.connect();
	let fileIds: string[] = [];
	try {
		await client.query('BEGIN');
		if (approve) {
			await client.query(
				`UPDATE ${SCHEMA}.employee_documents
				    SET status = 'active', title = $2, issued_on = $3, valid_until = $4,
				        reviewed_by = $5, reviewed_at = NOW(), review_note = $6, updated_at = NOW()
				  WHERE id = $1`,
				[row.id, title, issuedOn, validUntil, actorUserId, note]
			);
			if (params.replaceExisting !== false) {
				const replaced = await client.query(
					`UPDATE ${SCHEMA}.employee_documents
					    SET status = 'archived', replaced_by_id = $1, updated_at = NOW()
					  WHERE employee_id = $2 AND type_id = $3 AND status = 'active' AND id <> $1
					  RETURNING id, title`,
					[row.id, employee.employeeId, row.type_id]
				);
				for (const old of replaced.rows) {
					await logEvent(client, {
						organizationId: employee.organizationId,
						employeeId: employee.employeeId,
						documentId: old.id,
						action: 'archive',
						actorUserId,
						details: { title: old.title, replacedById: row.id }
					});
				}
			}
		} else {
			const files = await client.query(
				`DELETE FROM ${SCHEMA}.employee_document_files WHERE document_id = $1 RETURNING file_id`,
				[row.id]
			);
			fileIds = files.rows.map((f: any) => String(f.file_id));
			await client.query(
				`UPDATE ${SCHEMA}.employee_documents
				    SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), review_note = $3, updated_at = NOW()
				  WHERE id = $1`,
				[row.id, actorUserId, note]
			);
		}
		await logEvent(client, {
			organizationId: employee.organizationId,
			employeeId: employee.employeeId,
			documentId: row.id,
			action: approve ? 'approve' : 'reject',
			actorUserId,
			details: { title, ...(note ? { note } : {}) }
		});
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	await deleteStoredFiles(context, fileIds);
	await notifyDocumentReviewed(context, {
		organizationId: employee.organizationId,
		employeeUserId: employee.userId,
		documentId: row.id,
		title,
		approved: approve,
		note
	});
	return loadDocument(context, row.id);
}
