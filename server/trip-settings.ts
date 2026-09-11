/**
 * Kiküldetések — beállítások és NAV üzemanyagárak.
 *
 * A beállítások a kv_store-ban vannak (`settings:business_trip_policy:org_<id>`),
 * a NAV-árak a trip_fuel_prices táblában. Olvasni `trip.record` joggal lehet,
 * írni `trip.manage` joggal.
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { requireCapability } from './permissions.js';
import { SCHEMA, num, requireOrganizationId } from './trip-access.js';
import { ENABLED_PRICE_TYPES, isPriceType } from './trip-calc.js';
import type { PriceType } from './trip-calc.js';

export interface TripPolicy {
	/** Általános személygépkocsi-normaköltség, Ft/km. */
	normCostPerKm: number;
	/** A bizonylatszám előtagja: `<előtag>-<év>-<sorszám>`. */
	documentNumberPrefix: string;
	geocoder: { baseUrl: string; countryCodes: string };
	router: { baseUrl: string };
}

/** Nyilvános szolgáltatók (D22). A cím beállítás, hogy kódmódosítás nélkül cserélhető legyen. */
export const DEFAULT_GEOCODER_URL = 'https://nominatim.openstreetmap.org';
export const DEFAULT_ROUTER_URL = 'https://valhalla1.openstreetmap.de';

export const DEFAULT_TRIP_POLICY: TripPolicy = {
	normCostPerKm: 15,
	documentNumberPrefix: 'KR',
	geocoder: { baseUrl: DEFAULT_GEOCODER_URL, countryCodes: 'hu' },
	router: { baseUrl: DEFAULT_ROUTER_URL }
};

function policyKey(organizationId: number): string {
	return `settings:business_trip_policy:org_${organizationId}`;
}

function normalizeUrl(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim().replace(/\/+$/, '');
	return /^https?:\/\/[^\s/]+/.test(trimmed) ? trimmed : fallback;
}

function normalizePolicy(raw: unknown): TripPolicy {
	const value = (raw ?? {}) as Partial<TripPolicy>;
	const cost = Number(value.normCostPerKm);
	const countryCodes =
		typeof value.geocoder?.countryCodes === 'string'
			? value.geocoder.countryCodes.toLowerCase().replace(/[^a-z,]/g, '')
			: DEFAULT_TRIP_POLICY.geocoder.countryCodes;
	return {
		normCostPerKm: Number.isFinite(cost) && cost >= 0 ? cost : DEFAULT_TRIP_POLICY.normCostPerKm,
		documentNumberPrefix:
			typeof value.documentNumberPrefix === 'string'
				? value.documentNumberPrefix.trim().slice(0, 10)
				: DEFAULT_TRIP_POLICY.documentNumberPrefix,
		geocoder: { baseUrl: normalizeUrl(value.geocoder?.baseUrl, DEFAULT_GEOCODER_URL), countryCodes },
		router: { baseUrl: normalizeUrl(value.router?.baseUrl, DEFAULT_ROUTER_URL) }
	};
}

/** Belső segéd: a szervezet beállításai jogosultság-ellenőrzés nélkül. */
export async function loadTripPolicy(context: RemoteContext, organizationId: number): Promise<TripPolicy> {
	const r = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
		policyKey(organizationId)
	]);
	return normalizePolicy(r.rows[0]?.value);
}

export async function getTripPolicy(
	params: { organizationId: number },
	context: RemoteContext
): Promise<TripPolicy> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.record');
	return loadTripPolicy(context, organizationId);
}

export async function saveTripPolicy(
	params: { organizationId: number; policy: Partial<TripPolicy> },
	context: RemoteContext
): Promise<TripPolicy> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.manage');

	const input = params.policy ?? {};
	const cost = Number(input.normCostPerKm);
	if (!Number.isFinite(cost) || cost < 0 || cost > 1000) {
		throw new Error('A normaköltség 0 és 1000 Ft/km közötti szám legyen.');
	}
	if (typeof input.documentNumberPrefix === 'string' && !/^[A-Za-z0-9]{0,10}$/.test(input.documentNumberPrefix.trim())) {
		throw new Error('A bizonylatszám előtagja legfeljebb 10 betű vagy szám lehet.');
	}
	for (const [label, url] of [
		['címkereső', input.geocoder?.baseUrl],
		['útvonaltervező', input.router?.baseUrl]
	] as const) {
		if (url !== undefined && !/^https?:\/\/[^\s/]+/.test(String(url).trim())) {
			throw new Error(`A ${label} címe http:// vagy https:// kezdetű legyen.`);
		}
	}

	const policy = normalizePolicy({ ...(await loadTripPolicy(context, organizationId)), ...input });
	await context.db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[policyKey(organizationId), JSON.stringify(policy)]
	);
	return policy;
}

// --- NAV üzemanyagárak ---------------------------------------------------------

export interface FuelPrice {
	year: number;
	month: number;
	priceType: PriceType;
	priceHuf: number;
}

export async function getFuelPrices(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<FuelPrice[]> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.record');
	const year = Number(params.year);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Érvénytelen év');

	const r = await context.db.query(
		`SELECT year, month, price_type, price_huf
		   FROM ${SCHEMA}.trip_fuel_prices
		  WHERE organization_id = $1 AND year = $2
		  ORDER BY month, price_type`,
		[organizationId, year]
	);
	return r.rows.map((row: any) => ({
		year: row.year,
		month: row.month,
		priceType: row.price_type,
		priceHuf: num(row.price_huf) ?? 0
	}));
}

/** Belső segéd: az adott hónap ára, vagy null. */
export async function loadFuelPrice(
	context: RemoteContext,
	organizationId: number,
	year: number,
	month: number,
	priceType: PriceType
): Promise<number | null> {
	const r = await context.db.query(
		`SELECT price_huf FROM ${SCHEMA}.trip_fuel_prices
		  WHERE organization_id = $1 AND year = $2 AND month = $3 AND price_type = $4`,
		[organizationId, year, month, priceType]
	);
	return r.rows.length === 0 ? null : num(r.rows[0].price_huf);
}

/**
 * Egy havi ár mentése vagy törlése (`priceHuf: null`). Nem módosítható, ha
 * már van rá jóváhagyott vagy kifizetett rendelvény (K14).
 */
export async function saveFuelPrice(
	params: { organizationId: number; year: number; month: number; priceType: string; priceHuf: number | null },
	context: RemoteContext
): Promise<FuelPrice | null> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.manage');

	const year = Number(params.year);
	const month = Number(params.month);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Érvénytelen év');
	if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Érvénytelen hónap');
	if (!isPriceType(params.priceType) || !ENABLED_PRICE_TYPES.includes(params.priceType)) {
		throw new Error('Ehhez az üzemanyaghoz még nem lehet árat rögzíteni.');
	}
	const priceType = params.priceType;

	const locked = await context.db.query(
		`SELECT 1 FROM ${SCHEMA}.trip_settlements
		  WHERE organization_id = $1 AND year = $2 AND month = $3
		    AND status IN ('approved', 'paid')
		    AND snapshot->'vehicle'->>'priceType' = $4
		  LIMIT 1`,
		[organizationId, year, month, priceType]
	);
	if (locked.rows.length > 0) {
		throw new Error('Erre a hónapra már van jóváhagyott rendelvény, az ár nem módosítható.');
	}

	if (params.priceHuf === null || params.priceHuf === undefined || String(params.priceHuf) === '') {
		await context.db.query(
			`DELETE FROM ${SCHEMA}.trip_fuel_prices
			  WHERE organization_id = $1 AND year = $2 AND month = $3 AND price_type = $4`,
			[organizationId, year, month, priceType]
		);
		return null;
	}

	const price = Number(params.priceHuf);
	if (!Number.isFinite(price) || price <= 0 || price > 10000) {
		throw new Error('Az ár 0 és 10 000 Ft közötti szám legyen.');
	}
	const userId = await resolveUserId(context);
	await context.db.query(
		`INSERT INTO ${SCHEMA}.trip_fuel_prices (organization_id, year, month, price_type, price_huf, updated_by, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW())
		 ON CONFLICT (organization_id, year, month, price_type)
		 DO UPDATE SET price_huf = EXCLUDED.price_huf, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
		[organizationId, year, month, priceType, Math.round(price * 100) / 100, userId]
	);
	return { year, month, priceType, priceHuf: Math.round(price * 100) / 100 };
}
