/**
 * Dokumentumfájlok a böngészőben: előzetes ellenőrzés, feltöltés a core
 * fájltárolójába és megnyitás. A szerver (és a core) ugyanezeket a
 * korlátokat újra ellenőrzi (server/employee-documents.ts); itt csak azért
 * nézzük, hogy a felhasználó ne várjon egy biztosan elutasított feltöltésre.
 *
 * Feltöltés: prepareDocumentUpload (aláírt link) → sdk.files.upload (a fájl
 * nyersen, haladásjelzéssel) → attachDocumentFile (a dokumentumhoz kötés).
 */

import { formatSize } from '../leave-entitlement/files.js';

export { formatSize };

export const DOCUMENT_FILE_ACCEPT =
	'.pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.odt,.ods,application/pdf,image/jpeg,image/png,image/webp,' +
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
	'application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet';

/** A böngészőben megnyitható típusok; a többi letöltődik. */
const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

const EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'xlsx', 'odt', 'ods']);

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface DocumentFileLimits {
	maxFilesPerDocument: number;
	maxFileBytes: number;
	mimeTypes: string[];
}

/** Hibaüzenet, ha a fájl biztosan nem fog átmenni; különben null. */
export function checkDocumentFile(file: File, limits: DocumentFileLimits, t: Translate): string | null {
	if (file.size === 0) return t('documents.files.error.empty', { name: file.name });
	if (file.size > limits.maxFileBytes) {
		return t('documents.files.error.tooLarge', { name: file.name, max: formatSize(limits.maxFileBytes) });
	}
	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
	const typeOk = file.type ? limits.mimeTypes.includes(file.type) : EXTENSIONS.has(ext);
	if (!typeOk) return t('documents.files.error.type', { name: file.name });
	return null;
}

function cleanError(err: unknown, fallback: string): string {
	const message = (err as { message?: string })?.message;
	return message
		? message.replace(/^\[DevMode\] Remote call failed: \w+ — /, '').replace(/^[A-Z_]+:\s*/, '')
		: fallback;
}

/**
 * Egy fájl feltöltése és csatolása.
 *
 * @throws Felhasználónak szóló üzenettel, ha nem sikerült.
 */
export async function uploadDocumentFile(
	sdk: any,
	documentId: number,
	file: File,
	t: Translate,
	onProgress?: (percent: number) => void
): Promise<void> {
	if (typeof sdk?.files?.upload !== 'function') throw new Error(t('documents.files.error.unsupported'));
	try {
		const { uploadUrl } = await sdk.remote.call('prepareDocumentUpload', { documentId });
		const uploaded = await sdk.files.upload(uploadUrl, file, {
			onProgress: ({ loaded, total }: { loaded: number; total: number }) =>
				onProgress?.(total > 0 ? Math.round((loaded / total) * 100) : 0)
		});
		await sdk.remote.call('attachDocumentFile', { documentId, fileId: uploaded.fileId });
	} catch (err) {
		const code = (err as { code?: string })?.code;
		if (code === 'FILE_TOO_LARGE') throw new Error(t('documents.files.error.tooLarge', { name: file.name, max: '10 MB' }));
		if (code === 'INVALID_MIME') throw new Error(t('documents.files.error.type', { name: file.name }));
		throw new Error(`${file.name}: ${cleanError(err, t('error.saveFailed'))}`);
	}
}

/**
 * Megnyitás: a PDF és a kép új lapon, a többi letöltésként. A lapot még a
 * kattintáskor nyitjuk meg (a link csak utána érkezik), különben a böngésző
 * felugró ablakként letilthatja.
 */
export async function openDocumentFile(
	sdk: any,
	file: { id: number; mimeType: string },
	mode: 'open' | 'download' = 'open'
): Promise<void> {
	const tab =
		mode === 'open' && INLINE_TYPES.has(file.mimeType) ? window.open('about:blank', '_blank') : null;
	try {
		// Ha nem nyílt új lap (más típus, vagy a böngésző letiltotta), letöltés lesz belőle,
		// így a link sosem cseréli le magát az alkalmazást
		const { url } = await sdk.remote.call('getDocumentFileUrl', {
			fileRowId: file.id,
			disposition: tab ? 'inline' : 'attachment'
		});
		if (tab) {
			tab.opener = null;
			tab.location.href = url;
			return;
		}
		const link = document.createElement('a');
		link.href = url;
		link.rel = 'noopener';
		document.body.appendChild(link);
		link.click();
		link.remove();
	} catch (err) {
		tab?.close();
		throw err;
	}
}

/**
 * YYYY-MM-DD + hónapok, a hónap végéhez igazítva (01-31 + 1 hónap → 02-28/29).
 * Az érvényesség végének előtöltéséhez a típus alapértelmezett érvényességéből.
 */
export function addMonths(day: string, months: number): string {
	const [y, m, d] = day.split('-').map(Number);
	const target = new Date(Date.UTC(y, m - 1 + months, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(d, lastDay));
	return target.toISOString().slice(0, 10);
}

/** A dokumentum ablak módja: új, szerkesztés, vagy új verzió egy meglévő helyére. */
export type DocumentDialogMode =
	| { kind: 'new'; typeId?: number }
	| { kind: 'submit'; typeId?: number }
	| { kind: 'edit'; document: import('../../../server/functions.js').EmployeeDocument }
	| { kind: 'version'; document: import('../../../server/functions.js').EmployeeDocument };
