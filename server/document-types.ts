/**
 * Dokumentumtípusok — szervezetenkénti katalógus (specs/employee-documents.md, K1, K2).
 *
 * Az alaptípusokat az `app__racona_work.seed_document_types()` SQL függvény
 * hozza létre (025-ös migráció): a meglévő szervezeteknek a migráció, az
 * újaknak a createOrganization. Típust csak dokumentum nélkül lehet törölni;
 * ha már van hozzá dokumentum, archiválható.
 */

import type { RemoteContext } from './context.js';
import { hasCapability, requireCapability, type Capability } from './permissions.js';

const SCHEMA = 'app__racona_work';

export type DocumentFileMode = 'required' | 'optional' | 'none';

export interface DocumentType {
	id: number;
	organizationId: number;
	name: string;
	description: string | null;
	fileMode: DocumentFileMode;
	hasExpiry: boolean;
	defaultValidityMonths: number | null;
	reminderDays: number[];
	isRequired: boolean;
	visibleToEmployee: boolean;
	employeeCanUpload: boolean;
	sortOrder: number;
	systemKey: string | null;
	archived: boolean;
	/** A típushoz tartozó (nem archivált) dokumentumok száma */
	documentCount: number;
}

const FILE_MODES: readonly DocumentFileMode[] = ['required', 'optional', 'none'];
const MAX_REMINDERS = 5;

/** Bármelyik dokumentum-képesség elég a típusok olvasásához. */
const READ_CAPABILITIES: Capability[] = [
	'employee.documents.view',
	'employee.documents.manage',
	'employee.documents.own'
];

export function mapDocumentType(row: any): DocumentType {
	return {
		id: row.id,
		organizationId: row.organization_id,
		name: row.name,
		description: row.description ?? null,
		fileMode: row.file_mode,
		hasExpiry: row.has_expiry === true,
		defaultValidityMonths: row.default_validity_months ?? null,
		reminderDays: (row.reminder_days ?? []).map(Number),
		isRequired: row.is_required === true,
		visibleToEmployee: row.visible_to_employee === true,
		employeeCanUpload: row.employee_can_upload === true,
		sortOrder: row.sort_order ?? 0,
		systemKey: row.system_key ?? null,
		archived: row.archived_at !== null && row.archived_at !== undefined,
		documentCount: Number(row.document_count ?? 0)
	};
}

/** Belső segéd: az alaptípusok létrehozása egy (új) szervezethez. */
export async function seedDocumentTypes(context: RemoteContext, organizationId: number): Promise<void> {
	await context.db.query(`SELECT ${SCHEMA}.seed_document_types($1)`, [organizationId]);
}

/** Belső segéd: egy típus a szervezetével együtt, vagy hiba. */
export async function loadDocumentType(context: RemoteContext, typeId: number): Promise<DocumentType> {
	if (!Number.isInteger(typeId) || typeId <= 0) throw new Error('Érvénytelen dokumentumtípus.');
	const r = await context.db.query(`SELECT * FROM ${SCHEMA}.document_types WHERE id = $1`, [typeId]);
	if (r.rows.length === 0) throw new Error('A dokumentumtípus nem található.');
	return mapDocumentType(r.rows[0]);
}

async function requireAnyCapability(
	context: RemoteContext,
	organizationId: number,
	capabilities: Capability[]
): Promise<void> {
	for (const cap of capabilities) {
		if (await hasCapability(context, organizationId, cap)) return;
	}
	throw new Error('Nincs jogosultságod ehhez a művelethez');
}

/** A szervezet dokumentumtípusai sorrendben. */
export async function listDocumentTypes(
	params: { organizationId: number; includeArchived?: boolean },
	context: RemoteContext
): Promise<DocumentType[]> {
	if (!Number.isInteger(params?.organizationId) || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireAnyCapability(context, params.organizationId, READ_CAPABILITIES);
	const r = await context.db.query(
		`SELECT t.*,
		        (SELECT COUNT(*) FROM ${SCHEMA}.employee_documents d
		          WHERE d.type_id = t.id AND d.status <> 'archived') AS document_count
		   FROM ${SCHEMA}.document_types t
		  WHERE t.organization_id = $1 AND ($2::boolean OR t.archived_at IS NULL)
		  ORDER BY t.archived_at IS NOT NULL, t.sort_order, lower(t.name)`,
		[params.organizationId, params.includeArchived === true]
	);
	return r.rows.map(mapDocumentType);
}

export interface DocumentTypeInput {
	name: string;
	description?: string | null;
	fileMode: DocumentFileMode;
	hasExpiry: boolean;
	defaultValidityMonths?: number | null;
	reminderDays?: number[];
	isRequired: boolean;
	visibleToEmployee: boolean;
	/** A dolgozó maga is feltöltheti (ha a szervezetben be van kapcsolva); csak látható típusnál */
	employeeCanUpload?: boolean;
	sortOrder?: number;
}

/**
 * A beviteli adatok ellenőrzése és normalizálása (tiszta függvény, tesztelhető).
 *
 * @throws Magyar nyelvű hibaüzenettel, ha valami érvénytelen.
 */
export function normalizeDocumentTypeInput(input: DocumentTypeInput): Required<DocumentTypeInput> {
	const name = String(input?.name ?? '').trim().replace(/\s+/g, ' ');
	if (!name) throw new Error('A típus neve kötelező.');
	if (name.length > 100) throw new Error('A típus neve legfeljebb 100 karakter lehet.');

	const description = input.description ? String(input.description).trim().slice(0, 1000) || null : null;

	if (!FILE_MODES.includes(input.fileMode)) throw new Error('Érvénytelen fájlkezelési mód.');

	const hasExpiry = input.hasExpiry === true;
	let defaultValidityMonths: number | null = null;
	if (hasExpiry && input.defaultValidityMonths !== null && input.defaultValidityMonths !== undefined && String(input.defaultValidityMonths) !== '') {
		const n = Number(input.defaultValidityMonths);
		if (!Number.isInteger(n) || n < 1 || n > 240) {
			throw new Error('Az alapértelmezett érvényesség 1 és 240 hónap közötti egész szám lehet.');
		}
		defaultValidityMonths = n;
	}

	let reminderDays: number[] = [];
	if (hasExpiry) {
		const raw = Array.isArray(input.reminderDays) ? input.reminderDays : [30, 7];
		const days = [...new Set(raw.map(Number))];
		if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) {
			throw new Error('Az emlékeztető 1 és 365 nap közötti egész szám lehet.');
		}
		if (days.length > MAX_REMINDERS) throw new Error(`Legfeljebb ${MAX_REMINDERS} emlékeztető adható meg.`);
		reminderDays = days.sort((a, b) => b - a);
	}

	const sortOrder = Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0;
	const visibleToEmployee = input.visibleToEmployee === true;

	return {
		name,
		description,
		fileMode: input.fileMode,
		hasExpiry,
		defaultValidityMonths,
		reminderDays,
		isRequired: input.isRequired === true,
		visibleToEmployee,
		// Amit a dolgozó nem lát, azt fel sem töltheti; fájl nélküli típushoz nincs mit
		employeeCanUpload: visibleToEmployee && input.fileMode !== 'none' && input.employeeCanUpload === true,
		sortOrder
	};
}

function isUniqueNameViolation(err: unknown): boolean {
	return (err as { code?: string })?.code === '23505';
}

/** Új típus, vagy meglévő módosítása. */
export async function saveDocumentType(
	params: DocumentTypeInput & { organizationId: number; id?: number },
	context: RemoteContext
): Promise<DocumentType> {
	let organizationId = params.organizationId;
	if (params.id) {
		const existing = await loadDocumentType(context, params.id);
		organizationId = existing.organizationId;
	}
	await requireCapability(context, organizationId, 'employee.documents.manage');
	const v = normalizeDocumentTypeInput(params);

	try {
		const r = params.id
			? await context.db.query(
					`UPDATE ${SCHEMA}.document_types
					    SET name = $2, description = $3, file_mode = $4, has_expiry = $5,
					        default_validity_months = $6, reminder_days = $7, is_required = $8,
					        visible_to_employee = $9, sort_order = $10, employee_can_upload = $11, updated_at = NOW()
					  WHERE id = $1
					  RETURNING *`,
					[params.id, v.name, v.description, v.fileMode, v.hasExpiry, v.defaultValidityMonths,
						v.reminderDays, v.isRequired, v.visibleToEmployee, v.sortOrder, v.employeeCanUpload]
				)
			: await context.db.query(
					`INSERT INTO ${SCHEMA}.document_types
					    (organization_id, name, description, file_mode, has_expiry, default_validity_months,
					     reminder_days, is_required, visible_to_employee, sort_order, employee_can_upload)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
					         COALESCE($10, (SELECT COALESCE(MAX(sort_order), 0) + 10
					                          FROM ${SCHEMA}.document_types WHERE organization_id = $1)),
					         $11)
					 RETURNING *`,
					[organizationId, v.name, v.description, v.fileMode, v.hasExpiry, v.defaultValidityMonths,
						v.reminderDays, v.isRequired, v.visibleToEmployee, Number.isInteger(params.sortOrder) ? v.sortOrder : null,
						v.employeeCanUpload]
				);
		return mapDocumentType(r.rows[0]);
	} catch (err) {
		if (isUniqueNameViolation(err)) throw new Error('Már van ilyen nevű dokumentumtípus.');
		throw err;
	}
}

/** Archiválás vagy visszaállítás. Az archivált típushoz nem vehető fel új dokumentum. */
export async function archiveDocumentType(
	params: { id: number; archived: boolean },
	context: RemoteContext
): Promise<DocumentType> {
	const type = await loadDocumentType(context, params.id);
	await requireCapability(context, type.organizationId, 'employee.documents.manage');
	try {
		const r = await context.db.query(
			`UPDATE ${SCHEMA}.document_types
			    SET archived_at = CASE WHEN $2 THEN NOW() ELSE NULL END, updated_at = NOW()
			  WHERE id = $1
			  RETURNING *`,
			[params.id, params.archived === true]
		);
		return mapDocumentType(r.rows[0]);
	} catch (err) {
		if (isUniqueNameViolation(err)) {
			throw new Error('Már van ilyen nevű aktív dokumentumtípus, előbb azt nevezd át.');
		}
		throw err;
	}
}

/** Törlés; csak akkor, ha egyetlen dokumentum sem tartozik hozzá (archivált sem). */
export async function deleteDocumentType(params: { id: number }, context: RemoteContext): Promise<void> {
	const type = await loadDocumentType(context, params.id);
	await requireCapability(context, type.organizationId, 'employee.documents.manage');
	const used = await context.db.query(
		`SELECT 1 FROM ${SCHEMA}.employee_documents WHERE type_id = $1 LIMIT 1`,
		[params.id]
	);
	if (used.rows.length > 0) {
		throw new Error('A típushoz már tartozik dokumentum, ezért nem törölhető. Archiválhatod.');
	}
	await context.db.query(`DELETE FROM ${SCHEMA}.document_types WHERE id = $1`, [params.id]);
}

// --- Szervezeti beállítás (D4) ---------------------------------------------------

export interface DocumentSettings {
	/** A dolgozók is feltölthetnek dokumentumot (a típusnál engedélyezett típusokhoz), HR-jóváhagyással */
	employeeUploadEnabled: boolean;
}

function documentSettingsKey(organizationId: number): string {
	return `settings:documents:org_${organizationId}`;
}

export function normalizeDocumentSettings(raw: unknown): DocumentSettings {
	const value = raw as { employeeUploadEnabled?: unknown } | null;
	return { employeeUploadEnabled: value?.employeeUploadEnabled === true };
}

/** Belső segéd: a szervezet beállítása jogosultság-ellenőrzés nélkül. */
export async function loadDocumentSettings(context: RemoteContext, organizationId: number): Promise<DocumentSettings> {
	const r = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
		documentSettingsKey(organizationId)
	]);
	return normalizeDocumentSettings(r.rows[0]?.value);
}

export async function getDocumentSettings(
	params: { organizationId: number },
	context: RemoteContext
): Promise<DocumentSettings> {
	const organizationId = Number(params?.organizationId);
	if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error('Érvénytelen szervezet azonosító');
	await requireAnyCapability(context, organizationId, READ_CAPABILITIES);
	return loadDocumentSettings(context, organizationId);
}

export async function saveDocumentSettings(
	params: { organizationId: number } & Partial<DocumentSettings>,
	context: RemoteContext
): Promise<DocumentSettings> {
	const organizationId = Number(params?.organizationId);
	if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error('Érvénytelen szervezet azonosító');
	await requireCapability(context, organizationId, 'employee.documents.manage');
	const current = await loadDocumentSettings(context, organizationId);
	const settings = normalizeDocumentSettings({ ...current, ...params });
	await context.db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[documentSettingsKey(organizationId), JSON.stringify(settings)]
	);
	return settings;
}
