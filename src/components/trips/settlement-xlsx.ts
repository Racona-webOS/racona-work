/**
 * A kiküldetési rendelvény xlsx-e (K16): a mai céges minta alapján készült sablon
 * (`assets/templates/kikuldetesi-rendelveny.xlsx`) kitöltése. A jelölők listája:
 * specs/business-trips.md, 10. fejezet.
 */

import type { SettlementDocument } from '../../../server/functions.js';
import { FUEL_LABELS, consumptionUnitLabel, priceUnitLabel, settlementFileName } from '../../../server/trip-calc.js';
import { fillTemplate, type CellValue } from './xlsx-template.js';
import { officialDay } from './format.js';
import { downloadBytes } from '../../utils/download.js';
import { translate } from '../../utils/sdk.js';

export const TEMPLATE_ASSET = 'templates/kikuldetesi-rendelveny.xlsx';
/** A mai nyomtatvány képe: legalább ennyi sor (üresen is). */
const MIN_ROWS = 13;

function consumptionBasis(doc: SettlementDocument): string {
	switch (doc.vehicle.consumptionSource) {
		case 'regulation':
			return 'alapnorma szerint (60/1992. Korm. rendelet)';
		case 'override':
			return `egyedi érték${doc.vehicle.consumptionOverrideReason ? `: ${doc.vehicle.consumptionOverrideReason}` : ''}`;
		default:
			return '';
	}
}

/** A sablon jelölőinek értékei a rendelvényből. */
export function settlementTemplateData(doc: SettlementDocument) {
	const values: Record<string, CellValue> = {
		'doc.number': doc.documentNumber ?? '',
		'doc.date': officialDay(doc.issuedOn),
		'period.label': doc.periodLabel,
		'employer.name': doc.employer.name,
		'employer.address': doc.employer.address ?? '',
		'employer.taxNumber': doc.employer.taxNumber ?? '',
		'employee.name': doc.employee.name,
		'employee.address': doc.employee.address ?? '',
		'employee.birth': [doc.employee.birthDate ? officialDay(doc.employee.birthDate) : '', doc.employee.birthPlace ?? '']
			.filter(Boolean)
			.join(' '),
		'employee.motherName': doc.employee.motherName ?? '',
		'employee.taxId': doc.employee.taxId ?? '',
		'vehicle.plate': doc.vehicle.plate,
		'vehicle.model': doc.vehicle.model,
		'vehicle.engineCc': doc.vehicle.engineCc ?? '',
		'vehicle.fuel': FUEL_LABELS[doc.vehicle.fuelType]?.hu ?? doc.vehicle.fuelType,
		'vehicle.consumption': doc.calc.consumption,
		'vehicle.consumptionUnit': consumptionUnitLabel(doc.calc.unit),
		'vehicle.consumptionBasis': consumptionBasis(doc),
		'rate.normCost': doc.calc.normCostPerKm,
		'rate.priceUnit': priceUnitLabel(doc.calc.unit),
		'approval.text': doc.approval ? `${doc.approval.byName}, ${officialDay(doc.approval.at)}` : '',
		'payment.text': doc.payment ? `${doc.payment.byName}, ${officialDay(doc.payment.at)}` : ''
	};
	const rows: Record<string, CellValue>[] = doc.rows.map((row) => ({
		'trip.index': row.index,
		'trip.start': { date: row.startedAt },
		'trip.end': { date: row.endedAt },
		'trip.route': row.purpose ? `${row.route}\n${row.purpose}` : row.route,
		'trip.orderedBy': row.orderedByName ?? '',
		'trip.km': row.km,
		'trip.price': row.price,
		'trip.meal': 0,
		'trip.lodging': 0,
		'trip.breakfast': 0
	}));
	return { values, rows, rowPrefix: 'trip.', minRows: MIN_ROWS };
}

export function fillSettlementXlsx(template: Uint8Array, doc: SettlementDocument): Uint8Array {
	return fillTemplate(template, settlementTemplateData(doc));
}

/** Letölti a sablont, kitölti, és a böngészővel menteti (a mai fájlnév szerint). */
export async function downloadSettlementXlsx(sdk: any, doc: SettlementDocument): Promise<void> {
	const url: string = sdk?.assets?.getUrl?.(TEMPLATE_ASSET) ?? `/${TEMPLATE_ASSET}`;
	const response = await fetch(url);
	if (!response.ok) throw new Error(translate(sdk, 'trips.settlement.xlsxTemplateMissing'));
	const template = new Uint8Array(await response.arrayBuffer());
	downloadBytes(
		fillSettlementXlsx(template, doc),
		`${settlementFileName(doc.vehicle.plate, doc.employee.name, doc.year, doc.month)}.xlsx`
	);
}
