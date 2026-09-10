/**
 * Az éves szabadságon kívüli keretek: betegszabadság, apasági és szülői szabadság.
 *
 * Ezeket nem tároljuk: a keretet a dolgozó adataiból számoljuk (leave-entitlement.ts),
 * a felhasználást a kérelmekből. A betegszabadság túllépése nem akadály, csak jelzés
 * (a 15 napon felüli rész táppénzes keresőképtelenség); az apasági és a szülői
 * szabadság szabályait a kérelem beadásakor és jóváhagyásakor ellenőrizzük.
 *
 * Részletek: specs/leave-entitlement.md
 */

import type { RemoteContext } from './context.js';
import { requireSelfOrCapability } from './permissions.js';
import { todayInBudapest } from './dates.js';
import {
	calculateSickLeave,
	PARENTAL_DAYS,
	parentalDeadline,
	parentalEligibleFrom,
	PATERNITY_DAYS,
	PATERNITY_MAX_PARTS,
	paternityDeadline
} from './leave-entitlement.js';
import type { LeaveType } from './leave-types.js';

const SCHEMA = 'app__racona_work';

export interface SickLeaveStatus {
	year: number;
	/** Arányosított keret. */
	totalDays: number;
	fullYearDays: number;
	usedDays: number;
	pendingDays: number;
}

export interface ChildLeaveStatus {
	childId: number;
	label: string | null;
	birthDate: string;
	/** Az utolsó nap, ameddig kivehető. */
	deadline: string;
	totalDays: number;
	usedDays: number;
	pendingDays: number;
	/** totalDays − usedDays − pendingDays */
	remainingDays: number;
	/** Még kivehető-e (a határidő nem járt le). */
	active: boolean;
	/** Szülői szabadságnál: ettől a naptól jár (egy év munkaviszony). */
	eligibleFrom?: string | null;
	/** Apasági szabadságnál: hány részletben kérték már (jóváhagyott + függő). */
	parts?: number;
}

export interface LeaveAllowances {
	year: number;
	sick: SickLeaveStatus;
	paternity: ChildLeaveStatus[];
	parental: ChildLeaveStatus[];
}

async function loadEmployee(context: RemoteContext, employeeId: number) {
	const r = await context.db.query(
		`SELECT to_char(hire_date, 'YYYY-MM-DD') AS hire_date,
		        to_char(employment_end_date, 'YYYY-MM-DD') AS employment_end_date
		   FROM ${SCHEMA}.employees WHERE id = $1`,
		[employeeId]
	);
	if (r.rows.length === 0) throw new Error(`Nem található dolgozó a megadott azonosítóval: ${employeeId}`);
	return {
		hireDate: (r.rows[0].hire_date as string | null) ?? null,
		employmentEndDate: (r.rows[0].employment_end_date as string | null) ?? null
	};
}

/** Gyerekhez kötött kérelmek napjai gyerekenként és típusonként. */
async function loadChildUsage(context: RemoteContext, employeeId: number, excludeRequestId?: number) {
	const r = await context.db.query(
		`SELECT child_id, leave_type,
		        COALESCE(SUM(days) FILTER (WHERE status = 'approved'), 0)::int AS used,
		        COALESCE(SUM(days) FILTER (WHERE status = 'pending'), 0)::int AS pending,
		        COUNT(*)::int AS parts
		   FROM ${SCHEMA}.leave_requests
		  WHERE employee_id = $1 AND child_id IS NOT NULL
		    AND leave_type IN ('paternity', 'parental') AND status IN ('approved', 'pending')
		    AND ($2::int IS NULL OR id <> $2)
		  GROUP BY child_id, leave_type`,
		[employeeId, excludeRequestId ?? null]
	);
	const usage = new Map<string, { used: number; pending: number; parts: number }>();
	for (const row of r.rows) {
		usage.set(`${row.child_id}:${row.leave_type}`, { used: row.used, pending: row.pending, parts: row.parts });
	}
	return (childId: number, type: LeaveType) =>
		usage.get(`${childId}:${type}`) ?? { used: 0, pending: 0, parts: 0 };
}

/**
 * A dolgozó betegszabadság-, apasági és szülői kerete. A dolgozó a sajátját,
 * a HR és a kérelmeket elbíráló vezető másét is láthatja.
 */
export async function getLeaveAllowances(
	params: { employeeId: number; year?: number },
	context: RemoteContext
): Promise<LeaveAllowances> {
	await requireSelfOrCapability(context, params.employeeId, ['leave.balance.manage', 'leave.approve']);
	const today = todayInBudapest();
	const year = Number.isInteger(params.year) ? Number(params.year) : Number(today.slice(0, 4));

	const employee = await loadEmployee(context, params.employeeId);
	const [sickResult, childrenResult, usageOf] = await Promise.all([
		context.db.query(
			`SELECT COALESCE(SUM(days) FILTER (WHERE status = 'approved'), 0)::int AS used,
			        COALESCE(SUM(days) FILTER (WHERE status = 'pending'), 0)::int AS pending
			   FROM ${SCHEMA}.leave_requests
			  WHERE employee_id = $1 AND leave_type = 'sick' AND EXTRACT(YEAR FROM start_date) = $2`,
			[params.employeeId, year]
		),
		context.db.query(
			`SELECT id, label, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, paternity_eligible
			   FROM ${SCHEMA}.employee_children
			  WHERE employee_id = $1
			  ORDER BY birth_date DESC, id`,
			[params.employeeId]
		),
		loadChildUsage(context, params.employeeId)
	]);

	const sickAllowance = calculateSickLeave({ year, ...employee });
	const sick: SickLeaveStatus = {
		year,
		totalDays: sickAllowance.totalDays,
		fullYearDays: sickAllowance.fullYearDays,
		usedDays: sickResult.rows[0].used,
		pendingDays: sickResult.rows[0].pending
	};

	const paternity: ChildLeaveStatus[] = [];
	const parental: ChildLeaveStatus[] = [];
	for (const child of childrenResult.rows) {
		if (child.paternity_eligible) {
			const usage = usageOf(child.id, 'paternity');
			const deadline = paternityDeadline(child.birth_date);
			paternity.push({
				childId: child.id,
				label: child.label ?? null,
				birthDate: child.birth_date,
				deadline,
				totalDays: PATERNITY_DAYS,
				usedDays: usage.used,
				pendingDays: usage.pending,
				remainingDays: PATERNITY_DAYS - usage.used - usage.pending,
				active: deadline >= today,
				parts: usage.parts
			});
		}
		const deadline = parentalDeadline(child.birth_date);
		if (deadline >= today) {
			const usage = usageOf(child.id, 'parental');
			parental.push({
				childId: child.id,
				label: child.label ?? null,
				birthDate: child.birth_date,
				deadline,
				totalDays: PARENTAL_DAYS,
				usedDays: usage.used,
				pendingDays: usage.pending,
				remainingDays: PARENTAL_DAYS - usage.used - usage.pending,
				active: true,
				eligibleFrom: employee.hireDate ? parentalEligibleFrom(employee.hireDate) : null
			});
		}
	}

	return { year, sick, paternity, parental };
}

/**
 * Belső segéd (a functions.ts NEM reexportálja) — a leave.ts hívja.
 *
 * Az apasági és a szülői szabadságkérelem ellenőrzése: a gyerek a dolgozóé,
 * a kérelem a határidőn belül van, és belefér a keretbe. Beadáskor a függő
 * kérelmek is foglalnak (`countPending`), jóváhagyáskor csak a jóváhagyottak,
 * az épp elbírált kérelem nélkül (`excludeRequestId`).
 *
 * @throws Magyar nyelvű hibaüzenettel, ha a kérelem nem felel meg.
 */
export async function validateChildLeave(
	context: RemoteContext,
	request: {
		employeeId: number;
		childId: number | null | undefined;
		leaveType: 'paternity' | 'parental';
		startDate: string;
		endDate: string;
		days: number;
		countPending: boolean;
		excludeRequestId?: number;
	}
): Promise<void> {
	if (!request.childId) {
		throw new Error('Válaszd ki, melyik gyerek után kéred a szabadságot.');
	}
	const childResult = await context.db.query(
		`SELECT to_char(birth_date, 'YYYY-MM-DD') AS birth_date, paternity_eligible
		   FROM ${SCHEMA}.employee_children WHERE id = $1 AND employee_id = $2`,
		[request.childId, request.employeeId]
	);
	if (childResult.rows.length === 0) {
		throw new Error('A gyerek nem található a dolgozó adatai között.');
	}
	const child = childResult.rows[0] as { birth_date: string; paternity_eligible: boolean };
	const usage = (await loadChildUsage(context, request.employeeId, request.excludeRequestId))(
		request.childId,
		request.leaveType
	);
	const taken = usage.used + (request.countPending ? usage.pending : 0);

	if (request.startDate < child.birth_date) {
		throw new Error('A szabadság nem kezdődhet a gyerek születése előtt.');
	}

	if (request.leaveType === 'paternity') {
		if (!child.paternity_eligible) {
			throw new Error(
				'Ennél a gyereknél nincs jelölve, hogy apasági szabadság jár. A HR a dolgozó adatlapján állíthatja be.'
			);
		}
		const deadline = paternityDeadline(child.birth_date);
		if (request.endDate > deadline) {
			throw new Error(`Az apasági szabadságot ${deadline}-ig lehet kivenni (Mt. 118. §).`);
		}
		if (usage.parts >= PATERNITY_MAX_PARTS) {
			throw new Error('Az apasági szabadságot legfeljebb két részletben lehet kivenni.');
		}
		if (taken + request.days > PATERNITY_DAYS) {
			throw new Error(
				`Az apasági szabadságból ${Math.max(0, PATERNITY_DAYS - taken)} nap maradt, a kérelem ${request.days} nap.`
			);
		}
		return;
	}

	const deadline = parentalDeadline(child.birth_date);
	if (request.endDate > deadline) {
		throw new Error(`A szülői szabadságot a gyerek hároméves koráig, ${deadline}-ig lehet kivenni.`);
	}
	const employee = await loadEmployee(context, request.employeeId);
	if (!employee.hireDate) {
		throw new Error('A dolgozó belépési dátuma nincs megadva, így nem ellenőrizhető a jogosultság.');
	}
	const eligibleFrom = parentalEligibleFrom(employee.hireDate);
	if (request.startDate < eligibleFrom) {
		throw new Error(`Szülői szabadság egy év munkaviszony után, ${eligibleFrom}-tól jár (Mt. 128/A. §).`);
	}
	if (taken + request.days > PARENTAL_DAYS) {
		throw new Error(
			`A szülői szabadságból ${Math.max(0, PARENTAL_DAYS - taken)} nap maradt, a kérelem ${request.days} nap.`
		);
	}
}
