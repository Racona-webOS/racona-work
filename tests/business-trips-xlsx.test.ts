/**
 * A kiküldetési rendelvény xlsx-kitöltőjének tesztjei
 * (src/components/trips/xlsx-template.ts, settlement-xlsx.ts).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { calculateSettlement, periodLabel, type SettlementDocument } from '../server/trip-calc.ts';
import { fillSettlementXlsx } from '../src/components/trips/settlement-xlsx.ts';
import { excelSerial, shiftReferences } from '../src/components/trips/xlsx-template.ts';

const template = new Uint8Array(readFileSync(new URL('../assets/templates/kikuldetesi-rendelveny.xlsx', import.meta.url)));

function sampleDoc(kms: number[], overrides: Partial<SettlementDocument> = {}): SettlementDocument {
	const calc = calculateSettlement({
		trips: kms.map((km, i) => ({ id: i + 1, km })),
		consumption: 6.7,
		unit: 'l',
		price: 600,
		normCostPerKm: 15
	});
	return {
		settlementId: 1,
		status: 'approved',
		documentNumber: 'KR-2025-0001',
		year: 2025,
		month: 8,
		periodLabel: periodLabel(2025, 8),
		issuedOn: '2025-08-31',
		employer: { name: 'Minta Kft.', address: '1135 Budapest, Kisgömb utca 25–27.', taxNumber: '12345678-2-13' },
		employee: {
			id: 1,
			name: 'Kovács Zsófia',
			address: '1111 Budapest, Példa utca 1.',
			birthDate: '1990-05-12',
			birthPlace: 'Szeged',
			motherName: 'Minta Anna',
			taxId: '8123456789'
		},
		vehicle: {
			id: 1,
			plate: 'MXA-752',
			model: 'Audi A4',
			engineCc: 1968,
			fuelType: 'diesel',
			priceType: 'diesel',
			consumptionSource: 'regulation',
			consumptionOverrideReason: null
		},
		calc,
		rows: kms.map((km, i) => ({
			tripId: i + 1,
			index: i + 1,
			startedAt: `2025-08-${String(i + 1).padStart(2, '0')} 08:00`,
			endedAt: `2025-08-${String(i + 1).padStart(2, '0')} 16:00`,
			route: 'Lakcím (1111 Budapest, Példa utca 1.) → Martonvásár → vissza',
			purpose: 'Rendszerbevezetés & oktatás',
			orderedByUserId: 7,
			orderedByName: 'Nagy Péter',
			orderedByOverridden: false,
			km,
			routedKm: km,
			distanceReason: null,
			price: 600,
			amount: calc.rows[i].amount
		})),
		approval: { byName: 'Szabó Éva', at: '2025-09-02' },
		payment: null,
		note: null,
		warnings: [],
		...overrides
	};
}

function sheetXml(bytes: Uint8Array): string {
	return strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
}

function cell(xml: string, ref: string): string | null {
	const m = xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
	if (!m) return null;
	return m[1] ?? '';
}

function cellText(xml: string, ref: string): string {
	const inner = cell(xml, ref) ?? '';
	return (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
		.replace(/&amp;/g, '&');
}

describe('xlsx-sablon', () => {
	test('a sablonban nincs személyes adat, csak jelölők', () => {
		const xml = sheetXml(template);
		expect(xml).toContain('{{employee.name}}');
		expect(xml).toContain('{{trip.km}}');
		expect(xml).not.toMatch(/MXA|Printnet|Csikihegyek|8426/);
	});

	test('a minta rendelvény (3 út): fejléc, sorok, végösszeg', () => {
		const xml = sheetXml(fillSettlementXlsx(template, sampleDoc([62, 62, 88])));
		expect(cellText(xml, 'I1')).toBe('Biz.szám: KR-2025-0001');
		expect(cellText(xml, 'B4')).toBe('2025. év augusztus hó');
		expect(cellText(xml, 'G7')).toBe('Kovács Zsófia');
		expect(cellText(xml, 'G9')).toBe('születési ideje, helye: 1990.05.12. Szeged');
		expect(cellText(xml, 'B10')).toBe('Adószáma: 12345678-2-13');
		expect(cellText(xml, 'B12')).toContain('MXA-752');
		expect(cellText(xml, 'H13')).toBe('6.7');

		// Utak: 16–18., üres sorok a 28.-ig (13 soros nyomtatvány), lábléc a 29.-től
		expect(cellText(xml, 'G16')).toBe('62');
		expect(cellText(xml, 'G18')).toBe('88');
		expect(cellText(xml, 'E16')).toContain('Rendszerbevezetés & oktatás');
		expect(cellText(xml, 'C16')).toBe(String(excelSerial('2025-08-01 08:00')));
		expect(cell(xml, 'I16')).toContain('<f>G16*(H16/100*$H$13+$L$13)</f>');
		expect(cellText(xml, 'I16')).toBe('3422.4');
		expect(cell(xml, 'I19')).toBe(''); // üres sor: nincs képlet

		expect(cell(xml, 'G29')).toContain('<f>SUM(G16:G28)</f>');
		expect(cellText(xml, 'G29')).toBe('212');
		expect(cell(xml, 'I30')).toContain('<f>SUM(I16:I28)</f>');
		expect(cellText(xml, 'I30')).toBe('11702.4');
		expect(cell(xml, 'I31')).toContain('<f>ROUND(I30,0)-I30</f>');
		expect(cellText(xml, 'I31')).toBe('-0.4');
		expect(cellText(xml, 'I32')).toBe('11702');
		expect(cellText(xml, 'B34')).toContain('Szabó Éva, 2025.09.02.');
	});

	test('20 úttal a sorok, az összevont cellák és a SUM tartományok eltolódnak', () => {
		const kms = Array.from({ length: 20 }, () => 10);
		const bytes = fillSettlementXlsx(template, sampleDoc(kms));
		const xml = sheetXml(bytes);
		expect(cellText(xml, 'G35')).toBe('10'); // 16 + 19
		expect(cell(xml, 'G36')).toContain('<f>SUM(G16:G35)</f>');
		expect(cellText(xml, 'G36')).toBe('200');
		expect(xml).toContain('<mergeCell ref="G39:H39"/>'); // Mindösszesen: 20 → 39
		expect(xml).toContain('<mergeCell ref="B13:G13"/>'); // a mintasor feletti nem mozdul
		expect(xml).toContain('<dimension ref="A1:L42"/>');
		const workbook = strFromU8(unzipSync(bytes)['xl/workbook.xml']);
		expect(workbook).toContain('fullCalcOnLoad="1"');
	});

	test('hiányzó adószám: a cellában csak a felirat marad, a fájl érvényes', () => {
		const doc = sampleDoc([62]);
		const xml = sheetXml(
			fillSettlementXlsx(template, { ...doc, employer: { ...doc.employer, taxNumber: null }, documentNumber: null })
		);
		expect(cellText(xml, 'B10')).toBe('Adószáma: ');
		expect(cellText(xml, 'I1')).toBe('Biz.szám: '); // bizonylatszám jóváhagyás előtt üres
	});
});

describe('hivatkozások eltolása', () => {
	const ctx = { protoRow: 16, extra: 4 };

	test('a mintasor alatti sorok tolódnak, a felettiek nem', () => {
		expect(shiftReferences('G17*(H17/100*$H$13+$L$13)', ctx)).toBe('G21*(H21/100*$H$13+$L$13)');
	});

	test('a mintasorra mutató tartomány bővül', () => {
		expect(shiftReferences('SUM(G16:G16)', ctx)).toBe('SUM(G16:G20)');
	});

	test('a mintasor ismétlésénél a relatív hivatkozás az új sorra kerül', () => {
		expect(shiftReferences('G16*(H16/100*$H$13+$L$13)', { ...ctx, cloneRow: 18 })).toBe('G18*(H18/100*$H$13+$L$13)');
	});

	test('szövegkonstansban és függvénynévben nem cserél', () => {
		expect(shiftReferences('IF(A20="B17",LOG10(C17),0)', ctx)).toBe('IF(A24="B17",LOG10(C21),0)');
	});
});
