/**
 * Kiküldetési rendelvény — tiszta számítások (a kliens is importálja).
 *
 * Saját autós hivatali út költségtérítése (Szja tv. 3. számú melléklet):
 *   km × (NAV üzemanyagár × fogyasztási norma / 100 + általános személygépkocsi-normaköltség)
 *
 * A norma a 60/1992. (IV. 1.) Korm. rendelet alapnormája a hengerűrtartalom és az
 * üzemanyag szerint. Az üzemanyagok szabályai a FUEL_RULES táblában vannak: az
 * 1. fázisban csak a benzin és a gázolaj engedélyezett, a többi (LPG, CNG, hibrid,
 * elektromos) szakmai ellenőrzés után kapcsolható be, migráció nélkül.
 *
 * Részletek: specs/business-trips.md (3., 9. fejezet)
 */

export type FuelType = 'petrol' | 'diesel' | 'lpg' | 'cng' | 'hybrid' | 'electric';
export type PriceType = 'petrol' | 'diesel' | 'mixed' | 'lpg' | 'cng' | 'electricity';
export type ConsumptionUnit = 'l' | 'kg' | 'kWh';
export type ReturnMode = 'origin' | 'other' | 'none';
export type SettlementStatus = 'draft' | 'submitted' | 'approved' | 'paid';

export const FUEL_TYPES: FuelType[] = ['petrol', 'diesel', 'lpg', 'cng', 'hybrid', 'electric'];
export const PRICE_TYPES: PriceType[] = ['petrol', 'diesel', 'mixed', 'lpg', 'cng', 'electricity'];

export interface FuelRule {
	/** Választható-e (az 1. fázisban csak petrol és diesel). */
	enabled: boolean;
	/** Melyik NAV-árral számolunk. */
	priceType: PriceType;
	/** A norma és az ár mértékegysége. */
	unit: ConsumptionUnit;
	/** Kell-e hengerűrtartalom (a jogszabályi norma ettől függ). */
	requiresEngineCc: boolean;
	/** Alapnorma / 100 km; null = nincs jogszabályi norma, egyedi érték kell. */
	norm(engineCc: number | null): number | null;
}

/** 60/1992. Korm. rendelet, benzinüzemű személygépkocsi (l/100 km). */
export function petrolNorm(engineCc: number | null): number | null {
	if (!engineCc || engineCc <= 0) return null;
	if (engineCc <= 1000) return 7.6;
	if (engineCc <= 1500) return 8.6;
	if (engineCc <= 2000) return 9.5;
	if (engineCc <= 3000) return 11.4;
	return 13.3;
}

/** 60/1992. Korm. rendelet, gázolajüzemű személygépkocsi (l/100 km). */
export function dieselNorm(engineCc: number | null): number | null {
	if (!engineCc || engineCc <= 0) return null;
	if (engineCc <= 1500) return 5.7;
	if (engineCc <= 2000) return 6.7;
	if (engineCc <= 3000) return 7.6;
	return 9.5;
}

/** Nincs jogszabályi norma: a HR ad meg egyedi értéket. */
const noNorm = () => null;

/**
 * Üzemanyagonkénti szabályok. A nem engedélyezett sorok értékei (ártípus,
 * mértékegység) szakmai ellenőrzésre várnak — lásd specs/business-trips.md 17. fejezet.
 */
export const FUEL_RULES: Record<FuelType, FuelRule> = {
	petrol: { enabled: true, priceType: 'petrol', unit: 'l', requiresEngineCc: true, norm: petrolNorm },
	diesel: { enabled: true, priceType: 'diesel', unit: 'l', requiresEngineCc: true, norm: dieselNorm },
	lpg: { enabled: false, priceType: 'lpg', unit: 'l', requiresEngineCc: true, norm: noNorm },
	cng: { enabled: false, priceType: 'cng', unit: 'kg', requiresEngineCc: true, norm: noNorm },
	hybrid: { enabled: false, priceType: 'petrol', unit: 'l', requiresEngineCc: true, norm: noNorm },
	electric: { enabled: false, priceType: 'electricity', unit: 'kWh', requiresEngineCc: false, norm: noNorm }
};

export const ENABLED_FUEL_TYPES: FuelType[] = FUEL_TYPES.filter((f) => FUEL_RULES[f].enabled);

/** Azok az ártípusok, amelyekre engedélyezett üzemanyag hivatkozik (a NAV-ár táblához). */
export const ENABLED_PRICE_TYPES: PriceType[] = PRICE_TYPES.filter((p) =>
	ENABLED_FUEL_TYPES.some((f) => FUEL_RULES[f].priceType === p)
);

export function isFuelType(value: unknown): value is FuelType {
	return typeof value === 'string' && (FUEL_TYPES as string[]).includes(value);
}

export function isPriceType(value: unknown): value is PriceType {
	return typeof value === 'string' && (PRICE_TYPES as string[]).includes(value);
}

/** A rendelvényre kerülő üzemanyag-megnevezés. */
export const FUEL_LABELS: Record<FuelType, { hu: string; en: string }> = {
	petrol: { hu: 'benzin', en: 'petrol' },
	diesel: { hu: 'gázolaj', en: 'diesel' },
	lpg: { hu: 'LPG', en: 'LPG' },
	cng: { hu: 'CNG', en: 'CNG' },
	hybrid: { hu: 'hibrid', en: 'hybrid' },
	electric: { hu: 'elektromos', en: 'electric' }
};

export const PRICE_TYPE_LABELS: Record<PriceType, { hu: string; en: string }> = {
	petrol: { hu: 'Benzin', en: 'Petrol' },
	diesel: { hu: 'Gázolaj', en: 'Diesel' },
	mixed: { hu: 'Keverék', en: 'Two-stroke mix' },
	lpg: { hu: 'LPG (autógáz)', en: 'LPG' },
	cng: { hu: 'CNG', en: 'CNG' },
	electricity: { hu: 'Elektromos áram', en: 'Electricity' }
};

/** „l/100 km”, „kWh/100 km” */
export function consumptionUnitLabel(unit: ConsumptionUnit): string {
	return `${unit}/100 km`;
}

/** „Ft/l”, „Ft/kWh” */
export function priceUnitLabel(unit: ConsumptionUnit): string {
	return `Ft/${unit}`;
}

// --- Fogyasztás és km-díj ----------------------------------------------------

export interface VehicleConsumption {
	/** Fogyasztás / 100 km; null, ha nincs norma és egyedi érték sem. */
	value: number | null;
	unit: ConsumptionUnit;
	source: 'regulation' | 'override' | 'missing';
}

export function vehicleConsumption(vehicle: {
	fuelType: FuelType;
	engineCc: number | null;
	consumptionOverride: number | null;
}): VehicleConsumption {
	const rule = FUEL_RULES[vehicle.fuelType];
	if (vehicle.consumptionOverride !== null && vehicle.consumptionOverride > 0) {
		return { value: vehicle.consumptionOverride, unit: rule.unit, source: 'override' };
	}
	const norm = rule.norm(vehicle.engineCc);
	return norm === null
		? { value: null, unit: rule.unit, source: 'missing' }
		: { value: norm, unit: rule.unit, source: 'regulation' };
}

/**
 * Ft/km, kerekítés nélkül. A soronkénti összeg ebből számol, ugyanúgy, mint az
 * xlsx képlete (`km × (ár / 100 × norma + normaköltség)`), így a kettő egyezik.
 */
export function ratePerKm(input: { price: number; consumption: number; normCostPerKm: number }): number {
	return (input.price * input.consumption) / 100 + input.normCostPerKm;
}

/** Két tizedesre kerekít (a fél felfelé). */
export function round2(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Egész km, a fél felfelé (D4). */
export function roundKm(km: number): number {
	return Math.round(km);
}

export interface SettlementCalc {
	consumption: number | null;
	unit: ConsumptionUnit;
	price: number | null;
	normCostPerKm: number;
	/** Ft/km kerekítés nélkül; null, ha nincs ár vagy fogyasztás. */
	ratePerKm: number | null;
	rows: { tripId: number; km: number; amount: number | null }[];
	totalKm: number;
	/** A sorok összege két tizedesre. */
	subtotal: number | null;
	/** Egész forintra kerekítés különbözete (D5). */
	rounding: number | null;
	/** Mindösszesen, egész forint. */
	total: number | null;
}

export function calculateSettlement(input: {
	trips: { id: number; km: number }[];
	consumption: number | null;
	unit: ConsumptionUnit;
	price: number | null;
	normCostPerKm: number;
}): SettlementCalc {
	const totalKm = input.trips.reduce((sum, t) => sum + t.km, 0);
	const rate =
		input.price !== null && input.consumption !== null
			? ratePerKm({ price: input.price, consumption: input.consumption, normCostPerKm: input.normCostPerKm })
			: null;

	const exactRows = input.trips.map((t) => ({ tripId: t.id, km: t.km, exact: rate === null ? null : t.km * rate }));
	const subtotal = rate === null ? null : round2(exactRows.reduce((sum, r) => sum + (r.exact ?? 0), 0));
	const total = subtotal === null ? null : Math.round(subtotal);

	return {
		consumption: input.consumption,
		unit: input.unit,
		price: input.price,
		normCostPerKm: input.normCostPerKm,
		ratePerKm: rate,
		rows: exactRows.map((r) => ({ tripId: r.tripId, km: r.km, amount: r.exact === null ? null : round2(r.exact) })),
		totalKm,
		subtotal,
		rounding: subtotal === null || total === null ? null : round2(total - subtotal),
		total
	};
}

// --- Figyelmeztetések (K15) ---------------------------------------------------

export type EmployeeWarningField = 'home_address' | 'birth_date' | 'birth_place' | 'mother_name' | 'tax_id';
export type OrganizationWarningField = 'address' | 'tax_number';

export type SettlementWarning =
	| { kind: 'employee_field'; field: EmployeeWarningField }
	| { kind: 'organization_field'; field: OrganizationWarningField }
	| { kind: 'missing_ordered_by'; tripCount: number }
	| { kind: 'missing_consumption' }
	| { kind: 'missing_fuel_price'; priceType: PriceType; year: number; month: number };

/** Ezek nélkül nincs összeg, ezért a rendelvény nem hagyható jóvá (D17). */
export function blocksApproval(warning: SettlementWarning): boolean {
	return warning.kind === 'missing_fuel_price' || warning.kind === 'missing_consumption';
}

export function settlementWarnings(input: {
	employee: {
		homeAddress: string | null;
		birthDate: string | null;
		birthPlace: string | null;
		motherName: string | null;
		taxId: string | null;
	};
	organization: { address: string | null; taxNumber: string | null };
	tripsWithoutOrderer: number;
	consumptionMissing: boolean;
	missingPrice: { priceType: PriceType; year: number; month: number } | null;
}): SettlementWarning[] {
	const warnings: SettlementWarning[] = [];
	const blank = (v: string | null) => !v || !v.trim();

	const employeeFields: [EmployeeWarningField, string | null][] = [
		['home_address', input.employee.homeAddress],
		['birth_date', input.employee.birthDate],
		['birth_place', input.employee.birthPlace],
		['mother_name', input.employee.motherName],
		['tax_id', input.employee.taxId]
	];
	for (const [field, value] of employeeFields) {
		if (blank(value)) warnings.push({ kind: 'employee_field', field });
	}
	if (blank(input.organization.address)) warnings.push({ kind: 'organization_field', field: 'address' });
	if (blank(input.organization.taxNumber)) warnings.push({ kind: 'organization_field', field: 'tax_number' });
	if (input.tripsWithoutOrderer > 0) {
		warnings.push({ kind: 'missing_ordered_by', tripCount: input.tripsWithoutOrderer });
	}
	if (input.consumptionMissing) warnings.push({ kind: 'missing_consumption' });
	if (input.missingPrice) warnings.push({ kind: 'missing_fuel_price', ...input.missingPrice });
	return warnings;
}

// --- Adóazonosító jel és adószám ---------------------------------------------

const TAX_ID_EPOCH = Date.UTC(1867, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adóazonosító jel: 10 számjegy, 8-cal kezdődik. A 2–6. jegy az 1867. 01. 01.
 * óta eltelt napok száma a születésnapig; a 10. jegy ellenőrző: az 1–9. jegyek
 * helyi értékkel (1..9) szorzott összegének 11-es maradéka (10 nem lehet).
 */
export function validateTaxId(
	taxId: string,
	birthDate?: string | null
): { valid: boolean; birthDateMismatch: boolean } {
	if (!/^8\d{9}$/.test(taxId)) return { valid: false, birthDateMismatch: false };
	const digits = taxId.split('').map(Number);
	const sum = digits.slice(0, 9).reduce((acc, d, i) => acc + d * (i + 1), 0);
	if (sum % 11 !== digits[9]) return { valid: false, birthDateMismatch: false };

	let birthDateMismatch = false;
	if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
		const [y, m, d] = birthDate.split('-').map(Number);
		const days = Math.round((Date.UTC(y, m - 1, d) - TAX_ID_EPOCH) / DAY_MS);
		birthDateMismatch = days !== Number(taxId.slice(1, 6));
	}
	return { valid: true, birthDateMismatch };
}

/**
 * Adószám normalizálása `12345678-1-12` alakra. Szóközt és kötőjelet nélküle
 * is elfogad (11 számjegy). Üres értékre null; hibásra hibát dob.
 */
export function normalizeTaxNumber(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const raw = String(value).replace(/\s+/g, '');
	if (!raw) return null;
	const digits = raw.replace(/-/g, '');
	if (!/^\d{11}$/.test(digits) || !/^\d{8}-?\d-?\d{2}$/.test(raw)) {
		throw new Error('Adószám: a formátum 12345678-1-12.');
	}
	return `${digits.slice(0, 8)}-${digits.slice(8, 9)}-${digits.slice(9)}`;
}

// --- Rendelvény formázás -------------------------------------------------------

const HU_MONTHS = [
	'január',
	'február',
	'március',
	'április',
	'május',
	'június',
	'július',
	'augusztus',
	'szeptember',
	'október',
	'november',
	'december'
];

/** „2025. év augusztus hó” — a rendelvény fejléce. */
export function periodLabel(year: number, month: number): string {
	return `${year}. év ${HU_MONTHS[month - 1]} hó`;
}

/** „KR-2025-0001”; üres előtagnál „2025-0001”. */
export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
	const body = `${year}-${String(sequence).padStart(4, '0')}`;
	const cleanPrefix = prefix.trim();
	return cleanPrefix ? `${cleanPrefix}-${body}` : body;
}

const HU_DIGRAPHS = ['dzs', 'cs', 'dz', 'gy', 'ly', 'ny', 'sz', 'ty', 'zs'];

/**
 * Monogram a fájlnévhez, a magyar kettős és hármas betűket egy betűnek véve:
 * „Kovács Zsófia” → „kzs”, „Szabó Béla” → „szb”. Ékezet nélkül, kisbetűvel.
 */
export function monogram(fullName: string): string {
	return fullName
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => {
			const lower = word.toLocaleLowerCase('hu');
			const digraph = HU_DIGRAPHS.find((d) => lower.startsWith(d));
			return digraph ?? lower[0];
		})
		.join('')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z]/g, '');
}

/** `kikuldetesi_rendelveny_MXA752_kzs_202508` (kiterjesztés nélkül). */
export function settlementFileName(plate: string, employeeName: string, year: number, month: number): string {
	const cleanPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
	return `kikuldetesi_rendelveny_${cleanPlate}_${monogram(employeeName)}_${year}${String(month).padStart(2, '0')}`;
}

/** Rendszám tárolási alakja: nagybetűs, szóköz nélkül. */
export function normalizePlate(value: string): string {
	return value.toUpperCase().replace(/\s+/g, '');
}

// --- Útvonal -------------------------------------------------------------------

export interface Waypoint {
	label: string;
	address: string;
	lat: number;
	lng: number;
}

/**
 * Az útvonal szövegesen: „Lakcím → Martonvásár → vissza”.
 * `other` visszaútnál az utolsó pont a visszaérkezés helye.
 * `withAddresses`: a rendelvényre a név mellé a cím is kerül, ha a név nem
 * tartalmazza („Munkahely (1135 Budapest, Kisgömb utca 25.)”).
 */
export function routeLabel(waypoints: Waypoint[], returnMode: ReturnMode, withAddresses = false): string {
	const names = waypoints.map((w) => {
		const name = w.label || w.address;
		const redundant = name.includes(w.address) || w.address.includes(name);
		return withAddresses && w.address && !redundant ? `${name} (${w.address})` : name;
	});
	if (returnMode === 'origin') return [...names, 'vissza'].join(' → ');
	return names.join(' → ');
}

/** Az útvonaltervezőnek küldött pontsor (`origin` visszaútnál a kiindulópont a végén). */
export function routePoints(waypoints: Waypoint[], returnMode: ReturnMode): { lat: number; lng: number }[] {
	const points = waypoints.map((w) => ({ lat: w.lat, lng: w.lng }));
	if (returnMode === 'origin' && points.length > 0) points.push(points[0]);
	return points;
}

// --- A rendelvény dokumentuma (nyomtatás, xlsx, pillanatkép) ------------------

export interface SettlementRow {
	tripId: number;
	index: number;
	/** Budapesti idő, `YYYY-MM-DD HH:mm`. */
	startedAt: string;
	endedAt: string;
	route: string;
	purpose: string;
	orderedByUserId: number | null;
	orderedByName: string | null;
	orderedByOverridden: boolean;
	km: number;
	routedKm: number | null;
	distanceReason: string | null;
	price: number | null;
	amount: number | null;
}

export interface SettlementDocument {
	settlementId: number | null;
	status: SettlementStatus | null;
	documentNumber: string | null;
	year: number;
	month: number;
	periodLabel: string;
	/** Kelt (YYYY-MM-DD): a beküldés napja, előnézetben a mai nap. */
	issuedOn: string;
	employer: { name: string; address: string | null; taxNumber: string | null };
	employee: {
		id: number;
		name: string;
		address: string | null;
		birthDate: string | null;
		birthPlace: string | null;
		motherName: string | null;
		taxId: string | null;
	};
	vehicle: {
		id: number;
		plate: string;
		model: string;
		engineCc: number | null;
		fuelType: FuelType;
		priceType: PriceType;
		consumptionSource: VehicleConsumption['source'];
		consumptionOverrideReason: string | null;
	};
	calc: SettlementCalc;
	rows: SettlementRow[];
	approval: { byName: string; at: string } | null;
	payment: { byName: string; at: string } | null;
	note: string | null;
	warnings: SettlementWarning[];
}
