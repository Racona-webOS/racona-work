/**
 * Kiküldetések — a dolgozók autói (K1).
 *
 * A dolgozó a saját autóit kezeli (`trip.record`), a HR bárkiét (`trip.manage`).
 * Egyedi fogyasztási értéket csak a HR adhat meg, indoklással (D6). Ha az autóra
 * már van út, nem törölhető, csak archiválható (D12).
 */

import type { RemoteContext } from './context.js';
import { hasCapability } from './permissions.js';
import {
	SCHEMA,
	num,
	requireCallerEmployee,
	requireId,
	requireOrganizationId,
	requireTripAccess,
	resolveScope,
	text
} from './trip-access.js';
import { FUEL_RULES, isFuelType, normalizePlate, vehicleConsumption } from './trip-calc.js';
import type { FuelType, VehicleConsumption } from './trip-calc.js';

export interface TripVehicle {
	id: number;
	organizationId: number;
	employeeId: number;
	employeeName: string;
	plateNumber: string;
	model: string;
	engineCc: number | null;
	fuelType: FuelType;
	consumption: VehicleConsumption;
	consumptionOverride: number | null;
	consumptionOverrideReason: string | null;
	isDefault: boolean;
	archived: boolean;
	tripCount: number;
}

const VEHICLE_SELECT = `
	SELECT v.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.email) AS employee_name,
	       (SELECT COUNT(*)::int FROM ${SCHEMA}.trips t WHERE t.vehicle_id = v.id) AS trip_count
	  FROM ${SCHEMA}.trip_vehicles v
	  JOIN ${SCHEMA}.employees e ON e.id = v.employee_id
	  JOIN auth.users u ON u.id = e.user_id`;

export function mapVehicle(row: any): TripVehicle {
	const fuelType: FuelType = isFuelType(row.fuel_type) ? row.fuel_type : 'petrol';
	const engineCc = row.engine_cc ?? null;
	const consumptionOverride = num(row.consumption_override);
	return {
		id: row.id,
		organizationId: row.organization_id,
		employeeId: row.employee_id,
		employeeName: row.employee_name ?? '',
		plateNumber: row.plate_number,
		model: row.model,
		engineCc,
		fuelType,
		consumption: vehicleConsumption({ fuelType, engineCc, consumptionOverride }),
		consumptionOverride,
		consumptionOverrideReason: row.consumption_override_reason ?? null,
		isDefault: row.is_default === true,
		archived: row.archived_at !== null && row.archived_at !== undefined,
		tripCount: Number(row.trip_count ?? 0)
	};
}

/** Belső segéd: egy autó jogosultság-ellenőrzés nélkül. */
export async function loadVehicle(context: RemoteContext, vehicleId: number): Promise<TripVehicle> {
	const r = await context.db.query(`${VEHICLE_SELECT} WHERE v.id = $1`, [vehicleId]);
	if (r.rows.length === 0) throw new Error('Az autó nem található.');
	return mapVehicle(r.rows[0]);
}

export async function getTripVehicles(
	params: { organizationId: number; scope?: 'mine' | 'all'; employeeId?: number; includeArchived?: boolean },
	context: RemoteContext
): Promise<TripVehicle[]> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const employeeId = await resolveScope(context, organizationId, params.scope, params.employeeId, [
		'trip.manage',
		'trip.approve'
	]);
	if (employeeId === undefined) return [];

	const conditions = ['v.organization_id = $1'];
	const values: unknown[] = [organizationId];
	if (employeeId !== null) {
		values.push(employeeId);
		conditions.push(`v.employee_id = $${values.length}`);
	}
	if (!params.includeArchived) conditions.push('v.archived_at IS NULL');

	const r = await context.db.query(
		`${VEHICLE_SELECT} WHERE ${conditions.join(' AND ')}
		 ORDER BY employee_name, v.archived_at NULLS FIRST, v.is_default DESC, v.plate_number`,
		values
	);
	return r.rows.map(mapVehicle);
}

export async function saveTripVehicle(
	params: {
		id?: number;
		organizationId: number;
		/** Másik dolgozó autója (csak `trip.manage`); alapból a hívóé. */
		employeeId?: number;
		plateNumber: string;
		model: string;
		engineCc: number | null;
		fuelType: string;
		isDefault?: boolean;
		consumptionOverride?: number | null;
		consumptionOverrideReason?: string | null;
	},
	context: RemoteContext
): Promise<TripVehicle> {
	const organizationId = requireOrganizationId(params?.organizationId);

	let employeeId: number;
	let existing: TripVehicle | null = null;
	if (params.id) {
		existing = await loadVehicle(context, requireId(params.id, 'autó azonosító'));
		employeeId = existing.employeeId;
	} else if (params.employeeId) {
		employeeId = requireId(params.employeeId, 'dolgozó azonosító');
	} else {
		employeeId = (await requireCallerEmployee(context, organizationId)).id;
	}
	const { employee } = await requireTripAccess(context, employeeId, 'trip.manage');
	if (employee.organizationId !== organizationId) throw new Error('A dolgozó nem ennek a szervezetnek a tagja.');

	const plate = normalizePlate(String(params.plateNumber ?? ''));
	if (!plate || plate.length > 16) throw new Error('A rendszám kötelező (legfeljebb 16 karakter).');
	const model = text(params.model, 100);
	if (!model) throw new Error('A típus kötelező (pl. „Audi A4”).');

	if (!isFuelType(params.fuelType)) throw new Error('Érvénytelen üzemanyag.');
	const fuelType = params.fuelType;
	const rule = FUEL_RULES[fuelType];
	// Meglévő autónál a korábbi (azóta letiltott) üzemanyag megtartható
	if (!rule.enabled && existing?.fuelType !== fuelType) {
		throw new Error('Ez az üzemanyag még nem választható.');
	}

	let engineCc: number | null = null;
	if (params.engineCc !== null && params.engineCc !== undefined && String(params.engineCc) !== '') {
		engineCc = Number(params.engineCc);
		if (!Number.isInteger(engineCc) || engineCc < 50 || engineCc > 10000) {
			throw new Error('A hengerűrtartalom 50 és 10 000 cm³ közötti egész szám legyen.');
		}
	}
	if (rule.requiresEngineCc && engineCc === null) throw new Error('A hengerűrtartalom kötelező.');

	// Egyedi fogyasztás: csak HR, indoklással
	const canManage = await hasCapability(context, organizationId, 'trip.manage');
	let override = existing?.consumptionOverride ?? null;
	let overrideReason = existing?.consumptionOverrideReason ?? null;
	if (params.consumptionOverride !== undefined) {
		const next =
			params.consumptionOverride === null || String(params.consumptionOverride) === ''
				? null
				: Number(params.consumptionOverride);
		const nextReason = text(params.consumptionOverrideReason, 500);
		const changed = next !== override || (next !== null && nextReason !== overrideReason);
		if (changed && !canManage) throw new Error('Egyedi fogyasztást csak a HR adhat meg.');
		if (next !== null) {
			if (!Number.isFinite(next) || next <= 0 || next > 100) {
				throw new Error('Az egyedi fogyasztás 0 és 100 közötti szám legyen.');
			}
			if (!nextReason) throw new Error('Az egyedi fogyasztáshoz indoklás kell.');
		}
		override = next;
		overrideReason = next === null ? null : nextReason;
	}

	const client = await context.db.connect();
	let id: number;
	try {
		await client.query('BEGIN');
		if (params.isDefault) {
			await client.query(`UPDATE ${SCHEMA}.trip_vehicles SET is_default = FALSE WHERE employee_id = $1`, [
				employeeId
			]);
		}
		const values = [plate, model, engineCc, fuelType, override, overrideReason, params.isDefault === true];
		if (existing) {
			const r = await client.query(
				`UPDATE ${SCHEMA}.trip_vehicles
				    SET plate_number = $1, model = $2, engine_cc = $3, fuel_type = $4,
				        consumption_override = $5, consumption_override_reason = $6,
				        is_default = CASE WHEN $7 THEN TRUE ELSE is_default END, updated_at = NOW()
				  WHERE id = $8
				  RETURNING id`,
				[...values, existing.id]
			);
			id = r.rows[0].id;
		} else {
			// Az első autó automatikusan alapértelmezett
			const r = await client.query(
				`INSERT INTO ${SCHEMA}.trip_vehicles
				   (organization_id, employee_id, plate_number, model, engine_cc, fuel_type,
				    consumption_override, consumption_override_reason, is_default)
				 VALUES ($8, $9, $1, $2, $3, $4, $5, $6,
				         $7 OR NOT EXISTS (SELECT 1 FROM ${SCHEMA}.trip_vehicles
				                            WHERE employee_id = $9 AND archived_at IS NULL))
				 RETURNING id`,
				[...values, organizationId, employeeId]
			);
			id = r.rows[0].id;
		}
		await client.query('COMMIT');
	} catch (err: any) {
		await client.query('ROLLBACK');
		if (err?.code === '23505') throw new Error('Ezzel a rendszámmal már van autód.');
		throw err;
	} finally {
		client.release();
	}
	return loadVehicle(context, id);
}

/**
 * Archiválás (`archived: true`, alapértelmezés) vagy visszaállítás. Ha az autóra
 * még nincs út, archiválás helyett törli.
 */
export async function archiveTripVehicle(
	params: { id: number; archived?: boolean },
	context: RemoteContext
): Promise<{ deleted: boolean; vehicle: TripVehicle | null }> {
	const vehicle = await loadVehicle(context, requireId(params?.id, 'autó azonosító'));
	await requireTripAccess(context, vehicle.employeeId, 'trip.manage');

	if (params.archived === false) {
		await context.db.query(`UPDATE ${SCHEMA}.trip_vehicles SET archived_at = NULL, updated_at = NOW() WHERE id = $1`, [
			vehicle.id
		]);
		return { deleted: false, vehicle: await loadVehicle(context, vehicle.id) };
	}
	if (vehicle.tripCount === 0) {
		await context.db.query(`DELETE FROM ${SCHEMA}.trip_vehicles WHERE id = $1`, [vehicle.id]);
		return { deleted: true, vehicle: null };
	}
	await context.db.query(
		`UPDATE ${SCHEMA}.trip_vehicles SET archived_at = NOW(), is_default = FALSE, updated_at = NOW() WHERE id = $1`,
		[vehicle.id]
	);
	return { deleted: false, vehicle: await loadVehicle(context, vehicle.id) };
}
