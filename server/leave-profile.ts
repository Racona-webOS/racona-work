/**
 * Szabadságkeret-számítás — a dolgozó számításhoz szükséges adatai és a
 * számított keretek kezelése.
 *
 * A számítás maga tiszta függvény (leave-entitlement.ts); ez a modul tölti be
 * hozzá az adatokat, és írja vissza az eredményt a leave_balances táblába.
 *
 * Adatvédelem: a születési dátum, a gyerekek és az egészségkárosodás ténye
 * személyes (utóbbi különleges) adat. Olvasni a dolgozó a sajátját, másét csak
 * leave.balance.manage joggal lehet; írni csak leave.balance.manage joggal.
 *
 * Részletek: specs/leave-entitlement.md
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { requireCapability, requireSelfOrCapability } from './permissions.js';
import { getEmployeeOrganizationId } from './employees.js';
import { BALANCE_COLUMNS, mapBalanceRow } from './leave.js';
import type { LeaveBalance, LeaveBalanceCalculation } from './leave.js';
import { calculateAnnualLeave, STATUTORY_EXTRA_DAYS } from './leave-entitlement.js';
import type { EntitlementInput, ExtraLeaveKind, LeavePolicy } from './leave-entitlement.js';

const SCHEMA = 'app__racona_work';

export interface EmployeeChild {
	id: number;
	employeeId: number;
	label: string | null;
	birthDate: string;
	isDisabled: boolean;
}

export interface ExtraLeave {
	id: number;
	employeeId: number;
	kind: ExtraLeaveKind;
	days: number;
	validFrom: string | null;
	validTo: string | null;
	note: string | null;
}

export interface LeaveProfile {
	employeeId: number;
	birthDate: string | null;
	hireDate: string | null;
	employmentEndDate: string | null;
	/**
	 * A HR ellenőrizte-e a belépés dátumát. A hire_date létrehozáskor mindig az
	 * aznapi dátum lett, így amíg ez hamis, a dátum valószínűleg nem valós.
	 */
	hireDateConfirmed: boolean;
	children: EmployeeChild[];
	extras: ExtraLeave[];
}

/** Egy keret változása az automatikus újraszámoláskor (a felület üzenetben mutatja). */
export interface RecalculatedBalance {
	year: number;
	from: number;
	to: number;
}

const EXTRA_KINDS: ReadonlySet<string> = new Set<ExtraLeaveKind>([
	'health_impaired',
	'underground_radiation',
	'custom'
]);

const MAX_CUSTOM_EXTRA_DAYS = 60;
const MAX_POLICY_EXTRA_DAYS = 30;

// --- Segédek ----------------------------------------------------------------

/** A mai nap Budapesten, YYYY-MM-DD. Az évforduló így nem a szerver időzónáján múlik. */
function todayInBudapest(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());
}

function currentYear(): number {
	return Number(todayInBudapest().slice(0, 4));
}

/**
 * Dátum paraméter ellenőrzése. Az üres értéket null-ra fordítja.
 *
 * @throws Ha a formátum nem YYYY-MM-DD, vagy nem létező nap (pl. 02-30).
 */
function parseDay(value: unknown, fieldLabel: string, required = false): string | null {
	if (value === null || value === undefined || value === '') {
		if (required) throw new Error(`${fieldLabel}: kötelező megadni.`);
		return null;
	}
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error(`${fieldLabel}: érvénytelen dátum.`);
	}
	const [y, m, d] = value.split('-').map(Number);
	const roundTrip = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
	if (roundTrip !== value) throw new Error(`${fieldLabel}: érvénytelen dátum.`);
	return value;
}

function parseYear(value: unknown): number {
	const year = Number(value);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) {
		throw new Error('Érvénytelen év.');
	}
	return year;
}

function parseAdjustment(days: unknown, note: unknown): { days: number; note: string | null } {
	const value = days === undefined || days === null || days === '' ? 0 : Number(days);
	if (!Number.isInteger(value) || Math.abs(value) > 365) {
		throw new Error('A korrekció egész szám legyen.');
	}
	const trimmed = typeof note === 'string' ? note.trim() : '';
	if (value !== 0 && !trimmed) {
		throw new Error('A korrekcióhoz indoklást kell írni.');
	}
	return { days: value, note: trimmed || null };
}

function policyKey(organizationId: number): string {
	return `settings:leave_policy:org_${organizationId}`;
}

function normalizePolicy(raw: unknown): LeavePolicy {
	const value = (raw ?? {}) as Partial<LeavePolicy>;
	const days = Number(value.extraDaysForAll);
	return {
		extraDaysForAll: Number.isInteger(days) && days > 0 ? days : 0,
		extraDaysLabel: typeof value.extraDaysLabel === 'string' ? value.extraDaysLabel : null
	};
}

async function loadPolicy(context: RemoteContext, organizationId: number): Promise<LeavePolicy> {
	const r = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
		policyKey(organizationId)
	]);
	return normalizePolicy(r.rows[0]?.value);
}

function mapChild(row: any): EmployeeChild {
	return {
		id: row.id,
		employeeId: row.employee_id,
		label: row.label ?? null,
		birthDate: row.birth_date,
		isDisabled: row.is_disabled === true
	};
}

function mapExtra(row: any): ExtraLeave {
	return {
		id: row.id,
		employeeId: row.employee_id,
		kind: row.kind,
		days: row.days,
		validFrom: row.valid_from ?? null,
		validTo: row.valid_to ?? null,
		note: row.note ?? null
	};
}

// A DATE oszlopokat szövegként kérjük le, hogy a pg Date-konverziója ne tolja el
// időzóna miatt a napot.
const CHILD_COLUMNS = `id, employee_id, label, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, is_disabled`;
const EXTRA_COLUMNS = `id, employee_id, kind, days,
	to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
	to_char(valid_to, 'YYYY-MM-DD') AS valid_to, note`;

async function loadProfile(
	context: RemoteContext,
	employeeId: number
): Promise<LeaveProfile & { organizationId: number }> {
	const empResult = await context.db.query(
		`SELECT organization_id,
		        to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
		        to_char(hire_date, 'YYYY-MM-DD') AS hire_date,
		        to_char(employment_end_date, 'YYYY-MM-DD') AS employment_end_date,
		        hire_date_confirmed
		   FROM ${SCHEMA}.employees
		  WHERE id = $1`,
		[employeeId]
	);
	if (empResult.rows.length === 0) {
		throw new Error(`Nem található dolgozó a megadott azonosítóval: ${employeeId}`);
	}
	const emp = empResult.rows[0];

	const [childrenResult, extrasResult] = await Promise.all([
		context.db.query(
			`SELECT ${CHILD_COLUMNS} FROM ${SCHEMA}.employee_children
			  WHERE employee_id = $1 ORDER BY birth_date, id`,
			[employeeId]
		),
		context.db.query(
			`SELECT ${EXTRA_COLUMNS} FROM ${SCHEMA}.employee_extra_leave
			  WHERE employee_id = $1 ORDER BY kind, valid_from NULLS FIRST, id`,
			[employeeId]
		)
	]);

	return {
		organizationId: emp.organization_id,
		employeeId,
		birthDate: emp.birth_date ?? null,
		hireDate: emp.hire_date ?? null,
		employmentEndDate: emp.employment_end_date ?? null,
		hireDateConfirmed: emp.hire_date_confirmed === true,
		children: childrenResult.rows.map(mapChild),
		extras: extrasResult.rows.map(mapExtra)
	};
}

/** A számítás bemenete a tárgyév nélkül — egy dolgozóra egyszer töltjük be. */
async function loadEntitlementBase(
	context: RemoteContext,
	employeeId: number
): Promise<{ organizationId: number; base: Omit<EntitlementInput, 'year'> }> {
	const profile = await loadProfile(context, employeeId);
	const policy = await loadPolicy(context, profile.organizationId);
	return {
		organizationId: profile.organizationId,
		base: {
			birthDate: profile.birthDate,
			hireDate: profile.hireDate,
			employmentEndDate: profile.employmentEndDate,
			children: profile.children.map((c) => ({ birthDate: c.birthDate, isDisabled: c.isDisabled })),
			extras: profile.extras.map((e) => ({
				kind: e.kind,
				days: e.days,
				validFrom: e.validFrom,
				validTo: e.validTo,
				note: e.note
			})),
			policy
		}
	};
}

function calculate(base: Omit<EntitlementInput, 'year'>, year: number): LeaveBalanceCalculation {
	const input: EntitlementInput = { ...base, year };
	return { result: calculateAnnualLeave(input), input };
}

/**
 * Belső segéd (a functions.ts NEM reexportálja).
 *
 * A dolgozó nyitott, számított és nem zárolt kereteinek újraszámolása: az idei
 * és a későbbi évek. Új keretet nem hoz létre, a múltbeli évekhez nem nyúl.
 *
 * @returns Azok a keretek, amelyeknek az összege megváltozott.
 */
async function recalculateEmployeeBalances(
	context: RemoteContext,
	employeeId: number
): Promise<RecalculatedBalance[]> {
	const rows = await context.db.query(
		`SELECT id, year, calculated_days, adjustment_days
		   FROM ${SCHEMA}.leave_balances
		  WHERE employee_id = $1 AND year >= $2
		    AND calculated_days IS NOT NULL AND is_locked = FALSE
		  ORDER BY year`,
		[employeeId, currentYear()]
	);
	if (rows.rows.length === 0) return [];

	const { base } = await loadEntitlementBase(context, employeeId);
	const userId = await resolveUserId(context);
	const changes: RecalculatedBalance[] = [];

	for (const row of rows.rows) {
		const calculation = calculate(base, row.year);
		const calculated = calculation.result.totalDays;
		await context.db.query(
			`UPDATE ${SCHEMA}.leave_balances
			    SET calculated_days = $2,
			        total_days = $2::int + adjustment_days,
			        calculation = $3::jsonb,
			        calculated_at = NOW(),
			        updated_by = $4,
			        updated_at = NOW()
			  WHERE id = $1`,
			[row.id, calculated, JSON.stringify(calculation), userId]
		);
		if (calculated !== row.calculated_days) {
			changes.push({
				year: row.year,
				from: row.calculated_days + row.adjustment_days,
				to: calculated + row.adjustment_days
			});
		}
	}
	return changes;
}

async function requireManageForEmployee(context: RemoteContext, employeeId: number): Promise<number> {
	const orgId = await getEmployeeOrganizationId(context, employeeId);
	await requireCapability(context, orgId, 'leave.balance.manage');
	return orgId;
}

async function loadBalanceRow(context: RemoteContext, balanceId: number) {
	const r = await context.db.query(
		`SELECT ${BALANCE_COLUMNS}, organization_id FROM ${SCHEMA}.leave_balances WHERE id = $1`,
		[balanceId]
	);
	if (r.rows.length === 0) {
		throw new Error('Nem található a szabadságkeret.');
	}
	const row = r.rows[0];
	await requireCapability(context, row.organization_id, 'leave.balance.manage');
	return row;
}

// --- Dolgozói adatok --------------------------------------------------------

/** A dolgozó számításhoz szükséges adatai. Saját adat, vagy leave.balance.manage. */
export async function getLeaveProfile(
	params: { employeeId: number },
	context: RemoteContext
): Promise<LeaveProfile> {
	await requireSelfOrCapability(context, params.employeeId, 'leave.balance.manage');
	const { organizationId: _orgId, ...profile } = await loadProfile(context, params.employeeId);
	return profile;
}

/**
 * Születési, belépési és kilépési dátum mentése, majd a nyitott keretek
 * újraszámolása. A mentéssel a belépés dátuma ellenőrzöttnek számít.
 */
export async function saveLeaveProfile(
	params: {
		employeeId: number;
		birthDate?: string | null;
		hireDate: string;
		employmentEndDate?: string | null;
	},
	context: RemoteContext
): Promise<{ profile: LeaveProfile; recalculated: RecalculatedBalance[] }> {
	await requireManageForEmployee(context, params.employeeId);

	const today = todayInBudapest();
	const birthDate = parseDay(params.birthDate, 'Születési dátum');
	const hireDate = parseDay(params.hireDate, 'Belépés dátuma', true);
	const endDate = parseDay(params.employmentEndDate, 'Kilépés dátuma');

	if (birthDate && (birthDate > today || birthDate < '1900-01-01')) {
		throw new Error('Születési dátum: nem lehet a jövőben.');
	}
	if (endDate && hireDate && endDate < hireDate) {
		throw new Error('A kilépés dátuma nem lehet korábbi a belépésnél.');
	}

	await context.db.query(
		`UPDATE ${SCHEMA}.employees
		    SET birth_date = $2, hire_date = $3, employment_end_date = $4,
		        hire_date_confirmed = TRUE, updated_at = NOW()
		  WHERE id = $1`,
		[params.employeeId, birthDate, hireDate, endDate]
	);

	const recalculated = await recalculateEmployeeBalances(context, params.employeeId);
	const { organizationId: _orgId, ...profile } = await loadProfile(context, params.employeeId);
	return { profile, recalculated };
}

/** Gyerek felvétele vagy módosítása (id megadásával), majd újraszámolás. */
export async function saveEmployeeChild(
	params: {
		employeeId: number;
		id?: number;
		label?: string | null;
		birthDate: string;
		isDisabled?: boolean;
	},
	context: RemoteContext
): Promise<{ child: EmployeeChild; recalculated: RecalculatedBalance[] }> {
	await requireManageForEmployee(context, params.employeeId);

	const birthDate = parseDay(params.birthDate, 'A gyerek születési dátuma', true)!;
	if (birthDate > todayInBudapest()) {
		throw new Error('A gyerek születési dátuma nem lehet a jövőben.');
	}
	const label = typeof params.label === 'string' && params.label.trim() ? params.label.trim().slice(0, 255) : null;
	const isDisabled = params.isDisabled === true;

	let result;
	if (params.id) {
		result = await context.db.query(
			`UPDATE ${SCHEMA}.employee_children
			    SET label = $3, birth_date = $4, is_disabled = $5, updated_at = NOW()
			  WHERE id = $1 AND employee_id = $2
			  RETURNING ${CHILD_COLUMNS}`,
			[params.id, params.employeeId, label, birthDate, isDisabled]
		);
		if (result.rows.length === 0) throw new Error('Nem található a gyerek.');
	} else {
		result = await context.db.query(
			`INSERT INTO ${SCHEMA}.employee_children (employee_id, label, birth_date, is_disabled)
			 VALUES ($1, $2, $3, $4)
			 RETURNING ${CHILD_COLUMNS}`,
			[params.employeeId, label, birthDate, isDisabled]
		);
	}

	const recalculated = await recalculateEmployeeBalances(context, params.employeeId);
	return { child: mapChild(result.rows[0]), recalculated };
}

export async function deleteEmployeeChild(
	params: { id: number },
	context: RemoteContext
): Promise<{ recalculated: RecalculatedBalance[] }> {
	const r = await context.db.query(
		`SELECT employee_id FROM ${SCHEMA}.employee_children WHERE id = $1`,
		[params.id]
	);
	if (r.rows.length === 0) throw new Error('Nem található a gyerek.');
	const employeeId: number = r.rows[0].employee_id;
	await requireManageForEmployee(context, employeeId);

	await context.db.query(`DELETE FROM ${SCHEMA}.employee_children WHERE id = $1`, [params.id]);
	return { recalculated: await recalculateEmployeeBalances(context, employeeId) };
}

/**
 * Egyéb pótszabadság felvétele vagy módosítása. A törvényi jogcímeknél
 * (egészségkárosodás, föld alatti / ionizáló munka) a napok száma rögzített.
 */
export async function saveExtraLeave(
	params: {
		employeeId: number;
		id?: number;
		kind: ExtraLeaveKind;
		days?: number;
		validFrom?: string | null;
		validTo?: string | null;
		note?: string | null;
	},
	context: RemoteContext
): Promise<{ extra: ExtraLeave; recalculated: RecalculatedBalance[] }> {
	await requireManageForEmployee(context, params.employeeId);

	if (!EXTRA_KINDS.has(params.kind)) throw new Error('Érvénytelen pótszabadság-típus.');
	const note = typeof params.note === 'string' && params.note.trim() ? params.note.trim() : null;

	let days = STATUTORY_EXTRA_DAYS;
	if (params.kind === 'custom') {
		days = Number(params.days);
		if (!Number.isInteger(days) || days < 1 || days > MAX_CUSTOM_EXTRA_DAYS) {
			throw new Error(`A napok száma 1 és ${MAX_CUSTOM_EXTRA_DAYS} közötti egész szám legyen.`);
		}
		if (!note) throw new Error('Az egyedi pótszabadsághoz adj meg megnevezést.');
	}

	const validFrom = parseDay(params.validFrom, 'Érvényesség kezdete');
	const validTo = parseDay(params.validTo, 'Érvényesség vége');
	if (validFrom && validTo && validTo < validFrom) {
		throw new Error('Az érvényesség vége nem lehet korábbi a kezdeténél.');
	}

	let result;
	if (params.id) {
		result = await context.db.query(
			`UPDATE ${SCHEMA}.employee_extra_leave
			    SET kind = $3, days = $4, valid_from = $5, valid_to = $6, note = $7, updated_at = NOW()
			  WHERE id = $1 AND employee_id = $2
			  RETURNING ${EXTRA_COLUMNS}`,
			[params.id, params.employeeId, params.kind, days, validFrom, validTo, note]
		);
		if (result.rows.length === 0) throw new Error('Nem található a pótszabadság.');
	} else {
		result = await context.db.query(
			`INSERT INTO ${SCHEMA}.employee_extra_leave (employee_id, kind, days, valid_from, valid_to, note)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING ${EXTRA_COLUMNS}`,
			[params.employeeId, params.kind, days, validFrom, validTo, note]
		);
	}

	const recalculated = await recalculateEmployeeBalances(context, params.employeeId);
	return { extra: mapExtra(result.rows[0]), recalculated };
}

export async function deleteExtraLeave(
	params: { id: number },
	context: RemoteContext
): Promise<{ recalculated: RecalculatedBalance[] }> {
	const r = await context.db.query(
		`SELECT employee_id FROM ${SCHEMA}.employee_extra_leave WHERE id = $1`,
		[params.id]
	);
	if (r.rows.length === 0) throw new Error('Nem található a pótszabadság.');
	const employeeId: number = r.rows[0].employee_id;
	await requireManageForEmployee(context, employeeId);

	await context.db.query(`DELETE FROM ${SCHEMA}.employee_extra_leave WHERE id = $1`, [params.id]);
	return { recalculated: await recalculateEmployeeBalances(context, employeeId) };
}

// --- Számított keretek ------------------------------------------------------

/** A számítás egy dolgozóra és évre, a meglévő kerettel együtt (ha van). */
export async function previewLeaveEntitlement(
	params: { employeeId: number; year: number },
	context: RemoteContext
): Promise<{ calculation: LeaveBalanceCalculation; balance: LeaveBalance | null }> {
	await requireSelfOrCapability(context, params.employeeId, 'leave.balance.manage');
	const year = parseYear(params.year);

	const { base } = await loadEntitlementBase(context, params.employeeId);
	const existing = await context.db.query(
		`SELECT ${BALANCE_COLUMNS} FROM ${SCHEMA}.leave_balances WHERE employee_id = $1 AND year = $2`,
		[params.employeeId, year]
	);

	return {
		calculation: calculate(base, year),
		balance: existing.rows.length > 0 ? mapBalanceRow(existing.rows[0]) : null
	};
}

/** Keret létrehozása a számítás alapján, opcionális korrekcióval (K3). */
export async function createLeaveBalanceFromCalculation(
	params: { employeeId: number; year: number; adjustmentDays?: number; adjustmentNote?: string | null },
	context: RemoteContext
): Promise<LeaveBalance> {
	const orgId = await requireManageForEmployee(context, params.employeeId);
	const year = parseYear(params.year);
	const adjustment = parseAdjustment(params.adjustmentDays, params.adjustmentNote);

	const existing = await context.db.query(
		`SELECT 1 FROM ${SCHEMA}.leave_balances WHERE employee_id = $1 AND year = $2`,
		[params.employeeId, year]
	);
	if (existing.rows.length > 0) {
		throw new Error(`A(z) ${year}. évre már van szabadságkeret.`);
	}

	const { base } = await loadEntitlementBase(context, params.employeeId);
	const calculation = calculate(base, year);
	const calculated = calculation.result.totalDays;
	if (calculated + adjustment.days < 0) {
		throw new Error('A korrekcióval a keret nem lehet negatív.');
	}
	const userId = await resolveUserId(context);

	const result = await context.db.query(
		`INSERT INTO ${SCHEMA}.leave_balances
			(employee_id, organization_id, year, total_days, used_days,
			 calculated_days, adjustment_days, adjustment_note, calculation, calculated_at,
			 updated_by, updated_at)
		 VALUES ($1, $2, $3, $4::int + $5::int, 0, $4::int, $5::int, $6, $7::jsonb, NOW(), $8, NOW())
		 RETURNING ${BALANCE_COLUMNS}`,
		[
			params.employeeId,
			orgId,
			year,
			calculated,
			adjustment.days,
			adjustment.note,
			JSON.stringify(calculation),
			userId
		]
	);
	return mapBalanceRow(result.rows[0]);
}

/**
 * Korrekció és zárolás (K4, K5). Nem zárolt keretnél a számítást is frissíti,
 * így a feloldás után a keret azonnal a mostani adatokat tükrözi.
 */
export async function setLeaveBalanceAdjustment(
	params: { balanceId: number; adjustmentDays: number; adjustmentNote?: string | null; isLocked: boolean },
	context: RemoteContext
): Promise<LeaveBalance> {
	const row = await loadBalanceRow(context, params.balanceId);
	if (row.calculated_days === null) {
		throw new Error('Ez kézi keret — előbb alkalmazd rá a számítást.');
	}
	const adjustment = parseAdjustment(params.adjustmentDays, params.adjustmentNote);
	const isLocked = params.isLocked === true;

	let calculated: number = row.calculated_days;
	let calculationJson: string | null = null;
	if (!isLocked) {
		const { base } = await loadEntitlementBase(context, row.employee_id);
		const calculation = calculate(base, row.year);
		calculated = calculation.result.totalDays;
		calculationJson = JSON.stringify(calculation);
	}
	if (calculated + adjustment.days < 0) {
		throw new Error('A korrekcióval a keret nem lehet negatív.');
	}
	const userId = await resolveUserId(context);

	const result = await context.db.query(
		`UPDATE ${SCHEMA}.leave_balances
		    SET adjustment_days = $2,
		        adjustment_note = $3,
		        is_locked = $4,
		        calculated_days = $5,
		        total_days = $5::int + $2::int,
		        calculation = COALESCE($6::jsonb, calculation),
		        calculated_at = CASE WHEN $6::jsonb IS NULL THEN calculated_at ELSE NOW() END,
		        updated_by = $7,
		        updated_at = NOW()
		  WHERE id = $1
		  RETURNING ${BALANCE_COLUMNS}`,
		[params.balanceId, adjustment.days, adjustment.note, isLocked, calculated, calculationJson, userId]
	);
	return mapBalanceRow(result.rows[0]);
}

/**
 * A számítás alkalmazása egy kézi vagy zárolt keretre (K8).
 *
 * Kézi keretnél `keepTotal` esetén a korrekció a régi összeg és a számított
 * érték különbsége lesz, így a keret összege nem változik. Már számított
 * (zárolt) keretnél a meglévő korrekció marad, csak a számított érték frissül.
 */
export async function applyCalculationToBalance(
	params: { balanceId: number; keepTotal?: boolean },
	context: RemoteContext
): Promise<LeaveBalance> {
	const row = await loadBalanceRow(context, params.balanceId);
	const { base } = await loadEntitlementBase(context, row.employee_id);
	const calculation = calculate(base, row.year);
	const calculated = calculation.result.totalDays;

	let adjustmentDays: number = row.adjustment_days;
	let adjustmentNote: string | null = row.adjustment_note;
	if (row.calculated_days === null) {
		adjustmentDays = params.keepTotal ? row.total_days - calculated : 0;
		adjustmentNote =
			adjustmentDays !== 0 ? 'A korábbi kézi keret összege megtartva az átálláskor.' : null;
	}
	if (calculated + adjustmentDays < 0) {
		throw new Error('A korrekcióval a keret nem lehet negatív.');
	}
	const userId = await resolveUserId(context);

	const result = await context.db.query(
		`UPDATE ${SCHEMA}.leave_balances
		    SET calculated_days = $2,
		        adjustment_days = $3,
		        adjustment_note = $4,
		        total_days = $2::int + $3::int,
		        calculation = $5::jsonb,
		        calculated_at = NOW(),
		        updated_by = $6,
		        updated_at = NOW()
		  WHERE id = $1
		  RETURNING ${BALANCE_COLUMNS}`,
		[params.balanceId, calculated, adjustmentDays, adjustmentNote, JSON.stringify(calculation), userId]
	);
	return mapBalanceRow(result.rows[0]);
}

// --- Céges szabály ----------------------------------------------------------

export async function getLeavePolicy(
	params: { organizationId: number },
	context: RemoteContext
): Promise<LeavePolicy> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'employee.view');
	return loadPolicy(context, params.organizationId);
}

/**
 * A céges többletnap mentése, majd a szervezet összes nyitott, számított
 * keretének újraszámolása.
 */
export async function saveLeavePolicy(
	params: { organizationId: number; extraDaysForAll: number; extraDaysLabel?: string | null },
	context: RemoteContext
): Promise<{ policy: LeavePolicy; recalculatedEmployees: number }> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'org.manage');

	const days = Number(params.extraDaysForAll ?? 0);
	if (!Number.isInteger(days) || days < 0 || days > MAX_POLICY_EXTRA_DAYS) {
		throw new Error(`A többletnap 0 és ${MAX_POLICY_EXTRA_DAYS} közötti egész szám legyen.`);
	}
	const label =
		typeof params.extraDaysLabel === 'string' && params.extraDaysLabel.trim()
			? params.extraDaysLabel.trim().slice(0, 100)
			: null;
	const policy: LeavePolicy = { extraDaysForAll: days, extraDaysLabel: label };

	await context.db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[policyKey(params.organizationId), JSON.stringify(policy)]
	);

	const affected = await context.db.query(
		`SELECT DISTINCT employee_id FROM ${SCHEMA}.leave_balances
		  WHERE organization_id = $1 AND year >= $2
		    AND calculated_days IS NOT NULL AND is_locked = FALSE`,
		[params.organizationId, currentYear()]
	);
	let recalculatedEmployees = 0;
	for (const row of affected.rows) {
		const changes = await recalculateEmployeeBalances(context, row.employee_id);
		if (changes.length > 0) recalculatedEmployees++;
	}

	return { policy, recalculatedEmployees };
}
