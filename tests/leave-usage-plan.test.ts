/**
 * A szabadságfelhasználási terv tesztjei
 * (server/leave-usage-plan-utils.ts; specs/leave-balance-overview.md, 4. fejezet).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	employeePlanShare,
	normalizeStoredPlan,
	referenceDay,
	uniformMonths,
	uniformPlan,
	validatePlan
} from '../server/leave-usage-plan-utils.ts';

const UNIFORM = uniformMonths();
const NO_DATES = { hireDate: null, employmentEndDate: null };

describe('uniformPlan', () => {
	test('a 12 havi érték és az alapértelmezett küszöbök', () => {
		expect(UNIFORM).toEqual([8, 17, 25, 33, 42, 50, 58, 67, 75, 83, 92, 100]);
		expect(uniformPlan()).toEqual({ months: UNIFORM, tolerancePct: 10, criticalPct: 20 });
	});
});

describe('validatePlan', () => {
	test('az egyenletes terv érvényes', () => {
		const { plan, errors } = validatePlan(uniformPlan());
		expect(errors).toEqual([]);
		expect(plan).toEqual(uniformPlan());
	});

	test('12 hónap kell', () => {
		const { plan, errors } = validatePlan({ ...uniformPlan(), months: UNIFORM.slice(0, 11) });
		expect(plan).toBeNull();
		expect(errors).toEqual([{ field: 'months', code: 'months_length' }]);
	});

	test('0 és 100 közötti egész szám', () => {
		const months = [...UNIFORM];
		months[2] = 101;
		months[4] = 41.5;
		const { errors } = validatePlan({ ...uniformPlan(), months });
		expect(errors).toEqual([
			{ field: 'months', month: 3, code: 'month_range' },
			{ field: 'months', month: 5, code: 'month_range' }
		]);
	});

	test('hónapról hónapra nem csökkenhet, a kisebb hónap kapja a hibát', () => {
		const months = [...UNIFORM];
		months[6] = 40;
		const { errors } = validatePlan({ ...uniformPlan(), months });
		expect(errors).toEqual([{ field: 'months', month: 7, code: 'month_decreasing' }]);
	});

	test('a december lehet 100 alatt', () => {
		const months = [...UNIFORM];
		months[10] = 85;
		months[11] = 90;
		expect(validatePlan({ ...uniformPlan(), months }).errors).toEqual([]);
	});

	test('a küszöbök: 1–100, a kritikus nagyobb a tűrésnél', () => {
		expect(validatePlan({ months: UNIFORM, tolerancePct: 0, criticalPct: 20 }).errors).toEqual([
			{ field: 'tolerancePct', code: 'tolerance_range' }
		]);
		expect(validatePlan({ months: UNIFORM, tolerancePct: 10, criticalPct: 101 }).errors).toEqual([
			{ field: 'criticalPct', code: 'critical_range' }
		]);
		expect(validatePlan({ months: UNIFORM, tolerancePct: 20, criticalPct: 20 }).errors).toEqual([
			{ field: 'criticalPct', code: 'critical_not_above' }
		]);
	});

	test('a hibás tárolt érték nem terv', () => {
		expect(normalizeStoredPlan(null)).toBeNull();
		expect(normalizeStoredPlan({ months: [1, 2, 3] })).toBeNull();
		expect(normalizeStoredPlan(uniformPlan())).toEqual(uniformPlan());
	});
});

describe('employeePlanShare', () => {
	test('teljes évre a hónap végén a terv értéke', () => {
		expect(employeePlanShare(UNIFORM, NO_DATES, 2026, '2026-03-31')).toBe(25);
		expect(employeePlanShare(UNIFORM, NO_DATES, 2026, '2026-12-31')).toBe(100);
	});

	test('hónapon belül a nap arányában (4.5 példa: szeptember 14.)', () => {
		expect(employeePlanShare(UNIFORM, NO_DATES, 2026, '2026-09-14')).toBeCloseTo(67 + (8 * 14) / 30, 6);
	});

	test('a korábbi évben belépett dolgozónak a teljes évi terv', () => {
		const employment = { hireDate: '2020-05-01', employmentEndDate: null };
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-06-30')).toBe(50);
	});

	test('szökőév februárja', () => {
		expect(employeePlanShare(UNIFORM, NO_DATES, 2028, '2028-02-29')).toBe(17);
		expect(employeePlanShare(UNIFORM, NO_DATES, 2028, '2028-02-15')).toBeCloseTo(8 + (9 * 15) / 29, 6);
	});

	test('belépés szeptember 1-jén: a terv a belépés hónapjától indul (4.5)', () => {
		const employment = { hireDate: '2026-09-01', employmentEndDate: null };
		const september = (8 / 33) * 100;
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-08-31')).toBe(0);
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-09-30')).toBeCloseTo(september, 6);
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-09-14')).toBeCloseTo((september * 14) / 30, 6);
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-12-31')).toBe(100);
	});

	test('a belépés napja előtt 0, akkor is, ha a hónap közepén lép be', () => {
		const employment = { hireDate: '2026-09-15', employmentEndDate: null };
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-09-14')).toBe(0);
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-09-15')).toBeGreaterThan(0);
	});

	test('kilépés június 30-án: a kilépés hónapjára 100%', () => {
		const employment = { hireDate: null, employmentEndDate: '2026-06-30' };
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-05-31')).toBe(84);
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-06-15')).toBe(92);
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-06-30')).toBe(100);
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-08-01')).toBe(100);
	});

	test('kilépésnél akkor is 100% a cél, ha a terv decembere kevesebb', () => {
		const months = [...UNIFORM];
		months[11] = 90;
		expect(employeePlanShare(months, NO_DATES, 2026, '2026-12-31')).toBe(90);
		expect(employeePlanShare(months, { hireDate: null, employmentEndDate: '2026-11-30' }, 2026, '2026-11-30')).toBe(100);
	});

	test('belépés és kilépés ugyanabban a hónapban', () => {
		const employment = { hireDate: '2026-04-01', employmentEndDate: '2026-04-20' };
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-04-15')).toBe(50);
		expect(employeePlanShare(UNIFORM, employment, 2026, '2026-04-20')).toBe(100);
	});

	test('ha a terv a munkaviszony idejére lapos, egyenletesen halad', () => {
		const months = [10, 20, 20, 20, 20, 50, 60, 70, 80, 90, 95, 100];
		const employment = { hireDate: '2026-03-01', employmentEndDate: '2026-05-31' };
		expect(employeePlanShare(months, employment, 2026, '2026-03-31')).toBeCloseTo(100 / 3, 6);
		expect(employeePlanShare(months, employment, 2026, '2026-04-30')).toBeCloseTo(200 / 3, 6);
	});

	test('nincs munkaviszony az évben', () => {
		expect(employeePlanShare(UNIFORM, { hireDate: '2027-01-10', employmentEndDate: null }, 2026, '2026-12-31')).toBe(0);
		expect(employeePlanShare(UNIFORM, { hireDate: null, employmentEndDate: '2025-10-31' }, 2026, '2026-03-01')).toBe(100);
	});

	test('az éven kívüli nap: előtte 0, utána a cél', () => {
		const months = [...UNIFORM];
		months[11] = 90;
		expect(employeePlanShare(months, NO_DATES, 2026, '2025-12-31')).toBe(0);
		expect(employeePlanShare(months, NO_DATES, 2026, '2027-01-01')).toBe(90);
	});
});

describe('referenceDay', () => {
	test('a mai nap az évre szorítva', () => {
		expect(referenceDay(2026, '2026-09-14')).toBe('2026-09-14');
		expect(referenceDay(2025, '2026-09-14')).toBe('2025-12-31');
		expect(referenceDay(2027, '2026-09-14')).toBe('2027-01-01');
	});
});
