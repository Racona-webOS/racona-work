/**
 * A szabadságkeret-számítás tesztjei (server/leave-entitlement.ts).
 *
 * Nem a server/ alatt él, mert az a mappa teljes egészében bekerül a csomagba.
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	calculateAnnualLeave,
	calculateSickLeave,
	carryOverUsage,
	defaultCarryOverDeadline,
	parentalDeadline,
	parentalEligibleFrom,
	paternityDeadline,
	paternityStartDate,
	type EntitlementInput,
	type EntitlementItemCode
} from '../server/leave-entitlement.ts';

function input(overrides: Partial<EntitlementInput> = {}): EntitlementInput {
	return {
		year: 2026,
		birthDate: '1995-06-15', // 2026-ban 31 éves → +3
		hireDate: '2020-01-01',
		employmentEndDate: null,
		children: [],
		extras: [],
		policy: { extraDaysForAll: 0 },
		...overrides
	};
}

function itemDays(result: ReturnType<typeof calculateAnnualLeave>, code: EntitlementItemCode) {
	return result.items.find((i) => i.code === code)?.days ?? 0;
}

function warningCodes(result: ReturnType<typeof calculateAnnualLeave>) {
	return result.warnings.map((w) => w.code);
}

describe('életkor szerinti pótszabadság (Mt. 117. §)', () => {
	const cases: Array<[number, number]> = [
		[24, 0],
		[25, 1],
		[27, 1],
		[28, 2],
		[31, 3],
		[33, 4],
		[35, 5],
		[37, 6],
		[39, 7],
		[41, 8],
		[43, 9],
		[44, 9],
		[45, 10],
		[60, 10]
	];

	for (const [age, days] of cases) {
		test(`${age} éves → +${days}`, () => {
			const r = calculateAnnualLeave(input({ birthDate: `${2026 - age}-06-15` }));
			expect(itemDays(r, 'age')).toBe(days);
		});
	}

	test('az év számít, nem a születésnap: december 31-i születésnap is egész évre ad', () => {
		const r = calculateAnnualLeave(input({ birthDate: '2001-12-31' }));
		expect(itemDays(r, 'age')).toBe(1);
	});
});

describe('fiatal munkavállaló (Mt. 119. § (1))', () => {
	test('17 éves → +5', () => {
		expect(itemDays(calculateAnnualLeave(input({ birthDate: '2009-03-01' })), 'youth')).toBe(5);
	});
	test('18 éves (a betöltés éve) → +5', () => {
		expect(itemDays(calculateAnnualLeave(input({ birthDate: '2008-11-30' })), 'youth')).toBe(5);
	});
	test('19 éves → 0', () => {
		expect(itemDays(calculateAnnualLeave(input({ birthDate: '2007-01-01' })), 'youth')).toBe(0);
	});
});

describe('gyermek után járó pótszabadság (Mt. 118. §)', () => {
	const child = (birthDate: string, isDisabled = false) => ({ birthDate, isDisabled });

	test('a 16. életév betöltésének évében még számít', () => {
		const r = calculateAnnualLeave(input({ children: [child('2010-12-31')] }));
		expect(itemDays(r, 'children')).toBe(2);
	});
	test('a 16. életév utáni évben már nem számít', () => {
		const r = calculateAnnualLeave(input({ children: [child('2009-01-01')] }));
		expect(itemDays(r, 'children')).toBe(0);
	});
	test('a születés évében már számít', () => {
		const r = calculateAnnualLeave(input({ children: [child('2026-12-01')] }));
		expect(itemDays(r, 'children')).toBe(2);
	});
	test('a születés előtti évben nem számít', () => {
		const r = calculateAnnualLeave(input({ year: 2025, children: [child('2026-02-01')] }));
		expect(itemDays(r, 'children')).toBe(0);
	});
	test('2 gyerek → 4, 3 gyerek → 7, 4 gyerek → 7', () => {
		const two = [child('2015-01-01'), child('2018-01-01')];
		expect(itemDays(calculateAnnualLeave(input({ children: two })), 'children')).toBe(4);
		const three = [...two, child('2020-01-01')];
		expect(itemDays(calculateAnnualLeave(input({ children: three })), 'children')).toBe(7);
		const four = [...three, child('2022-01-01')];
		expect(itemDays(calculateAnnualLeave(input({ children: four })), 'children')).toBe(7);
	});
	test('1 fogyatékos gyerek → 2 + 2', () => {
		const r = calculateAnnualLeave(input({ children: [child('2015-01-01', true)] }));
		expect(itemDays(r, 'children')).toBe(2);
		expect(itemDays(r, 'disabled_children')).toBe(2);
		expect(r.totalDays).toBe(20 + 3 + 4);
	});
	test('3 gyerek, ebből 1 fogyatékos → 7 + 2', () => {
		const r = calculateAnnualLeave(
			input({ children: [child('2012-01-01', true), child('2015-01-01'), child('2019-01-01')] })
		);
		expect(itemDays(r, 'children') + itemDays(r, 'disabled_children')).toBe(9);
	});
	test('a már nem beszámító fogyatékos gyerek után sem jár plusz', () => {
		const r = calculateAnnualLeave(input({ children: [child('2008-01-01', true)] }));
		expect(itemDays(r, 'disabled_children')).toBe(0);
	});
});

describe('arányosítás (Mt. 121. §)', () => {
	test('a spec példája: 1987, két gyerekből egy számít, belépés 2026-03-01 → 24', () => {
		const r = calculateAnnualLeave(
			input({
				birthDate: '1987-04-10',
				hireDate: '2026-03-01',
				children: [
					{ birthDate: '2012-05-05', isDisabled: false },
					{ birthDate: '2009-09-09', isDisabled: false }
				]
			})
		);
		expect(r.fullYearDays).toBe(29);
		expect(r.employedDays).toBe(306);
		expect(r.totalDays).toBe(24);
	});
	test('teljes évnél nincs arányosítás', () => {
		const r = calculateAnnualLeave(input());
		expect(r.employedDays).toBe(365);
		expect(r.totalDays).toBe(r.fullYearDays);
	});
	test('belépés december 31-én → 0', () => {
		const r = calculateAnnualLeave(input({ hireDate: '2026-12-31' }));
		expect(r.employedDays).toBe(1);
		expect(r.totalDays).toBe(0);
	});
	test('kilépés év közben', () => {
		// 23 nap × 181/365 = 11,4 → 11
		const r = calculateAnnualLeave(input({ employmentEndDate: '2026-06-30' }));
		expect(r.fullYearDays).toBe(23);
		expect(r.employedDays).toBe(181);
		expect(r.totalDays).toBe(11);
	});
	test('belépés és kilépés ugyanabban az évben', () => {
		// 23 × 92/365 = 5,8 → 6
		const r = calculateAnnualLeave(
			input({ hireDate: '2026-04-01', employmentEndDate: '2026-07-01' })
		);
		expect(r.employedDays).toBe(92);
		expect(r.totalDays).toBe(6);
	});
	test('szökőév: 366 nappal számol', () => {
		const r = calculateAnnualLeave(input({ year: 2028, hireDate: '2028-07-02' }));
		expect(r.daysInYear).toBe(366);
		expect(r.employedDays).toBe(183);
	});
	test('a fél nap felfelé kerekül: 31 × 183/366 = 15,5 → 16', () => {
		const r = calculateAnnualLeave(
			input({
				year: 2028,
				birthDate: '1980-01-01', // 48 év → +10
				hireDate: '2028-07-02',
				policy: { extraDaysForAll: 1 }
			})
		);
		expect(r.fullYearDays).toBe(31);
		expect(r.totalDays).toBe(16);
	});
	test('a fél alatti töredék lefelé kerekül', () => {
		// 20 × 100/365 = 5,48 → 5
		const r = calculateAnnualLeave(
			input({ birthDate: null, hireDate: '2026-09-23' })
		);
		expect(r.employedDays).toBe(100);
		expect(r.totalDays).toBe(5);
	});
	test('nem volt munkaviszonyban az évben → 0, figyelmeztetéssel', () => {
		const r = calculateAnnualLeave(input({ hireDate: '2027-01-01' }));
		expect(r.totalDays).toBe(0);
		expect(warningCodes(r)).toContain('not_employed_in_year');
	});
	test('a kilépés a belépés előtt van → 0, figyelmeztetéssel', () => {
		const r = calculateAnnualLeave(
			input({ hireDate: '2026-05-01', employmentEndDate: '2026-04-01' })
		);
		expect(r.totalDays).toBe(0);
		expect(warningCodes(r)).toEqual(['end_before_hire']);
	});
	test('hiányzó belépési dátum: teljes évvel számol, figyelmeztetéssel', () => {
		const r = calculateAnnualLeave(input({ hireDate: null }));
		expect(r.employedDays).toBe(365);
		expect(warningCodes(r)).toContain('missing_hire_date');
	});
});

describe('egyéb pótszabadságok és céges többlet', () => {
	test('az idén érvényes egészségkárosodás → +5', () => {
		const r = calculateAnnualLeave(
			input({
				extras: [{ kind: 'health_impaired', days: 5, validFrom: '2026-08-01', validTo: null }]
			})
		);
		expect(itemDays(r, 'health_impaired')).toBe(5);
	});
	test('a tavaly lejárt egészségkárosodás → 0', () => {
		const r = calculateAnnualLeave(
			input({
				extras: [{ kind: 'health_impaired', days: 5, validFrom: null, validTo: '2025-12-31' }]
			})
		);
		expect(itemDays(r, 'health_impaired')).toBe(0);
	});
	test('két átfedő egészségkárosodási időszak csak egyszer számít', () => {
		const r = calculateAnnualLeave(
			input({
				extras: [
					{ kind: 'health_impaired', days: 5, validFrom: '2024-01-01', validTo: '2026-03-31' },
					{ kind: 'health_impaired', days: 5, validFrom: '2026-04-01', validTo: null }
				]
			})
		);
		expect(r.items.filter((i) => i.code === 'health_impaired')).toHaveLength(1);
		expect(itemDays(r, 'health_impaired')).toBe(5);
	});
	test('egyedi pótszabadság a megjegyzésével', () => {
		const r = calculateAnnualLeave(
			input({
				extras: [{ kind: 'custom', days: 2, validFrom: null, validTo: null, note: 'Hűségnap' }]
			})
		);
		const item = r.items.find((i) => i.code === 'custom');
		expect(item?.days).toBe(2);
		expect(item?.params?.note).toBe('Hűségnap');
	});
	test('céges többlet mindenkinek', () => {
		const r = calculateAnnualLeave(
			input({ policy: { extraDaysForAll: 2, extraDaysLabel: 'KSZ' } })
		);
		expect(itemDays(r, 'policy')).toBe(2);
		expect(r.totalDays).toBe(20 + 3 + 2);
	});
});

describe('hiányzó születési dátum', () => {
	test('csak az alap, a gyerek- és az egyéb tételek, figyelmeztetéssel', () => {
		const r = calculateAnnualLeave(
			input({
				birthDate: null,
				children: [{ birthDate: '2015-01-01', isDisabled: false }]
			})
		);
		expect(r.items.map((i) => i.code)).toEqual(['base', 'children']);
		expect(r.totalDays).toBe(22);
		expect(warningCodes(r)).toContain('missing_birth_date');
	});
});

describe('nem munkában töltött idő (Mt. 115. §)', () => {
	test('fizetés nélküli szabadság arányosan csökkent: 23 × (365 − 31)/365 = 21,05 → 21', () => {
		const r = calculateAnnualLeave(
			input({ absences: [{ kind: 'unpaid_leave', from: '2026-03-01', to: '2026-03-31' }] })
		);
		expect(r.nonCountingDays).toBe(31);
		expect(r.totalDays).toBe(21);
	});
	test('az átfedő időszakok csak egyszer számítanak', () => {
		const r = calculateAnnualLeave(
			input({
				absences: [
					{ kind: 'unpaid_leave', from: '2026-03-01', to: '2026-03-20' },
					{ kind: 'unpaid_request', from: '2026-03-15', to: '2026-03-31' },
					{ kind: 'unexcused_absence', from: '2026-04-01', to: '2026-04-01' }
				]
			})
		);
		expect(r.nonCountingDays).toBe(32);
	});
	test('csak a munkaviszony idejére eső rész számít', () => {
		const r = calculateAnnualLeave(
			input({
				hireDate: '2026-03-01',
				absences: [
					{ kind: 'unpaid_leave', from: '2025-12-01', to: '2026-03-10' },
					{ kind: 'other', from: '2026-12-20', to: '2027-01-10' }
				]
			})
		);
		expect(r.nonCountingDays).toBe(10 + 12);
		expect(r.employedDays).toBe(306);
	});
	test('gyermekgondozási fizetés nélküli szabadság: az első 6 hónap még beszámít', () => {
		// 2025-10-15-től 2026-04-14-ig beszámít, 2026-04-15 és 12-31 között nem → 261 nap
		const r = calculateAnnualLeave(
			input({ absences: [{ kind: 'childcare_unpaid_leave', from: '2025-10-15', to: '2027-06-30' }] })
		);
		expect(r.nonCountingDays).toBe(261);
	});
	test('6 hónapnál rövidebb gyermekgondozási szabadság nem csökkent', () => {
		const r = calculateAnnualLeave(
			input({ absences: [{ kind: 'childcare_unpaid_leave', from: '2026-02-01', to: '2026-07-31' }] })
		);
		expect(r.nonCountingDays).toBe(0);
		expect(r.totalDays).toBe(r.fullYearDays);
	});
	test('a hu-mt@1 pillanatképek (absences nélkül) ugyanúgy számolnak', () => {
		const r = calculateAnnualLeave(input());
		expect(r.nonCountingDays).toBe(0);
		expect(r.totalDays).toBe(23);
	});
});

describe('betegszabadság (Mt. 126. §)', () => {
	test('teljes évre 15 nap', () => {
		expect(calculateSickLeave({ year: 2026, hireDate: '2020-01-01', employmentEndDate: null }).totalDays).toBe(15);
	});
	test('év közbeni belépésnél arányos: 15 × 306/365 = 12,6 → 13', () => {
		expect(calculateSickLeave({ year: 2026, hireDate: '2026-03-01', employmentEndDate: null }).totalDays).toBe(13);
	});
	test('nincs munkaviszony az évben → 0', () => {
		expect(calculateSickLeave({ year: 2026, hireDate: '2027-01-01', employmentEndDate: null }).totalDays).toBe(0);
	});
});

describe('apasági és szülői szabadság határidői', () => {
	test('apasági: a születést követő negyedik hónap vége', () => {
		expect(paternityDeadline('2026-05-15')).toBe('2026-09-30');
		expect(paternityDeadline('2026-10-01')).toBe('2027-02-28');
		expect(paternityDeadline('2027-10-31')).toBe('2028-02-29');
	});
	test('apasági örökbefogadásnál: a határozat véglegessé válását követő negyedik hónap vége', () => {
		expect(paternityDeadline('2024-11-02', '2026-06-20')).toBe('2026-10-31');
		expect(paternityStartDate('2024-11-02', '2026-06-20')).toBe('2026-06-20');
		expect(paternityStartDate('2024-11-02', null)).toBe('2024-11-02');
	});
	test('szülői: a harmadik születésnap előtti nap', () => {
		expect(parentalDeadline('2025-06-10')).toBe('2028-06-09');
		expect(parentalDeadline('2024-02-29')).toBe('2027-02-27');
	});
	test('szülői: egy év munkaviszony után jár', () => {
		expect(parentalEligibleFrom('2025-03-01')).toBe('2026-03-01');
		expect(parentalEligibleFrom('2024-02-29')).toBe('2025-02-28');
	});
});

describe('áthozott napok határideje (Mt. 123. §)', () => {
	const base = { carriedDays: 5, deadline: '2027-03-31' };
	test('alapból március 31.', () => {
		expect(defaultCarryOverDeadline(2027)).toBe('2027-03-31');
	});
	test('a határidőig kezdődő kérelmek először az áthozottból fogynak', () => {
		const r = carryOverUsage({
			...base,
			requests: [
				{ startDate: '2027-02-10', days: 2 },
				{ startDate: '2027-03-31', days: 1 },
				{ startDate: '2027-04-01', days: 3 }
			],
			today: '2027-03-01'
		});
		expect(r.usedDays).toBe(3);
		expect(r.remainingDays).toBe(2);
		expect(r.status).toBe('due_soon');
		expect(r.daysLeft).toBe(30);
	});
	test('több kivett nap sem visz az áthozott fölé', () => {
		const r = carryOverUsage({ ...base, requests: [{ startDate: '2027-01-05', days: 10 }], today: '2027-01-10' });
		expect(r.usedDays).toBe(5);
		expect(r.remainingDays).toBe(0);
		expect(r.status).toBe('done');
	});
	test('van még idő', () => {
		expect(carryOverUsage({ ...base, requests: [], today: '2027-01-15' }).status).toBe('open');
	});
	test('lejárt, és maradt kiadatlan nap', () => {
		const r = carryOverUsage({ ...base, requests: [{ startDate: '2027-03-01', days: 1 }], today: '2027-04-02' });
		expect(r.status).toBe('expired');
		expect(r.remainingDays).toBe(4);
		expect(r.daysLeft).toBe(-2);
	});
	test('lejárt, de mindent kivett → rendben', () => {
		const r = carryOverUsage({ ...base, requests: [{ startDate: '2027-03-01', days: 5 }], today: '2027-06-01' });
		expect(r.status).toBe('done');
	});
});
