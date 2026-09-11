/**
 * A szabadságnapok tiszta segédfüggvényeinek tesztjei (server/leave-days.ts).
 *
 * Nem a server/ alatt él, mert az a mappa teljes egészében bekerül a csomagba.
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	daysToPeriods,
	groupDaysByYear,
	groupIntoRuns,
	isWorkingDay,
	listWorkingDays,
	nextDay,
	normalizeDays
} from '../server/leave-days.ts';

// 2026. június 1. hétfő; június 6–7. hétvége
const weekendRule = (day: string) => isWorkingDay(day);

describe('listWorkingDays', () => {
	test('a hétvégét kihagyja', () => {
		expect(listWorkingDays('2026-06-04', '2026-06-09')).toEqual([
			'2026-06-04',
			'2026-06-05',
			'2026-06-08',
			'2026-06-09'
		]);
	});

	test('a munkanaptár felülírja a hétvége-szabályt mindkét irányban', () => {
		const overrides = new Map<string, boolean>([
			['2026-06-05', false], // péntek, munkaszüneti nap
			['2026-06-06', true] // szombat, áthelyezett munkanap
		]);
		expect(listWorkingDays('2026-06-04', '2026-06-08', overrides)).toEqual([
			'2026-06-04',
			'2026-06-06',
			'2026-06-08'
		]);
	});

	test('fordított sorrendnél üres', () => {
		expect(listWorkingDays('2026-06-09', '2026-06-04')).toEqual([]);
	});

	test('a téli-nyári átállás nem tol el napot', () => {
		expect(listWorkingDays('2026-03-27', '2026-03-31')).toEqual([
			'2026-03-27',
			'2026-03-30',
			'2026-03-31'
		]);
	});

	test('rossz formátumra hibát dob', () => {
		expect(() => listWorkingDays('2026-6-4', '2026-06-09')).toThrow();
		expect(() => listWorkingDays('2026-06-04', 'holnap')).toThrow();
	});
});

describe('groupIntoRuns', () => {
	test('a példa három szakasz: június 4–6, július 3–4, augusztus 10', () => {
		// 2026-06-06 szombat: nem munkanap, ezért nem szakít, de mint felvett nap
		// (áthelyezett munkanap) benne van a szakaszban
		const overrides = new Map([['2026-06-06', true]]);
		const runs = groupIntoRuns(
			['2026-08-10', '2026-06-05', '2026-07-03', '2026-06-04', '2026-07-04', '2026-06-06'],
			(day) => isWorkingDay(day, overrides)
		);
		expect(runs).toEqual([
			{ startDate: '2026-06-04', endDate: '2026-06-06', days: ['2026-06-04', '2026-06-05', '2026-06-06'] },
			{ startDate: '2026-07-03', endDate: '2026-07-04', days: ['2026-07-03', '2026-07-04'] },
			{ startDate: '2026-08-10', endDate: '2026-08-10', days: ['2026-08-10'] }
		]);
	});

	test('a hétvége nem szakít: péntek és hétfő egy szakasz', () => {
		const runs = groupIntoRuns(['2026-06-05', '2026-06-08'], weekendRule);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toEqual({
			startDate: '2026-06-05',
			endDate: '2026-06-08',
			days: ['2026-06-05', '2026-06-08']
		});
	});

	test('a munkaszüneti nap sem szakít', () => {
		const overrides = new Map([['2026-06-04', false]]);
		const runs = groupIntoRuns(['2026-06-03', '2026-06-05'], (day) => isWorkingDay(day, overrides));
		expect(runs).toHaveLength(1);
		expect(runs[0].endDate).toBe('2026-06-05');
	});

	test('egy kihagyott munkanap új szakaszt kezd', () => {
		const runs = groupIntoRuns(['2026-06-03', '2026-06-05'], weekendRule);
		expect(runs.map((r) => r.days)).toEqual([['2026-06-03'], ['2026-06-05']]);
	});

	test('az ismétlődő napok egyszer számítanak', () => {
		const runs = groupIntoRuns(['2026-06-03', '2026-06-03', '2026-06-04'], weekendRule);
		expect(runs).toEqual([
			{ startDate: '2026-06-03', endDate: '2026-06-04', days: ['2026-06-03', '2026-06-04'] }
		]);
	});

	test('üres bemenetre üres', () => {
		expect(groupIntoRuns([], weekendRule)).toEqual([]);
	});
});

describe('daysToPeriods', () => {
	test('a naptári napok szerint összefüggő napok egy időszak', () => {
		expect(daysToPeriods(['2026-06-03', '2026-06-01', '2026-06-02'])).toEqual([
			{ from: '2026-06-01', to: '2026-06-03' }
		]);
	});

	test('a hétvége szakít, mert az nem szabadságnap', () => {
		expect(daysToPeriods(['2026-06-04', '2026-06-05', '2026-06-08'])).toEqual([
			{ from: '2026-06-04', to: '2026-06-05' },
			{ from: '2026-06-08', to: '2026-06-08' }
		]);
	});

	test('a hónapváltás nem szakít', () => {
		expect(daysToPeriods(['2026-06-30', '2026-07-01'])).toEqual([
			{ from: '2026-06-30', to: '2026-07-01' }
		]);
	});
});

describe('segédek', () => {
	test('nextDay az évfordulón is jó', () => {
		expect(nextDay('2026-12-31')).toBe('2027-01-01');
		expect(nextDay('2028-02-28')).toBe('2028-02-29');
	});

	test('normalizeDays rendez, szűr, és a nem létező napot elutasítja', () => {
		expect(normalizeDays(['2026-06-02', '2026-06-01', '2026-06-02'])).toEqual([
			'2026-06-01',
			'2026-06-02'
		]);
		expect(() => normalizeDays(['2026-02-30'])).toThrow();
		expect(() => normalizeDays(['2026/06/01'])).toThrow();
	});

	test('groupDaysByYear az évet átlépő napokat szétválasztja', () => {
		const byYear = groupDaysByYear(['2026-12-30', '2026-12-31', '2027-01-04']);
		expect([...byYear.keys()]).toEqual([2026, 2027]);
		expect(byYear.get(2026)).toHaveLength(2);
		expect(byYear.get(2027)).toEqual(['2027-01-04']);
	});
});
