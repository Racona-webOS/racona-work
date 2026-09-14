/**
 * Nyomtatható kiküldetési rendelvény (K12).
 *
 * A mai céges űrlap szerkezetét követő HTML egy rejtett iframe-be kerül
 * (`srcdoc`), és annak ablaka nyomtat — így nem az egész webOS asztal kerül a
 * papírra, és nem kell `innerHTML`/`document.write`, amit a core kódellenőrzője
 * tilt. A böngésző nyomtatási ablakában PDF-be is menthető.
 */

import type { SettlementDocument } from '../../../server/functions.js';
import { FUEL_LABELS, consumptionUnitLabel, priceUnitLabel, settlementFileName } from '../../../server/trip-calc.js';
import { formatDateTime, formatDay, formatHuf } from './format.js';

const MIN_ROWS = 13;

function esc(value: string | number | null | undefined): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function num(value: number | null | undefined, decimals = 0): string {
	if (value === null || value === undefined) return '';
	return new Intl.NumberFormat('hu-HU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** `2025.08.12.` és alatta `08:00`, hogy a keskeny oszlopba is kiférjen. */
function dateTimeCell(value: string): string {
	const [date, time] = formatDateTime(value).split(' ');
	return `${esc(date)}<br>${esc(time ?? '')}`;
}

export function settlementPrintHtml(doc: SettlementDocument, options: { watermark?: string } = {}): string {
	const c = doc.calc;
	const consumption =
		doc.vehicle.consumptionSource === 'regulation'
			? 'alapnorma szerint (60/1992. Korm. rendelet)'
			: doc.vehicle.consumptionSource === 'override'
				? `egyedi érték${doc.vehicle.consumptionOverrideReason ? `: ${doc.vehicle.consumptionOverrideReason}` : ''}`
				: '';
	const birth = [doc.employee.birthDate ? formatDay(doc.employee.birthDate) : '', doc.employee.birthPlace ?? '']
		.filter(Boolean)
		.join(' ');

	const rows = doc.rows
		.map(
			(r) => `<tr>
				<td class="c">${r.index}</td>
				<td class="c when">${dateTimeCell(r.startedAt)}</td>
				<td class="c when">${dateTimeCell(r.endedAt)}</td>
				<td>${esc(r.route)}${r.purpose ? `<div class="purpose">${esc(r.purpose)}</div>` : ''}${
					r.distanceReason ? `<div class="note">Eltérés oka: ${esc(r.distanceReason)}</div>` : ''
				}</td>
				<td class="sign">${esc(r.orderedByName)}</td>
				<td class="r">${num(r.km)}</td>
				<td class="r">${num(r.price, 0)}</td>
				<td class="r">${num(r.amount, 2)}</td>
				<td class="r">0</td><td class="r">0</td><td class="r">0</td>
			</tr>`
		)
		.join('');
	const empty = Array.from({ length: Math.max(0, MIN_ROWS - doc.rows.length) }, () => '<tr class="empty">' + '<td></td>'.repeat(11) + '</tr>').join('');

	return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8">
<title>${esc(settlementFileName(doc.vehicle.plate, doc.employee.name, doc.year, doc.month))}</title>
<style>
	@page { size: A4 portrait; margin: 12mm; }
	* { box-sizing: border-box; }
	body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; margin: 0 auto; max-width: 186mm; }
	.doc-number { text-align: right; font-size: 9pt; }
	h1 { text-align: center; font-size: 15pt; margin: 4mm 0 1mm; }
	.sub { text-align: center; margin: 0; }
	.period { text-align: center; font-weight: bold; font-size: 11pt; margin: 2mm 0 4mm; }
	table { width: 100%; border-collapse: collapse; }
	.parties td { border: 1px solid #000; padding: 1.2mm 2mm; vertical-align: top; width: 50%; }
	.parties .label { font-size: 8pt; }
	.parties .name { font-weight: bold; }
	.vehicle td { border: 1px solid #000; border-top: none; padding: 1.2mm 2mm; }
	.trips { table-layout: fixed; }
	.trips th, .trips td { border: 1px solid #000; padding: 1mm 1.2mm; overflow-wrap: anywhere; }
	.trips th { font-weight: normal; font-size: 6.5pt; }
	.trips td { font-size: 8pt; vertical-align: top; }
	.trips tr.empty td { height: 5mm; }
	.c { text-align: center; }
	.trips td.when { font-size: 7.5pt; white-space: nowrap; overflow-wrap: normal; }
	.r { text-align: right; white-space: nowrap; }
	.sign { font-size: 7pt; }
	.purpose { color: #333; margin-top: 0.5mm; }
	.note { font-size: 7pt; font-style: italic; margin-top: 0.5mm; }
	.totals td { border: 1px solid #000; padding: 1mm 1.2mm; }
	.totals .bold { font-weight: bold; }
	.footer { margin-top: 6mm; display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
	.signatures p { margin: 5mm 0; }
	.watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 40pt; color: rgba(220, 38, 38, 0.18); transform: rotate(-20deg); pointer-events: none; }
</style></head>
<body>
${options.watermark ? `<div class="watermark">${esc(options.watermark)}</div>` : ''}
<div class="doc-number">Biz.szám: ${esc(doc.documentNumber ?? '________')}</div>
<h1>Kiküldetési rendelvény</h1>
<p class="sub">A hivatali, üzleti utazás költségtérítéséhez</p>
<p class="period">${esc(doc.periodLabel)}</p>

<table class="parties"><tr>
	<td><div class="label">A munkáltató</div><div class="name">${esc(doc.employer.name)}</div>
		<div>Címe: ${esc(doc.employer.address)}</div><div>Adószáma: ${esc(doc.employer.taxNumber)}</div></td>
	<td><div class="label">A munkavállaló</div><div class="name">${esc(doc.employee.name)}</div>
		<div>Lakcíme: ${esc(doc.employee.address)}</div>
		<div>születési ideje, helye: ${esc(birth)}</div>
		<div>anyja neve: ${esc(doc.employee.motherName)}</div>
		<div>adóazonosító jele: ${esc(doc.employee.taxId)}</div></td>
</tr></table>
<table class="vehicle">
	<tr><td colspan="3">A gépjármű rendszáma: <b>${esc(doc.vehicle.plate)}</b> &nbsp; típusa: ${esc(doc.vehicle.model)} &nbsp;
		${doc.vehicle.engineCc ? `${esc(doc.vehicle.engineCc)} cm³` : ''} (${esc(FUEL_LABELS[doc.vehicle.fuelType]?.hu ?? doc.vehicle.fuelType)})</td></tr>
	<tr><td>Az üzemanyag-felhasználás módja: ${esc(consumption)}</td>
		<td class="r">${num(c.consumption, 1)} ${esc(consumptionUnitLabel(c.unit))}</td>
		<td class="r">Normaköltség: ${num(c.normCostPerKm, 0)} Ft/km</td></tr>
</table>

<table class="trips">
	<colgroup>
		<col style="width:5%"><col style="width:10%"><col style="width:10%"><col style="width:24%"><col style="width:9%">
		<col style="width:7%"><col style="width:7%"><col style="width:9%"><col style="width:6%"><col style="width:6%"><col style="width:7%">
	</colgroup>
	<thead>
		<tr><th rowspan="2">Sor-<br>szám</th><th colspan="4">A küldetés, külszolgálat</th>
			<th rowspan="2">Futás-teljesítmény (km)</th><th rowspan="2">NAV üzemanyag-egységár (${esc(priceUnitLabel(c.unit))})</th>
			<th rowspan="2">Utazási költség-térítés (Ft)</th><th rowspan="2">Napidíj (Ft)</th>
			<th rowspan="2">Szállás (Ft)</th><th rowspan="2">Le: reggeli miatt</th></tr>
		<tr><th>kezdete</th><th>vége</th><th>útvonala és célja</th><th>Elrendelő aláírása</th></tr>
	</thead>
	<tbody>${rows}${empty}</tbody>
	<tfoot class="totals">
		<tr><td colspan="5" class="r bold">Összes:</td><td class="r bold">${num(c.totalKm)}</td><td class="r">${num(c.price, 0)}</td>
			<td class="r">${num(c.subtotal, 2)}</td><td colspan="3"></td></tr>
		<tr><td colspan="7" class="r">Kerekítés:</td><td class="r">${num(c.rounding, 2)}</td><td colspan="3"></td></tr>
		<tr><td colspan="7" class="r bold">Mindösszesen:</td><td class="r bold">${esc(formatHuf(c.total))}</td><td colspan="3"></td></tr>
	</tfoot>
</table>

<div class="footer">
	<div>Kelt: ${esc(formatDay(doc.issuedOn))}</div>
	<div class="signatures">
		<p>Igazolta: ${esc(doc.approval ? `${doc.approval.byName}, ${formatDay(doc.approval.at)}` : '')} ______________________</p>
		<p>Utalványozta: ${esc(doc.payment ? `${doc.payment.byName}, ${formatDay(doc.payment.at)}` : '')} ______________________</p>
	</div>
</div>
</body></html>`;
}

/** Nyomtatás rejtett iframe-ből. */
export function printSettlement(doc: SettlementDocument, options: { watermark?: string } = {}): void {
	const frame = document.createElement('iframe');
	frame.setAttribute('aria-hidden', 'true');
	frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
	frame.srcdoc = settlementPrintHtml(doc, options);
	frame.onload = () => {
		const win = frame.contentWindow;
		if (!win) return;
		win.focus();
		win.print();
		setTimeout(() => frame.remove(), 60_000);
	};
	document.body.appendChild(frame);
}
