/**
 * Kiküldetések — közös formázó segédek a felülethez.
 */

import type { SettlementWarning, SettlementStatus } from '../../../server/functions.js';
import { PRICE_TYPE_LABELS } from '../../../server/trip-calc.js';
import { appLocale, formatDate, formatNumber } from '../../utils/format.js';
import type { AppLocale } from '../../utils/format.js';

type T = (key: string, vars?: Record<string, string | number>) => string;

// A számok és dátumok a felület nyelvén jelennek meg; a hivatalos nyomtatvány
// (settlement-print.ts, settlement-xlsx.ts) magyar formátumot kér (`hu-HU`, `official*`).

export function formatHuf(
	value: number | null | undefined,
	decimals = false,
	locale: AppLocale = appLocale()
): string {
	if (value === null || value === undefined) return '—';
	const digits = decimals ? 2 : 0;
	return `${formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits }, locale)} Ft`;
}

export function formatKm(value: number | null | undefined): string {
	if (value === null || value === undefined) return '—';
	return `${formatDecimal(value)} km`;
}

export function formatDecimal(value: number | null | undefined): string {
	return value === null || value === undefined ? '—' : formatNumber(value, { maximumFractionDigits: 1 });
}

/** `YYYY-MM-DD` → a felület nyelvén („2025. 08. 12.” / „12/08/2025”). */
export function formatDay(value: string | null | undefined, locale: AppLocale = appLocale()): string {
	return formatDate(value, undefined, locale);
}

/**
 * `YYYY-MM-DDTHH:mm` (budapesti falióra-idő) → a nap a felület nyelvén, az
 * időpont változatlanul. Nem alakítjuk át `Date`-té, hogy ne csússzon időzónával.
 */
export function formatDateTime(value: string | null | undefined, locale: AppLocale = appLocale()): string {
	if (!value) return '—';
	const [date, time] = value.split(/[T ]/);
	return `${formatDay(date, locale)} ${time ?? ''}`.trim();
}

/** Csak az időpont, ha a kezdés és a vég ugyanarra a napra esik. */
export function formatTimeRange(start: string, end: string, locale: AppLocale = appLocale()): string {
	const [startDay, startTime] = start.split(/[T ]/);
	const [endDay, endTime] = end.split(/[T ]/);
	return startDay === endDay
		? `${formatDay(startDay, locale)} ${startTime}–${endTime}`
		: `${formatDateTime(start, locale)} – ${formatDateTime(end, locale)}`;
}

/** A hivatalos nyomtatvány napja: `YYYY-MM-DD` → `2025.08.12.` (mindig magyar). */
export function officialDay(value: string | null | undefined): string {
	return value ? `${value.replace(/-/g, '.')}.` : '—';
}

/** A hivatalos nyomtatvány időpontja: `YYYY-MM-DDTHH:mm` → `2025.08.12. 08:00` (mindig magyar). */
export function officialDateTime(value: string | null | undefined): string {
	if (!value) return '—';
	const [date, time] = value.split(/[T ]/);
	return `${officialDay(date)} ${time ?? ''}`.trim();
}

const MONTHS_HU = [
	'január', 'február', 'március', 'április', 'május', 'június',
	'július', 'augusztus', 'szeptember', 'október', 'november', 'december'
];
const MONTHS_EN = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];

export function monthLabel(year: number, month: number, locale = 'hu'): string {
	return locale === 'hu' ? `${year}. ${MONTHS_HU[month - 1]}` : `${MONTHS_EN[month - 1]} ${year}`;
}

export function monthName(month: number, locale = 'hu'): string {
	return (locale === 'hu' ? MONTHS_HU : MONTHS_EN)[month - 1];
}

export function statusLabel(t: T, status: SettlementStatus | null): string {
	return t(`trips.status.${status ?? 'none'}`);
}

export function priceTypeLabel(priceType: string, locale = 'hu'): string {
	const labels = PRICE_TYPE_LABELS[priceType as keyof typeof PRICE_TYPE_LABELS];
	return labels ? labels[locale === 'hu' ? 'hu' : 'en'] : priceType;
}

/** A figyelmeztetés szövege (K15). */
export function warningText(t: T, warning: SettlementWarning, locale = 'hu'): string {
	switch (warning.kind) {
		case 'employee_field':
			return t('trips.warning.employeeField', { field: t(`trips.field.${warning.field}`) });
		case 'organization_field':
			return t('trips.warning.organizationField', { field: t(`trips.field.org_${warning.field}`) });
		case 'missing_ordered_by':
			return t('trips.warning.missingOrderedBy', { count: warning.tripCount });
		case 'missing_consumption':
			return t('trips.warning.missingConsumption');
		case 'missing_fuel_price':
			return t('trips.warning.missingFuelPrice', {
				month: monthLabel(warning.year, warning.month, locale),
				type: priceTypeLabel(warning.priceType, locale).toLowerCase()
			});
	}
}

/** Hibaüzenet a remote hívásból (a core előtag nélkül). */
export function errorMessage(err: unknown, fallback: string): string {
	const message = (err as { message?: string })?.message;
	return message ? message.replace(/^\[DevMode\] Remote call failed: \w+ — /, '').replace(/^[A-Z_]+:\s*/, '') : fallback;
}

/** Budapesti helyi idő `YYYY-MM-DDTHH:mm` formában (a datetime-local mezőhöz). */
export function localDateTime(date: Date): string {
	const parts = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Budapest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	}).format(date);
	return parts.replace(' ', 'T');
}
