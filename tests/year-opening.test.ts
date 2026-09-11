/**
 * Az évnyitás és a nyitott év szabályainak tesztjei
 * (server/leave-closing.ts, server/leave-year-opening.ts; specs/year-opening.md).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { isDayUnopened, isYearOpen, lockedDayErrors } from '../server/leave-closing.ts';
import { openingBlockReason } from '../server/leave-year-opening.ts';

describe('isYearOpen', () => {
	test('a megnyitott évig nyitott, a lezártig nem', () => {
		const state = { closedYear: 2024, openedYear: 2026 };
		expect(isYearOpen(2024, state)).toBe(false);
		expect(isYearOpen(2025, state)).toBe(true);
		expect(isYearOpen(2026, state)).toBe(true);
		expect(isYearOpen(2027, state)).toBe(false);
	});

	test('beállítás nélkül egy év sincs megnyitva', () => {
		expect(isYearOpen(2026, { closedYear: null, openedYear: null })).toBe(false);
		expect(isDayUnopened('2026-05-04', null)).toBe(true);
	});
});

describe('lockedDayErrors', () => {
	test('a lezárt és a meg nem nyitott napokat külön hibában sorolja fel', () => {
		const errors = lockedDayErrors(['2024-12-30', '2026-06-01', '2027-01-04'], {
			closedYear: 2024,
			openedYear: 2026
		});
		expect(errors).toHaveLength(2);
		expect(errors[0]).toContain('2024-12-30');
		expect(errors[1]).toContain('2027. év még nincs megnyitva');
		expect(errors[1]).toContain('2027-01-04');
	});

	test('nyitott napokra nincs hiba', () => {
		expect(lockedDayErrors(['2026-06-01'], { closedYear: null, openedYear: 2026 })).toEqual([]);
	});
});

describe('openingBlockReason', () => {
	test('a legutolsó megnyitott utáni év nyitható, legfeljebb a jövő év', () => {
		const state = { closedYear: null, openedYear: 2026 };
		expect(openingBlockReason(2027, state, 2026)).toBeNull();
		expect(openingBlockReason(2026, state, 2026)).toContain('már meg van nyitva');
		expect(openingBlockReason(2028, state, 2026)).toContain('Legfeljebb a jövő év');
	});

	test('sorban kell nyitni', () => {
		expect(openingBlockReason(2028, { closedYear: null, openedYear: 2026 }, 2027)).toContain(
			'Előbb a(z) 2027. évet'
		);
	});

	test('megnyitott év nélkül bármelyik nem lezárt év nyitható a jövő évig', () => {
		const state = { closedYear: 2025, openedYear: null };
		expect(openingBlockReason(2026, state, 2026)).toBeNull();
		expect(openingBlockReason(2025, state, 2026)).toContain('le van zárva');
		expect(openingBlockReason(2027, state, 2026)).toBeNull();
	});
});
