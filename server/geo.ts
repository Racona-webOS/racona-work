/**
 * Címkeresés és útvonaltervezés a plugin szerverén.
 *
 * A core Térkép appja a böngészőből hívja a nyilvános Nominatim és Valhalla
 * szervereket; az SDK ezt nem adja tovább, ezért a plugin maga hívja őket (D22):
 *   - a km-t így a szerver kéri le és tárolja, a kliens nem tudja „beküldeni”;
 *   - a gyorsítótár (geo_cache) miatt az ismétlődő útvonalak nem mennek ki újra;
 *   - a Nominatim szabályait (azonosító User-Agent, legfeljebb 1 kérés/s, nincs
 *     gépelés közbeni kiegészítés) egy helyen tartjuk be.
 *
 * A szolgáltatók címe a kiküldetési beállításokból jön (trip-settings.ts), így
 * saját üzemeltetésre vagy más szolgáltatóra kódmódosítás nélkül át lehet állni.
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import { SCHEMA, requireOrganizationId } from './trip-access.js';
import { loadTripPolicy } from './trip-settings.js';
import type { TripPolicy } from './trip-settings.js';
import { routePoints } from './trip-calc.js';
import type { ReturnMode, Waypoint } from './trip-calc.js';
import { decodePolyline, encodePolyline } from './polyline.js';

const USER_AGENT = 'RaconaWork/1.0 (Racona webOS plugin; business trip distances)';
const REQUEST_TIMEOUT_MS = 10_000;
/** Szolgáltatónként legfeljebb 1 kérés másodpercenként. */
const MIN_INTERVAL_MS = 1_000;
const SEARCH_TTL_DAYS = 90;
const ROUTE_TTL_DAYS = 30;
const MAX_POINTS = 11;

export const ROUTER_UNAVAILABLE =
	'Az útvonaltervező most nem érhető el. A km-t kézzel is megadhatod, indoklással.';
export const GEOCODER_UNAVAILABLE = 'A címkereső most nem érhető el. Próbáld újra később.';

export interface PlaceResult {
	label: string;
	address: string;
	lat: number;
	lng: number;
}

export interface RouteOptions {
	/** A fizetős utak (Magyarországon a matricás autópályák) kerülése (K5). */
	avoidTolls?: boolean;
}

export interface RouteResult {
	/** Útvonaltervező szerinti távolság, km, 1 tizedesre. */
	km: number;
	legsKm: number[];
	durationMin: number;
	/** Encoded polyline (precision 6), a teljes útvonal. */
	geometry: string;
}

// --- Sorba állítás és gyorsítótár ----------------------------------------------

/** A következő szabad időpont szolgáltatónként (a modul a core folyamatában él). */
const nextSlot = new Map<string, number>();

async function waitTurn(host: string): Promise<void> {
	const now = Date.now();
	const slot = Math.max(now, nextSlot.get(host) ?? 0);
	nextSlot.set(host, slot + MIN_INTERVAL_MS);
	if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readCache<T>(context: RemoteContext, key: string, ttlDays: number): Promise<T | null> {
	const r = await context.db.query(
		`SELECT response FROM ${SCHEMA}.geo_cache
		  WHERE cache_key = $1 AND created_at > NOW() - make_interval(days => $2)`,
		[key, ttlDays]
	);
	return r.rows.length === 0 ? null : (r.rows[0].response as T);
}

async function writeCache(context: RemoteContext, key: string, kind: 'search' | 'route', value: unknown) {
	try {
		await context.db.query(
			`INSERT INTO ${SCHEMA}.geo_cache (cache_key, kind, response, created_at)
			 VALUES ($1, $2, $3::jsonb, NOW())
			 ON CONFLICT (cache_key) DO UPDATE SET response = EXCLUDED.response, created_at = NOW()`,
			[key, kind, JSON.stringify(value)]
		);
		// A lakcímet is tartalmazhat, ezért a régi sorok törlődnek (specs 14. fejezet)
		await context.db.query(
			`DELETE FROM ${SCHEMA}.geo_cache WHERE created_at < NOW() - make_interval(days => $1)`,
			[SEARCH_TTL_DAYS]
		);
	} catch (err) {
		console.error('[Work] geo_cache írás sikertelen:', err);
	}
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<any> {
	await waitTurn(new URL(url).host);
	const response = await fetch(url, {
		...init,
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers ?? {}) },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, body });
	}
	return response.json();
}

// --- Címkeresés (Nominatim) ---------------------------------------------------

/** „2462 Martonvásár, Brunszvik utca 2.” — a Nominatim címrészeiből. */
function formatAddress(item: any): string {
	const a = item?.address ?? {};
	const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.city_district ?? '';
	const street = [a.road ?? a.pedestrian ?? a.square ?? '', a.house_number ? `${a.house_number}.` : '']
		.filter(Boolean)
		.join(' ');
	const place = [a.postcode ?? '', city].filter(Boolean).join(' ');
	const formatted = [place, street].filter(Boolean).join(', ');
	return formatted || String(item?.display_name ?? '');
}

function toPlace(item: any): PlaceResult | null {
	const lat = Number(item?.lat);
	const lng = Number(item?.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	const address = formatAddress(item);
	const name = typeof item?.name === 'string' ? item.name.trim() : '';
	const street = item?.address?.road ?? '';
	const label = name && name !== street && !address.includes(name) ? `${name}, ${address}` : address;
	return { label: label.slice(0, 100), address, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

async function searchWithPolicy(
	context: RemoteContext,
	policy: TripPolicy,
	query: string,
	limit: number
): Promise<PlaceResult[]> {
	const normalized = query.trim().replace(/\s+/g, ' ');
	const key = await sha256(`search|${policy.geocoder.baseUrl}|${policy.geocoder.countryCodes}|${limit}|${normalized.toLowerCase()}`);
	const cached = await readCache<PlaceResult[]>(context, key, SEARCH_TTL_DAYS);
	if (cached) return cached;

	const params = new URLSearchParams({
		q: normalized,
		format: 'jsonv2',
		addressdetails: '1',
		limit: String(limit),
		'accept-language': 'hu'
	});
	if (policy.geocoder.countryCodes) params.set('countrycodes', policy.geocoder.countryCodes);
	const url = `${policy.geocoder.baseUrl}/search?${params.toString()}`;

	let data: unknown;
	try {
		data = await fetchJson(url);
	} catch (err) {
		console.error('[Work] Címkeresés sikertelen:', err);
		throw new Error(GEOCODER_UNAVAILABLE);
	}
	// Ugyanaz a hely több OSM-objektumként is visszajöhet (pl. a település határa és a pontja)
	const results: PlaceResult[] = [];
	for (const place of (Array.isArray(data) ? data : []).map(toPlace)) {
		if (place && !results.some((r) => r.label === place.label)) results.push(place);
	}
	await writeCache(context, key, 'search', results);
	return results;
}

/**
 * Címkeresés gombra vagy Enterre (K3). Legfeljebb 5 találat.
 * Gépelés közbeni hívásra nem való (Nominatim szabály).
 */
export async function searchPlaces(
	params: { organizationId: number; query: string },
	context: RemoteContext
): Promise<PlaceResult[]> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.record');
	const query = String(params.query ?? '').trim();
	if (query.length < 3) throw new Error('Legalább 3 karaktert írj be a kereséshez.');
	if (query.length > 200) throw new Error('A keresett cím túl hosszú.');
	const policy = await loadTripPolicy(context, organizationId);
	return searchWithPolicy(context, policy, query, 5);
}

/**
 * Belső segéd: egy cím koordinátái (lakcím, szervezet címe mentésekor).
 * Hibánál null — a hívó figyelmeztet, de ment.
 */
export async function geocodeAddress(
	context: RemoteContext,
	organizationId: number,
	address: string
): Promise<PlaceResult | null> {
	try {
		const policy = await loadTripPolicy(context, organizationId);
		const results = await searchWithPolicy(context, policy, address, 1);
		return results[0] ?? null;
	} catch (err) {
		console.error('[Work] Geokódolás sikertelen:', err);
		return null;
	}
}

// --- Útvonal (Valhalla) -------------------------------------------------------

function parsePoints(points: unknown): { lat: number; lng: number }[] {
	if (!Array.isArray(points) || points.length < 2) throw new Error('Az útvonalhoz legalább két pont kell.');
	if (points.length > MAX_POINTS) throw new Error(`Legfeljebb ${MAX_POINTS} ponton át lehet útvonalat tervezni.`);
	return points.map((p: any) => {
		const lat = Number(p?.lat);
		const lng = Number(p?.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
			throw new Error('Érvénytelen koordináta az útvonalban.');
		}
		return { lat, lng };
	});
}

/**
 * Belső segéd (a trips.ts is használja): útvonal a pontsoron át, gyorsítótárral.
 * @throws ROUTER_UNAVAILABLE, ha a szolgáltató nem válaszol vagy nem talál útvonalat
 */
export async function routeThrough(
	context: RemoteContext,
	organizationId: number,
	rawPoints: { lat: number; lng: number }[],
	options: RouteOptions = {}
): Promise<RouteResult> {
	const points = parsePoints(rawPoints);
	const policy = await loadTripPolicy(context, organizationId);
	const coordKey = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
	const profile = options.avoidTolls ? 'auto-notolls' : 'auto';
	const key = await sha256(`route|${policy.router.baseUrl}|${profile}|${coordKey}`);
	const cached = await readCache<RouteResult>(context, key, ROUTE_TTL_DAYS);
	if (cached) return cached;

	const body = {
		locations: points.map((p) => ({ lat: p.lat, lon: p.lng })),
		costing: 'auto',
		// A fizetős utak kerülése „puha”: ha nincs más út, a fizetőst is használja, nem ad hibát
		...(options.avoidTolls ? { costing_options: { auto: { use_tolls: 0 } } } : {}),
		units: 'kilometers',
		directions_type: 'none'
	};
	const url = `${policy.router.baseUrl}/route`;
	let data: any;
	try {
		data = await fetchJson(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch (err) {
		console.error('[Work] Útvonaltervezés sikertelen:', err);
		throw new Error(ROUTER_UNAVAILABLE);
	}

	const trip = data?.trip;
	const legs: any[] = Array.isArray(trip?.legs) ? trip.legs : [];
	const km = Number(trip?.summary?.length);
	if (!Number.isFinite(km) || legs.length === 0) throw new Error(ROUTER_UNAVAILABLE);

	const coords = legs.flatMap((leg, i) => {
		const decoded = typeof leg?.shape === 'string' ? decodePolyline(leg.shape) : [];
		// A szakaszok végpontja megegyezik a következő kezdőpontjával
		return i === 0 ? decoded : decoded.slice(1);
	});
	const result: RouteResult = {
		km: Math.round(km * 10) / 10,
		legsKm: legs.map((leg) => Math.round(Number(leg?.summary?.length ?? 0) * 10) / 10),
		durationMin: Math.round(Number(trip?.summary?.time ?? 0) / 60),
		geometry: encodePolyline(coords)
	};
	await writeCache(context, key, 'route', result);
	return result;
}

/** Útvonal a „Távolság számítása” gombhoz (K5). */
export async function calculateRoute(
	params: { organizationId: number; waypoints: Waypoint[]; returnMode: ReturnMode; avoidTolls?: boolean },
	context: RemoteContext
): Promise<RouteResult> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.record');
	const returnMode: ReturnMode = ['origin', 'other', 'none'].includes(params.returnMode) ? params.returnMode : 'origin';
	const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
	return routeThrough(context, organizationId, routePoints(waypoints, returnMode), {
		avoidTolls: params.avoidTolls === true
	});
}
