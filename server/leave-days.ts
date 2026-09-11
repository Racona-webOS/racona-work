/**
 * Szabadságnapok — a jóváhagyott szabadság napszintű tárolása (leave_days).
 *
 * A kérelem (leave_requests) beadott, utólag nem módosuló meta sor; a tényleges
 * szabadság minden munkanapja külön sor ebben a táblában. Ez az igazságforrás
 * a keretek felhasználásához, az áthozott napokhoz, a betegszabadsághoz, a
 * dashboardhoz és a naptárhoz.
 *
 * A tiszta segédek (munkanapok, szakaszolás) a leave-day-utils.ts fájlban
 * vannak, hogy a kliens is használhassa őket. Részletek: specs/leave-days.md
 */

import type { RemoteContext } from './context.js';
import { isCoreAdmin, isDevMode, resolveUserId } from './context.js';
import { hasCapability, requireCapability } from './permissions.js';
import { getWorkCalendarOverrides } from './work-calendar.js';
import {
	notifyLeaveDaysAdded,
	notifyLeaveDaysRemoved,
	notifyLeaveRequestsCreated
} from './leave-notifications.js';
import { recalculateEmployeeBalances } from './leave-profile.js';
import { BALANCE_LEAVE_TYPES, CHILD_LEAVE_TYPES, consumesAnnualBalance, isLeaveType } from './leave-types.js';
import { validateChildLeave } from './leave-allowances.js';
import type { LeaveType } from './leave-types.js';
import { isDayClosed, loadClosedYear } from './leave-closing.js';
import {
	CALENDAR_LEAVE_TYPES,
	groupDaysByYear,
	groupIntoRuns,
	isWorkingDay,
	listWorkingDays,
	normalizeDays,
	REQUEST_CALENDAR_LEAVE_TYPES
} from './leave-day-utils.js';
import type { LeaveRun } from './leave-day-utils.js';

export * from './leave-day-utils.js';

// ---------------------------------------------------------------------------
// Adatbázis-műveletek (a leave.ts hívja; a functions.ts NEM exportálja újra)
// ---------------------------------------------------------------------------

/** Lekérdezés-képes kapcsolat: a pool vagy egy tranzakció kliense. */
export interface Queryable {
	query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

const SCHEMA = 'app__racona_work';

/**
 * A pg DATE oszlopot Date-ként is visszaadhatja — egységes ISO napra hozzuk.
 *
 * @param value - A nyers dátumérték az adatbázisból.
 * @returns A nap YYYY-MM-DD formában.
 */
export function toIsoDay(value: string | Date): string {
	if (value instanceof Date) {
		return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
			.toISOString()
			.slice(0, 10);
	}
	return String(value).slice(0, 10);
}

/**
 * A dolgozó már foglalt napjai a megadottak közül.
 *
 * @param db - Kapcsolat.
 * @param employeeId - A dolgozó.
 * @param days - A vizsgált napok.
 * @returns A foglalt napok növekvő sorrendben.
 */
export async function findTakenDays(
	db: Queryable,
	employeeId: number,
	days: string[]
): Promise<string[]> {
	if (days.length === 0) return [];
	const result = await db.query(
		`SELECT to_char(day, 'YYYY-MM-DD') AS day
		   FROM ${SCHEMA}.leave_days
		  WHERE employee_id = $1 AND day = ANY($2::date[])
		  ORDER BY day`,
		[employeeId, days]
	);
	return result.rows.map((row: { day: string }) => row.day);
}

/**
 * Hibát dob, ha a dolgozónak a napok bármelyikén már van szabadsága.
 *
 * @param db - Kapcsolat.
 * @param employeeId - A dolgozó.
 * @param days - A vizsgált napok.
 * @throws Magyar nyelvű hibaüzenettel, a foglalt napok felsorolásával.
 */
export async function assertDaysFree(
	db: Queryable,
	employeeId: number,
	days: string[]
): Promise<void> {
	const taken = await findTakenDays(db, employeeId, days);
	if (taken.length > 0) {
		throw new Error(
			`A dolgozónak már van szabadsága ezeken a napokon: ${taken.join(', ')}.`
		);
	}
}

/**
 * Egy kérelem napjainak beszúrása.
 *
 * @param db - Kapcsolat (tranzakcióban hívjuk).
 * @param params - A kérelem és a napjai.
 */
export async function insertLeaveDays(
	db: Queryable,
	params: {
		employeeId: number;
		organizationId: number;
		leaveRequestId: number;
		leaveType: string;
		days: string[];
	}
): Promise<void> {
	if (params.days.length === 0) return;
	await db.query(
		`INSERT INTO ${SCHEMA}.leave_days
			(employee_id, organization_id, leave_request_id, day, leave_type)
		 SELECT $1, $2, $3, d::date, $4
		   FROM unnest($5::date[]) AS d`,
		[params.employeeId, params.organizationId, params.leaveRequestId, params.leaveType, params.days]
	);
}

/**
 * Az éves keret felhasználásának újraszámolása a napokból (specs/leave-days.md, D12).
 *
 * A `used_days` mindig az adott év jóváhagyott éves szabadságnapjainak száma;
 * nem növeljük és csökkentjük, hanem minden változás után újraszámoljuk.
 * Csak létező keretet frissít, keretet nem hoz létre.
 *
 * @param db - Kapcsolat.
 * @param employeeId - A dolgozó.
 * @param years - Az érintett évek.
 */
export async function syncAnnualUsedDays(
	db: Queryable,
	employeeId: number,
	years: number[]
): Promise<void> {
	const unique = [...new Set(years)];
	if (unique.length === 0) return;
	await db.query(
		`UPDATE ${SCHEMA}.leave_balances b
		    SET used_days = (
		            SELECT COUNT(*)
		              FROM ${SCHEMA}.leave_days ld
		             WHERE ld.employee_id = b.employee_id
		               AND ld.leave_type = ANY($3::text[])
		               AND EXTRACT(YEAR FROM ld.day)::int = b.year
		        ),
		        updated_at = NOW()
		  WHERE b.employee_id = $1 AND b.year = ANY($2::int[])`,
		[employeeId, unique, [...BALANCE_LEAVE_TYPES]]
	);
}

/**
 * Éves szabadságnál: belefér-e a keretbe, évenként.
 *
 * @param db - Kapcsolat.
 * @param employeeId - A dolgozó.
 * @param days - A kért éves szabadságnapok.
 * @param message - A hibaüzenet elé kerülő szövegkörnyezet ('request' beadásnál, 'approve' jóváhagyásnál).
 * @throws Ha valamelyik évre nincs keret, vagy nem fér bele.
 */
export async function assertAnnualBalance(
	db: Queryable,
	employeeId: number,
	days: string[],
	message: 'request' | 'approve'
): Promise<void> {
	for (const [year, yearDays] of groupDaysByYear(days)) {
		const result = await db.query(
			`SELECT remaining_days FROM ${SCHEMA}.leave_balances
			  WHERE employee_id = $1 AND year = $2`,
			[employeeId, year]
		);
		if (result.rows.length === 0) {
			throw new Error(
				message === 'request'
					? `Nincs szabadságkeret beállítva a(z) ${year}. évre. Kérjük, állítsa be a keretet először.`
					: `Nincs szabadságkeret beállítva a(z) ${year}. évre, a kérelem nem hagyható jóvá.`
			);
		}
		const remaining: number = result.rows[0].remaining_days;
		if (yearDays.length > remaining) {
			throw new Error(
				message === 'request'
					? `Nincs elegendő szabad keret a(z) ${year}. évre. Kért napok: ${yearDays.length}, fennmaradó napok: ${remaining}.`
					: `A kérelem a munkanaptár szerint ${yearDays.length} munkanap a(z) ${year}. évre, a fennmaradó keret viszont ${remaining} nap. A kérelem így nem hagyható jóvá.`
			);
		}
	}
}

/**
 * A hívó dolgozói sora a szervezetben (a jóváhagyó rögzítéséhez).
 *
 * @param db - Kapcsolat.
 * @param userId - A felhasználó azonosítója.
 * @param organizationId - A szervezet.
 * @returns A dolgozó azonosítója, vagy null, ha a felhasználó nem dolgozó itt.
 */
export async function findEmployeeIdOfUser(
	db: Queryable,
	userId: number,
	organizationId: number
): Promise<number | null> {
	const result = await db.query(
		`SELECT id FROM ${SCHEMA}.employees WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
		[userId, organizationId]
	);
	return result.rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Naptár (hívható a kliensről; a functions.ts exportálja)
// ---------------------------------------------------------------------------

/** Egy dolgozó egy szabadságnapja a naptárban. */
export interface LeaveCalendarDay {
	/** YYYY-MM-DD */
	day: string;
	employeeId: number;
	employeeName: string;
	/** A jóváhagyó és a saját napjainál a dolgozó látja; a kollégákét nem. */
	leaveType: string | null;
	leaveRequestId: number;
}

/** Egy függő kérelem munkanapja a naptárban (halványan jelenik meg). */
export interface LeaveCalendarPendingDay {
	day: string;
	employeeId: number;
	employeeName: string;
	leaveType: string | null;
	leaveRequestId: number;
}

export interface LeaveCalendar {
	from: string;
	to: string;
	/** A jóváhagyott napok (leave_days). */
	days: LeaveCalendarDay[];
	/** A függő kérelmek munkanapjai a kérelem időszakából. */
	pending: LeaveCalendarPendingDay[];
	/** A munkanaptár kivételei az időszakban: nap → munkanap-e. */
	calendar: { day: string; isWorkingDay: boolean }[];
	/** A hívó látja-e a típust és szerkesztheti-e a naptárat (leave.approve). */
	canManage: boolean;
	/** A legutolsó lezárt év; eddig (és ez előtt) nem lehet módosítani. */
	closedYear: number | null;
}

/** Legfeljebb ennyi nap kérhető le egyszerre (egy év, az éves nézethez). */
const MAX_CALENDAR_DAYS = 366;

/** Naptári napok száma a két nap között, mindkettőt beleértve. */
function daySpan(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/**
 * A szabadságnaptár egy időszakra (specs/leave-days.md, K5).
 *
 * Aki `leave.request` joggal belép, látja, ki mikor van távol; a típust a
 * `leave.approve` jog mutatja, meg a dolgozó a saját napjainál (a
 * betegszabadság egészségügyi adat, a kollégák nem látják). A függő kérelmek
 * napjait a kérelem időszakából számoljuk a munkanaptárral; jóváhagyó jog
 * nélkül csak a hívó saját függő kérelmeit.
 *
 * @param params - A szervezet, az időszak (legfeljebb egy év) és a dolgozószűrő.
 * @param context - Remote futási kontextus.
 * @returns A napok, a függő napok és a munkanaptár kivételei.
 */
export async function getLeaveCalendar(
	params: { organizationId: number; from: string; to: string; employeeId?: number | null },
	context: RemoteContext
): Promise<LeaveCalendar> {
	const { organizationId } = params;
	if (!organizationId || organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	const [from, to] = normalizeDays([params.from, params.to]);
	if (from !== params.from || to !== params.to) {
		throw new Error('A záró dátum nem lehet korábbi a kezdő dátumnál.');
	}
	if (daySpan(from, to) > MAX_CALENDAR_DAYS) {
		throw new Error(`Egyszerre legfeljebb ${MAX_CALENDAR_DAYS} nap kérhető le.`);
	}

	await requireCapability(context, organizationId, 'leave.request');
	const canManage = await hasCapability(context, organizationId, 'leave.approve');
	// A saját napjainak típusát a dolgozó is látja
	const ownEmployeeId = await findEmployeeIdOfUser(context.db, await resolveUserId(context), organizationId);
	const showType = (employeeId: number) => canManage || employeeId === ownEmployeeId;

	const employeeFilter = params.employeeId ? Number(params.employeeId) : null;
	const conditions = ['e.organization_id = $1'];
	const queryParams: unknown[] = [organizationId, from, to];
	if (employeeFilter) {
		conditions.push('e.id = $4');
		queryParams.push(employeeFilter);
	}
	const where = conditions.join(' AND ');
	// A kollégák függő kérelmei csak a jóváhagyónak látszanak; a dolgozónak a sajátjai
	const pendingWhere = canManage
		? where
		: `${where} AND lr.employee_id = $${queryParams.length + 1}`;
	const pendingParams = canManage ? queryParams : [...queryParams, ownEmployeeId ?? 0];

	const [daysResult, pendingResult, overrides, closedYear] = await Promise.all([
		context.db.query(
			`SELECT to_char(ld.day, 'YYYY-MM-DD') AS day, ld.employee_id, ld.leave_type, ld.leave_request_id,
			        u.full_name AS employee_name
			   FROM ${SCHEMA}.leave_days ld
			   JOIN ${SCHEMA}.employees e ON e.id = ld.employee_id
			   JOIN auth.users u ON u.id = e.user_id
			  WHERE ${where} AND ld.day >= $2::date AND ld.day <= $3::date
			  ORDER BY ld.day, u.full_name`,
			queryParams
		),
		context.db.query(
			`SELECT lr.id, lr.employee_id, lr.leave_type,
			        to_char(lr.start_date, 'YYYY-MM-DD') AS start_date,
			        to_char(lr.end_date, 'YYYY-MM-DD') AS end_date,
			        u.full_name AS employee_name
			   FROM ${SCHEMA}.leave_requests lr
			   JOIN ${SCHEMA}.employees e ON e.id = lr.employee_id
			   JOIN auth.users u ON u.id = e.user_id
			  WHERE ${pendingWhere} AND lr.status = 'pending'
			    AND lr.start_date <= $3::date AND lr.end_date >= $2::date
			  ORDER BY lr.start_date, u.full_name`,
			pendingParams
		),
		getWorkCalendarOverrides(context, organizationId, from, to),
		loadClosedYear(context.db, organizationId)
	]);

	const days: LeaveCalendarDay[] = daysResult.rows.map((row: any) => ({
		day: row.day,
		employeeId: row.employee_id,
		employeeName: row.employee_name ?? '—',
		leaveType: showType(row.employee_id) ? row.leave_type : null,
		leaveRequestId: row.leave_request_id
	}));

	const pending: LeaveCalendarPendingDay[] = [];
	for (const row of pendingResult.rows) {
		// Csak az időszakba eső munkanapok
		const start = row.start_date < from ? from : row.start_date;
		const end = row.end_date > to ? to : row.end_date;
		for (const day of listWorkingDays(start, end, overrides)) {
			pending.push({
				day,
				employeeId: row.employee_id,
				employeeName: row.employee_name ?? '—',
				leaveType: showType(row.employee_id) ? row.leave_type : null,
				leaveRequestId: row.id
			});
		}
	}

	return {
		from,
		to,
		days,
		pending,
		calendar: [...overrides].map(([day, isWorking]) => ({ day, isWorkingDay: isWorking })),
		canManage,
		closedYear
	};
}

// ---------------------------------------------------------------------------
// Szerkesztés a naptárban: előnézet és mentés
// ---------------------------------------------------------------------------

export interface LeaveCalendarChangeParams {
	organizationId: number;
	employeeId: number;
	/** A felvett napok típusa (CALENDAR_LEAVE_TYPES). */
	leaveType: string;
	addDays: string[];
	removeDays: string[];
	/** Apasági és szülői szabadságnál kötelező: melyik gyerek után. */
	childId?: number | null;
	/** A létrejövő kérelmek indoklása (nem kötelező). */
	reason?: string | null;
}

/** Egy év éves kerete a módosítás előtt és után. */
export interface CalendarBalanceEffect {
	year: number;
	hasBalance: boolean;
	remainingBefore: number;
	remainingAfter: number;
}

/** Az előnézet: mi történne mentéskor. */
export interface LeaveCalendarChangePlan {
	/** A felvett napokból készülő kérelmek. */
	runs: LeaveRun[];
	/** A törlendő napok a típusukkal. */
	removeDays: { day: string; leaveType: string }[];
	/** Az érintett évek éves kerete (csak ha éves szabadság érintett). */
	balances: CalendarBalanceEffect[];
	/** Ami miatt a mentés nem futna le. Üres, ha minden rendben. */
	errors: string[];
}

export interface LeaveCalendarSaveResult {
	createdRequests: { id: number; startDate: string; endDate: string; days: number }[];
	removedDays: string[];
}

interface CalendarChangeInput {
	organizationId: number;
	employeeId: number;
	leaveType: LeaveType;
	addDays: string[];
	removeDays: string[];
	childId: number | null;
	reason: string | null;
}

/** A gyerek azonosítója csak gyerekhez kötött típusnál számít. */
function parseChildId(leaveType: LeaveType, value: unknown): number | null {
	if (!CHILD_LEAVE_TYPES.has(leaveType)) return null;
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Apasági és szülői szabadság: a gyerek, a határidő és a keret ellenőrzése a
 * szakaszok együttesére; a hibát a tervbe gyűjti.
 */
async function collectChildLeaveErrors(
	context: RemoteContext,
	input: { employeeId: number; leaveType: LeaveType; childId: number | null },
	runs: LeaveRun[],
	countPending: boolean,
	errors: string[]
): Promise<void> {
	if (!CHILD_LEAVE_TYPES.has(input.leaveType) || runs.length === 0) return;
	try {
		await validateChildLeave(context, {
			employeeId: input.employeeId,
			childId: input.childId,
			leaveType: input.leaveType as 'paternity' | 'parental',
			startDate: runs[0].startDate,
			endDate: runs[runs.length - 1].endDate,
			days: runs.reduce((sum, r) => sum + r.days.length, 0),
			countPending,
			newParts: runs.length
		});
	} catch (err) {
		errors.push(err instanceof Error ? err.message : String(err));
	}
}

function parseChangeParams(params: LeaveCalendarChangeParams): CalendarChangeInput {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!params.employeeId || params.employeeId <= 0) {
		throw new Error('Válassz dolgozót a naptár szerkesztéséhez.');
	}
	if (!isLeaveType(params.leaveType) || !CALENDAR_LEAVE_TYPES.includes(params.leaveType)) {
		throw new Error('Ez a típus a naptárból nem rögzíthető, add be kérelemként.');
	}
	const addDays = normalizeDays(Array.isArray(params.addDays) ? params.addDays : []);
	const removeDays = normalizeDays(Array.isArray(params.removeDays) ? params.removeDays : []);
	const both = addDays.filter((d) => removeDays.includes(d));
	if (both.length > 0) {
		throw new Error(`Egy nap nem lehet egyszerre felvéve és törölve: ${both.join(', ')}.`);
	}
	return {
		organizationId: params.organizationId,
		employeeId: params.employeeId,
		leaveType: params.leaveType,
		addDays,
		removeDays,
		childId: parseChildId(params.leaveType, params.childId),
		reason: params.reason?.trim() || null
	};
}

async function assertEmployeeInOrganization(
	db: Queryable,
	employeeId: number,
	organizationId: number
): Promise<void> {
	const r = await db.query(
		`SELECT 1 FROM ${SCHEMA}.employees WHERE id = $1 AND organization_id = $2`,
		[employeeId, organizationId]
	);
	if (r.rows.length === 0) throw new Error('A dolgozó nem található ebben a szervezetben');
}

/**
 * A módosítás terve és ellenőrzése (specs/leave-days.md, 4. fejezet, D7–D11).
 *
 * Nem dob hibát a tartalmi problémákra, hanem az `errors` listába gyűjti,
 * hogy az előnézet mindet megmutathassa. A mentés az első hibán megáll.
 */
async function planCalendarChanges(
	db: Queryable,
	context: RemoteContext,
	input: CalendarChangeInput
): Promise<LeaveCalendarChangePlan> {
	const errors: string[] = [];
	const all = [...input.addDays, ...input.removeDays].sort();
	const overrides =
		all.length > 0
			? await getWorkCalendarOverrides(context, input.organizationId, all[0], all[all.length - 1])
			: new Map<string, boolean>();
	const working = (day: string) => isWorkingDay(day, overrides);

	// Lezárt évet nem lehet módosítani
	const closedYear = await loadClosedYear(db, input.organizationId);
	const closedDays = all.filter((d) => isDayClosed(d, closedYear));
	if (closedDays.length > 0) {
		errors.push(`A(z) ${closedYear}. évig az évek le vannak zárva, ott nem lehet módosítani: ${closedDays.join(', ')}.`);
	}

	// Felvétel: munkanap, szabad, és nincs rá függő kérelem
	const notWorking = input.addDays.filter((d) => !working(d));
	if (notWorking.length > 0) {
		errors.push(`Nem munkanapra nem vehető fel szabadság: ${notWorking.join(', ')}.`);
	}
	const taken = await findTakenDays(db, input.employeeId, input.addDays);
	if (taken.length > 0) {
		errors.push(`Ezeken a napokon már van szabadság: ${taken.join(', ')}.`);
	}
	if (input.addDays.length > 0) {
		const pending = await db.query(
			`SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
			   FROM ${SCHEMA}.leave_requests
			  WHERE employee_id = $1 AND status = 'pending'
			    AND start_date <= $3::date AND end_date >= $2::date
			  ORDER BY start_date`,
			[input.employeeId, input.addDays[0], input.addDays[input.addDays.length - 1]]
		);
		const blocked = input.addDays.filter((d) =>
			pending.rows.some((r: any) => r.start_date <= d && d <= r.end_date)
		);
		if (blocked.length > 0) {
			errors.push(`Ezekre a napokra függő kérelem van, előbb azt kell elbírálni: ${blocked.join(', ')}.`);
		}
	}

	// Törlés: a nap létezik és a dolgozóé
	const existing =
		input.removeDays.length > 0
			? await db.query(
					`SELECT to_char(day, 'YYYY-MM-DD') AS day, leave_type
					   FROM ${SCHEMA}.leave_days
					  WHERE employee_id = $1 AND day = ANY($2::date[])
					  ORDER BY day`,
					[input.employeeId, input.removeDays]
				)
			: { rows: [] as any[] };
	const removeDays = existing.rows.map((r: any) => ({ day: r.day as string, leaveType: r.leave_type as string }));
	const missing = input.removeDays.filter((d) => !removeDays.some((r) => r.day === d));
	if (missing.length > 0) {
		errors.push(`Ezeken a napokon nincs törölhető szabadság: ${missing.join(', ')}.`);
	}

	// Éves keret évenként: a törölt éves napok visszakerülnek, a felvettek terhelnek (D11)
	const balances: CalendarBalanceEffect[] = [];
	const addedAnnual = consumesAnnualBalance(input.leaveType)
		? groupDaysByYear(input.addDays)
		: new Map<number, string[]>();
	const removedAnnual = groupDaysByYear(
		removeDays.filter((r) => consumesAnnualBalance(r.leaveType)).map((r) => r.day)
	);
	const years = [...new Set([...addedAnnual.keys(), ...removedAnnual.keys()])].sort();
	for (const year of years) {
		const r = await db.query(
			`SELECT remaining_days FROM ${SCHEMA}.leave_balances WHERE employee_id = $1 AND year = $2`,
			[input.employeeId, year]
		);
		const hasBalance = r.rows.length > 0;
		const before: number = hasBalance ? r.rows[0].remaining_days : 0;
		const after = before + (removedAnnual.get(year)?.length ?? 0) - (addedAnnual.get(year)?.length ?? 0);
		balances.push({ year, hasBalance, remainingBefore: before, remainingAfter: after });
		if ((addedAnnual.get(year)?.length ?? 0) > 0) {
			if (!hasBalance) {
				errors.push(`Nincs szabadságkeret beállítva a(z) ${year}. évre.`);
			} else if (after < 0) {
				errors.push(
					`A(z) ${year}. évi keretbe nem fér bele: ${addedAnnual.get(year)!.length} nap kellene, ${before + (removedAnnual.get(year)?.length ?? 0)} nap van.`
				);
			}
		}
	}

	const runs = groupIntoRuns(input.addDays, working);
	// Jóváhagyottként kerül be: a függő kérelmek nem számítanak (mint a jóváhagyásnál)
	await collectChildLeaveErrors(context, input, runs, false, errors);

	return { runs, removeDays, balances, errors };
}

/**
 * Mentés nélkül megmutatja, mi történne (K8 összegzősáv): a szakaszok, a
 * törlendő napok, az érintett keretek és a hibák.
 */
export async function previewLeaveCalendarSave(
	params: LeaveCalendarChangeParams,
	context: RemoteContext
): Promise<LeaveCalendarChangePlan> {
	const input = parseChangeParams(params);
	await requireCapability(context, input.organizationId, 'leave.approve');
	await assertEmployeeInOrganization(context.db, input.employeeId, input.organizationId);
	return planCalendarChanges(context.db, context, input);
}

/**
 * A naptáras módosítások mentése egy tranzakcióban (specs/leave-days.md, 4. fejezet).
 *
 * A törölt napok eltűnnek a leave_days táblából, a kérelmük nem változik (D1).
 * A felvett napokból szakaszonként egy, rögtön jóváhagyott kérelem készül (D7, D8).
 * Ha bármelyik ellenőrzés elbukik, semmi nem mentődik (D10). A végén a dolgozó
 * értesítést kap (D16).
 */
export async function saveLeaveCalendar(
	params: LeaveCalendarChangeParams,
	context: RemoteContext
): Promise<LeaveCalendarSaveResult> {
	const input = parseChangeParams(params);
	if (input.addDays.length === 0 && input.removeDays.length === 0) {
		throw new Error('Nincs mentenivaló módosítás.');
	}
	await requireCapability(context, input.organizationId, 'leave.approve');
	await assertEmployeeInOrganization(context.db, input.employeeId, input.organizationId);
	const userId = await resolveUserId(context);
	const approverEmployeeId = await findEmployeeIdOfUser(context.db, userId, input.organizationId);

	const client = await context.db.connect();
	let plan: LeaveCalendarChangePlan;
	const created: LeaveCalendarSaveResult['createdRequests'] = [];
	try {
		await client.query('BEGIN');
		// A dolgozó sorának zárolása: két egyszerre futó mentés egymás után ellenőriz
		await client.query(`SELECT id FROM ${SCHEMA}.employees WHERE id = $1 FOR UPDATE`, [input.employeeId]);

		plan = await planCalendarChanges(client, context, input);
		if (plan.errors.length > 0) throw new Error(plan.errors.join(' '));

		if (plan.removeDays.length > 0) {
			await client.query(
				`DELETE FROM ${SCHEMA}.leave_days WHERE employee_id = $1 AND day = ANY($2::date[])`,
				[input.employeeId, plan.removeDays.map((r) => r.day)]
			);
		}

		for (const run of plan.runs) {
			const inserted = await client.query(
				`INSERT INTO ${SCHEMA}.leave_requests
					(employee_id, organization_id, leave_type, start_date, end_date, days, status, reason,
					 approved_by, child_id, created_at, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, 'approved', $8, $7, $9, NOW(), NOW())
				 RETURNING id`,
				[
					input.employeeId,
					input.organizationId,
					input.leaveType,
					run.startDate,
					run.endDate,
					run.days.length,
					approverEmployeeId,
					input.reason,
					input.childId
				]
			);
			const requestId: number = inserted.rows[0].id;
			await insertLeaveDays(client, {
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				leaveRequestId: requestId,
				leaveType: input.leaveType,
				days: run.days
			});
			created.push({ id: requestId, startDate: run.startDate, endDate: run.endDate, days: run.days.length });
		}

		const touchedYears = plan.balances.map((b) => b.year);
		if (touchedYears.length > 0) {
			await syncAnnualUsedDays(client, input.employeeId, touchedYears);
		}
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	// A fizetés nélküli szabadság nem munkában töltött idő: csökkenti az éves keretet
	const unpaidTouched =
		(input.leaveType === 'unpaid' && plan.runs.length > 0) ||
		plan.removeDays.some((r) => r.leaveType === 'unpaid');
	if (unpaidTouched) {
		await recalculateEmployeeBalances(context, input.employeeId);
	}

	await notifyLeaveDaysRemoved(context, {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		days: plan.removeDays
	});
	await notifyLeaveDaysAdded(context, {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		leaveType: input.leaveType,
		periods: created
	});

	return { createdRequests: created, removedDays: plan.removeDays.map((r) => r.day) };
}

// ---------------------------------------------------------------------------
// A dolgozó kérelmei a saját naptárból (specs/leave-days.md, K15)
// ---------------------------------------------------------------------------

export interface LeaveRequestBatchParams {
	organizationId: number;
	employeeId: number;
	/** A kért napok típusa (REQUEST_CALENDAR_LEAVE_TYPES). */
	leaveType: string;
	days: string[];
	reason?: string | null;
	/** Apasági és szülői szabadságnál kötelező: melyik gyerek után. */
	childId?: number | null;
}

export interface LeaveRequestBatchResult {
	createdRequests: { id: number; startDate: string; endDate: string; days: number }[];
}

interface RequestBatchInput {
	organizationId: number;
	employeeId: number;
	leaveType: LeaveType;
	days: string[];
	reason: string | null;
	childId: number | null;
}

function parseBatchParams(params: LeaveRequestBatchParams): RequestBatchInput {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!params.employeeId || params.employeeId <= 0) {
		throw new Error('Érvénytelen dolgozó azonosító');
	}
	if (!isLeaveType(params.leaveType) || !REQUEST_CALENDAR_LEAVE_TYPES.includes(params.leaveType)) {
		throw new Error('Ezt a típust a naptárból nem lehet kérni, add be az űrlapon.');
	}
	return {
		organizationId: params.organizationId,
		employeeId: params.employeeId,
		leaveType: params.leaveType,
		days: normalizeDays(Array.isArray(params.days) ? params.days : []),
		reason: params.reason?.trim() || null,
		childId: parseChildId(params.leaveType, params.childId)
	};
}

/** A dolgozó a sajátját kérheti; más nevében a jóváhagyó (mint az űrlapon). */
async function requireOwnOrApprover(context: RemoteContext, input: RequestBatchInput): Promise<void> {
	await requireCapability(context, input.organizationId, 'leave.request');
	if (isDevMode(context) || isCoreAdmin(context)) return;
	const callerUserId = await resolveUserId(context);
	const r = await context.db.query(
		`SELECT user_id FROM ${SCHEMA}.employees WHERE id = $1 AND organization_id = $2`,
		[input.employeeId, input.organizationId]
	);
	if (r.rows.length === 0) throw new Error('A dolgozó nem található ebben a szervezetben');
	if (Number(r.rows[0].user_id) !== Number(callerUserId)) {
		await requireCapability(context, input.organizationId, 'leave.approve');
	}
}

/**
 * A kért napok terve: szakaszok és évenként a keret, a függő kérelmekkel
 * együtt számolva (a dolgozó csak annyit jelölhet, amennyi még van neki).
 */
async function planRequestBatch(
	db: Queryable,
	context: RemoteContext,
	input: RequestBatchInput
): Promise<LeaveCalendarChangePlan> {
	const errors: string[] = [];
	const days = input.days;
	const overrides =
		days.length > 0
			? await getWorkCalendarOverrides(context, input.organizationId, days[0], days[days.length - 1])
			: new Map<string, boolean>();
	const working = (day: string) => isWorkingDay(day, overrides);

	const closedYear = await loadClosedYear(db, input.organizationId);
	const closedDays = days.filter((d) => isDayClosed(d, closedYear));
	if (closedDays.length > 0) {
		errors.push(`A(z) ${closedYear}. évig az évek le vannak zárva: ${closedDays.join(', ')}.`);
	}

	const notWorking = days.filter((d) => !working(d));
	if (notWorking.length > 0) {
		errors.push(`Nem munkanapra nem kérhető szabadság: ${notWorking.join(', ')}.`);
	}
	const taken = await findTakenDays(db, input.employeeId, days);
	if (taken.length > 0) {
		errors.push(`Ezeken a napokon már van jóváhagyott szabadságod: ${taken.join(', ')}.`);
	}
	if (days.length > 0) {
		const pending = await db.query(
			`SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
			   FROM ${SCHEMA}.leave_requests
			  WHERE employee_id = $1 AND status = 'pending'
			    AND start_date <= $3::date AND end_date >= $2::date`,
			[input.employeeId, days[0], days[days.length - 1]]
		);
		const blocked = days.filter((d) => pending.rows.some((r: any) => r.start_date <= d && d <= r.end_date));
		if (blocked.length > 0) {
			errors.push(`Ezekre a napokra már van függő kérelmed: ${blocked.join(', ')}.`);
		}
	}

	// Keret évenként: a maradékból a függő kérelmek napjai is levonva
	const balances: CalendarBalanceEffect[] = [];
	if (consumesAnnualBalance(input.leaveType)) {
		for (const [year, yearDays] of groupDaysByYear(days)) {
			const r = await db.query(
				`SELECT b.remaining_days,
				        COALESCE((SELECT SUM(lr.days) FROM ${SCHEMA}.leave_requests lr
				                   WHERE lr.employee_id = b.employee_id AND lr.status = 'pending'
				                     AND lr.leave_type = ANY($3::text[])
				                     AND EXTRACT(YEAR FROM lr.start_date)::int = b.year), 0)::int AS pending_days
				   FROM ${SCHEMA}.leave_balances b
				  WHERE b.employee_id = $1 AND b.year = $2`,
				[input.employeeId, year, [...BALANCE_LEAVE_TYPES]]
			);
			const hasBalance = r.rows.length > 0;
			const before: number = hasBalance ? r.rows[0].remaining_days - r.rows[0].pending_days : 0;
			const after = before - yearDays.length;
			balances.push({ year, hasBalance, remainingBefore: before, remainingAfter: after });
			if (!hasBalance) {
				errors.push(`Nincs szabadságkeret beállítva a(z) ${year}. évre.`);
			} else if (after < 0) {
				errors.push(
					`A(z) ${year}. évi keretbe nem fér bele: ${yearDays.length} napot kérsz, ${before} nap van (a függő kérelmekkel együtt).`
				);
			}
		}
	}

	const runs = groupIntoRuns(days, working);
	// Beadáskor a függő kérelmek is foglalnak (mint az űrlapon)
	await collectChildLeaveErrors(context, input, runs, true, errors);

	return { runs, removeDays: [], balances, errors };
}

/**
 * Mentés nélkül: a kért napokból készülő kérelmek, a keret és a hibák.
 */
export async function previewLeaveRequestBatch(
	params: LeaveRequestBatchParams,
	context: RemoteContext
): Promise<LeaveCalendarChangePlan> {
	const input = parseBatchParams(params);
	await requireOwnOrApprover(context, input);
	return planRequestBatch(context.db, context, input);
}

/**
 * A naptárban kijelölt napok beküldése: összefüggő szakaszonként egy függő
 * kérelem, egy tranzakcióban. A beadásról egy összevont értesítés megy.
 */
export async function submitLeaveRequestBatch(
	params: LeaveRequestBatchParams,
	context: RemoteContext
): Promise<LeaveRequestBatchResult> {
	const input = parseBatchParams(params);
	if (input.days.length === 0) throw new Error('Jelölj ki legalább egy napot.');
	await requireOwnOrApprover(context, input);

	const client = await context.db.connect();
	const created: LeaveRequestBatchResult['createdRequests'] = [];
	let plan: LeaveCalendarChangePlan;
	try {
		await client.query('BEGIN');
		await client.query(`SELECT id FROM ${SCHEMA}.employees WHERE id = $1 FOR UPDATE`, [input.employeeId]);
		plan = await planRequestBatch(client, context, input);
		if (plan.errors.length > 0) throw new Error(plan.errors.join(' '));

		for (const run of plan.runs) {
			const inserted = await client.query(
				`INSERT INTO ${SCHEMA}.leave_requests
					(employee_id, organization_id, leave_type, start_date, end_date, days, status, reason, child_id,
					 created_at, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, NOW(), NOW())
				 RETURNING id`,
				[
					input.employeeId,
					input.organizationId,
					input.leaveType,
					run.startDate,
					run.endDate,
					run.days.length,
					input.reason,
					input.childId
				]
			);
			created.push({
				id: inserted.rows[0].id,
				startDate: run.startDate,
				endDate: run.endDate,
				days: run.days.length
			});
		}
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	await notifyLeaveRequestsCreated(
		context,
		created.map((r) => ({
			id: r.id,
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			leaveType: input.leaveType,
			startDate: r.startDate,
			endDate: r.endDate,
			days: r.days,
			reason: input.reason
		}))
	);

	return { createdRequests: created };
}
