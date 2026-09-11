/**
 * Szabadságnapok — a jóváhagyott szabadság napszintű tárolása (leave_days).
 *
 * A kérelem (leave_requests) beadott, utólag nem módosuló meta sor; a tényleges
 * szabadság minden munkanapja külön sor ebben a táblában. Ez az igazságforrás
 * a keretek felhasználásához, az áthozott napokhoz, a betegszabadsághoz, a
 * dashboardhoz és a naptárhoz.
 *
 * A fájl első fele tiszta (adatbázis nélküli) segédfüggvény — a kliens is
 * importálhatja, és a tests/leave-days.test.ts teszteli. A második fele az
 * adatbázis-műveletek, amiket a leave.ts hív. Részletek: specs/leave-days.md
 */

import type { RemoteContext } from './context.js';
import { hasCapability, requireCapability } from './permissions.js';
import { getWorkCalendarOverrides } from './work-calendar.js';

// ---------------------------------------------------------------------------
// Tiszta segédfüggvények
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Egy összefüggő szabadságszakasz a naptárban felvett napokból. */
export interface LeaveRun {
	/** Az első felvett nap (YYYY-MM-DD). */
	startDate: string;
	/** Az utolsó felvett nap (YYYY-MM-DD). */
	endDate: string;
	/** A szakasz napjai növekvő sorrendben. */
	days: string[];
}

/** Naptári napok szerint összefüggő időszak. */
export interface DayPeriod {
	from: string;
	to: string;
}

function dayMs(isoDay: string): number {
	const [y, m, d] = isoDay.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

function msToIsoDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A nap után következő nap.
 *
 * @param isoDay - A nap YYYY-MM-DD formában.
 * @returns A következő nap YYYY-MM-DD formában.
 */
export function nextDay(isoDay: string): string {
	return msToIsoDay(dayMs(isoDay) + DAY_MS);
}

/**
 * Munkanap-e a nap: a munkanaptári kivétel dönt, ha van; egyébként a hétvége
 * nem munkanap.
 *
 * @param isoDay - A nap YYYY-MM-DD formában.
 * @param overrides - Nap → munkanap-e leképezés a munkanaptárból.
 * @returns Igaz, ha munkanap.
 */
export function isWorkingDay(isoDay: string, overrides?: Map<string, boolean>): boolean {
	const override = overrides?.get(isoDay);
	if (override !== undefined) return override;
	const dow = new Date(dayMs(isoDay)).getUTCDay();
	return dow !== 0 && dow !== 6;
}

/**
 * Egy időszak munkanapjai.
 *
 * Alapszabály: a hétvége nem munkanap. Az `overrides` ezt felülírja naponként —
 * innen jönnek a munkaszüneti napok (hétköznap, mégsem munkanap) és az
 * áthelyezett munkanapok (szombat, mégis munkanap). UTC alapú iteráció, hogy a
 * téli-nyári időszámítás ne okozzon eltolódást.
 *
 * @param startDate - Kezdő dátum (YYYY-MM-DD).
 * @param endDate - Záró dátum (YYYY-MM-DD).
 * @param overrides - Nap → munkanap-e leképezés; hiányzó napra a hétvége-szabály dönt.
 * @returns A munkanapok növekvő sorrendben; üres, ha a kezdő nap a záró után van.
 * @throws Ha a dátum formátuma nem YYYY-MM-DD.
 */
export function listWorkingDays(
	startDate: string,
	endDate: string,
	overrides?: Map<string, boolean>
): string[] {
	if (!ISO_DAY.test(startDate) || !ISO_DAY.test(endDate)) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}
	const startMs = dayMs(startDate);
	const endMs = dayMs(endDate);
	if (isNaN(startMs) || isNaN(endMs)) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}

	const days: string[] = [];
	for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
		const iso = msToIsoDay(ms);
		if (isWorkingDay(iso, overrides)) days.push(iso);
	}
	return days;
}

/**
 * Rendezett, ismétlés nélküli naplista.
 *
 * @param days - Napok YYYY-MM-DD formában, tetszőleges sorrendben.
 * @returns Növekvő sorrend, minden nap egyszer.
 * @throws Ha valamelyik nap formátuma nem YYYY-MM-DD.
 */
export function normalizeDays(days: string[]): string[] {
	for (const day of days) {
		if (typeof day !== 'string' || !ISO_DAY.test(day) || msToIsoDay(dayMs(day)) !== day) {
			throw new Error(`Érvénytelen nap: ${String(day)}`);
		}
	}
	return [...new Set(days)].sort();
}

/**
 * A felvett napok összefüggő szakaszokra bontása (specs/leave-days.md, D7).
 *
 * Két felvett nap egy szakaszban van, ha köztük csak nem munkanap áll: a
 * hétvége és a munkaszüneti nap nem szakít. Péntek és a következő hétfő így egy
 * szakasz, ahogy egy kézzel beadott kérelemnél is. Egy kihagyott munkanap új
 * szakaszt kezd.
 *
 * @param days - A felvett napok, tetszőleges sorrendben, ismétléssel is.
 * @param isWorking - Munkanap-e a nap (a hívó adja a munkanaptárral).
 * @returns A szakaszok növekvő sorrendben.
 */
export function groupIntoRuns(days: string[], isWorking: (isoDay: string) => boolean): LeaveRun[] {
	const sorted = normalizeDays(days);
	const runs: LeaveRun[] = [];
	let current: LeaveRun | null = null;

	for (const day of sorted) {
		if (current && !hasWorkingDayBetween(current.endDate, day, isWorking)) {
			current.endDate = day;
			current.days.push(day);
		} else {
			current = { startDate: day, endDate: day, days: [day] };
			runs.push(current);
		}
	}
	return runs;
}

/** Van-e munkanap két nap között (a két napot nem számítva). */
function hasWorkingDayBetween(
	from: string,
	to: string,
	isWorking: (isoDay: string) => boolean
): boolean {
	for (let ms = dayMs(from) + DAY_MS; ms < dayMs(to); ms += DAY_MS) {
		if (isWorking(msToIsoDay(ms))) return true;
	}
	return false;
}

/**
 * Naptári napok szerint összefüggő időszakok a napokból.
 *
 * A fizetés nélküli szabadság napjait így adjuk át a keretszámításnak, ami
 * időszakokkal dolgozik (a naptári napokat számolja, a hétvégével együtt).
 * A hétvége itt szakít: egy hétfő–péntek és a rá következő hétfő–péntek két
 * időszak, mert a köztes hétvége nem szabadságnap.
 *
 * @param days - Napok YYYY-MM-DD formában, tetszőleges sorrendben.
 * @returns Az időszakok növekvő sorrendben.
 */
export function daysToPeriods(days: string[]): DayPeriod[] {
	const sorted = normalizeDays(days);
	const periods: DayPeriod[] = [];
	let current: DayPeriod | null = null;

	for (const day of sorted) {
		if (current && nextDay(current.to) === day) {
			current.to = day;
		} else {
			current = { from: day, to: day };
			periods.push(current);
		}
	}
	return periods;
}

/**
 * Napok évenként csoportosítva (az éves keret az adott év napjait terheli).
 *
 * @param days - Napok YYYY-MM-DD formában.
 * @returns Év → napok.
 */
export function groupDaysByYear(days: string[]): Map<number, string[]> {
	const byYear = new Map<number, string[]>();
	for (const day of days) {
		const year = Number(day.slice(0, 4));
		if (!byYear.has(year)) byYear.set(year, []);
		byYear.get(year)!.push(day);
	}
	return byYear;
}

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
		return msToIsoDay(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
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
		               AND ld.leave_type = 'annual'
		               AND EXTRACT(YEAR FROM ld.day)::int = b.year
		        ),
		        updated_at = NOW()
		  WHERE b.employee_id = $1 AND b.year = ANY($2::int[])`,
		[employeeId, unique]
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
	/** Csak leave.approve joggal van kitöltve; a kollégák nem látják a típust. */
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
}

/** Legfeljebb ennyi nap kérhető le egyszerre (két hónap). */
const MAX_CALENDAR_DAYS = 62;

/**
 * A szabadságnaptár egy időszakra (specs/leave-days.md, K5).
 *
 * Aki `leave.request` joggal belép, látja, ki mikor van távol; a típust csak
 * a `leave.approve` jog mutatja (a betegszabadság egészségügyi adat). A függő
 * kérelmek napjait a kérelem időszakából számoljuk a munkanaptárral.
 *
 * @param params - A szervezet, az időszak (legfeljebb 62 nap) és a dolgozószűrő.
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
	if ((dayMs(to) - dayMs(from)) / DAY_MS + 1 > MAX_CALENDAR_DAYS) {
		throw new Error(`Egyszerre legfeljebb ${MAX_CALENDAR_DAYS} nap kérhető le.`);
	}

	await requireCapability(context, organizationId, 'leave.request');
	const canManage = await hasCapability(context, organizationId, 'leave.approve');

	const employeeFilter = params.employeeId ? Number(params.employeeId) : null;
	const conditions = ['e.organization_id = $1'];
	const queryParams: unknown[] = [organizationId, from, to];
	if (employeeFilter) {
		conditions.push('e.id = $4');
		queryParams.push(employeeFilter);
	}
	const where = conditions.join(' AND ');

	const [daysResult, pendingResult, overrides] = await Promise.all([
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
			  WHERE ${where} AND lr.status = 'pending'
			    AND lr.start_date <= $3::date AND lr.end_date >= $2::date
			  ORDER BY lr.start_date, u.full_name`,
			queryParams
		),
		getWorkCalendarOverrides(context, organizationId, from, to)
	]);

	const days: LeaveCalendarDay[] = daysResult.rows.map((row: any) => ({
		day: row.day,
		employeeId: row.employee_id,
		employeeName: row.employee_name ?? '—',
		leaveType: canManage ? row.leave_type : null,
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
				leaveType: canManage ? row.leave_type : null,
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
		canManage
	};
}
