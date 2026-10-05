/**
 * Segédek a nyers HTML-be (createRawSnippet, srcdoc) kerülő értékekhez.
 *
 * A plugin a core-ral egy dokumentumban fut, ezért a felhasználó által megadott
 * szöveg (pl. a core profilban szabadon átírható név vagy profilkép) escapelés
 * nélkül a megtekintő munkamenetével futó kódot juttathatna az oldalra.
 */

export function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Képcím, ha biztonságos: http(s), protokoll-relatív nélküli relatív útvonal vagy
 * beágyazott raszteres kép. Minden más (pl. `javascript:`, `data:text/html`) null.
 */
export function safeImageUrl(value: string | null | undefined): string | null {
	const url = value?.trim();
	if (!url) return null;
	if (/^https?:\/\//i.test(url)) return url;
	if (url.startsWith('/') && !url.startsWith('//')) return url;
	if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(url)) return url;
	return null;
}
