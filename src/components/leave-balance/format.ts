/**
 * Szám- és dátumformázás a Szabadság egyenleg oldal komponenseihez.
 */

/** Napok legfeljebb egy tizedessel (magyar tizedesvesszővel). */
export function formatDays(value: number, digits = 1): string {
	return value.toLocaleString('hu-HU', { maximumFractionDigits: digits });
}

/** Előjeles érték: +3,7 / −2 / 0. */
export function formatSigned(value: number, digits = 1): string {
	const rounded = Number(value.toFixed(digits));
	if (rounded === 0) return '0';
	return `${rounded > 0 ? '+' : '−'}${formatDays(Math.abs(rounded), digits)}`;
}

/** Rövid dátum: „szept. 14.”. */
export function formatShortDay(iso: string): string {
	return new Date(`${iso}T00:00:00Z`).toLocaleDateString('hu-HU', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/** Monogram a profilkép helyére. */
export function initials(name: string): string {
	return name
		.split(' ')
		.filter(Boolean)
		.map((part) => part[0])
		.join('')
		.slice(0, 2)
		.toUpperCase();
}
