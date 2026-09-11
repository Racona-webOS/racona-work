/**
 * Kiküldetések — utak rögzítése (K4–K7).
 *
 * Egy út a dolgozó, az autó és a kezdés hónapja (budapesti idő) alapján tartozik
 * egy havi rendelvényhez. Beküldött, jóváhagyott vagy kifizetett rendelvény útjai
 * nem szerkeszthetők (D10); az elrendelőt a jóváhagyó ettől függetlenül
 * felülbírálhatja, amíg a rendelvény nincs jóváhagyva (D14, D21).
 *
 * A km-t a szerver kéri le az útvonaltervezőtől (geo.ts), nem a klienstől
 * fogadja el; eltérni csak indoklással lehet (D2).
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { requireCapability } from './permissions.js';
import {
	SCHEMA,
	num,
	requireCallerEmployee,
	requireId,
	requireOrganizationId,
	requireTripAccess,
	text
} from './trip-access.js';
import { FUEL_RULES, roundKm, routePoints } from './trip-calc.js';
import type { ReturnMode, SettlementStatus, Waypoint } from './trip-calc.js';
import { routeThrough } from './geo.js';
import { loadVehicle } from './trip-vehicles.js';
import { notifyOrderedByOverridden } from './trip-notifications.js';

export interface TripRow {
	id: number;
	organizationId: number;
	employeeId: number;
	employeeName: string;
	vehicleId: number;
	plateNumber: string;
	/** Budapesti idő, `YYYY-MM-DDTHH:mm` */
	startedAt: string;
	endedAt: string;
	purpose: string;
	waypoints: Waypoint[];
	returnMode: ReturnMode;
	routedKm: number | null;
	routeLegsKm: number[] | null;
	distanceKm: number;
	distanceReason: string | null;
	orderedByUserId: number | null;
	orderedByName: string | null;
	/** Ha a HR felülbírálta az elrendelőt: ki és mikor. */
	orderedByOverride: { byUserId: number; byName: string; at: string } | null;
	settlementStatus: SettlementStatus | null;
	/** Beküldött / jóváhagyott / kifizetett rendelvényhez tartozik. */
	locked: boolean;
}

export interface TripDetail extends TripRow {
	routeGeometry: string | null;
}

const LOCKED_STATUSES: SettlementStatus[] = ['submitted', 'approved', 'paid'];
const LOCAL_TIME = `'YYYY-MM-DD"T"HH24:MI'`;
const TZ = `'Europe/Budapest'`;

const TRIP_SELECT = `
	SELECT t.*,
	       to_char(t.started_at AT TIME ZONE ${TZ}, ${LOCAL_TIME}) AS started_local,
	       to_char(t.ended_at AT TIME ZONE ${TZ}, ${LOCAL_TIME}) AS ended_local,
	       COALESCE(NULLIF(TRIM(eu.full_name), ''), eu.email) AS employee_name,
	       v.plate_number,
	       COALESCE(NULLIF(TRIM(ob.full_name), ''), ob.email) AS ordered_by_name,
	       COALESCE(NULLIF(TRIM(ov.full_name), ''), ov.email) AS overridden_by_name,
	       s.status AS settlement_status
	  FROM ${SCHEMA}.trips t
	  JOIN ${SCHEMA}.employees e ON e.id = t.employee_id
	  JOIN auth.users eu ON eu.id = e.user_id
	  JOIN ${SCHEMA}.trip_vehicles v ON v.id = t.vehicle_id
	  LEFT JOIN auth.users ob ON ob.id = t.ordered_by_user_id
	  LEFT JOIN auth.users ov ON ov.id = t.ordered_by_overridden_by
	  LEFT JOIN ${SCHEMA}.trip_settlements s
	         ON s.employee_id = t.employee_id AND s.vehicle_id = t.vehicle_id
	        AND s.year = EXTRACT(YEAR FROM t.started_at AT TIME ZONE ${TZ})
	        AND s.month = EXTRACT(MONTH FROM t.started_at AT TIME ZONE ${TZ})`;

/** A hónap [kezdete, vége) budapesti idő szerint, a $2 (év) és $3 (hónap) paraméterből. */
export const MONTH_RANGE_SQL = `t.started_at >= (make_date($2, $3, 1)::timestamp AT TIME ZONE ${TZ})
	AND t.started_at < ((make_date($2, $3, 1) + INTERVAL '1 month')::timestamp AT TIME ZONE ${TZ})`;

function mapTrip(row: any): TripDetail {
	const status: SettlementStatus | null = row.settlement_status ?? null;
	return {
		id: row.id,
		organizationId: row.organization_id,
		employeeId: row.employee_id,
		employeeName: row.employee_name ?? '',
		vehicleId: row.vehicle_id,
		plateNumber: row.plate_number,
		startedAt: row.started_local,
		endedAt: row.ended_local,
		purpose: row.purpose,
		waypoints: Array.isArray(row.waypoints) ? row.waypoints : [],
		returnMode: row.return_mode,
		routedKm: num(row.routed_km),
		routeLegsKm: Array.isArray(row.route_legs_km) ? row.route_legs_km : null,
		distanceKm: row.distance_km,
		distanceReason: row.distance_reason ?? null,
		orderedByUserId: row.ordered_by_user_id ?? null,
		orderedByName: row.ordered_by_name ?? null,
		orderedByOverride: row.ordered_by_overridden_by
			? {
					byUserId: row.ordered_by_overridden_by,
					byName: row.overridden_by_name ?? '—',
					at: new Date(row.ordered_by_overridden_at).toISOString()
				}
			: null,
		settlementStatus: status,
		locked: status !== null && LOCKED_STATUSES.includes(status),
		routeGeometry: row.route_geometry ?? null
	};
}

function toRow(detail: TripDetail): TripRow {
	const { routeGeometry: _geometry, ...row } = detail;
	return row;
}

async function loadTrip(context: RemoteContext, id: number): Promise<TripDetail> {
	const r = await context.db.query(`${TRIP_SELECT} WHERE t.id = $1`, [id]);
	if (r.rows.length === 0) throw new Error('Az út nem található.');
	return mapTrip(r.rows[0]);
}

/**
 * Belső segéd: utak szűrve (a rendelvény és a havi nézet használja).
 * `employeeId: null` = a szervezet minden dolgozója.
 */
export async function loadMonthTrips(
	context: RemoteContext,
	filter: { organizationId: number; year: number; month: number; employeeId: number | null; vehicleId?: number }
): Promise<TripRow[]> {
	const values: unknown[] = [filter.organizationId, filter.year, filter.month];
	const conditions = ['t.organization_id = $1', MONTH_RANGE_SQL];
	if (filter.employeeId !== null) {
		values.push(filter.employeeId);
		conditions.push(`t.employee_id = $${values.length}`);
	}
	if (filter.vehicleId) {
		values.push(filter.vehicleId);
		conditions.push(`t.vehicle_id = $${values.length}`);
	}
	const r = await context.db.query(
		`${TRIP_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY employee_name, t.started_at, t.id`,
		values
	);
	return r.rows.map((row: any) => toRow(mapTrip(row)));
}

/** Belső segéd: a dolgozó, autó és hónap rendelvényének állapota, vagy null. */
export async function settlementStatusOf(
	context: RemoteContext,
	key: { employeeId: number; vehicleId: number; year: number; month: number }
): Promise<SettlementStatus | null> {
	const r = await context.db.query(
		`SELECT status FROM ${SCHEMA}.trip_settlements
		  WHERE employee_id = $1 AND vehicle_id = $2 AND year = $3 AND month = $4`,
		[key.employeeId, key.vehicleId, key.year, key.month]
	);
	return r.rows[0]?.status ?? null;
}

async function requireUnlocked(
	context: RemoteContext,
	key: { employeeId: number; vehicleId: number; year: number; month: number }
): Promise<void> {
	const status = await settlementStatusOf(context, key);
	if (status && LOCKED_STATUSES.includes(status)) {
		throw new Error(
			status === 'submitted'
				? 'Ennek a hónapnak a rendelvényét már beküldted. Vond vissza a beküldést, ha módosítanál.'
				: 'Ennek a hónapnak a rendelvénye már le van zárva, az útjai nem módosíthatók.'
		);
	}
}

// --- Bemenet ellenőrzése -----------------------------------------------------

function parseLocalDateTime(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
		throw new Error(`${label}: érvénytelen időpont.`);
	}
	const [datePart, timePart] = value.split('T');
	const [y, m, d] = datePart.split('-').map(Number);
	const [hh, mm] = timePart.split(':').map(Number);
	const check = new Date(Date.UTC(y, m - 1, d, hh, mm));
	if (check.getUTCDate() !== d || hh > 23 || mm > 59 || y < 2000 || y > 2100) {
		throw new Error(`${label}: érvénytelen időpont.`);
	}
	return value;
}

function parseWaypoints(value: unknown, returnMode: ReturnMode): Waypoint[] {
	if (!Array.isArray(value)) throw new Error('Az útvonal hiányzik.');
	const min = returnMode === 'other' ? 3 : 2;
	const max = returnMode === 'other' ? 11 : 10;
	if (value.length < min) {
		throw new Error(
			returnMode === 'other' ? 'Add meg, hova érkeztél vissza.' : 'Add meg a kiindulópontot és a célt.'
		);
	}
	if (value.length > max) throw new Error('Legfeljebb 8 köztes megálló adható meg.');
	return value.map((w: any) => {
		const lat = Number(w?.lat);
		const lng = Number(w?.lng);
		const address = text(w?.address, 500);
		if (!address || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
			throw new Error('Az útvonal egyik pontja érvénytelen. Válaszd ki a listából vagy a keresés találatai közül.');
		}
		return { label: text(w?.label, 100) ?? address.slice(0, 100), address, lat, lng };
	});
}

async function requireOrgMemberUser(context: RemoteContext, organizationId: number, userId: unknown): Promise<number | null> {
	if (userId === null || userId === undefined || userId === '') return null;
	const id = requireId(userId, 'elrendelő');
	const r = await context.db.query(
		`SELECT 1 FROM ${SCHEMA}.employees WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
		[organizationId, id]
	);
	if (r.rows.length === 0) throw new Error('Az elrendelő nem tagja a szervezetnek.');
	return id;
}

function monthKey(localDateTime: string): { year: number; month: number } {
	return { year: Number(localDateTime.slice(0, 4)), month: Number(localDateTime.slice(5, 7)) };
}

// --- Remote függvények ---------------------------------------------------------

export async function getTrip(params: { id: number }, context: RemoteContext): Promise<TripDetail> {
	const trip = await loadTrip(context, requireId(params?.id, 'út azonosító'));
	await requireTripAccess(context, trip.employeeId, ['trip.approve', 'trip.manage']);
	return trip;
}

export interface SaveTripParams {
	id?: number;
	organizationId: number;
	/** Más dolgozó útja (csak `trip.manage`); alapból a hívóé. */
	employeeId?: number;
	vehicleId: number;
	/** Budapesti idő, `YYYY-MM-DDTHH:mm` */
	startedAt: string;
	endedAt: string;
	purpose: string;
	waypoints: Waypoint[];
	returnMode: ReturnMode;
	distanceKm: number;
	distanceReason?: string | null;
	orderedByUserId?: number | null;
	/** Az útvonaltervező nélkül, kézzel megadott km (K5). */
	manualDistance?: boolean;
}

export async function saveTrip(params: SaveTripParams, context: RemoteContext): Promise<TripDetail> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const existing = params.id ? await loadTrip(context, requireId(params.id, 'út azonosító')) : null;

	const employeeId = existing
		? existing.employeeId
		: params.employeeId
			? requireId(params.employeeId, 'dolgozó azonosító')
			: (await requireCallerEmployee(context, organizationId)).id;
	const { employee, isSelf } = await requireTripAccess(context, employeeId, 'trip.manage');
	if (employee.organizationId !== organizationId) throw new Error('A dolgozó nem ennek a szervezetnek a tagja.');

	// Autó
	const vehicle = await loadVehicle(context, requireId(params.vehicleId, 'autó azonosító'));
	if (vehicle.employeeId !== employeeId) throw new Error('Az autó nem ehhez a dolgozóhoz tartozik.');
	const keepsVehicle = existing?.vehicleId === vehicle.id;
	if (vehicle.archived && !keepsVehicle) throw new Error('Archivált autóval nem rögzíthető új út.');
	if (!FUEL_RULES[vehicle.fuelType].enabled && !keepsVehicle) {
		throw new Error('Ennek az autónak az üzemanyagával még nem számolható el út.');
	}

	// Időpontok és cél
	const startedAt = parseLocalDateTime(params.startedAt, 'Kezdete');
	const endedAt = parseLocalDateTime(params.endedAt, 'Vége');
	if (endedAt <= startedAt) throw new Error('A vége a kezdete után legyen.');
	const purpose = text(params.purpose, 1000);
	if (!purpose) throw new Error('A kiküldetés célja kötelező.');

	const returnMode: ReturnMode = ['origin', 'other', 'none'].includes(params.returnMode) ? params.returnMode : 'origin';
	const waypoints = parseWaypoints(params.waypoints, returnMode);

	// Zárolás: az új és (szerkesztésnél) a régi hónap is nyitott legyen
	const { year, month } = monthKey(startedAt);
	await requireUnlocked(context, { employeeId, vehicleId: vehicle.id, year, month });
	if (existing) {
		const old = monthKey(existing.startedAt);
		await requireUnlocked(context, { employeeId, vehicleId: existing.vehicleId, ...old });
	}

	// Átfedés ugyanannak a dolgozónak az útjaival
	const overlap = await context.db.query(
		`SELECT to_char(started_at AT TIME ZONE ${TZ}, 'YYYY.MM.DD. HH24:MI') AS started
		   FROM ${SCHEMA}.trips
		  WHERE employee_id = $1 AND id <> $2
		    AND started_at < ($4::timestamp AT TIME ZONE ${TZ})
		    AND ended_at > ($3::timestamp AT TIME ZONE ${TZ})
		  LIMIT 1`,
		[employeeId, existing?.id ?? 0, startedAt, endedAt]
	);
	if (overlap.rows.length > 0) {
		throw new Error(`Az út időben átfed egy másik utaddal (${overlap.rows[0].started}).`);
	}

	// Távolság (D2): a tervezett km a szerveré, eltérni csak indoklással lehet
	let routedKm: number | null = null;
	let legsKm: number[] | null = null;
	let geometry: string | null = null;
	if (!params.manualDistance) {
		const route = await routeThrough(context, organizationId, routePoints(waypoints, returnMode));
		routedKm = route.km;
		legsKm = route.legsKm;
		geometry = route.geometry;
	}
	const distanceKm = Number(params.distanceKm);
	if (!Number.isInteger(distanceKm) || distanceKm < 1 || distanceKm > 5000) {
		throw new Error('Az elszámolt km 1 és 5000 közötti egész szám legyen.');
	}
	const distanceReason = text(params.distanceReason, 500);
	if (routedKm === null && !distanceReason) {
		throw new Error('Kézzel megadott km-hez indoklás kell.');
	}
	if (routedKm !== null && distanceKm !== roundKm(routedKm) && !distanceReason) {
		throw new Error(`Az elszámolt km eltér a tervezettől (${roundKm(routedKm)} km), ehhez indoklás kell.`);
	}
	const keptReason = routedKm !== null && distanceKm === roundKm(routedKm) ? null : distanceReason;

	// Elrendelő: ha a HR más útján változtat, az felülbírálásnak számít
	const orderedBy = await requireOrgMemberUser(context, organizationId, params.orderedByUserId);
	const callerId = await resolveUserId(context);
	const orderedByChanged = !existing || existing.orderedByUserId !== orderedBy;
	let overriddenBy: number | null = existing?.orderedByOverride?.byUserId ?? null;
	let overriddenAt: string | null = existing?.orderedByOverride?.at ?? null;
	if (orderedByChanged) {
		overriddenBy = isSelf || !existing ? null : callerId;
		overriddenAt = overriddenBy ? new Date().toISOString() : null;
	}

	const values = [
		vehicle.id,
		startedAt,
		endedAt,
		purpose,
		JSON.stringify(waypoints),
		returnMode,
		routedKm,
		legsKm ? JSON.stringify(legsKm) : null,
		geometry,
		distanceKm,
		keptReason,
		orderedBy,
		overriddenBy,
		overriddenAt
	];
	let id: number;
	if (existing) {
		const r = await context.db.query(
			`UPDATE ${SCHEMA}.trips
			    SET vehicle_id = $1,
			        started_at = ($2::timestamp AT TIME ZONE ${TZ}),
			        ended_at = ($3::timestamp AT TIME ZONE ${TZ}),
			        purpose = $4, waypoints = $5::jsonb, return_mode = $6,
			        routed_km = $7, route_legs_km = $8::jsonb, route_geometry = $9,
			        distance_km = $10, distance_reason = $11,
			        ordered_by_user_id = $12, ordered_by_overridden_by = $13, ordered_by_overridden_at = $14,
			        updated_at = NOW()
			  WHERE id = $15
			  RETURNING id`,
			[...values, existing.id]
		);
		id = r.rows[0].id;
	} else {
		const r = await context.db.query(
			`INSERT INTO ${SCHEMA}.trips
			   (vehicle_id, started_at, ended_at, purpose, waypoints, return_mode,
			    routed_km, route_legs_km, route_geometry, distance_km, distance_reason,
			    ordered_by_user_id, ordered_by_overridden_by, ordered_by_overridden_at,
			    organization_id, employee_id, created_by)
			 VALUES ($1, ($2::timestamp AT TIME ZONE ${TZ}), ($3::timestamp AT TIME ZONE ${TZ}), $4, $5::jsonb, $6,
			         $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17)
			 RETURNING id`,
			[...values, organizationId, employeeId, callerId]
		);
		id = r.rows[0].id;
	}
	return loadTrip(context, id);
}

export async function deleteTrip(params: { id: number }, context: RemoteContext): Promise<{ ok: true }> {
	const trip = await loadTrip(context, requireId(params?.id, 'út azonosító'));
	await requireTripAccess(context, trip.employeeId, 'trip.manage');
	await requireUnlocked(context, { employeeId: trip.employeeId, vehicleId: trip.vehicleId, ...monthKey(trip.startedAt) });
	await context.db.query(`DELETE FROM ${SCHEMA}.trips WHERE id = $1`, [trip.id]);
	return { ok: true };
}

/**
 * Az elrendelő felülbírálása egy vagy több úton (D14, D21). Jóváhagyó joggal,
 * draft vagy beküldött rendelvény útjain; jóváhagyott rendelvénynél csak
 * visszanyitás után.
 */
export async function setTripOrderedBy(
	params: { tripIds: number[]; orderedByUserId: number | null },
	context: RemoteContext
): Promise<{ updated: number }> {
	const ids = Array.isArray(params?.tripIds) ? [...new Set(params.tripIds.map((id) => requireId(id, 'út azonosító')))] : [];
	if (ids.length === 0) throw new Error('Nincs kiválasztott út.');
	if (ids.length > 500) throw new Error('Egyszerre legfeljebb 500 út módosítható.');

	const r = await context.db.query(`${TRIP_SELECT} WHERE t.id = ANY($1::int[])`, [ids]);
	const trips = r.rows.map(mapTrip);
	if (trips.length !== ids.length) throw new Error('Az egyik út nem található.');
	const organizationId = trips[0].organizationId;
	if (trips.some((t) => t.organizationId !== organizationId)) throw new Error('Az utak több szervezethez tartoznak.');
	await requireCapability(context, organizationId, 'trip.approve');
	if (trips.some((t) => t.settlementStatus === 'approved' || t.settlementStatus === 'paid')) {
		throw new Error('Jóváhagyott rendelvény útjain az elrendelő csak visszanyitás után módosítható.');
	}

	const orderedBy = await requireOrgMemberUser(context, organizationId, params.orderedByUserId);
	const callerId = await resolveUserId(context);
	const changed = trips.filter((t) => t.orderedByUserId !== orderedBy);
	if (changed.length === 0) return { updated: 0 };

	await context.db.query(
		`UPDATE ${SCHEMA}.trips
		    SET ordered_by_user_id = $2, ordered_by_overridden_by = $3, ordered_by_overridden_at = NOW(), updated_at = NOW()
		  WHERE id = ANY($1::int[])`,
		[changed.map((t) => t.id), orderedBy, callerId]
	);

	const perEmployee = new Map<number, number>();
	for (const t of changed) perEmployee.set(t.employeeId, (perEmployee.get(t.employeeId) ?? 0) + 1);
	for (const [employeeId, count] of perEmployee) {
		await notifyOrderedByOverridden(context, { organizationId, employeeId, count });
	}
	return { updated: changed.length };
}
