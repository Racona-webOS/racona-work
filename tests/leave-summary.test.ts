/**
 * A szabadságnaptár összesítőjének és az xlsx-írónak a tesztjei
 * (src/lib/leave-summary.ts, src/lib/xlsx-writer.ts; specs/leave-days.md, K18).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { summarizeLeave, visibleLeaveTypes } from '../src/lib/leave-summary.ts';
import { buildXlsx, columnName, escapeXml, sheetName } from '../src/lib/xlsx-writer.ts';

const employees = [
	{ id: 1, name: 'Anna' },
	{ id: 2, name: 'Béla' },
	{ id: 3, name: 'Csaba' }
];

const day = (employeeId: number, leaveType: string | null, employeeName?: string) => ({
	employeeId,
	leaveType,
	employeeName
});

describe('summarizeLeave', () => {
	const days = [
		day(1, 'annual'),
		day(1, 'annual'),
		day(1, 'sick'),
		day(1, 'company_mandatory'),
		day(2, 'unpaid'),
		day(2, null),
		day(9, 'annual', 'Kilépett Kati')
	];
	const pending = [day(1, 'annual'), day(3, 'annual'), day(3, 'annual')];

	test('típusonként, összesen, függő; a dolgozók sorrendje megmarad, a listán kívüliek a végén', () => {
		const { rows, totals } = summarizeLeave({ employees, days, pending });
		expect(rows.map((r) => r.name)).toEqual(['Anna', 'Béla', 'Csaba', 'Kilépett Kati']);
		expect(rows[0].byType.annual).toBe(2);
		expect(rows[0].byType.sick).toBe(1);
		expect(rows[0].byType.company_mandatory).toBe(1);
		expect(rows[0].total).toBe(4);
		expect(rows[0].pending).toBe(1);
		expect(rows[1].byType.unpaid).toBe(1);
		expect(rows[1].unknown).toBe(1);
		expect(rows[1].total).toBe(2);
		expect(rows[2].total).toBe(0);
		expect(rows[2].pending).toBe(2);
		expect(totals.total).toBe(7);
		expect(totals.pending).toBe(3);
		expect(totals.byType.annual).toBe(3);
		expect(totals.allowance).toBeNull();
	});

	test('keret és maradék: a keretet az éves és a céges kötelező szabadság terheli', () => {
		const allowances = new Map([
			[1, 25],
			[2, 20]
		]);
		const { rows, totals } = summarizeLeave({ employees, days, pending, allowances });
		expect(rows[0].allowance).toBe(25);
		expect(rows[0].remaining).toBe(22);
		expect(rows[1].remaining).toBe(20);
		expect(rows[2].allowance).toBeNull();
		expect(rows[2].remaining).toBeNull();
		expect(totals.allowance).toBe(45);
		expect(totals.remaining).toBe(42);
	});

	test('a látható típusoszlopok: amiben van nap, és mindig az éves', () => {
		const summary = summarizeLeave({ employees, days: [day(1, 'sick')], pending: [] });
		expect(visibleLeaveTypes(summary)).toEqual(['annual', 'sick']);
	});
});

describe('xlsx-író', () => {
	test('oszlopnevek, escape, munkalapnév', () => {
		expect(columnName(0)).toBe('A');
		expect(columnName(25)).toBe('Z');
		expect(columnName(26)).toBe('AA');
		expect(columnName(27)).toBe('AB');
		expect(escapeXml('a < b & "c"')).toBe('a &lt; b &amp; &quot;c&quot;');
		expect(sheetName('Szabadságok [2026/09]')).toBe('Szabadságok  2026 09');
		expect(sheetName('x'.repeat(40))).toHaveLength(31);
	});

	test('a munkafüzet részei és a cellák', () => {
		const bytes = buildXlsx({
			name: 'Szabadságok',
			title: 'Szabadságok – 2026. szeptember',
			header: ['Dolgozó', 'Éves szabadság'],
			rows: [
				['Kovács <Anna>', 3],
				['Béla', null]
			],
			footer: ['Összesen', 3],
			columnWidths: [30, 14]
		});
		const files = unzipSync(bytes);
		expect(Object.keys(files).sort()).toEqual([
			'[Content_Types].xml',
			'_rels/.rels',
			'xl/_rels/workbook.xml.rels',
			'xl/styles.xml',
			'xl/workbook.xml',
			'xl/worksheets/sheet1.xml'
		]);
		const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
		expect(sheet).toContain('<c r="A1" s="3" t="inlineStr"><is><t xml:space="preserve">Szabadságok – 2026. szeptember</t></is></c>');
		expect(sheet).toContain('<c r="B3" s="2" t="inlineStr">');
		expect(sheet).toContain('<t xml:space="preserve">Kovács &lt;Anna&gt;</t>');
		expect(sheet).toContain('<c r="B4"><v>3</v></c>');
		expect(sheet).toContain('<row r="5"><c r="A5" t="inlineStr">');
		expect(sheet).not.toContain('r="B5"');
		expect(sheet).toContain('<c r="B6" s="1"><v>3</v></c>');
		expect(sheet).toContain('<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/>');
		expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
		expect(strFromU8(files['xl/workbook.xml'])).toContain('<sheet name="Szabadságok" sheetId="1" r:id="rId1"/>');
	});
});
