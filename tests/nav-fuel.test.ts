/**
 * A NAV üzemanyagár-oldal feldolgozásának tesztjei (server/nav-fuel.ts).
 *
 * A minták a NAV valódi oldalairól vannak (tests/fixtures/nav), csak az
 * ártáblázat és a linkek. Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
	NavParseError,
	columnKey,
	columnQualifier,
	findArchivePage,
	findYearPage,
	navPath,
	normalizeMapping,
	parseNavFuelTable,
	planNavImport,
	resolveMapping,
	suggestMapping,
	tableVersion,
	type NavFuelTable
} from '../server/nav-fuel.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', 'nav', name), 'utf8');

const PETROL_PROTECTED = 'olmozatlan-motorbenzin-esz-95-vedett-ar-ft-l';
const PETROL_MARKET = 'olmozatlan-motorbenzin-esz-95-piaci-arszabas-ft-l';
const DIESEL_PROTECTED = 'gazolaj-vedett-ar-ft-l';
const DIESEL_MARKET = 'gazolaj-piaci-arszabas-ft-l';

function value(table: NavFuelTable, month: number, key: string): number | null | undefined {
	const index = table.columns.findIndex((c) => c.key === key);
	return table.rows.find((r) => r.month === month)?.values[index];
}

describe('parseNavFuelTable', () => {
	test('2026: védett és piaci ár külön oszlopban', () => {
		const table = parseNavFuelTable(fixture('2026.html'), 2026);
		expect(table.columns.map((c) => c.key)).toEqual([
			PETROL_PROTECTED,
			PETROL_MARKET,
			DIESEL_PROTECTED,
			DIESEL_MARKET,
			'keverek-ft-l',
			'lpg-autogaz-ft-l',
			'cng-autogaz-ft-kg'
		]);
		expect(table.columns[0].label).toBe('Ólmozatlan motorbenzin ESZ-95 (védett ár) (Ft/l)');
		expect(table.rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(value(table, 9, PETROL_PROTECTED)).toBeNull();
		expect(value(table, 9, PETROL_MARKET)).toBe(604);
		expect(value(table, 6, PETROL_PROTECTED)).toBe(595);
		expect(value(table, 6, DIESEL_MARKET)).toBe(731);
		expect(value(table, 9, 'cng-autogaz-ft-kg')).toBe(800);
		expect(table.invalidCells).toEqual([]);
	});

	test('2025: az előző év decembere („december (2024)”) kimarad', () => {
		const table = parseNavFuelTable(fixture('2025.html'), 2025);
		expect(table.rows).toHaveLength(12);
		expect(value(table, 12, 'olmozatlan-motorbenzin-esz-95-ft-l')).toBe(580);
		expect(value(table, 1, 'gazolaj-ft-l')).toBe(638);
	});

	test('2022: hatósági és piaci árszabás', () => {
		const table = parseNavFuelTable(fixture('2022.html'), 2022);
		expect(table.columns.map((c) => c.key)).toContain('gazolaj-hatosagi-arszabas-ft-l');
		expect(value(table, 1, 'gazolaj-piaci-arszabas-ft-l')).toBeNull();
		expect(value(table, 12, 'gazolaj-piaci-arszabas-ft-l')).toBe(825);
	});

	test('más év táblázata hibát ad', () => {
		expect(() => parseNavFuelTable(fixture('2026.html'), 2025)).toThrow(NavParseError);
	});

	test('táblázat nélküli oldal hibát ad', () => {
		expect(() => parseNavFuelTable('<p>Nincs itt semmi</p>', 2026)).toThrow(NavParseError);
	});

	test('összevont cellák esetén hibát ad', () => {
		const html = `<table><tr><td>2026.év</td><td colspan="2">Benzin</td></tr><tr><td>január</td><td>600</td><td>610</td></tr></table>`;
		expect(() => parseNavFuelTable(html, 2026)).toThrow(/összevont/);
	});

	test('tizedesvessző, entitások, értelmezhetetlen cella', () => {
		const html = `<table>
			<tr><td>2026. &eacute;v</td><td>G&aacute;zolaj<br>(Ft/l)</td><td>Benzin (Ft/l)</td></tr>
			<tr><td>február</td><td>598,5</td><td>lásd lent</td></tr>
			<tr><td>Január</td><td>&nbsp;-&nbsp;</td><td>1 000</td></tr>
		</table>`;
		const table = parseNavFuelTable(html, 2026);
		expect(table.columns.map((c) => c.label)).toEqual(['Gázolaj (Ft/l)', 'Benzin (Ft/l)']);
		expect(value(table, 2, 'gazolaj-ft-l')).toBe(598.5);
		expect(value(table, 1, 'gazolaj-ft-l')).toBeNull();
		expect(value(table, 1, 'benzin-ft-l')).toBe(1000);
		expect(table.invalidCells).toEqual([{ month: 2, columnKey: 'benzin-ft-l', raw: 'lásd lent' }]);
	});

	test('kétszer szereplő hónap hibát ad', () => {
		const html = `<table><tr><td>2026</td><td>Benzin</td></tr><tr><td>május</td><td>1</td></tr><tr><td>május</td><td>2</td></tr></table>`;
		expect(() => parseNavFuelTable(html, 2026)).toThrow(/kétszer/);
	});
});

describe('oszlopok', () => {
	test('columnKey és columnQualifier', () => {
		expect(columnKey('Gázolaj (védett ár) (Ft/l)')).toBe('gazolaj-vedett-ar-ft-l');
		expect(columnQualifier('Gázolaj (védett ár) (Ft/l)')).toBe('védett ár');
		expect(columnQualifier('Gázolaj (Ft/l)')).toBeNull();
		expect(columnQualifier('CNG autógáz (Ft/kg)')).toBeNull();
	});

	test('a javaslatban a védett vagy hatósági ár az első, a piaci a tartalék', () => {
		const t2026 = parseNavFuelTable(fixture('2026.html'), 2026);
		expect(suggestMapping(t2026.columns, ['petrol', 'diesel'])).toEqual({
			petrol: [PETROL_PROTECTED, PETROL_MARKET],
			diesel: [DIESEL_PROTECTED, DIESEL_MARKET]
		});
		const t2022 = parseNavFuelTable(fixture('2022.html'), 2022);
		expect(suggestMapping(t2022.columns, ['diesel']).diesel).toEqual([
			'gazolaj-hatosagi-arszabas-ft-l',
			'gazolaj-piaci-arszabas-ft-l'
		]);
		const t2025 = parseNavFuelTable(fixture('2025.html'), 2025);
		expect(suggestMapping(t2025.columns, ['petrol', 'diesel'])).toEqual({
			petrol: ['olmozatlan-motorbenzin-esz-95-ft-l'],
			diesel: ['gazolaj-ft-l']
		});
	});

	test('a mentett hozzárendelés marad, az eltűnt oszlop helyett javaslat jön', () => {
		const t2026 = parseNavFuelTable(fixture('2026.html'), 2026);
		const saved = { petrol: [PETROL_MARKET], diesel: [DIESEL_MARKET, DIESEL_PROTECTED] };
		expect(resolveMapping(saved, t2026.columns, ['petrol', 'diesel'])).toEqual({ mapping: saved, changed: false });

		const t2025 = parseNavFuelTable(fixture('2025.html'), 2025);
		const resolved = resolveMapping(saved, t2025.columns, ['petrol', 'diesel']);
		expect(resolved.changed).toBe(true);
		expect(resolved.mapping).toEqual({ petrol: ['olmozatlan-motorbenzin-esz-95-ft-l'], diesel: ['gazolaj-ft-l'] });
	});

	test('normalizeMapping: legfeljebb két, ismétlés nélküli, érvényes kulcs', () => {
		expect(
			normalizeMapping({ petrol: ['a', 'a', 'b', 'c'], diesel: ['Rossz Kulcs', 3], lpg: ['x'] }, ['petrol', 'diesel'])
		).toEqual({ petrol: ['a', 'b'], diesel: [] });
		expect(normalizeMapping(null, ['petrol'])).toEqual({ petrol: [] });
	});
});

describe('linkek', () => {
	test('az év oldala a gyűjtőoldalon vagy a korábbi évek között', () => {
		const index = fixture('index.html');
		expect(findYearPage(index, 2026)).toBe('/ugyfeliranytu/uzemanyag/2026-ban-alkalmazhato-uzemanyagarak');
		expect(findYearPage(index, 2025)).toBe('/ugyfeliranytu/uzemanyag/2025-ben-alkalmazhato-uzemanyagarak');
		expect(findYearPage(index, 2024)).toBeNull();
		expect(findArchivePage(index)).toBe('/ugyfeliranytu/uzemanyag/Korabbi_evben_alkalma20150212');

		const archive = fixture('korabbi.html');
		expect(findYearPage(archive, 2024)).toBe('/ugyfeliranytu/uzemanyag/2024-ben-alkalmazhato-uzemanyagarak');
		expect(findYearPage(archive, 2017)).toBe('/ugyfeliranytu/uzemanyag/uzemanyagar_2017');
		expect(findYearPage(archive, 2022)).toBe('/ugyfeliranytu/uzemanyag/2022_uzemanyagar');
	});

	test('csak a NAV üzemanyag-oldalaira mutató link követhető', () => {
		expect(navPath('/ugyfeliranytu/uzemanyag/2026-ban')).toBe('/ugyfeliranytu/uzemanyag/2026-ban');
		expect(navPath('https://nav.gov.hu/ugyfeliranytu/uzemanyag/2026-ban')).toBe('/ugyfeliranytu/uzemanyag/2026-ban');
		expect(navPath('https://pelda.hu/ugyfeliranytu/uzemanyag/2026')).toBeNull();
		expect(navPath('//pelda.hu/ugyfeliranytu/uzemanyag/2026')).toBeNull();
		expect(navPath('/ugyfeliranytu/uzemanyag/../../admin')).toBeNull();
		expect(navPath('/ugyfeliranytu/uzemanyag/x?lang=en')).toBeNull();
	});
});

describe('planNavImport', () => {
	const table = parseNavFuelTable(fixture('2026.html'), 2026);
	const mapping = { petrol: [PETROL_PROTECTED, PETROL_MARKET], diesel: [DIESEL_PROTECTED, DIESEL_MARKET] };
	const cell = (plan: ReturnType<typeof planNavImport>, month: number, type: string) =>
		plan.find((c) => c.month === month && c.priceType === type)!;

	test('védett ár, ha van; ha nincs, a piaci', () => {
		const plan = planNavImport(table, mapping, ['petrol', 'diesel'], [], []);
		expect(cell(plan, 6, 'petrol')).toMatchObject({ navPrice: 595, columnKey: PETROL_PROTECTED, fallback: false, status: 'new' });
		expect(cell(plan, 9, 'petrol')).toMatchObject({ navPrice: 604, columnKey: PETROL_MARKET, fallback: true, status: 'new' });
		expect(cell(plan, 6, 'diesel').navPrice).toBe(615);
		expect(cell(plan, 10, 'petrol')).toMatchObject({ navPrice: null, status: 'missing' });
		expect(plan).toHaveLength(24);
	});

	test('egyező, eltérő és zárolt ár', () => {
		const plan = planNavImport(
			table,
			mapping,
			['petrol', 'diesel'],
			[
				{ month: 1, priceType: 'petrol', priceHuf: 572, source: 'nav' },
				{ month: 2, priceType: 'petrol', priceHuf: 555, source: 'manual' },
				{ month: 3, priceType: 'petrol', priceHuf: 500, source: 'nav' }
			],
			[{ month: 3, priceType: 'petrol' }]
		);
		expect(cell(plan, 1, 'petrol').status).toBe('same');
		expect(cell(plan, 2, 'petrol')).toMatchObject({ status: 'differs', current: 555, currentSource: 'manual', navPrice: 560 });
		expect(cell(plan, 3, 'petrol')).toMatchObject({ status: 'locked', current: 500, navPrice: 564 });
	});

	test('hibás elsődleges cellánál nem lép a tartalékra', () => {
		const broken: NavFuelTable = {
			...table,
			invalidCells: [{ month: 9, columnKey: PETROL_PROTECTED, raw: '?' }]
		};
		const plan = planNavImport(broken, mapping, ['petrol'], [], []);
		expect(cell(plan, 9, 'petrol')).toMatchObject({ status: 'invalid', navPrice: null });
	});

	test('hozzárendelés nélküli ártípus nem töltődik', () => {
		const plan = planNavImport(table, { petrol: [] }, ['petrol'], [], []);
		expect(plan.every((c) => c.status === 'missing')).toBe(true);
	});
});

test('tableVersion: a tartalomtól függ', () => {
	const a = parseNavFuelTable(fixture('2026.html'), 2026);
	const b = parseNavFuelTable(fixture('2026.html'), 2026);
	expect(tableVersion(a)).toBe(tableVersion(b));
	b.rows[0].values[1] = 999;
	expect(tableVersion(a)).not.toBe(tableVersion(b));
});
