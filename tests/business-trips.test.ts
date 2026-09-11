/**
 * A kiküldetési rendelvény számításainak tesztjei (server/trip-calc.ts).
 *
 * Nem a server/ alatt él, mert az a mappa teljes egészében bekerül a csomagba.
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	ENABLED_FUEL_TYPES,
	ENABLED_PRICE_TYPES,
	calculateSettlement,
	dieselNorm,
	formatDocumentNumber,
	monogram,
	normalizeTaxNumber,
	periodLabel,
	petrolNorm,
	routeLabel,
	routePoints,
	roundKm,
	settlementFileName,
	settlementWarnings,
	blocksApproval,
	validateTaxId,
	vehicleConsumption,
	type Waypoint
} from '../server/trip-calc.ts';
import { decodePolyline, encodePolyline } from '../server/polyline.ts';

/** Érvényes adóazonosító jel a megadott születési dátumhoz (a 7–9. jegy tetszőleges). */
function taxIdFor(birthDate: string, middle = '123'): string {
	const [y, m, d] = birthDate.split('-').map(Number);
	const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1867, 0, 1)) / 86_400_000);
	for (let serial = Number(middle); serial < 1000; serial++) {
		const body = `8${String(days).padStart(5, '0')}${String(serial).padStart(3, '0')}`;
		const sum = body.split('').reduce((acc, digit, i) => acc + Number(digit) * (i + 1), 0);
		if (sum % 11 < 10) return body + String(sum % 11);
	}
	throw new Error('Nincs érvényes sorszám');
}

describe('alapnorma (60/1992. Korm. rendelet)', () => {
	test('benzin sávhatárok', () => {
		expect(petrolNorm(1000)).toBe(7.6);
		expect(petrolNorm(1001)).toBe(8.6);
		expect(petrolNorm(1500)).toBe(8.6);
		expect(petrolNorm(1501)).toBe(9.5);
		expect(petrolNorm(2000)).toBe(9.5);
		expect(petrolNorm(2001)).toBe(11.4);
		expect(petrolNorm(3000)).toBe(11.4);
		expect(petrolNorm(3001)).toBe(13.3);
	});

	test('gázolaj sávhatárok', () => {
		expect(dieselNorm(1200)).toBe(5.7);
		expect(dieselNorm(1500)).toBe(5.7);
		expect(dieselNorm(1501)).toBe(6.7);
		expect(dieselNorm(2000)).toBe(6.7);
		expect(dieselNorm(2001)).toBe(7.6);
		expect(dieselNorm(3000)).toBe(7.6);
		expect(dieselNorm(3001)).toBe(9.5);
	});

	test('hengerűrtartalom nélkül nincs norma', () => {
		expect(petrolNorm(null)).toBeNull();
		expect(dieselNorm(0)).toBeNull();
	});

	test('az 1. fázisban csak benzin és gázolaj választható', () => {
		expect(ENABLED_FUEL_TYPES).toEqual(['petrol', 'diesel']);
		expect(ENABLED_PRICE_TYPES).toEqual(['petrol', 'diesel']);
	});
});

describe('fogyasztás', () => {
	test('jogszabályi norma', () => {
		expect(vehicleConsumption({ fuelType: 'diesel', engineCc: 1968, consumptionOverride: null })).toEqual({
			value: 6.7,
			unit: 'l',
			source: 'regulation'
		});
	});

	test('az egyedi érték felülírja a táblázatot', () => {
		expect(vehicleConsumption({ fuelType: 'petrol', engineCc: 1400, consumptionOverride: 7.2 })).toEqual({
			value: 7.2,
			unit: 'l',
			source: 'override'
		});
	});

	test('elektromos autónál egyedi érték kell', () => {
		expect(vehicleConsumption({ fuelType: 'electric', engineCc: null, consumptionOverride: null })).toEqual({
			value: null,
			unit: 'kWh',
			source: 'missing'
		});
	});
});

describe('rendelvény számítása', () => {
	test('a minta rendelvény: 62 + 62 + 88 km, dízel 2000 cm³, 600 Ft/l', () => {
		const calc = calculateSettlement({
			trips: [
				{ id: 1, km: 62 },
				{ id: 2, km: 62 },
				{ id: 3, km: 88 }
			],
			consumption: 6.7,
			unit: 'l',
			price: 600,
			normCostPerKm: 15
		});
		expect(calc.ratePerKm).toBeCloseTo(55.2, 10);
		expect(calc.rows.map((r) => r.amount)).toEqual([3422.4, 3422.4, 4857.6]);
		expect(calc.totalKm).toBe(212);
		expect(calc.subtotal).toBe(11702.4);
		expect(calc.rounding).toBe(-0.4);
		expect(calc.total).toBe(11702);
	});

	test('a fél forint felfelé kerekedik', () => {
		// 1 km × (500 × 5 / 100 + 15,5) = 40,5 Ft
		const calc = calculateSettlement({
			trips: [{ id: 1, km: 1 }],
			consumption: 5,
			unit: 'l',
			price: 500,
			normCostPerKm: 15.5
		});
		expect(calc.subtotal).toBe(40.5);
		expect(calc.total).toBe(41);
		expect(calc.rounding).toBe(0.5);
	});

	test('hiányzó NAV-ár: nincs összeg, a km megmarad', () => {
		const calc = calculateSettlement({
			trips: [
				{ id: 1, km: 62 },
				{ id: 2, km: 30 }
			],
			consumption: 6.7,
			unit: 'l',
			price: null,
			normCostPerKm: 15
		});
		expect(calc.totalKm).toBe(92);
		expect(calc.ratePerKm).toBeNull();
		expect(calc.rows.every((r) => r.amount === null)).toBe(true);
		expect(calc.total).toBeNull();
	});

	test('km-kerekítés: a fél felfelé', () => {
		expect(roundKm(61.4)).toBe(61);
		expect(roundKm(61.5)).toBe(62);
	});
});

describe('figyelmeztetések', () => {
	const complete = {
		employee: {
			homeAddress: '1111 Budapest, Példa utca 1.',
			birthDate: '1990-05-12',
			birthPlace: 'Szeged',
			motherName: 'Minta Anna',
			taxId: taxIdFor('1990-05-12')
		},
		organization: { address: '1135 Budapest, Kisgömb utca 25–27.', taxNumber: '12345678-1-12' },
		tripsWithoutOrderer: 0,
		consumptionMissing: false,
		missingPrice: null
	};

	test('minden adat megvan → nincs figyelmeztetés', () => {
		expect(settlementWarnings(complete)).toEqual([]);
	});

	test('hiányzó adószám és adóazonosító', () => {
		const warnings = settlementWarnings({
			...complete,
			employee: { ...complete.employee, taxId: null },
			organization: { ...complete.organization, taxNumber: '  ' }
		});
		expect(warnings).toEqual([
			{ kind: 'employee_field', field: 'tax_id' },
			{ kind: 'organization_field', field: 'tax_number' }
		]);
		expect(warnings.some(blocksApproval)).toBe(false);
	});

	test('a hiányzó NAV-ár blokkolja a jóváhagyást', () => {
		const warnings = settlementWarnings({
			...complete,
			tripsWithoutOrderer: 3,
			missingPrice: { priceType: 'diesel', year: 2025, month: 8 }
		});
		expect(warnings).toEqual([
			{ kind: 'missing_ordered_by', tripCount: 3 },
			{ kind: 'missing_fuel_price', priceType: 'diesel', year: 2025, month: 8 }
		]);
		expect(warnings.filter(blocksApproval)).toHaveLength(1);
	});
});

describe('adóazonosító jel', () => {
	const valid = taxIdFor('1990-05-12');

	test('érvényes szám, egyező születési dátummal', () => {
		expect(validateTaxId(valid, '1990-05-12')).toEqual({ valid: true, birthDateMismatch: false });
	});

	test('rossz ellenőrző jegy', () => {
		const wrong = valid.slice(0, 9) + String((Number(valid[9]) + 1) % 10);
		expect(validateTaxId(wrong).valid).toBe(false);
	});

	test('formátumhiba: 9 jegy, nem 8-cal kezdődik', () => {
		expect(validateTaxId(valid.slice(0, 9)).valid).toBe(false);
		expect(validateTaxId('7' + valid.slice(1)).valid).toBe(false);
	});

	test('a születési dátum nem egyezik a 2–6. jeggyel', () => {
		expect(validateTaxId(valid, '1990-05-13')).toEqual({ valid: true, birthDateMismatch: true });
	});
});

describe('adószám', () => {
	test('normalizálás', () => {
		expect(normalizeTaxNumber('12345678-1-12')).toBe('12345678-1-12');
		expect(normalizeTaxNumber('12345678112')).toBe('12345678-1-12');
		expect(normalizeTaxNumber(' 12345678 - 1 - 12 ')).toBe('12345678-1-12');
		expect(normalizeTaxNumber('')).toBeNull();
		expect(normalizeTaxNumber(null)).toBeNull();
	});

	test('hibás formátum', () => {
		expect(() => normalizeTaxNumber('1234-5678')).toThrow();
		expect(() => normalizeTaxNumber('123456781123')).toThrow();
	});
});

describe('formázás', () => {
	test('időszak', () => {
		expect(periodLabel(2025, 8)).toBe('2025. év augusztus hó');
	});

	test('bizonylatszám', () => {
		expect(formatDocumentNumber('KR', 2025, 1)).toBe('KR-2025-0001');
		expect(formatDocumentNumber('', 2025, 12)).toBe('2025-0012');
	});

	test('monogram magyar kettős betűkkel', () => {
		expect(monogram('Kovács Zsófia')).toBe('kzs');
		expect(monogram('Szabó Béla')).toBe('szb');
		expect(monogram('Dzsida Ágnes')).toBe('dzsa');
		expect(monogram('Nagy  Csaba')).toBe('ncs');
	});

	test('fájlnév a mai elnevezés szerint', () => {
		expect(settlementFileName('MXA-752', 'Kovács Zsófia', 2025, 8)).toBe(
			'kikuldetesi_rendelveny_MXA752_kzs_202508'
		);
	});
});

describe('útvonal', () => {
	const home: Waypoint = { label: 'Lakcím', address: '1111 Budapest', lat: 47.47, lng: 19.03 };
	const work: Waypoint = { label: 'Munkahely', address: '1135 Budapest', lat: 47.54, lng: 19.07 };
	const target: Waypoint = { label: 'Martonvásár', address: '2462 Martonvásár', lat: 47.31, lng: 18.79 };

	test('vissza a kiindulópontra', () => {
		expect(routeLabel([home, target], 'origin')).toBe('Lakcím → Martonvásár → vissza');
		expect(routePoints([home, target], 'origin')).toEqual([
			{ lat: 47.47, lng: 19.03 },
			{ lat: 47.31, lng: 18.79 },
			{ lat: 47.47, lng: 19.03 }
		]);
	});

	test('máshová érkezik vissza', () => {
		expect(routeLabel([work, target, home], 'other')).toBe('Munkahely → Martonvásár → Lakcím');
		expect(routePoints([work, target, home], 'other')).toHaveLength(3);
	});

	test('csak odaút', () => {
		expect(routeLabel([home, target], 'none')).toBe('Lakcím → Martonvásár');
	});

	test('a rendelvényen a név mellett a cím is', () => {
		expect(routeLabel([work, { ...target, label: '2462 Martonvásár' }], 'origin', true)).toBe(
			'Munkahely (1135 Budapest) → 2462 Martonvásár → vissza'
		);
	});
});

describe('polyline (precision 6)', () => {
	test('oda-vissza kódolás', () => {
		const coords: [number, number][] = [
			[19.03, 47.47],
			[18.790123, 47.310456],
			[19.07, 47.54]
		];
		const decoded = decodePolyline(encodePolyline(coords));
		expect(decoded).toHaveLength(3);
		decoded.forEach(([lng, lat], i) => {
			expect(lng).toBeCloseTo(coords[i][0], 6);
			expect(lat).toBeCloseTo(coords[i][1], 6);
		});
	});
});
