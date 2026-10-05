/**
 * Nyelvfüggő dátum- és számformázás a felülethez.
 *
 * A formátum a felület nyelvét követi (magyar: hu-HU, angol: en-GB), nem a
 * böngészőét, ezért a `toLocaleDateString()` paraméter nélkül nem használható.
 * A nyelvet a hívás pillanatában olvassuk az SDK-ból, így a segédeket bármelyik
 * komponens és modul hívhatja külön paraméter nélkül.
 *
 * A hivatalos magyar nyomtatványok (kiküldetési rendelvény) nem ezt használják,
 * azok formátuma nyelvtől függetlenül magyar (trips/format.ts `official*`).
 */

import { resolveSdk } from './sdk.js';

export type AppLocale = 'hu-HU' | 'en-GB';

type DateInput = string | number | Date | null | undefined;

/** A felület nyelvének megfelelő formázási nyelv (SDK nélkül, pl. tesztben: magyar). */
export function appLocale(): AppLocale {
	return resolveSdk('racona-work')?.i18n?.locale === 'en' ? 'en-GB' : 'hu-HU';
}

/**
 * Dátummá alakítás. A csak napot tartalmazó `YYYY-MM-DD` értéket helyi napként
 * értelmezzük: a `new Date('2025-03-01')` UTC éjfélt adna, ami nyugatabbra
 * az előző napra csúszna.
 */
export function toDate(value: DateInput): Date | null {
	if (value === null || value === undefined || value === '') return null;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
	if (typeof value === 'string') {
		const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Dátum („2025. 08. 12.” / „12/08/2025”); üres vagy hibás értékre „—”. */
export function formatDate(
	value: DateInput,
	options?: Intl.DateTimeFormatOptions,
	locale: AppLocale = appLocale()
): string {
	const date = toDate(value);
	return date ? date.toLocaleDateString(locale, options) : '—';
}

/** Dátum és időpont („2025. 08. 12. 14:03:00” / „12/08/2025, 14:03:00”). */
export function formatDateTime(
	value: DateInput,
	options?: Intl.DateTimeFormatOptions,
	locale: AppLocale = appLocale()
): string {
	const date = toDate(value);
	return date ? date.toLocaleString(locale, options) : '—';
}

/** Rövid nap a hónap nevével („szept. 14.” / „14 Sept”). */
export function formatShortDay(value: DateInput, locale: AppLocale = appLocale()): string {
	return formatDate(value, { month: 'short', day: 'numeric' }, locale);
}

/** Szám a nyelv tizedes- és ezreselválasztójával („3,5” / „3.5”). */
export function formatNumber(
	value: number,
	options?: Intl.NumberFormatOptions,
	locale: AppLocale = appLocale()
): string {
	return value.toLocaleString(locale, options);
}
