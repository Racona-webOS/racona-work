/**
 * A havi szabadság-ellenőrzés tiszta segédfüggvényeinek tesztjei
 * (server/leave-month-confirmation-utils.ts; specs/leave-month-confirmation.md).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	buildMonthSnapshot,
	formatMonthLabel,
	isMonthClosable,
	monthBounds,
	monthSendBlocker,
	parseDisputeItems,
	parseYearMonth,
	planSendAction,
	snapshotFingerprint,
	summarizeSnapshot
} from '../server/leave-month-confirmation-utils.ts';
import { listWorkingDays } from '../server/leave-day-utils.ts';

// 2026. szeptember: 1. kedd; 5–6., 12–13. hétvége
const september = () =>
	buildMonthSnapshot({
		from: '2026-09-01',
		to: '2026-09-30',
		workingDays: listWorkingDays('2026-09-01', '2026-09-30'),
		days: [
			{ day: '2026-09-07', leaveType: 'annual' },
			{ day: '2026-09-04', leaveType: 'annual' },
			{ day: '2026-09-08', leaveType: 'annual' },
			{ day: '2026-09-15', leaveType: 'sick' }
		],
		pending: [
			{ day: '2026-09-21', leaveType: 'annual' },
			{ day: '2026-09-15', leaveType: 'annual' }
		]
	});

describe('hónap', () => {
	test('monthBounds a hónap hosszát a naptárból adja (szökőév is)', () => {
		expect(monthBounds(2026, 9)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
		expect(monthBounds(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
		expect(monthBounds(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
	});

	test('parseYearMonth elutasítja az érvénytelen hónapot', () => {
		expect(parseYearMonth('2026', 9)).toEqual({ year: 2026, month: 9 });
		expect(() => parseYearMonth(2026, 13)).toThrow('hónap');
		expect(() => parseYearMonth(2026, 0)).toThrow('hónap');
	});

	test('jövőbeli hónapra és lezárt évre nem küldhető, a folyó hónapra igen (D3)', () => {
		expect(monthSendBlocker(2026, 9, '2026-09-15', null)).toBeNull();
		expect(monthSendBlocker(2026, 8, '2026-09-15', null)).toBeNull();
		expect(monthSendBlocker(2026, 10, '2026-09-15', null)).toBe('future');
		expect(monthSendBlocker(2025, 12, '2026-09-15', 2025)).toBe('closed');
		expect(monthSendBlocker(2026, 1, '2026-09-15', 2025)).toBeNull();
	});

	test('formatMonthLabel', () => {
		expect(formatMonthLabel(2026, 9, 'hu')).toBe('2026. szeptember');
		expect(formatMonthLabel(2026, 9, 'en')).toBe('September 2026');
	});
});

describe('pillanatkép', () => {
	test('rendez, és a jóváhagyott nap nem függő (D7)', () => {
		const s = september();
		expect(s.days.map((d) => d.day)).toEqual(['2026-09-04', '2026-09-07', '2026-09-08', '2026-09-15']);
		expect(s.pending).toEqual([{ day: '2026-09-21', leaveType: 'annual' }]);
	});

	test('az ujjlenyomat a sorrendtől független, a típusra érzékeny (D5)', () => {
		const a = [
			{ day: '2026-09-07', leaveType: 'annual' },
			{ day: '2026-09-04', leaveType: 'annual' }
		];
		expect(snapshotFingerprint(a)).toBe(snapshotFingerprint([...a].reverse()));
		expect(snapshotFingerprint(a)).toBe('2026-09-04:annual,2026-09-07:annual');
		expect(snapshotFingerprint([{ day: '2026-09-04', leaveType: 'sick' }, a[0]])).not.toBe(snapshotFingerprint(a));
		expect(snapshotFingerprint([])).toBe('');
	});

	test('az összegzés típusonként szakaszol, a hétvége nem szakít', () => {
		const summary = summarizeSnapshot(september());
		expect(summary.dayCount).toBe(4);
		expect(summary.byType).toEqual([
			{ leaveType: 'annual', days: 3 },
			{ leaveType: 'sick', days: 1 }
		]);
		expect(summary.periods).toEqual([
			{ leaveType: 'annual', startDate: '2026-09-04', endDate: '2026-09-08', days: 3 },
			{ leaveType: 'sick', startDate: '2026-09-15', endDate: '2026-09-15', days: 1 }
		]);
		expect(summary.pendingDayCount).toBe(1);
	});
});

describe('planSendAction (D6)', () => {
	test('új, változott, érintetlen és eltérést jelzett tétel', () => {
		expect(planSendAction(null, 'x')).toBe('send');
		expect(planSendAction({ status: 'pending', fingerprint: 'x' }, 'x')).toBe('none');
		expect(planSendAction({ status: 'accepted', fingerprint: 'x' }, 'x')).toBe('none');
		expect(planSendAction({ status: 'closed', fingerprint: 'x' }, 'x')).toBe('none');
		expect(planSendAction({ status: 'pending', fingerprint: 'x' }, 'y')).toBe('resend');
		expect(planSendAction({ status: 'accepted', fingerprint: 'x' }, 'y')).toBe('resend');
		expect(planSendAction({ status: 'disputed', fingerprint: 'x' }, 'y')).toBe('none');
	});

	test('isMonthClosable (D10)', () => {
		expect(isMonthClosable([])).toBe(false);
		expect(isMonthClosable([{ status: 'accepted', stale: false }, { status: 'closed', stale: false }])).toBe(true);
		expect(isMonthClosable([{ status: 'accepted', stale: true }])).toBe(false);
		expect(isMonthClosable([{ status: 'accepted', stale: false }, { status: null, stale: false }])).toBe(false);
		expect(isMonthClosable([{ status: 'disputed', stale: false }])).toBe(false);
	});
});

describe('parseDisputeItems (D8)', () => {
	test('a három tételtípus, nap szerint rendezve', () => {
		const { items, note } = parseDisputeItems(
			[
				{ kind: 'missing', day: '2026-09-22', leaveType: 'sick' },
				{ kind: 'not_on_leave', day: '2026-09-04' },
				{ kind: 'wrong_type', day: '2026-09-15', leaveType: 'annual' }
			],
			'  A 22-én beteg voltam.  ',
			september()
		);
		expect(items).toEqual([
			{ kind: 'not_on_leave', day: '2026-09-04' },
			{ kind: 'wrong_type', day: '2026-09-15', leaveType: 'annual' },
			{ kind: 'missing', day: '2026-09-22', leaveType: 'sick' }
		]);
		expect(note).toBe('A 22-én beteg voltam.');
	});

	test('megjegyzés tétel nélkül is elég, de üresen nem küldhető', () => {
		expect(parseDisputeItems([], 'Valami nem stimmel', september()).items).toEqual([]);
		expect(() => parseDisputeItems([], '   ', september())).toThrow('Jelöld meg');
	});

	test('hibás tételek', () => {
		const s = september();
		const bad = (item: unknown) => () => parseDisputeItems([item], null, s);
		expect(bad({ kind: 'not_on_leave', day: '2026-09-09' })).toThrow('nincs rögzített');
		expect(bad({ kind: 'missing', day: '2026-09-04', leaveType: 'annual' })).toThrow('már van');
		expect(bad({ kind: 'missing', day: '2026-09-05', leaveType: 'annual' })).toThrow('munkanapra');
		expect(bad({ kind: 'missing', day: '2026-09-09' })).toThrow('típusát');
		expect(bad({ kind: 'wrong_type', day: '2026-09-04', leaveType: 'annual' })).toThrow('ugyanaz');
		expect(bad({ kind: 'wrong_type', day: '2026-09-04', leaveType: 'nope' })).toThrow('helyes típust');
		expect(bad({ kind: 'not_on_leave', day: '2026-10-01' })).toThrow('nem ebbe a hónapba');
		expect(bad({ kind: 'bogus', day: '2026-09-04' })).toThrow('eltérés-típus');
		expect(() =>
			parseDisputeItems(
				[
					{ kind: 'not_on_leave', day: '2026-09-04' },
					{ kind: 'wrong_type', day: '2026-09-04', leaveType: 'sick' }
				],
				null,
				s
			)
		).toThrow('Egy napra egy');
	});
});
