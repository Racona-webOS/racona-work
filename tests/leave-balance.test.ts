/**
 * A szabadság egyenleg számításainak tesztjei
 * (server/leave-balance-utils.ts; specs/leave-balance-overview.md, 4.3–4.5).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	aggregate,
	classifyStatus,
	dayPosition,
	employeeFigures,
	filterRows,
	monthEnd
} from '../server/leave-balance-utils.ts';
import type { BalanceEmployeeRow } from '../server/leave-balance-utils.ts';
import { uniformPlan } from '../server/leave-usage-plan-utils.ts';

const PLAN = uniformPlan();
const TODAY = '2026-09-14';
const zeros = () => Array(12).fill(0) as number[];

function row(overrides: Partial<BalanceEmployeeRow>): BalanceEmployeeRow {
	return {
		employeeId: 1,
		name: 'Teszt',
		image: null,
		position: null,
		hireDate: null,
		employmentEndDate: null,
		totalDays: 25,
		takenByMonth: zeros(),
		bookedByMonth: zeros(),
		pending: 0,
		projectIds: [],
		...overrides
	};
}

/** A 4.5 példa: 25 napos keret, 14 nap kivett, 3 nap decemberre lefoglalva. */
const A = row({
	employeeId: 1,
	takenByMonth: [0, 0, 2, 0, 0, 3, 5, 4, 0, 0, 0, 0],
	bookedByMonth: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3],
	projectIds: [1]
});
/** 20 napos keret, szeptember közepéig 18 nap kivett. */
const B = row({ employeeId: 2, totalDays: 20, takenByMonth: [2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0], projectIds: [2] });

describe('segédek', () => {
	test('hónap vége és a nap helye a tengelyen', () => {
		expect(monthEnd(2026, 2)).toBe('2026-02-28');
		expect(monthEnd(2028, 2)).toBe('2028-02-29');
		expect(dayPosition('2026-09-30')).toBe(9);
		expect(dayPosition('2026-09-15')).toBe(8.5);
	});
});

describe('classifyStatus', () => {
	const base = { totalDays: 25, toleranceDays: 2.5, criticalDays: 5, planned: 7 };

	test('a határon még Rendben', () => {
		expect(classifyStatus({ ...base, remaining: 9.5, free: 9.5 })).toBe('ok');
		expect(classifyStatus({ ...base, remaining: 4.5, free: 4.5 })).toBe('ok');
	});

	test('magas, túl magas, gyorsan fogy', () => {
		expect(classifyStatus({ ...base, remaining: 10, free: 10 })).toBe('slightly_high');
		expect(classifyStatus({ ...base, remaining: 12.5, free: 12.5 })).toBe('too_high');
		expect(classifyStatus({ ...base, remaining: 4, free: 4 })).toBe('fast');
	});

	test('keret nélkül nincs státusz', () => {
		expect(classifyStatus({ ...base, totalDays: 0, remaining: 0, free: 0, planned: 0 })).toBe('none');
	});
});

describe('employeeFigures', () => {
	test('a 4.5 példa: a lefoglalt napok miatt Rendben', () => {
		const f = employeeFigures(A, PLAN, 2026, TODAY);
		const planned = 25 * (1 - (67 + (8 * 14) / 30) / 100);
		expect(f.taken).toBe(14);
		expect(f.booked).toBe(3);
		expect(f.remaining).toBe(11);
		expect(f.free).toBe(8);
		expect(f.planned).toBeCloseTo(planned, 6);
		expect(f.deviation).toBeCloseTo(11 - planned, 6);
		expect(f.toleranceDays).toBe(2.5);
		expect(f.status).toBe('ok');
	});

	test('lefoglalt napok nélkül ugyanez Enyhén magas', () => {
		expect(employeeFigures({ ...A, bookedByMonth: zeros() }, PLAN, 2026, TODAY).status).toBe('slightly_high');
	});

	test('a lefoglalt nap nem okoz Gyorsan fogyt', () => {
		const booked = row({ takenByMonth: [0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0], bookedByMonth: [0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0] });
		expect(employeeFigures(booked, PLAN, 2026, TODAY).status).toBe('ok');
	});

	test('gyorsan fogy, túl magas, keret nélkül', () => {
		expect(employeeFigures(B, PLAN, 2026, TODAY).status).toBe('fast');
		expect(employeeFigures(row({}), PLAN, 2026, TODAY).status).toBe('too_high');
		expect(employeeFigures(row({ totalDays: 0 }), PLAN, 2026, TODAY).status).toBe('none');
	});

	test('szeptemberi belépő: a terv a belépéstől számol', () => {
		const f = employeeFigures(row({ totalDays: 10, hireDate: '2026-09-01' }), PLAN, 2026, TODAY);
		expect(f.planned).toBeCloseTo(10 * (1 - ((8 / 33) * 100 * 14) / 30 / 100), 6);
		expect(f.status).toBe('slightly_high');
	});

	test('trend: legfeljebb 6 pont, az utolsó a vonatkozási nap', () => {
		const f = employeeFigures(A, PLAN, 2026, TODAY);
		expect(f.trend.map((p) => p.day)).toEqual([
			'2026-04-30',
			'2026-05-31',
			'2026-06-30',
			'2026-07-31',
			'2026-08-31',
			TODAY
		]);
		expect(f.trend[5].deviation).toBeCloseTo(f.deviation, 6);
		expect(employeeFigures(A, PLAN, 2026, '2026-01-10').trend).toHaveLength(1);
	});
});

describe('filterRows', () => {
	const C = row({ employeeId: 3, projectIds: [] });
	const running = new Set([1]);

	test('mindenki, projekt, projekt nélkül (a lezárt projekt nem számít)', () => {
		expect(filterRows([A, B, C], { kind: 'all' }, running)).toHaveLength(3);
		expect(filterRows([A, B, C], { kind: 'project', projectId: 2 }, running).map((r) => r.employeeId)).toEqual([2]);
		expect(filterRows([A, B, C], { kind: 'no_project' }, running).map((r) => r.employeeId)).toEqual([2, 3]);
	});
});

describe('aggregate', () => {
	test('összegek és mutatók', () => {
		const s = aggregate([A, B], PLAN, 2026, TODAY);
		expect(s.count).toBe(2);
		expect(s.okCount).toBe(1);
		expect(s.attentionCount).toBe(1);
		expect(s.totalDays).toBe(45);
		expect(s.taken).toBe(32);
		expect(s.remaining).toBe(13);
		expect(s.booked).toBe(3);
		expect(s.usageRatio).toBeCloseTo(32 / 45, 6);
		expect(s.averageRemaining).toBe(6.5);
		expect(s.previousMonthRemaining).toBe(15);
	});

	test('a grafikon: tényleges a vonatkozási napig, lefoglalt utána', () => {
		const { chart } = aggregate([A, B], PLAN, 2026, TODAY);
		expect(chart.actual).toHaveLength(10);
		expect(chart.actual[0]).toEqual({ x: 0, value: 45 });
		expect(chart.actual[8]).toEqual({ x: 8, value: 15 });
		expect(chart.actual[9].x).toBeCloseTo(8 + 14 / 30, 6);
		expect(chart.actual[9].value).toBe(13);
		expect(chart.refX).toBeCloseTo(8 + 14 / 30, 6);
		expect(chart.booked.map((p) => p.value)).toEqual([13, 13, 13, 13, 10]);
		expect(chart.planned).toHaveLength(13);
		expect(chart.bandHigh[0].value).toBe(49.5);
		expect(chart.bandLow[12].value).toBe(0);
	});

	test('havi részletek a tooltiphez', () => {
		const { months } = aggregate([A, B], PLAN, 2026, TODAY).chart;
		expect(months[7]).toMatchObject({ month: 8, actual: 15, booked: null });
		expect(months[8]).toMatchObject({ month: 9, actual: 13, booked: 13 });
		expect(months[9].actual).toBeNull();
		expect(months[11].booked).toBe(10);
	});

	test('múltbeli év: a teljes év, lefoglalt nélkül', () => {
		const s = aggregate([{ ...A, bookedByMonth: zeros() }], PLAN, 2025, TODAY);
		expect(s.chart.actual).toHaveLength(13);
		expect(s.chart.refX).toBe(12);
		expect(s.chart.booked).toEqual([]);
		expect(s.previousMonthRemaining).toBe(11);
	});

	test('jövő év: nincs tényleges görbe, a lefoglalt az év elejétől', () => {
		const future = row({ bookedByMonth: [0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0] });
		const s = aggregate([future], PLAN, 2027, TODAY);
		expect(s.chart.actual).toEqual([]);
		expect(s.chart.refX).toBeNull();
		expect(s.previousMonthRemaining).toBeNull();
		expect(s.chart.booked[0]).toEqual({ x: 0, value: 25 });
		expect(s.chart.booked[7]).toEqual({ x: 7, value: 20 });
	});

	test('üres szűrés', () => {
		const s = aggregate([], PLAN, 2026, TODAY);
		expect(s.count).toBe(0);
		expect(s.usageRatio).toBeNull();
		expect(s.averageRemaining).toBeNull();
	});
});
