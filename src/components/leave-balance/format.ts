/**
 * Szám- és dátumformázás a Szabadság egyenleg oldal komponenseihez.
 */

import { formatNumber, formatShortDay as formatShortDate } from '../../utils/format.js';

/** Napok legfeljebb egy tizedessel, a felület nyelvének tizedesjelével. */
export function formatDays(value: number, digits = 1): string {
	return formatNumber(value, { maximumFractionDigits: digits });
}

/** Előjeles érték: +3,7 / −2 / 0. */
export function formatSigned(value: number, digits = 1): string {
	const rounded = Number(value.toFixed(digits));
	if (rounded === 0) return '0';
	return `${rounded > 0 ? '+' : '−'}${formatDays(Math.abs(rounded), digits)}`;
}

/** Rövid dátum: „szept. 14.” / „14 Sept”. */
export function formatShortDay(iso: string): string {
	return formatShortDate(iso);
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
