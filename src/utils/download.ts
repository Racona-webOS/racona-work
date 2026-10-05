/**
 * Böngészős fájlmentés és -megnyitás Blob URL-lel.
 *
 * Minden export (CSV, XLSX, kiküldetési rendelvény, igazolások) ezeken
 * keresztül megy, hogy a letöltés módja és az URL felszabadítása egy helyen
 * legyen.
 */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const CSV_MIME = 'text/csv;charset=utf-8';

/**
 * A Blob URL-t nem szabad azonnal felszabadítani: a letöltés indítása a
 * kattintás után aszinkron, egyes böngészőkben a korai revoke megszakítja.
 */
const REVOKE_AFTER_DOWNLOAD_MS = 1000;
/** A megnyitott lapnak idő kell a betöltéshez, utána felszabadítjuk. */
const REVOKE_AFTER_OPEN_MS = 60_000;

/** Mentés a böngészővel a megadott fájlnéven. */
export function downloadBlob(blob: Blob, fileName: string): void {
	const href = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = href;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(href), REVOKE_AFTER_DOWNLOAD_MS);
}

/** Bináris tartalom mentése (alapértelmezésben XLSX). */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime = XLSX_MIME): void {
	downloadBlob(new Blob([bytes as BlobPart], { type: mime }), fileName);
}

/**
 * Szöveges tartalom mentése (alapértelmezésben CSV). A `bom` az Excelnek
 * jelzi az UTF-8 kódolást, enélkül az ékezetes betűk elromlanak.
 */
export function downloadText(
	text: string,
	fileName: string,
	{ mime = CSV_MIME, bom = true }: { mime?: string; bom?: boolean } = {}
): void {
	downloadBlob(new Blob([(bom ? '﻿' : '') + text], { type: mime }), fileName);
}

/**
 * Megnyitás új lapon (pl. PDF, kép). Ha a böngésző letiltja az új lapot,
 * letöltésként kínálja fel `fallbackFileName` néven.
 */
export function openBlobInNewTab(blob: Blob, fallbackFileName: string): void {
	const href = URL.createObjectURL(blob);

	// A 'noopener' jelzővel a window.open mindig null-t adna, ezért utólag bontjuk a kapcsolatot
	const opened = window.open(href, '_blank');
	if (opened) {
		opened.opener = null;
	} else {
		const link = document.createElement('a');
		link.href = href;
		link.download = fallbackFileName;
		link.click();
	}
	setTimeout(() => URL.revokeObjectURL(href), REVOKE_AFTER_OPEN_MS);
}

/** Base64 szöveg bájtokká alakítása (a szerver így küldi a bináris fájlokat). */
export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
