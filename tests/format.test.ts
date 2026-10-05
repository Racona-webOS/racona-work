/**
 * A nyelvfüggő formázó segédek tesztjei (src/utils/format.ts, trips/format.ts).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	appLocale,
	formatDate,
	formatDateTime,
	formatNumber,
	formatShortDay,
	toDate
} from '../src/utils/format.ts';
import {
	formatDay,
	formatHuf,
	formatTimeRange,
	officialDateTime,
	officialDay
} from '../src/components/trips/format.ts';

describe('toDate', () => {
	test('a csak napot tartalmazó értéket helyi napként értelmezi (nem csúszik el)', () => {
		const date = toDate('2025-03-01')!;
		expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2025, 2, 1]);
	});

	test('üres és hibás értékre null', () => {
		expect(toDate(null)).toBeNull();
		expect(toDate(undefined)).toBeNull();
		expect(toDate('')).toBeNull();
		expect(toDate('nem dátum')).toBeNull();
	});
});

describe('formázás a felület nyelvén', () => {
	test('SDK nélkül magyar', () => {
		expect(appLocale()).toBe('hu-HU');
		expect(formatDate('2025-08-12')).toBe('2025. 08. 12.');
	});

	test('dátum magyarul és angolul (en-GB)', () => {
		expect(formatDate('2025-08-12', undefined, 'hu-HU')).toBe('2025. 08. 12.');
		expect(formatDate('2025-08-12', undefined, 'en-GB')).toBe('12/08/2025');
		expect(formatDate(null)).toBe('—');
	});

	test('rövid nap', () => {
		expect(formatShortDay('2025-09-14', 'hu-HU')).toBe('szept. 14.');
		// Az ICU verziójától függ, hogy „Sep” vagy „Sept”
		expect(formatShortDay('2025-09-14', 'en-GB')).toMatch(/^14 Sept?$/);
	});

	test('dátum és időpont', () => {
		const value = new Date(2025, 7, 12, 14, 3);
		expect(formatDateTime(value, { dateStyle: 'short', timeStyle: 'short' }, 'hu-HU')).toBe('2025. 08. 12. 14:03');
		expect(formatDateTime(value, { dateStyle: 'short', timeStyle: 'short' }, 'en-GB')).toBe('12/08/2025, 14:03');
	});

	test('szám tizedesvesszővel vagy ponttal', () => {
		expect(formatNumber(3.25, { maximumFractionDigits: 1 }, 'hu-HU')).toBe('3,3');
		expect(formatNumber(3.25, { maximumFractionDigits: 1 }, 'en-GB')).toBe('3.3');
		expect(formatNumber(12345, undefined, 'en-GB')).toBe('12,345');
	});
});

describe('kiküldetések', () => {
	test('a felület a nyelv szerinti formátumot kapja', () => {
		expect(formatDay('2025-08-12', 'en-GB')).toBe('12/08/2025');
		expect(formatTimeRange('2025-08-12T08:00', '2025-08-12T16:30', 'en-GB')).toBe('12/08/2025 08:00–16:30');
		expect(formatHuf(12345, false, 'en-GB')).toBe('12,345 Ft');
	});

	test('a hivatalos nyomtatvány formátuma nyelvtől függetlenül magyar', () => {
		expect(officialDay('2025-08-12')).toBe('2025.08.12.');
		expect(officialDateTime('2025-08-12T08:00')).toBe('2025.08.12. 08:00');
		// A magyar ezreselválasztó nem törő szóköz
		expect(formatHuf(12345, false, 'hu-HU')).toBe('12\u00a0345 Ft');
	});
});
