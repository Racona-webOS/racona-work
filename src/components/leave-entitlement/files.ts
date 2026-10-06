/**
 * Igazolás-fájlok a böngészőben: ellenőrzés, base64 olvasás, feltöltés és
 * megnyitás. A szerver ugyanezeket a korlátokat újra ellenőrzi
 * (server/leave-data-request-files.ts), itt csak azért nézzük, hogy a
 * dolgozó ne várjon egy biztosan elutasított feltöltésre.
 */

import { base64ToBytes, openBlobInNewTab } from '../../utils/download.js';

export const FILE_ACCEPT ='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 5;

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	const mb = bytes / 1024 / 1024;
	return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** Hibaüzenet, ha a fájl biztosan nem fog átmenni; különben null. */
export function checkFile(file: File, t: Translate): string | null {
	if (file.size > MAX_FILE_BYTES) return t('files.error.tooLarge', { name: file.name });
	if (file.type && !ALLOWED_TYPES.has(file.type)) return t('files.error.type', { name: file.name });
	return null;
}

function readAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/**
 * A fájlok feltöltése egyenként (egy hívás egy fájl, hogy a kérés kicsi maradjon).
 *
 * @returns A sikertelen fájlok hibaüzenetei.
 */
export async function uploadFiles(sdk: any, requestId: number, files: File[], t: Translate): Promise<string[]> {
	const errors: string[] = [];
	for (const file of files) {
		const problem = checkFile(file, t);
		if (problem) {
			errors.push(problem);
			continue;
		}
		try {
			await sdk.remote.call('attachLeaveDataRequestFile', {
				requestId,
				fileName: file.name,
				data: await readAsBase64(file)
			});
		} catch (err: any) {
			errors.push(`${file.name}: ${err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed')}`);
		}
	}
	return errors;
}

/**
 * Egy igazolás megnyitása új lapon (Blob URL). Ha a böngésző letiltja az új
 * lapot, letöltésként kínálja fel.
 */
export async function openFile(sdk: any, fileId: number): Promise<void> {
	const file: { fileName: string; mimeType: string; data: string } = await sdk.remote.call(
		'getLeaveDataRequestFile',
		{ fileId }
	);
	const bytes = base64ToBytes(file.data);
	openBlobInNewTab(new Blob([bytes as BlobPart], { type: file.mimeType }), file.fileName);
}
