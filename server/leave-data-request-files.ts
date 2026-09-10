/**
 * Igazolások a dolgozói adatbejelentésekhez.
 *
 * A core nem ad fájltárolót a pluginoknak: a kliens base64-ben küldi a fájlt
 * egy remote hívásban (fájlonként egy hívás, hogy a kérés kicsi maradjon), a
 * szerver a plugin sémájában bytea-ként tárolja. Letöltéskor base64-ben adja
 * vissza, a kliens Blob URL-lel nyitja meg.
 *
 * Hozzáférés: a feltöltő dolgozó és a HR (leave.balance.manage). Csatolni csak
 * függő bejelentéshez lehet; a dolgozó a sajátját csak függő állapotban
 * törölheti, a HR bármikor. Megőrzés: elutasításkor és visszavonáskor a fájlok
 * törlődnek (leave-data-requests.ts), jóváhagyás után a HR törli, ha már nem kell.
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { hasCapability, requireSelfOrCapability } from './permissions.js';

const SCHEMA = 'app__racona_work';

/** Fájlonként legfeljebb 4 MB — base64-ben kb. 5,4 MB megy át a remote híváson. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 5;

export type CertificateMimeType = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface LeaveDataRequestFile {
	id: number;
	requestId: number;
	fileName: string;
	mimeType: CertificateMimeType;
	sizeBytes: number;
	createdAt: string;
}

const SIGNATURES: ReadonlyArray<{ mime: CertificateMimeType; bytes: number[] }> = [
	{ mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
	{ mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
	{ mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }
];

/**
 * A fájl típusa a tartalma alapján (a kiterjesztésben és a böngésző által
 * küldött típusban nem bízunk). Ismeretlen tartalomnál null.
 */
export function detectMimeType(bytes: Uint8Array): CertificateMimeType | null {
	for (const signature of SIGNATURES) {
		if (signature.bytes.every((b, i) => bytes[i] === b)) return signature.mime;
	}
	return null;
}

/** A fájlnév útvonal és vezérlőkarakterek nélkül, legfeljebb 255 karakter. */
export function sanitizeFileName(name: unknown): string {
	const base = String(name ?? '')
		.split(/[\\/]/)
		.pop()!
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.trim();
	return (base || 'igazolas').slice(0, 255);
}

/**
 * base64 → bájtok (az ellenőrzéshez; a tárolást a PostgreSQL decode() végzi).
 *
 * @throws Ha nem érvényes base64.
 */
function decodeBase64(base64: string): Uint8Array {
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Érvénytelen base64');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function mapFile(row: any): LeaveDataRequestFile {
	return {
		id: row.id,
		requestId: row.request_id,
		fileName: row.file_name,
		mimeType: row.mime_type,
		sizeBytes: row.size_bytes,
		createdAt: row.created_at
	};
}

const FILE_META_COLUMNS = 'id, request_id, file_name, mime_type, size_bytes, created_at';

/** Belső segéd: a bejelentések fájljainak adatai (tartalom nélkül). */
export async function loadFilesFor(
	context: RemoteContext,
	requestIds: number[]
): Promise<Map<number, LeaveDataRequestFile[]>> {
	const files = new Map<number, LeaveDataRequestFile[]>();
	if (requestIds.length === 0) return files;
	const r = await context.db.query(
		`SELECT ${FILE_META_COLUMNS} FROM ${SCHEMA}.leave_data_request_files
		  WHERE request_id = ANY($1::int[]) ORDER BY created_at, id`,
		[requestIds]
	);
	for (const row of r.rows) {
		if (!files.has(row.request_id)) files.set(row.request_id, []);
		files.get(row.request_id)!.push(mapFile(row));
	}
	return files;
}

/** Belső segéd: egy bejelentés összes fájljának törlése (elutasításkor, visszavonáskor). */
export async function deleteFilesOfRequest(context: RemoteContext, requestId: number): Promise<void> {
	await context.db.query(`DELETE FROM ${SCHEMA}.leave_data_request_files WHERE request_id = $1`, [
		requestId
	]);
}

async function loadRequestOwner(context: RemoteContext, requestId: number) {
	const r = await context.db.query(
		`SELECT employee_id, organization_id, status FROM ${SCHEMA}.leave_data_requests WHERE id = $1`,
		[requestId]
	);
	if (r.rows.length === 0) throw new Error('Nem található az adatbejelentés.');
	return r.rows[0] as { employee_id: number; organization_id: number; status: string };
}

/**
 * Igazolás csatolása egy függő bejelentéshez. A fájl base64-ben érkezik;
 * csak PDF, JPG vagy PNG, legfeljebb 4 MB.
 */
export async function attachLeaveDataRequestFile(
	params: { requestId: number; fileName: string; data: string },
	context: RemoteContext
): Promise<LeaveDataRequestFile> {
	const request = await loadRequestOwner(context, params.requestId);
	await requireSelfOrCapability(context, request.employee_id, 'leave.balance.manage');
	if (request.status !== 'pending') {
		throw new Error('Igazolást csak függő bejelentéshez lehet csatolni.');
	}

	const count = await context.db.query(
		`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.leave_data_request_files WHERE request_id = $1`,
		[params.requestId]
	);
	if (count.rows[0].n >= MAX_FILES_PER_REQUEST) {
		throw new Error(`Egy bejelentéshez legfeljebb ${MAX_FILES_PER_REQUEST} fájl csatolható.`);
	}

	const base64 = typeof params.data === 'string' ? params.data.replace(/\s/g, '') : '';
	let content: Uint8Array;
	try {
		content = decodeBase64(base64);
	} catch {
		throw new Error('A fájl nem olvasható.');
	}
	if (content.length === 0) throw new Error('A fájl üres.');
	if (content.length > MAX_FILE_BYTES) {
		throw new Error('A fájl legfeljebb 4 MB lehet.');
	}
	const mimeType = detectMimeType(content);
	if (!mimeType) throw new Error('Csak PDF, JPG vagy PNG fájl csatolható.');

	const result = await context.db.query(
		`INSERT INTO ${SCHEMA}.leave_data_request_files
			(request_id, file_name, mime_type, size_bytes, content, uploaded_by)
		 VALUES ($1, $2, $3, $4, decode($5, 'base64'), $6)
		 RETURNING ${FILE_META_COLUMNS}`,
		[
			params.requestId,
			sanitizeFileName(params.fileName),
			mimeType,
			content.length,
			base64,
			await resolveUserId(context)
		]
	);
	return mapFile(result.rows[0]);
}

/** Egy igazolás letöltése base64-ben (a feltöltő dolgozó vagy a HR). */
export async function getLeaveDataRequestFile(
	params: { fileId: number },
	context: RemoteContext
): Promise<{ fileName: string; mimeType: CertificateMimeType; data: string }> {
	const r = await context.db.query(
		`SELECT f.file_name, f.mime_type, r.employee_id,
		        translate(encode(f.content, 'base64'), E'\n', '') AS data
		   FROM ${SCHEMA}.leave_data_request_files f
		   JOIN ${SCHEMA}.leave_data_requests r ON r.id = f.request_id
		  WHERE f.id = $1`,
		[params.fileId]
	);
	if (r.rows.length === 0) throw new Error('Nem található a fájl.');
	const row = r.rows[0];
	await requireSelfOrCapability(context, row.employee_id, 'leave.balance.manage');
	return {
		fileName: row.file_name,
		mimeType: row.mime_type,
		data: row.data
	};
}

/**
 * Igazolás törlése. A HR bármikor törölheti (pl. ha jóváhagyás után már nem
 * kell); a dolgozó csak a függő bejelentéséből.
 */
export async function deleteLeaveDataRequestFile(
	params: { fileId: number },
	context: RemoteContext
): Promise<void> {
	const r = await context.db.query(
		`SELECT f.request_id, r.employee_id, r.organization_id, r.status
		   FROM ${SCHEMA}.leave_data_request_files f
		   JOIN ${SCHEMA}.leave_data_requests r ON r.id = f.request_id
		  WHERE f.id = $1`,
		[params.fileId]
	);
	if (r.rows.length === 0) throw new Error('Nem található a fájl.');
	const row = r.rows[0];

	if (!(await hasCapability(context, row.organization_id, 'leave.balance.manage'))) {
		await requireSelfOrCapability(context, row.employee_id, 'leave.balance.manage');
		if (row.status !== 'pending') {
			throw new Error('Elbírált bejelentés igazolását csak a HR törölheti.');
		}
	}
	await context.db.query(`DELETE FROM ${SCHEMA}.leave_data_request_files WHERE id = $1`, [
		params.fileId
	]);
}
