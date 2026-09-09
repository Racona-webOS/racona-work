/**
 * Plugin SDK segédek.
 *
 * A Racona core minden plugin példányhoz beregisztrál egy SDK objektumot
 * (`window.__webOS_instances`), a dev-környezetben pedig a `window.webOS`
 * mock SDK érhető el. Ezek a segédek azért vannak külön, hogy a komponensek
 * ne másolják fájlonként ugyanazt a feloldó- és fordítás-logikát.
 */

/** Az aktuális plugin példány SDK objektuma (dev módban a mock SDK). */
export function resolveSdk(pluginId: string): any {
	if (typeof window === 'undefined') return null;
	return (window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS;
}

/**
 * Fordítás az SDK i18n-jével. Ha nincs kulcs, magát a kulcsot adja vissza,
 * hogy a felület ne üres szöveggel jelenjen meg.
 * A `vars` értékei a `{név}` helyőrzőkbe kerülnek.
 */
export function translate(
	sdk: any,
	key: string,
	vars?: Record<string, string | number>
): string {
	let str = sdk?.i18n?.t(key) ?? key;
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			str = str.replace(`{${k}}`, String(v));
		}
	}
	return str;
}
