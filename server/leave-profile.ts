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
import { logBalanceChange } from './leave-history.js';
import { calculateAnnualLeave, STATUTORY_EXTRA_DAYS } from './leave-entitlement.js';
import type {
	AbsenceKind,
	EntitlementAbsence,
	EntitlementInput,
	EntitlementResult,
	ExtraLeaveKind,
	LeavePolicy
} from './leave-entitlement.js';

const SCHEMA = 'app__racona_work';

export interface EmployeeChild {
	id: number;
	employeeId: number;
	label: string | null;
	birthDate: string;
	isDisabled: boolean;
	/** A HR jelöli: a dolgozónak apasági szabadság jár ennek a gyereknek a születése után. */
	paternityEligible: boolean;
}

/** A HR által rögzített kézi távollét-típusok (a jóváhagyott kérelmeket a szerver hozza). */
export type EmployeeAbsenceKind = Exclude<AbsenceKind, 'unpaid_request'>;

/** Nem munkában töltött időszak (Mt. 115. §), ami csökkenti az arányos szabadságot. */
export interface EmployeeAbsence {
	id: number;
	employeeId: number;
	kind: EmployeeAbsenceKind;
	startDate: string;
	endDate: string;
	note: string | null;
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
	absences: EmployeeAbsence[];
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

const ABSENCE_KINDS: ReadonlySet<string> = new Set<EmployeeAbsenceKind>([
	'unpaid_leave',
	'childcare_unpaid_leave',
	'unexcused_absence',
	'other'
]);

const MAX_CUSTOM_EXTRA_DAYS = 60;
const MAX_POLICY_EXTRA_DAYS = 30;
/** Az áthozatal felső korlátja: több egy teljes évi keretnél; csak a hibás bevitelt fogja meg. */
const MAX_CARRY_OVER_DAYS = 60;

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
		isDisabled: row.is_disabled === true,
		paternityEligible: row.paternity_eligible === true
	};
}

function mapAbsence(row: any): EmployeeAbsence {
	return {
		id: row.id,
		employeeId: row.employee_id,
		kind: row.kind,
		startDate: row.start_date,
		endDate: row.end_date,
		note: row.note ?? null
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
const CHILD_COLUMNS = `id, employee_id, label, to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
	is_disabled, paternity_eligible`;
const ABSENCE_COLUMNS = `id, employee_id, kind,
	to_char(start_date, 'YYYY-MM-DD') AS start_date,
	to_char(end_date, 'YYYY-MM-DD') AS end_date, note`;
const EXTRA_COLUMNS = `id, employee_id, kind, days,
	to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
	to_char(valid_to, 'YYYY-MM-DD') AS valid_to, note`;

/**
 * A profil a szervezettel és a jóváhagyott fizetés nélküli szabadságkérelmekkel
 * — utóbbiak nem munkában töltött időnek számítanak (Mt. 115. §), ezért a
 * számítás magától levonja őket.
 */
type ProfileWithOrg = LeaveProfile & {
	organizationId: number;
	approvedUnpaid: { from: string; to: string }[];
};

/**
 * Dolgozók számításhoz szükséges adatai egyszerre, dolgozónként egy-egy
 * lekérdezés helyett — a tömeges előnézet így nem dolgozónként kérdez.
 */
async function loadProfiles(
	context: RemoteContext,
	employeeIds: number[]
): Promise<Map<number, ProfileWithOrg>> {
	const profiles = new Map<number, ProfileWithOrg>();
	if (employeeIds.length === 0) return profiles;

	const [empResult, childrenResult, extrasResult, absencesResult, unpaidResult] = await Promise.all([
		context.db.query(
			`SELECT id, organization_id,
			        to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
			        to_char(hire_date, 'YYYY-MM-DD') AS hire_date,
			        to_char(employment_end_date, 'YYYY-MM-DD') AS employment_end_date,
			        hire_date_confirmed
			   FROM ${SCHEMA}.employees
			  WHERE id = ANY($1::int[])`,
			[employeeIds]
		),
		context.db.query(
			`SELECT ${CHILD_COLUMNS} FROM ${SCHEMA}.employee_children
			  WHERE employee_id = ANY($1::int[]) ORDER BY birth_date, id`,
			[employeeIds]
		),
		context.db.query(
			`SELECT ${EXTRA_COLUMNS} FROM ${SCHEMA}.employee_extra_leave
			  WHERE employee_id = ANY($1::int[]) ORDER BY kind, valid_from NULLS FIRST, id`,
			[employeeIds]
		),
		context.db.query(
			`SELECT ${ABSENCE_COLUMNS} FROM ${SCHEMA}.employee_absence_periods
			  WHERE employee_id = ANY($1::int[]) ORDER BY start_date, id`,
			[employeeIds]
		),
		context.db.query(
			`SELECT employee_id,
			        to_char(start_date, 'YYYY-MM-DD') AS start_date,
			        to_char(end_date, 'YYYY-MM-DD') AS end_date
			   FROM ${SCHEMA}.leave_requests
			  WHERE employee_id = ANY($1::int[]) AND leave_type = 'unpaid' AND status = 'approved'`,
			[employeeIds]
		)
	]);

	for (const emp of empResult.rows) {
		profiles.set(emp.id, {
			organizationId: emp.organization_id,
			employeeId: emp.id,
			birthDate: emp.birth_date ?? null,
			hireDate: emp.hire_date ?? null,
			employmentEndDate: emp.employment_end_date ?? null,
			hireDateConfirmed: emp.hire_date_confirmed === true,
			children: [],
			extras: [],
			absences: [],
			approvedUnpaid: []
		});
	}
	for (const row of childrenResult.rows) profiles.get(row.employee_id)?.children.push(mapChild(row));
	for (const row of extrasResult.rows) profiles.get(row.employee_id)?.extras.push(mapExtra(row));
	for (const row of absencesResult.rows) profiles.get(row.employee_id)?.absences.push(mapAbsence(row));
	for (const row of unpaidResult.rows) {
		profiles.get(row.employee_id)?.approvedUnpaid.push({ from: row.start_date, to: row.end_date });
	}
	return profiles;
}

async function loadProfile(context: RemoteContext, employeeId: number): Promise<ProfileWithOrg> {
	const profile = (await loadProfiles(context, [employeeId])).get(employeeId);
	if (!profile) {
		throw new Error(`Nem található dolgozó a megadott azonosítóval: ${employeeId}`);
	}
	return profile;
}

/** A számítás bemenete a tárgyév nélkül. */
function toEntitlementBase(profile: ProfileWithOrg, policy: LeavePolicy): Omit<EntitlementInput, 'year'> {
	const absences: EntitlementAbsence[] = [
		...profile.absences.map((a) => ({ kind: a.kind, from: a.startDate, to: a.endDate })),
		...profile.approvedUnpaid.map((r) => ({ kind: 'unpaid_request' as const, from: r.from, to: r.to }))
	];
	return {
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
		policy,
		absences
	};
}

/** Egy dolgozó számítási bemenete (a tárgyév nélkül) — egyszer töltjük be. */
async function loadEntitlementBase(
	context: RemoteContext,
	employeeId: number
): Promise<{ organizationId: number; base: Omit<EntitlementInput, 'year'> }> {
	const profile = await loadProfile(context, employeeId);
	const policy = await loadPolicy(context, profile.organizationId);
	return { organizationId: profile.organizationId, base: toEntitlementBase(profile, policy) };
}

function calculate(base: Omit<EntitlementInput, 'year'>, year: number): LeaveBalanceCalculation {
	const input: EntitlementInput = { ...base, year };
	return { result: calculateAnnualLeave(input), input };
}

/**
 * Belső segéd (a functions.ts NEM reexportálja) — a leave.ts is hívja, ha egy
 * fizetés nélküli kérelmet jóváhagynak vagy törölnek.
 *
 * A dolgozó nyitott, számított és nem zárolt kereteinek újraszámolása: az idei
 * és a későbbi évek. Új keretet nem hoz létre, a múltbeli évekhez nem nyúl.
 *
 * @returns Azok a keretek, amelyeknek az összege megváltozott.
 */
export async function recalculateEmployeeBalances(
	context: RemoteContext,
	employeeId: number
): Promise<RecalculatedBalance[]> {
	const rows = await context.db.query(
		`SELECT ${BALANCE_COLUMNS}
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
		const updated = await context.db.query(
			`UPDATE ${SCHEMA}.leave_balances
			    SET calculated_days = $2,
			        total_days = $2::int + adjustment_days + carried_over_days,
			        calculation = $3::jsonb,
			        calculated_at = NOW(),
			        updated_by = $4,
			        updated_at = NOW()
			  WHERE id = $1
			  RETURNING ${BALANCE_COLUMNS}`,
			[row.id, calculated, JSON.stringify(calculation), userId]
		);
		if (calculated !== row.calculated_days) {
			const before = mapBalanceRow(row);
			const after = mapBalanceRow(updated.rows[0]);
			await logBalanceChange(context.db, { action: 'recalculated', before, after, actorUserId: userId });
			changes.push({ year: row.year, from: before.totalDays, to: after.totalDays });
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
	return publicProfile(await loadProfile(context, params.employeeId));
}

function publicProfile(profile: ProfileWithOrg): LeaveProfile {
	const { organizationId: _orgId, approvedUnpaid: _unpaid, ...rest } = profile;
	return rest;
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
	return { profile: publicProfile(await loadProfile(context, params.employeeId)), recalculated };
}

/** Gyerek felvétele vagy módosítása (id megadásával), majd újraszámolás. */
export async function saveEmployeeChild(
	params: {
		employeeId: number;
		id?: number;
		label?: string | null;
		birthDate: string;
		isDisabled?: boolean;
		paternityEligible?: boolean;
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
	const paternityEligible = params.paternityEligible === true;

	let result;
	if (params.id) {
		result = await context.db.query(
			`UPDATE ${SCHEMA}.employee_children
			    SET label = $3, birth_date = $4, is_disabled = $5, paternity_eligible = $6,
			        updated_at = NOW()
			  WHERE id = $1 AND employee_id = $2
			  RETURNING ${CHILD_COLUMNS}`,
			[params.id, params.employeeId, label, birthDate, isDisabled, paternityEligible]
		);
		if (result.rows.length === 0) throw new Error('Nem található a gyerek.');
	} else {
		result = await context.db.query(
			`INSERT INTO ${SCHEMA}.employee_children
				(employee_id, label, birth_date, is_disabled, paternity_eligible)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING ${CHILD_COLUMNS}`,
			[params.employeeId, label, birthDate, isDisabled, paternityEligible]
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

/**
 * Nem munkában töltött időszak felvétele vagy módosítása (Mt. 115. §), majd
 * újraszámolás. A jóváhagyott fizetés nélküli szabadságkérelmeket nem kell
 * itt rögzíteni: azokat a számítás magától levonja.
 */
export async function saveAbsencePeriod(
	params: {
		employeeId: number;
		id?: number;
		kind: EmployeeAbsenceKind;
		startDate: string;
		endDate: string;
		note?: string | null;
	},
	context: RemoteContext
): Promise<{ absence: EmployeeAbsence; recalculated: RecalculatedBalance[] }> {
	await requireManageForEmployee(context, params.employeeId);

	if (!ABSENCE_KINDS.has(params.kind)) throw new Error('Érvénytelen távollét-típus.');
	const startDate = parseDay(params.startDate, 'Kezdete', true)!;
	const endDate = parseDay(params.endDate, 'Vége', true)!;
	if (endDate < startDate) throw new Error('A vége nem lehet korábbi a kezdeténél.');
	const note = typeof params.note === 'string' && params.note.trim() ? params.note.trim() : null;
	if (params.kind === 'other' && !note) {
		throw new Error('Az egyéb távollétnél írd le, mi volt az ok.');
	}

	let result;
	if (params.id) {
		result = await context.db.query(
			`UPDATE ${SCHEMA}.employee_absence_periods
			    SET kind = $3, start_date = $4, end_date = $5, note = $6, updated_at = NOW()
			  WHERE id = $1 AND employee_id = $2
			  RETURNING ${ABSENCE_COLUMNS}`,
			[params.id, params.employeeId, params.kind, startDate, endDate, note]
		);
		if (result.rows.length === 0) throw new Error('Nem található a távollét.');
	} else {
		result = await context.db.query(
			`INSERT INTO ${SCHEMA}.employee_absence_periods (employee_id, kind, start_date, end_date, note)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING ${ABSENCE_COLUMNS}`,
			[params.employeeId, params.kind, startDate, endDate, note]
		);
	}

	const recalculated = await recalculateEmployeeBalances(context, params.employeeId);
	return { absence: mapAbsence(result.rows[0]), recalculated };
}

export async function deleteAbsencePeriod(
	params: { id: number },
	context: RemoteContext
): Promise<{ recalculated: RecalculatedBalance[] }> {
	const r = await context.db.query(
		`SELECT employee_id FROM ${SCHEMA}.employee_absence_periods WHERE id = $1`,
		[params.id]
	);
	if (r.rows.length === 0) throw new Error('Nem található a távollét.');
	const employeeId: number = r.rows[0].employee_id;
	await requireManageForEmployee(context, employeeId);

	await context.db.query(`DELETE FROM ${SCHEMA}.employee_absence_periods WHERE id = $1`, [params.id]);
	return { recalculated: await recalculateEmployeeBalances(context, employeeId) };
}

// --- Számított keretek ------------------------------------------------------

/** Az előző évi keret röviden, az áthozatal javaslatához. */
export interface PreviousYearBalance {
	year: number;
	totalDays: number;
	usedDays: number;
	remainingDays: number;
}

function parseCarryOver(value: unknown): number {
	const days = value === undefined || value === null || value === '' ? 0 : Number(value);
	if (!Number.isInteger(days) || days < 0 || days > MAX_CARRY_OVER_DAYS) {
		throw new Error(`Az áthozott napok száma 0 és ${MAX_CARRY_OVER_DAYS} közötti egész szám legyen.`);
	}
	return days;
}

/**
 * Áthozatal-javaslat: az előző év maradéka. Hogy ebből mennyi hozható át
 * (Mt. 123. §: pl. október 1. utáni belépés, a felek megállapodása), az az
 * adatokból nem következik — a HR dönt, a javaslat csak kiindulópont.
 */
function suggestCarryOver(previous: PreviousYearBalance | null): number {
	return previous ? Math.max(0, Math.min(previous.remainingDays, MAX_CARRY_OVER_DAYS)) : 0;
}

async function loadPreviousBalances(
	context: RemoteContext,
	employeeIds: number[],
	year: number
): Promise<Map<number, PreviousYearBalance>> {
	const result = new Map<number, PreviousYearBalance>();
	if (employeeIds.length === 0) return result;
	const r = await context.db.query(
		`SELECT employee_id, year, total_days, used_days, remaining_days
		   FROM ${SCHEMA}.leave_balances
		  WHERE employee_id = ANY($1::int[]) AND year = $2`,
		[employeeIds, year]
	);
	for (const row of r.rows) {
		result.set(row.employee_id, {
			year: row.year,
			totalDays: row.total_days,
			usedDays: row.used_days,
			remainingDays: row.remaining_days
		});
	}
	return result;
}

/**
 * Számított keret beszúrása. Ha az évre már van keret, nem ír felül, és null-t ad.
 * A tömeges mentés tranzakciós kliense is ezt használja.
 */
async function insertCalculatedBalance(
	db: Pick<RemoteContext['db'], 'query'>,
	values: {
		employeeId: number;
		organizationId: number;
		year: number;
		calculation: LeaveBalanceCalculation;
		adjustmentDays: number;
		adjustmentNote: string | null;
		carriedOverDays: number;
		userId: number;
		action: 'created' | 'bulk_created';
	}
): Promise<LeaveBalance | null> {
	const calculated = values.calculation.result.totalDays;
	const result = await db.query(
		`INSERT INTO ${SCHEMA}.leave_balances
			(employee_id, organization_id, year, total_days, used_days,
			 calculated_days, adjustment_days, adjustment_note, carried_over_days,
			 calculation, calculated_at, updated_by, updated_at)
		 VALUES ($1, $2, $3, $4::int + $5::int + $7::int, 0, $4::int, $5::int, $6, $7::int,
		         $8::jsonb, NOW(), $9, NOW())
		 ON CONFLICT (employee_id, year) DO NOTHING
		 RETURNING ${BALANCE_COLUMNS}`,
		[
			values.employeeId,
			values.organizationId,
			values.year,
			calculated,
			values.adjustmentDays,
			values.adjustmentNote,
			values.carriedOverDays,
			JSON.stringify(values.calculation),
			values.userId
		]
	);
	if (result.rows.length === 0) return null;
	const balance = mapBalanceRow(result.rows[0]);
	await logBalanceChange(db, { action: values.action, before: null, after: balance, actorUserId: values.userId });
	return balance;
}

/**
 * A számítás egy dolgozóra és évre, a meglévő kerettel, az előző évi kerettel
 * és az áthozatal-javaslattal együtt.
 */
export async function previewLeaveEntitlement(
	params: { employeeId: number; year: number },
	context: RemoteContext
): Promise<{
	calculation: LeaveBalanceCalculation;
	balance: LeaveBalance | null;
	previousBalance: PreviousYearBalance | null;
	suggestedCarryOver: number;
}> {
	await requireSelfOrCapability(context, params.employeeId, 'leave.balance.manage');
	const year = parseYear(params.year);

	const { base } = await loadEntitlementBase(context, params.employeeId);
	const [existing, previous] = await Promise.all([
		context.db.query(
			`SELECT ${BALANCE_COLUMNS} FROM ${SCHEMA}.leave_balances WHERE employee_id = $1 AND year = $2`,
			[params.employeeId, year]
		),
		loadPreviousBalances(context, [params.employeeId], year - 1)
	]);
	const previousBalance = previous.get(params.employeeId) ?? null;

	return {
		calculation: calculate(base, year),
		balance: existing.rows.length > 0 ? mapBalanceRow(existing.rows[0]) : null,
		previousBalance,
		suggestedCarryOver: suggestCarryOver(previousBalance)
	};
}

/** Keret létrehozása a számítás alapján, opcionális korrekcióval és áthozatallal (K3). */
export async function createLeaveBalanceFromCalculation(
	params: {
		employeeId: number;
		year: number;
		adjustmentDays?: number;
		adjustmentNote?: string | null;
		carriedOverDays?: number;
	},
	context: RemoteContext
): Promise<LeaveBalance> {
	const orgId = await requireManageForEmployee(context, params.employeeId);
	const year = parseYear(params.year);
	const adjustment = parseAdjustment(params.adjustmentDays, params.adjustmentNote);
	const carriedOverDays = parseCarryOver(params.carriedOverDays);

	const { base } = await loadEntitlementBase(context, params.employeeId);
	const calculation = calculate(base, year);
	if (calculation.result.totalDays + adjustment.days + carriedOverDays < 0) {
		throw new Error('A korrekcióval a keret nem lehet negatív.');
	}

	const balance = await insertCalculatedBalance(context.db, {
		employeeId: params.employeeId,
		organizationId: orgId,
		year,
		calculation,
		adjustmentDays: adjustment.days,
		adjustmentNote: adjustment.note,
		carriedOverDays,
		userId: await resolveUserId(context),
		action: 'created'
	});
	if (!balance) {
		throw new Error(`A(z) ${year}. évre már van szabadságkeret.`);
	}
	return balance;
}

/**
 * Korrekció, áthozatal és zárolás (K4, K5). Nem zárolt keretnél a számítást is
 * frissíti, így a feloldás után a keret azonnal a mostani adatokat tükrözi.
 * Ha `carriedOverDays` nincs megadva, a meglévő áthozatal marad.
 */
export async function setLeaveBalanceAdjustment(
	params: {
		balanceId: number;
		adjustmentDays: number;
		adjustmentNote?: string | null;
		carriedOverDays?: number;
		isLocked: boolean;
	},
	context: RemoteContext
): Promise<LeaveBalance> {
	const row = await loadBalanceRow(context, params.balanceId);
	if (row.calculated_days === null) {
		throw new Error('Ez kézi keret — előbb alkalmazd rá a számítást.');
	}
	const adjustment = parseAdjustment(params.adjustmentDays, params.adjustmentNote);
	const carriedOverDays =
		params.carriedOverDays === undefined ? row.carried_over_days : parseCarryOver(params.carriedOverDays);
	const isLocked = params.isLocked === true;

	let calculated: number = row.calculated_days;
	let calculationJson: string | null = null;
	if (!isLocked) {
		const { base } = await loadEntitlementBase(context, row.employee_id);
		const calculation = calculate(base, row.year);
		calculated = calculation.result.totalDays;
		calculationJson = JSON.stringify(calculation);
	}
	if (calculated + adjustment.days + carriedOverDays < 0) {
		throw new Error('A korrekcióval a keret nem lehet negatív.');
	}
	const userId = await resolveUserId(context);

	const result = await context.db.query(
		`UPDATE ${SCHEMA}.leave_balances
		    SET adjustment_days = $2,
		        adjustment_note = $3,
		        is_locked = $4,
		        calculated_days = $5,
		        carried_over_days = $8,
		        total_days = $5::int + $2::int + $8::int,
		        calculation = COALESCE($6::jsonb, calculation),
		        calculated_at = CASE WHEN $6::jsonb IS NULL THEN calculated_at ELSE NOW() END,
		        updated_by = $7,
		        updated_at = NOW()
		  WHERE id = $1
		  RETURNING ${BALANCE_COLUMNS}`,
		[
			params.balanceId,
			adjustment.days,
			adjustment.note,
			isLocked,
			calculated,
			calculationJson,
			userId,
			carriedOverDays
		]
	);
	const after = mapBalanceRow(result.rows[0]);
	await logBalanceChange(context.db, { action: 'adjusted', before: mapBalanceRow(row), after, actorUserId: userId });
	return after;
}

/**
 * A számítás alkalmazása egy kézi vagy zárolt keretre (K8).
 *
 * Kézi keretnél `keepTotal` esetén a korrekció a régi összeg és a számított
 * érték különbsége lesz, így a keret összege nem változik. Már számított
 * (zárolt) keretnél a meglévő korrekció és áthozatal marad, csak a számított
 * érték frissül.
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
	const carriedOverDays: number = row.carried_over_days;
	if (row.calculated_days === null) {
		adjustmentDays = params.keepTotal ? row.total_days - calculated : 0;
		adjustmentNote =
			adjustmentDays !== 0 ? 'A korábbi kézi keret összege megtartva az átálláskor.' : null;
	}
	if (calculated + adjustmentDays + carriedOverDays < 0) {
		throw new Error('A korrekcióval a keret nem lehet negatív.');
	}
	const userId = await resolveUserId(context);

	const result = await context.db.query(
		`UPDATE ${SCHEMA}.leave_balances
		    SET calculated_days = $2,
		        adjustment_days = $3,
		        adjustment_note = $4,
		        total_days = $2::int + $3::int + carried_over_days,
		        calculation = $5::jsonb,
		        calculated_at = NOW(),
		        updated_by = $6,
		        updated_at = NOW()
		  WHERE id = $1
		  RETURNING ${BALANCE_COLUMNS}`,
		[params.balanceId, calculated, adjustmentDays, adjustmentNote, JSON.stringify(calculation), userId]
	);
	const after = mapBalanceRow(result.rows[0]);
	await logBalanceChange(context.db, {
		action: 'calculation_applied',
		before: mapBalanceRow(row),
		after,
		actorUserId: userId
	});
	return after;
}

// --- Éves keretgenerálás (tömeges) -------------------------------------------

export interface BulkEntitlementRow {
	employeeId: number;
	userName: string;
	position: string | null;
	department: string | null;
	hireDateConfirmed: boolean;
	calculation: EntitlementResult;
	previousBalance: PreviousYearBalance | null;
	suggestedCarryOver: number;
}

export interface BulkEntitlementPreview {
	year: number;
	/** Az aktív dolgozók, akiknek még nincs kerete az évre. */
	rows: BulkEntitlementRow[];
	/** Ennyi aktív dolgozónak már van kerete az évre. */
	existingCount: number;
}

/** Egy sor a tömeges mentéshez: a HR döntései. A számítást a szerver újra elvégzi. */
export interface BulkEntitlementDecision {
	employeeId: number;
	adjustmentDays?: number;
	adjustmentNote?: string | null;
	carriedOverDays?: number;
}

const MAX_BULK_ROWS = 1000;

/** A szervezet aktív (nem kilépett) dolgozói, és hogy van-e már keretük az évre. */
async function loadActiveEmployees(context: RemoteContext, organizationId: number, year: number) {
	const r = await context.db.query(
		`SELECT e.id, u.full_name, e.position, e.department,
		        EXISTS (SELECT 1 FROM ${SCHEMA}.leave_balances lb
		                 WHERE lb.employee_id = e.id AND lb.year = $2) AS has_balance
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.organization_id = $1 AND e.status <> 'inactive'
		  ORDER BY u.full_name, e.id`,
		[organizationId, year]
	);
	return r.rows as Array<{
		id: number;
		full_name: string;
		position: string | null;
		department: string | null;
		has_balance: boolean;
	}>;
}

/**
 * Éves keretek előnézete a szervezet összes olyan aktív dolgozójára, akinek
 * még nincs kerete az adott évre: számítás, előző évi keret, áthozatal-javaslat.
 */
export async function previewBulkEntitlements(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<BulkEntitlementPreview> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'leave.balance.manage');
	const year = parseYear(params.year);

	const employees = await loadActiveEmployees(context, params.organizationId, year);
	const pending = employees.filter((e) => !e.has_balance);
	const ids = pending.map((e) => e.id);

	const [profiles, policy, previous] = await Promise.all([
		loadProfiles(context, ids),
		loadPolicy(context, params.organizationId),
		loadPreviousBalances(context, ids, year - 1)
	]);

	const rows: BulkEntitlementRow[] = pending.map((e) => {
		const profile = profiles.get(e.id)!;
		const previousBalance = previous.get(e.id) ?? null;
		return {
			employeeId: e.id,
			userName: e.full_name,
			position: e.position ?? null,
			department: e.department ?? null,
			hireDateConfirmed: profile.hireDateConfirmed,
			calculation: calculate(toEntitlementBase(profile, policy), year).result,
			previousBalance,
			suggestedCarryOver: suggestCarryOver(previousBalance)
		};
	});

	return { year, rows, existingCount: employees.length - pending.length };
}

/**
 * Éves keretek létrehozása egyben, a HR soronkénti döntéseivel (korrekció,
 * áthozatal). A számítást a szerver a mostani adatokból újra elvégzi.
 *
 * Előbb minden sort ellenőriz, és hiba esetén semmit nem ír. Az időközben
 * (pl. egy másik ablakban) már létrehozott kereteket nem írja felül, ezeket
 * a `skippedEmployeeIds` adja vissza.
 */
export async function applyLeaveEntitlements(
	params: { organizationId: number; year: number; rows: BulkEntitlementDecision[] },
	context: RemoteContext
): Promise<{ created: number; skippedEmployeeIds: number[] }> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	await requireCapability(context, params.organizationId, 'leave.balance.manage');
	const year = parseYear(params.year);

	const decisions = Array.isArray(params.rows) ? params.rows : [];
	if (decisions.length === 0) throw new Error('Nincs kiválasztott dolgozó.');
	if (decisions.length > MAX_BULK_ROWS) throw new Error('Túl sok sor egy mentésben.');

	const employees = new Map(
		(await loadActiveEmployees(context, params.organizationId, year)).map((e) => [e.id, e])
	);
	const seen = new Set<number>();
	const prepared = decisions.map((d) => {
		const employee = employees.get(Number(d.employeeId));
		if (!employee) throw new Error('A dolgozó nem található ebben a szervezetben, vagy már kilépett.');
		if (seen.has(employee.id)) throw new Error(`${employee.full_name}: kétszer szerepel.`);
		seen.add(employee.id);
		try {
			return {
				employeeId: employee.id,
				name: employee.full_name,
				adjustment: parseAdjustment(d.adjustmentDays, d.adjustmentNote),
				carriedOverDays: parseCarryOver(d.carriedOverDays)
			};
		} catch (err) {
			throw new Error(`${employee.full_name}: ${(err as Error).message}`);
		}
	});

	const [profiles, policy] = await Promise.all([
		loadProfiles(context, prepared.map((p) => p.employeeId)),
		loadPolicy(context, params.organizationId)
	]);
	const calculated = prepared.map((p) => {
		const calculation = calculate(toEntitlementBase(profiles.get(p.employeeId)!, policy), year);
		if (calculation.result.totalDays + p.adjustment.days + p.carriedOverDays < 0) {
			throw new Error(`${p.name}: a korrekcióval a keret nem lehet negatív.`);
		}
		return { ...p, calculation };
	});

	const userId = await resolveUserId(context);
	const client = await context.db.connect();
	let created = 0;
	const skippedEmployeeIds: number[] = [];
	try {
		await client.query('BEGIN');
		for (const row of calculated) {
			const balance = await insertCalculatedBalance(client, {
				employeeId: row.employeeId,
				organizationId: params.organizationId,
				year,
				calculation: row.calculation,
				adjustmentDays: row.adjustment.days,
				adjustmentNote: row.adjustment.note,
				carriedOverDays: row.carriedOverDays,
				userId,
				action: 'bulk_created'
			});
			if (balance) created++;
			else skippedEmployeeIds.push(row.employeeId);
		}
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	return { created, skippedEmployeeIds };
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
