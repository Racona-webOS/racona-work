/**
 * Kiküldetések — mentett helyek (K2).
 *
 * Mindig választható kiindulópont a dolgozó lakcíme és a munkahely (a szervezet
 * címe, vagy a HR által munkahelynek jelölt céges hely). Céges helyeket a HR
 * kezel (`trip.manage`), saját helyeket a dolgozó.
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
import type { Waypoint } from './trip-calc.js';

export interface TripPlace extends Waypoint {
	id: number;
	/** null = céges hely */
	employeeId: number | null;
	isWorkplace: boolean;
}

export interface TripPlaces {
	/** A dolgozó lakcíme, ha van koordinátája. */
	home: Waypoint | null;
	/** A munkahely: a munkahelynek jelölt céges hely, különben a szervezet címe. */
	workplace: Waypoint | null;
	company: TripPlace[];
	personal: TripPlace[];
	/**
	 * A dolgozó legutóbb rögzített útjának „fizetős utak elkerülése” beállítása:
	 * új útnál ez az alapértelmezés (K5). Ha még nincs útja, false.
	 */
	lastAvoidTolls: boolean;
}

export const HOME_LABEL = 'Lakcím';
export const WORKPLACE_LABEL = 'Munkahely';

function mapPlace(row: any): TripPlace {
	return {
		id: row.id,
		employeeId: row.employee_id ?? null,
		label: row.label,
		address: row.address,
		lat: num(row.lat) ?? 0,
		lng: num(row.lng) ?? 0,
		isWorkplace: row.is_workplace === true
	};
}

/** Belső segéd: a dolgozó lakcíme és a munkahely (a rendelvényhez és az űrlaphoz). */
export async function loadHomeAndWorkplace(
	context: RemoteContext,
	organizationId: number,
	employeeId: number
): Promise<{ home: Waypoint | null; workplace: Waypoint | null }> {
	const emp = await context.db.query(
		`SELECT home_address, home_lat, home_lng FROM ${SCHEMA}.employees WHERE id = $1`,
		[employeeId]
	);
	const e = emp.rows[0];
	const home =
		e?.home_address && e.home_lat !== null
			? { label: HOME_LABEL, address: e.home_address, lat: num(e.home_lat)!, lng: num(e.home_lng)! }
			: null;

	const marked = await context.db.query(
		`SELECT address, lat, lng FROM ${SCHEMA}.trip_places
		  WHERE organization_id = $1 AND employee_id IS NULL AND is_workplace = TRUE LIMIT 1`,
		[organizationId]
	);
	let workplace: Waypoint | null = null;
	if (marked.rows[0]) {
		const w = marked.rows[0];
		workplace = { label: WORKPLACE_LABEL, address: w.address, lat: num(w.lat)!, lng: num(w.lng)! };
	} else {
		const org = await context.db.query(
			`SELECT address, address_lat, address_lng FROM ${SCHEMA}.organizations WHERE id = $1`,
			[organizationId]
		);
		const o = org.rows[0];
		if (o?.address && o.address_lat !== null) {
			workplace = { label: WORKPLACE_LABEL, address: o.address, lat: num(o.address_lat)!, lng: num(o.address_lng)! };
		}
	}
	return { home, workplace };
}

/**
 * A választható helyek. `employeeId` csak akkor kell, ha a HR más nevében
 * rögzít utat (akkor annak a dolgozónak a lakcíme és saját helyei jönnek).
 */
export async function getTripPlaces(
	params: { organizationId: number; employeeId?: number },
	context: RemoteContext
): Promise<TripPlaces> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const employee = params.employeeId
		? (await requireTripAccess(context, requireId(params.employeeId, 'dolgozó azonosító'), 'trip.manage')).employee
		: await requireCallerEmployee(context, organizationId);
	if (employee.organizationId !== organizationId) throw new Error('A dolgozó nem ennek a szervezetnek a tagja.');

	const { home, workplace } = await loadHomeAndWorkplace(context, organizationId, employee.id);
	const r = await context.db.query(
		`SELECT * FROM ${SCHEMA}.trip_places
		  WHERE organization_id = $1 AND (employee_id IS NULL OR employee_id = $2)
		  ORDER BY label`,
		[organizationId, employee.id]
	);
	const places = r.rows.map(mapPlace);
	const last = await context.db.query(
		`SELECT avoid_tolls FROM ${SCHEMA}.trips WHERE employee_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
		[employee.id]
	);
	return {
		home,
		workplace,
		company: places.filter((p) => p.employeeId === null),
		personal: places.filter((p) => p.employeeId !== null),
		lastAvoidTolls: last.rows[0]?.avoid_tolls === true
	};
}

/** Csak a céges helyek (a beállítások oldalhoz). */
export async function getCompanyTripPlaces(
	params: { organizationId: number },
	context: RemoteContext
): Promise<TripPlace[]> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.record');
	const r = await context.db.query(
		`SELECT * FROM ${SCHEMA}.trip_places WHERE organization_id = $1 AND employee_id IS NULL ORDER BY label`,
		[organizationId]
	);
	return r.rows.map(mapPlace);
}

export async function saveTripPlace(
	params: {
		id?: number;
		organizationId: number;
		scope: 'company' | 'personal';
		/** Saját hely más dolgozónak (csak `trip.manage`). */
		employeeId?: number;
		label: string;
		address: string;
		lat: number;
		lng: number;
		isWorkplace?: boolean;
	},
	context: RemoteContext
): Promise<TripPlace> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const label = text(params.label, 100);
	const address = text(params.address, 500);
	const lat = Number(params.lat);
	const lng = Number(params.lng);
	if (!label) throw new Error('A hely neve kötelező.');
	if (!address) throw new Error('A cím kötelező.');
	if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
		throw new Error('Érvénytelen koordináta. Válaszd ki a helyet a keresés találatai közül.');
	}

	let employeeId: number | null = null;
	if (params.scope === 'company') {
		await requireCapability(context, organizationId, 'trip.manage');
	} else {
		employeeId = params.employeeId
			? requireId(params.employeeId, 'dolgozó azonosító')
			: (await requireCallerEmployee(context, organizationId)).id;
		const { employee } = await requireTripAccess(context, employeeId, 'trip.manage');
		if (employee.organizationId !== organizationId) throw new Error('A dolgozó nem ennek a szervezetnek a tagja.');
	}
	const isWorkplace = params.scope === 'company' && params.isWorkplace === true;

	if (params.id) {
		const existing = await context.db.query(
			`SELECT organization_id, employee_id FROM ${SCHEMA}.trip_places WHERE id = $1`,
			[params.id]
		);
		const row = existing.rows[0];
		if (!row || row.organization_id !== organizationId || (row.employee_id ?? null) !== employeeId) {
			throw new Error('A hely nem található.');
		}
	}

	const client = await context.db.connect();
	try {
		await client.query('BEGIN');
		if (isWorkplace) {
			await client.query(
				`UPDATE ${SCHEMA}.trip_places SET is_workplace = FALSE WHERE organization_id = $1 AND employee_id IS NULL`,
				[organizationId]
			);
		}
		const r = params.id
			? await client.query(
					`UPDATE ${SCHEMA}.trip_places SET label = $1, address = $2, lat = $3, lng = $4, is_workplace = $5
					  WHERE id = $6 RETURNING *`,
					[label, address, lat, lng, isWorkplace, params.id]
				)
			: await client.query(
					`INSERT INTO ${SCHEMA}.trip_places (organization_id, employee_id, label, address, lat, lng, is_workplace, created_by)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
					[organizationId, employeeId, label, address, lat, lng, isWorkplace, await resolveUserId(context)]
				);
		await client.query('COMMIT');
		return mapPlace(r.rows[0]);
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

export async function deleteTripPlace(params: { id: number }, context: RemoteContext): Promise<{ ok: true }> {
	const id = requireId(params?.id, 'hely azonosító');
	const r = await context.db.query(`SELECT organization_id, employee_id FROM ${SCHEMA}.trip_places WHERE id = $1`, [id]);
	const row = r.rows[0];
	if (!row) throw new Error('A hely nem található.');
	if (row.employee_id === null) {
		await requireCapability(context, row.organization_id, 'trip.manage');
	} else {
		await requireTripAccess(context, row.employee_id, 'trip.manage');
	}
	await context.db.query(`DELETE FROM ${SCHEMA}.trip_places WHERE id = $1`, [id]);
	return { ok: true };
}
