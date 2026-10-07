/**
 * Kiküldetések — havi rendelvény (dolgozó + autó + hónap, D1).
 *
 * Állapotok (6. fejezet):
 *   (nincs sor) ──beküldés──▶ submitted ──jóváhagyás──▶ approved ──kifizetve──▶ paid
 *   submitted ──visszavonás / visszaküldés──▶ draft ──újraküldés──▶ submitted
 *   approved ──HR visszanyitás──▶ draft
 *
 * A rendelvény tartalma (SettlementDocument) draft és submitted állapotban élő
 * számítás; beküldéskor és jóváhagyáskor pillanatkép is készül. Jóváhagyás után a
 * nyomtatás és az xlsx a pillanatképből dolgozik (D11), így a későbbi adatváltozás
 * nem írja át a bizonylatot. A bizonylatszámot jóváhagyáskor kapja (D20).
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { ensureNotSelfDecision, hasCapability, requireCapability } from './permissions.js';
import {
	SCHEMA,
	requireId,
	requireOrganizationId,
	requireTripAccess,
	resolveScope,
	text,
	userName
} from './trip-access.js';
import {
	FUEL_RULES,
	blocksApproval,
	calculateSettlement,
	formatDocumentNumber,
	periodLabel,
	routeLabel,
	settlementWarnings
} from './trip-calc.js';
import type { SettlementDocument, SettlementStatus, SettlementWarning } from './trip-calc.js';
import { loadMonthTrips } from './trips.js';
import type { TripRow } from './trips.js';
import { loadVehicle } from './trip-vehicles.js';
import { loadFuelPrice, loadTripPolicy } from './trip-settings.js';
import { todayInBudapest, parseDay } from './dates.js';
import type { PaginatedResult } from './types.js';
import { notifySettlementEvent, notifySettlementSubmitted } from './trip-notifications.js';
import type { SettlementNotice } from './trip-notifications.js';

export interface SettlementKey {
	employeeId: number;
	vehicleId: number;
	year: number;
	month: number;
}

interface SettlementDbRow {
	id: number;
	organization_id: number;
	employee_id: number;
	vehicle_id: number;
	year: number;
	month: number;
	status: SettlementStatus;
	document_number: string | null;
	snapshot: SettlementDocument;
	note: string | null;
	submitted_day: string | null;
	approved_by: number | null;
	approved_at: string | null;
	paid_by: number | null;
	paid_day: string | null;
}

const SETTLEMENT_SELECT = `
	SELECT s.*,
	       to_char(s.submitted_at AT TIME ZONE 'Europe/Budapest', 'YYYY-MM-DD') AS submitted_day,
	       to_char(s.paid_at, 'YYYY-MM-DD') AS paid_day
	  FROM ${SCHEMA}.trip_settlements s`;

function parseKey(params: Partial<SettlementKey>): SettlementKey {
	const year = Number(params.year);
	const month = Number(params.month);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Érvénytelen év');
	if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Érvénytelen hónap');
	return {
		employeeId: requireId(params.employeeId, 'dolgozó azonosító'),
		vehicleId: requireId(params.vehicleId, 'autó azonosító'),
		year,
		month
	};
}

async function loadSettlementRow(context: RemoteContext, id: number): Promise<SettlementDbRow> {
	const r = await context.db.query(`${SETTLEMENT_SELECT} WHERE s.id = $1`, [id]);
	if (r.rows.length === 0) throw new Error('A rendelvény nem található.');
	return r.rows[0];
}

async function findSettlementRow(context: RemoteContext, key: SettlementKey): Promise<SettlementDbRow | null> {
	const r = await context.db.query(
		`${SETTLEMENT_SELECT} WHERE s.employee_id = $1 AND s.vehicle_id = $2 AND s.year = $3 AND s.month = $4`,
		[key.employeeId, key.vehicleId, key.year, key.month]
	);
	return r.rows[0] ?? null;
}

function keyOf(row: SettlementDbRow): SettlementKey {
	return { employeeId: row.employee_id, vehicleId: row.vehicle_id, year: row.year, month: row.month };
}

function isFinal(status: SettlementStatus | null): boolean {
	return status === 'approved' || status === 'paid';
}

// --- A rendelvény összeállítása --------------------------------------------------

/**
 * Élő rendelvény a jelenlegi adatokból. A `row` a meglévő rendelvénysor (állapot,
 * bizonylatszám, jóváhagyás), ha van.
 */
async function buildDocument(
	context: RemoteContext,
	key: SettlementKey,
	row: SettlementDbRow | null,
	preloadedTrips?: TripRow[]
): Promise<SettlementDocument> {
	const vehicle = await loadVehicle(context, key.vehicleId);
	if (vehicle.employeeId !== key.employeeId) throw new Error('Az autó nem ehhez a dolgozóhoz tartozik.');
	const organizationId = vehicle.organizationId;

	const [empResult, orgResult, policy] = await Promise.all([
		context.db.query(
			`SELECT e.home_address, to_char(e.birth_date, 'YYYY-MM-DD') AS birth_day, e.birth_place,
			        e.mother_name, e.tax_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.email) AS name
			   FROM ${SCHEMA}.employees e JOIN auth.users u ON u.id = e.user_id
			  WHERE e.id = $1`,
			[key.employeeId]
		),
		context.db.query(`SELECT name, address, tax_number FROM ${SCHEMA}.organizations WHERE id = $1`, [organizationId]),
		loadTripPolicy(context, organizationId)
	]);
	const emp = empResult.rows[0];
	const org = orgResult.rows[0];

	const rule = FUEL_RULES[vehicle.fuelType];
	const price = await loadFuelPrice(context, organizationId, key.year, key.month, rule.priceType);
	const trips =
		preloadedTrips ??
		(await loadMonthTrips(context, {
			organizationId,
			year: key.year,
			month: key.month,
			employeeId: key.employeeId,
			vehicleId: key.vehicleId
		}));

	const calc = calculateSettlement({
		trips: trips.map((t) => ({ id: t.id, km: t.distanceKm })),
		consumption: vehicle.consumption.value,
		unit: vehicle.consumption.unit,
		price,
		normCostPerKm: policy.normCostPerKm
	});

	const warnings = settlementWarnings({
		employee: {
			homeAddress: emp?.home_address ?? null,
			birthDate: emp?.birth_day ?? null,
			birthPlace: emp?.birth_place ?? null,
			motherName: emp?.mother_name ?? null,
			taxId: emp?.tax_id ?? null
		},
		organization: { address: org?.address ?? null, taxNumber: org?.tax_number ?? null },
		tripsWithoutOrderer: trips.filter((t) => t.orderedByUserId === null).length,
		consumptionMissing: vehicle.consumption.value === null,
		missingPrice: price === null ? { priceType: rule.priceType, year: key.year, month: key.month } : null
	});

	const approvedByName = row?.approved_by ? await userName(context, row.approved_by) : null;
	const paidByName = row?.paid_by ? await userName(context, row.paid_by) : null;

	return {
		settlementId: row?.id ?? null,
		status: row?.status ?? null,
		documentNumber: row?.document_number ?? null,
		year: key.year,
		month: key.month,
		periodLabel: periodLabel(key.year, key.month),
		issuedOn: row?.submitted_day ?? todayInBudapest(),
		employer: { name: org?.name ?? '', address: org?.address ?? null, taxNumber: org?.tax_number ?? null },
		employee: {
			id: key.employeeId,
			name: emp?.name ?? '',
			address: emp?.home_address ?? null,
			birthDate: emp?.birth_day ?? null,
			birthPlace: emp?.birth_place ?? null,
			motherName: emp?.mother_name ?? null,
			taxId: emp?.tax_id ?? null
		},
		vehicle: {
			id: vehicle.id,
			plate: vehicle.plateNumber,
			model: vehicle.model,
			engineCc: vehicle.engineCc,
			fuelType: vehicle.fuelType,
			priceType: rule.priceType,
			consumptionSource: vehicle.consumption.source,
			consumptionOverrideReason: vehicle.consumptionOverrideReason
		},
		calc,
		rows: trips.map((t, i) => ({
			tripId: t.id,
			index: i + 1,
			startedAt: t.startedAt.replace('T', ' '),
			endedAt: t.endedAt.replace('T', ' '),
			route: routeLabel(t.waypoints, t.returnMode, true),
			purpose: t.purpose,
			orderedByUserId: t.orderedByUserId,
			orderedByName: t.orderedByName,
			orderedByOverridden: t.orderedByOverride !== null,
			km: t.distanceKm,
			routedKm: t.routedKm,
			distanceReason: t.distanceReason,
			price,
			amount: calc.rows[i]?.amount ?? null
		})),
		approval:
			row?.approved_at && approvedByName
				? { byName: approvedByName, at: new Date(row.approved_at).toISOString().slice(0, 10) }
				: null,
		payment: row?.paid_day && paidByName ? { byName: paidByName, at: row.paid_day } : null,
		note: row?.note ?? null,
		warnings
	};
}

/**
 * A megjelenítendő rendelvény: jóváhagyott és kifizetett állapotban a
 * pillanatkép (az állapot és a kifizetés a sorból frissítve), egyébként élő.
 */
async function documentFor(context: RemoteContext, key: SettlementKey, row: SettlementDbRow | null) {
	if (row && isFinal(row.status)) {
		const paidByName = row.paid_by ? await userName(context, row.paid_by) : null;
		return {
			...row.snapshot,
			settlementId: row.id,
			status: row.status,
			documentNumber: row.document_number,
			note: row.note,
			payment: row.paid_day && paidByName ? { byName: paidByName, at: row.paid_day } : null
		} satisfies SettlementDocument;
	}
	return buildDocument(context, key, row);
}

function noticeOf(row: SettlementDbRow, doc: SettlementDocument): SettlementNotice {
	return {
		id: row.id,
		organizationId: row.organization_id,
		employeeId: row.employee_id,
		year: row.year,
		month: row.month,
		plateNumber: doc.vehicle.plate
	};
}

// --- Lekérdezések ------------------------------------------------------------------

/** Rendelvény egy dolgozó, autó és hónap szerint, vagy azonosító szerint. */
export async function getSettlementDocument(
	params: { id?: number } & Partial<SettlementKey>,
	context: RemoteContext
): Promise<SettlementDocument> {
	let row: SettlementDbRow | null;
	let key: SettlementKey;
	if (params?.id) {
		row = await loadSettlementRow(context, requireId(params.id, 'rendelvény azonosító'));
		key = keyOf(row);
	} else {
		key = parseKey(params ?? {});
		row = await findSettlementRow(context, key);
	}
	await requireTripAccess(context, key.employeeId, ['trip.approve', 'trip.manage']);
	return documentFor(context, key, row);
}

export interface TripMonthGroup {
	employeeId: number;
	employeeName: string;
	vehicleId: number;
	plateNumber: string;
	model: string;
	settlementId: number | null;
	status: SettlementStatus | null;
	documentNumber: string | null;
	note: string | null;
	totalKm: number;
	total: number | null;
	ratePerKm: number | null;
	warnings: SettlementWarning[];
}

/**
 * A havi nézet (Utaim, K8): az utak és dolgozónként + autónként a rendelvény
 * összesítője, állapota és figyelmeztetései.
 */
export async function getTripMonth(
	params: { organizationId: number; scope?: 'mine' | 'all'; year: number; month: number; employeeId?: number },
	context: RemoteContext
): Promise<{ trips: TripRow[]; groups: TripMonthGroup[] }> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const year = Number(params.year);
	const month = Number(params.month);
	if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
		throw new Error('Érvénytelen időszak');
	}
	const employeeId = await resolveScope(context, organizationId, params.scope, params.employeeId, [
		'trip.approve',
		'trip.manage'
	]);
	if (employeeId === undefined) return { trips: [], groups: [] };

	const trips = await loadMonthTrips(context, { organizationId, year, month, employeeId });

	// Csoportok: az utak, plusz az út nélküli, de létező rendelvények (pl. visszaküldés után törölt utak)
	const keys = new Map<string, SettlementKey>();
	for (const t of trips) {
		keys.set(`${t.employeeId}:${t.vehicleId}`, { employeeId: t.employeeId, vehicleId: t.vehicleId, year, month });
	}
	const existing = await context.db.query(
		`${SETTLEMENT_SELECT}
		  WHERE s.organization_id = $1 AND s.year = $2 AND s.month = $3 ${employeeId !== null ? 'AND s.employee_id = $4' : ''}`,
		employeeId !== null ? [organizationId, year, month, employeeId] : [organizationId, year, month]
	);
	const rows = new Map<string, SettlementDbRow>();
	for (const row of existing.rows as SettlementDbRow[]) {
		const k = `${row.employee_id}:${row.vehicle_id}`;
		rows.set(k, row);
		if (!keys.has(k)) keys.set(k, keyOf(row));
	}

	const groups: TripMonthGroup[] = [];
	for (const [k, key] of keys) {
		const row = rows.get(k) ?? null;
		const groupTrips = trips.filter((t) => t.employeeId === key.employeeId && t.vehicleId === key.vehicleId);
		const doc =
			row && isFinal(row.status) ? await documentFor(context, key, row) : await buildDocument(context, key, row, groupTrips);
		groups.push({
			employeeId: key.employeeId,
			employeeName: doc.employee.name,
			vehicleId: key.vehicleId,
			plateNumber: doc.vehicle.plate,
			model: doc.vehicle.model,
			settlementId: row?.id ?? null,
			status: row?.status ?? null,
			documentNumber: row?.document_number ?? null,
			note: row?.note ?? null,
			totalKm: doc.calc.totalKm,
			total: doc.calc.total,
			ratePerKm: doc.calc.ratePerKm,
			warnings: doc.warnings
		});
	}
	groups.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'hu') || a.plateNumber.localeCompare(b.plateNumber));
	return { trips, groups };
}

export interface SettlementListRow {
	id: number;
	employeeId: number;
	employeeName: string;
	vehicleId: number;
	plateNumber: string;
	year: number;
	month: number;
	status: SettlementStatus;
	documentNumber: string | null;
	totalKm: number;
	totalAmount: number | null;
	warningCount: number;
	blocking: boolean;
	submittedAt: string | null;
	approvedAt: string | null;
	paidAt: string | null;
}

export async function getSettlements(
	params: {
		organizationId: number;
		scope?: 'mine' | 'all';
		year?: number;
		month?: number;
		status?: SettlementStatus;
		employeeId?: number;
		page?: number;
		pageSize?: number;
	},
	context: RemoteContext
): Promise<PaginatedResult<SettlementListRow>> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const page = Math.max(1, Number(params.page) || 1);
	const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));
	const employeeId = await resolveScope(context, organizationId, params.scope, params.employeeId, [
		'trip.approve',
		'trip.manage'
	]);
	if (employeeId === undefined) {
		return { data: [], pagination: { page, pageSize, totalCount: 0, totalPages: 0 } };
	}

	const conditions = [
		's.organization_id = $1',
		`NOT EXISTS (SELECT 1 FROM ${SCHEMA}.employees x WHERE x.id = s.employee_id AND x.is_external)`
	];
	const values: unknown[] = [organizationId];
	const add = (sql: string, value: unknown) => {
		values.push(value);
		conditions.push(sql.replace('?', `$${values.length}`));
	};
	if (employeeId !== null) add('s.employee_id = ?', employeeId);
	if (params.year) add('s.year = ?', Number(params.year));
	if (params.month) add('s.month = ?', Number(params.month));
	if (params.status && ['draft', 'submitted', 'approved', 'paid'].includes(params.status)) add('s.status = ?', params.status);
	const where = conditions.join(' AND ');

	const count = await context.db.query(`SELECT COUNT(*)::int AS c FROM ${SCHEMA}.trip_settlements s WHERE ${where}`, values);
	const totalCount = count.rows[0].c as number;

	values.push(pageSize, (page - 1) * pageSize);
	const r = await context.db.query(
		`SELECT s.id, s.employee_id, s.vehicle_id, s.year, s.month, s.status, s.document_number,
		        s.total_km, s.total_amount, s.submitted_at, s.approved_at, to_char(s.paid_at, 'YYYY-MM-DD') AS paid_day,
		        s.snapshot->'warnings' AS warnings,
		        COALESCE(NULLIF(TRIM(u.full_name), ''), u.email) AS employee_name, v.plate_number
		   FROM ${SCHEMA}.trip_settlements s
		   JOIN ${SCHEMA}.employees e ON e.id = s.employee_id
		   JOIN auth.users u ON u.id = e.user_id
		   JOIN ${SCHEMA}.trip_vehicles v ON v.id = s.vehicle_id
		  WHERE ${where}
		  ORDER BY s.year DESC, s.month DESC,
		           CASE s.status WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
		           employee_name
		  LIMIT $${values.length - 1} OFFSET $${values.length}`,
		values
	);
	return {
		data: r.rows.map((row: any) => {
			const warnings: SettlementWarning[] = Array.isArray(row.warnings) ? row.warnings : [];
			return {
				id: row.id,
				employeeId: row.employee_id,
				employeeName: row.employee_name,
				vehicleId: row.vehicle_id,
				plateNumber: row.plate_number,
				year: row.year,
				month: row.month,
				status: row.status,
				documentNumber: row.document_number,
				totalKm: row.total_km,
				totalAmount: row.total_amount,
				warningCount: warnings.length,
				blocking: warnings.some(blocksApproval),
				submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
				approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
				paidAt: row.paid_day ?? null
			};
		}),
		pagination: { page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) }
	};
}

// --- Állapotváltások -----------------------------------------------------------------

/** Beküldés (K9). A figyelmeztetések nem akadályozzák (D17). */
export async function submitSettlement(params: SettlementKey, context: RemoteContext): Promise<SettlementDocument> {
	const key = parseKey(params ?? {});
	const { employee } = await requireTripAccess(context, key.employeeId, 'trip.manage');

	const current = await findSettlementRow(context, key);
	if (current && current.status !== 'draft') throw new Error('Ezt a rendelvényt már beküldték.');
	const doc = await buildDocument(context, key, current);
	if (doc.rows.length === 0) throw new Error('Ebben a hónapban nincs út ezzel az autóval.');

	const snapshot: SettlementDocument = { ...doc, status: 'submitted', issuedOn: todayInBudapest() };
	const r = await context.db.query(
		`INSERT INTO ${SCHEMA}.trip_settlements
		   (organization_id, employee_id, vehicle_id, year, month, status, total_km, total_amount, snapshot, submitted_at)
		 VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8::jsonb, NOW())
		 ON CONFLICT (employee_id, vehicle_id, year, month) DO UPDATE
		    SET status = 'submitted', total_km = EXCLUDED.total_km, total_amount = EXCLUDED.total_amount,
		        snapshot = EXCLUDED.snapshot, submitted_at = NOW(), note = NULL, updated_at = NOW()
		  WHERE ${SCHEMA}.trip_settlements.status = 'draft'
		 RETURNING id`,
		[
			employee.organizationId,
			key.employeeId,
			key.vehicleId,
			key.year,
			key.month,
			doc.calc.totalKm,
			doc.calc.total,
			JSON.stringify(snapshot)
		]
	);
	if (r.rows.length === 0) throw new Error('Ezt a rendelvényt már beküldték.');
	const row = await loadSettlementRow(context, r.rows[0].id);
	await notifySettlementSubmitted(context, noticeOf(row, doc), doc.warnings.length);
	return documentFor(context, key, row);
}

/**
 * A dolgozó visszavonja a beküldést, amíg nincs jóváhagyva (D10). Csak a saját
 * rendelvényét: a HR indoklással, értesítéssel küldi vissza (`decideSettlement`).
 */
export async function withdrawSettlement(params: { id: number }, context: RemoteContext): Promise<SettlementDocument> {
	const row = await loadSettlementRow(context, requireId(params?.id, 'rendelvény azonosító'));
	// Emelt jog nélkül: csak a saját rendelvény (`trip.record`)
	await requireTripAccess(context, row.employee_id, []);
	const r = await context.db.query(
		`UPDATE ${SCHEMA}.trip_settlements SET status = 'draft', updated_at = NOW()
		  WHERE id = $1 AND status = 'submitted' RETURNING id`,
		[row.id]
	);
	if (r.rows.length === 0) throw new Error('Csak beküldött, még el nem bírált rendelvény vonható vissza.');
	return documentFor(context, keyOf(row), await loadSettlementRow(context, row.id));
}

/**
 * Jóváhagyás vagy visszaküldés (K10). Jóváhagyáskor a rendelvény megkapja a
 * következő bizonylatszámot, ha még nincs neki (D20), és a pillanatkép frissül.
 */
export async function decideSettlement(
	params: { id: number; decision: 'approve' | 'return'; note?: string | null },
	context: RemoteContext
): Promise<SettlementDocument> {
	const row = await loadSettlementRow(context, requireId(params?.id, 'rendelvény azonosító'));
	await requireCapability(context, row.organization_id, 'trip.approve');
	await ensureNotSelfDecision(context, row.employee_id);
	if (row.status !== 'submitted') throw new Error('A rendelvényt már elbírálták, vagy nincs beküldve.');
	const note = text(params.note, 1000);
	const key = keyOf(row);
	const callerId = await resolveUserId(context);

	if (params.decision === 'return') {
		if (!note) throw new Error('A visszaküldéshez írd meg az okát.');
		const r = await context.db.query(
			`UPDATE ${SCHEMA}.trip_settlements SET status = 'draft', note = $2, updated_at = NOW()
			  WHERE id = $1 AND status = 'submitted' RETURNING id`,
			[row.id, note]
		);
		if (r.rows.length === 0) throw new Error('A rendelvényt közben már elbírálták.');
		const doc = await documentFor(context, key, await loadSettlementRow(context, row.id));
		await notifySettlementEvent(context, noticeOf(row, doc), 'returned', { note });
		return doc;
	}
	if (params.decision !== 'approve') throw new Error('Érvénytelen döntés');

	const doc = await buildDocument(context, key, row);
	const blocking = doc.warnings.filter(blocksApproval);
	if (blocking.length > 0) {
		throw new Error(
			blocking.some((w) => w.kind === 'missing_fuel_price')
				? 'Erre a hónapra nincs rögzítve NAV üzemanyagár, ezért a rendelvény nem hagyható jóvá.'
				: 'Az autónak nincs fogyasztási normája, ezért a rendelvény nem hagyható jóvá.'
		);
	}
	const policy = await loadTripPolicy(context, row.organization_id);
	const approverName = (await userName(context, callerId)) ?? '—';
	const today = todayInBudapest();

	const client = await context.db.connect();
	let documentNumber = row.document_number;
	try {
		await client.query('BEGIN');
		const claimed = await client.query(
			`UPDATE ${SCHEMA}.trip_settlements SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
			  WHERE id = $1 AND status = 'submitted' RETURNING id`,
			[row.id, callerId]
		);
		if (claimed.rows.length === 0) throw new Error('A rendelvényt közben már elbírálták.');

		if (!documentNumber) {
			const counter = await client.query(
				`INSERT INTO ${SCHEMA}.trip_document_counters (organization_id, year, last_number)
				 VALUES ($1, $2, 1)
				 ON CONFLICT (organization_id, year)
				 DO UPDATE SET last_number = ${SCHEMA}.trip_document_counters.last_number + 1
				 RETURNING last_number`,
				[row.organization_id, row.year]
			);
			documentNumber = formatDocumentNumber(policy.documentNumberPrefix, row.year, counter.rows[0].last_number);
		}

		const snapshot: SettlementDocument = {
			...doc,
			status: 'approved',
			documentNumber,
			issuedOn: row.submitted_day ?? today,
			approval: { byName: approverName, at: today },
			note: null
		};
		await client.query(
			`UPDATE ${SCHEMA}.trip_settlements
			    SET document_number = $2, snapshot = $3::jsonb, total_km = $4, total_amount = $5, note = NULL
			  WHERE id = $1`,
			[row.id, documentNumber, JSON.stringify(snapshot), doc.calc.totalKm, doc.calc.total]
		);
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	const approved = await documentFor(context, key, await loadSettlementRow(context, row.id));
	await notifySettlementEvent(context, noticeOf(row, approved), 'approved', { documentNumber });
	return approved;
}

/** Kifizetettnek jelölés (K11): a rendelvény végleg lezárul. */
export async function markSettlementPaid(
	params: { id: number; paidAt?: string },
	context: RemoteContext
): Promise<SettlementDocument> {
	const row = await loadSettlementRow(context, requireId(params?.id, 'rendelvény azonosító'));
	await requireCapability(context, row.organization_id, 'trip.manage');
	await ensureNotSelfDecision(context, row.employee_id);
	const paidAt = parseDay(params.paidAt ?? todayInBudapest(), 'Kifizetés dátuma', true)!;
	if (paidAt > todayInBudapest()) throw new Error('A kifizetés dátuma nem lehet a jövőben.');

	const r = await context.db.query(
		`UPDATE ${SCHEMA}.trip_settlements SET status = 'paid', paid_by = $2, paid_at = $3, updated_at = NOW()
		  WHERE id = $1 AND status = 'approved' RETURNING id`,
		[row.id, await resolveUserId(context), paidAt]
	);
	if (r.rows.length === 0) throw new Error('Csak jóváhagyott rendelvény jelölhető kifizetettnek.');
	const doc = await documentFor(context, keyOf(row), await loadSettlementRow(context, row.id));
	await notifySettlementEvent(context, noticeOf(row, doc), 'paid', { documentNumber: row.document_number });
	return doc;
}

/**
 * Visszanyitás a kifizetés előtt: `approved` → `draft`; a bizonylatszám megmarad (D20).
 * A saját rendelvényét senki nem nyithatja vissza, mint ahogy jóvá sem hagyhatja.
 */
export async function reopenSettlement(
	params: { id: number; note: string },
	context: RemoteContext
): Promise<SettlementDocument> {
	const row = await loadSettlementRow(context, requireId(params?.id, 'rendelvény azonosító'));
	await requireCapability(context, row.organization_id, 'trip.manage');
	await ensureNotSelfDecision(context, row.employee_id);
	const note = text(params.note, 1000);
	if (!note) throw new Error('A visszanyitáshoz írd meg az okát.');
	const r = await context.db.query(
		`UPDATE ${SCHEMA}.trip_settlements
		    SET status = 'draft', note = $2, approved_by = NULL, approved_at = NULL, updated_at = NOW()
		  WHERE id = $1 AND status = 'approved' RETURNING id`,
		[row.id, note]
	);
	if (r.rows.length === 0) throw new Error('Csak jóváhagyott, még ki nem fizetett rendelvény nyitható vissza.');
	const doc = await documentFor(context, keyOf(row), await loadSettlementRow(context, row.id));
	await notifySettlementEvent(context, noticeOf(row, doc), 'reopened', { note });
	return doc;
}

/** Kell-e a hívónak a HR-es műveleteket látnia (a felület ezzel dönt a gombokról). */
export async function getSettlementPermissions(
	params: { organizationId: number },
	context: RemoteContext
): Promise<{ canApprove: boolean; canManage: boolean; employeeId: number | null }> {
	const organizationId = requireOrganizationId(params?.organizationId);
	const [canApprove, canManage] = await Promise.all([
		hasCapability(context, organizationId, 'trip.approve'),
		hasCapability(context, organizationId, 'trip.manage')
	]);
	const me = await context.db.query(
		`SELECT id FROM ${SCHEMA}.employees WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
		[organizationId, await resolveUserId(context)]
	);
	return { canApprove, canManage, employeeId: me.rows[0]?.id ?? null };
}

/** A szervezet tagjai (elrendelő választó). */
export async function getTripOrderers(
	params: { organizationId: number },
	context: RemoteContext
): Promise<{ userId: number; name: string }[]> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.record');
	const r = await context.db.query(
		`SELECT u.id AS user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.email) AS name
		   FROM ${SCHEMA}.employees e JOIN auth.users u ON u.id = e.user_id
		  WHERE e.organization_id = $1 AND e.status = 'active' AND e.is_external = FALSE
		  ORDER BY name`,
		[organizationId]
	);
	return r.rows.map((row: any) => ({ userId: row.user_id, name: row.name }));
}
