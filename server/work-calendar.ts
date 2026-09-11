/**
 * Munkanaptár — szervezetenkénti naptári kivételek.
 *
 * A szabadság-számítás alapból csak a hétvégéket zárja ki. Ez a modul tárolja
 * és szolgáltatja azokat a napokat, amelyek ettől eltérnek:
 *
 *   - munkaszüneti nap hétköznap  → nem munkanap
 *   - áthelyezett pihenőnap       → nem munkanap
 *   - áthelyezett munkanap (szombat) → munkanap
 *   - céges nap (pl. üzemszünet)  → jellemzően nem munkanap
 *
 * A munkaszüneti napok kiszámíthatók (fix dátumok + húsvéthoz kötöttek), az
 * áthelyezések viszont évente miniszteri rendeletből jönnek, ezért azokat
 * kézzel kell felvinni.
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';

/** Naptári bejegyzés indoka. */
export type CalendarDayKind =
	| 'public_holiday'
	| 'relocated_rest_day'
	| 'relocated_work_day'
	| 'company_day'
	// Kötelező szabadság: a cég által kijelölt nap, amire mindenkinek szabadságot
	// kell kivennie (pl. a két ünnep között). Munkanap marad (a szabadság rá esik);
	// az app-beli működése később kerül kidolgozásra (specs/leave-days.md).
	| 'mandatory_leave';

const CALENDAR_DAY_KINDS: readonly CalendarDayKind[] = [
	'public_holiday',
	'relocated_rest_day',
	'relocated_work_day',
	'company_day',
	'mandatory_leave'
];

export interface CalendarDay {
	id: number;
	organizationId: number;
	day: string;
	isWorkingDay: boolean;
	kind: CalendarDayKind;
	note: string | null;
}

const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dátum YYYY-MM-DD formára, UTC alapon.
 *
 * @param ms - Unix időbélyeg ezredmásodpercben.
 * @returns A nap ISO formátumban.
 */
function toIsoDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Húsvétvasárnap dátuma egy adott évben (Meeus/Jones/Butcher algoritmus).
 *
 * @param year - A naptári év.
 * @returns A húsvétvasárnap UTC időbélyege ezredmásodpercben.
 */
function easterSundayMs(year: number): number {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = március, 4 = április
	const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
	return Date.UTC(year, month - 1, dayOfMonth);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// MUNKASZÜNETI NAPOK — KARBANTARTANDÓ LISTA
// ============================================================================
//
// FIGYELEM: az alábbi két konstans a magyar Munka törvénykönyve (2012. évi I.
// törvény) 102. § (1) bekezdése szerinti munkaszüneti napokat sorolja fel.
// Ha a jogszabály változik, EZT A KÉT LISTÁT kell módosítani — a kód többi
// része nem tartalmaz dátumot.
//
// Jelenleg ismert nyitott kérdés: december 24. státusza az utóbbi években
// változott, ezért szándékosan NEM szerepel a listában. Mielőtt felvennéd,
// ellenőrizd a hatályos jogszabályban.
//
// Ami NINCS és nem is lehet ebben a listában: az áthelyezett munkanapok
// (ledolgozós szombatok) és az áthelyezett pihenőnapok. Azokat évente
// miniszteri rendelet állapítja meg, semmilyen szabályból nem következnek —
// a munkanaptár felületén kell kézzel felvinni őket.

/**
 * Fix dátumú munkaszüneti napok: [hónap (1-12), nap, megnevezés].
 *
 * Ezek évről évre ugyanarra a naptári napra esnek.
 */
const FIXED_PUBLIC_HOLIDAYS: ReadonlyArray<readonly [number, number, string]> = [
	[1, 1, 'Újév'],
	[3, 15, 'Nemzeti ünnep (március 15.)'],
	[5, 1, 'A munka ünnepe'],
	[8, 20, 'Az államalapítás ünnepe'],
	[10, 23, 'Nemzeti ünnep (október 23.)'],
	[11, 1, 'Mindenszentek'],
	[12, 25, 'Karácsony'],
	[12, 26, 'Karácsony másnapja']
];

/**
 * Húsvéthoz kötött munkaszüneti napok: [eltolás húsvétvasárnaptól, megnevezés].
 *
 * Ezek dátuma évente változik, de az eltolás állandó — a húsvétvasárnapot az
 * easterSundayMs() számítja ki, nem tárolt adatból jön.
 */
const EASTER_RELATIVE_HOLIDAYS: ReadonlyArray<readonly [number, string]> = [
	[-2, 'Nagypéntek'],
	[1, 'Húsvéthétfő'],
	[50, 'Pünkösdhétfő']
];

/**
 * Magyar munkaszüneti napok egy adott évben.
 *
 * Két forrásból áll össze: a FIXED_PUBLIC_HOLIDAYS fix naptári dátumaiból és
 * az EASTER_RELATIVE_HOLIDAYS húsvéthoz viszonyított eltolásaiból.
 *
 * Nem tartalmazza az áthelyezett munkanapokat és pihenőnapokat — lásd a
 * konstansok fölötti megjegyzést.
 *
 * @param year - A naptári év.
 * @returns A munkaszüneti napok ISO dátummal és megnevezéssel, dátum szerint rendezve.
 */
export function hungarianPublicHolidays(year: number): Array<{ day: string; name: string }> {
	const easter = easterSundayMs(year);

	const days: Array<{ day: string; name: string }> = [
		...FIXED_PUBLIC_HOLIDAYS.map(([month, day, name]) => ({
			day: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
			name
		})),
		...EASTER_RELATIVE_HOLIDAYS.map(([offset, name]) => ({
			day: toIsoDay(easter + offset * DAY_MS),
			name
		}))
	];

	return days.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Egy szervezet naptári kivételei egy évre.
 *
 * @param params - A szervezet azonosítója és az év.
 * @param context - Remote futási kontextus.
 * @returns A naptári bejegyzések dátum szerint rendezve.
 */
export async function listCalendarDays(
	params: { organizationId: number; year: number },
	context: RemoteContext
): Promise<CalendarDay[]> {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!Number.isInteger(params.year) || params.year < 1970 || params.year > 2200) {
		throw new Error('Érvénytelen év');
	}

	await requireCapability(context, params.organizationId, 'employee.view');

	const result = await context.db.query(
		`SELECT id, organization_id, day, is_working_day, kind, note
		 FROM app__racona_work.work_calendar_days
		 WHERE organization_id = $1
		   AND day >= $2::date AND day <= $3::date
		 ORDER BY day ASC`,
		[params.organizationId, `${params.year}-01-01`, `${params.year}-12-31`]
	);

	return result.rows.map(mapCalendarRow);
}

/**
 * Naptári bejegyzés létrehozása vagy felülírása.
 *
 * @param params - A nap adatai.
 * @param context - Remote futási kontextus.
 * @returns A mentett bejegyzés.
 */
export async function upsertCalendarDay(
	params: {
		organizationId: number;
		day: string;
		isWorkingDay: boolean;
		kind: CalendarDayKind;
		note?: string;
	},
	context: RemoteContext
): Promise<CalendarDay> {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!DATE_FORMAT_REGEX.test(params.day)) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}
	if (!CALENDAR_DAY_KINDS.includes(params.kind)) {
		throw new Error(`Érvénytelen naptári típus: ${params.kind}`);
	}
	if (typeof params.isWorkingDay !== 'boolean') {
		throw new Error('A munkanap jelző kötelező');
	}

	await requireCapability(context, params.organizationId, 'leave.calendar.manage');

	const result = await context.db.query(
		`INSERT INTO app__racona_work.work_calendar_days
			(organization_id, day, is_working_day, kind, note, created_at, updated_at)
		 VALUES ($1, $2::date, $3, $4, $5, NOW(), NOW())
		 ON CONFLICT (organization_id, day) DO UPDATE
		 SET is_working_day = EXCLUDED.is_working_day,
		     kind = EXCLUDED.kind,
		     note = EXCLUDED.note,
		     updated_at = NOW()
		 RETURNING id, organization_id, day, is_working_day, kind, note`,
		[params.organizationId, params.day, params.isWorkingDay, params.kind, params.note ?? null]
	);

	return mapCalendarRow(result.rows[0]);
}

/**
 * Naptári bejegyzés törlése.
 *
 * @param params - A szervezet azonosítója és a nap.
 * @param context - Remote futási kontextus.
 * @returns Törlődött-e bejegyzés.
 */
export async function deleteCalendarDay(
	params: { organizationId: number; day: string },
	context: RemoteContext
): Promise<{ deleted: boolean }> {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!DATE_FORMAT_REGEX.test(params.day)) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}

	await requireCapability(context, params.organizationId, 'leave.calendar.manage');

	const result = await context.db.query(
		`DELETE FROM app__racona_work.work_calendar_days
		 WHERE organization_id = $1 AND day = $2::date
		 RETURNING id`,
		[params.organizationId, params.day]
	);

	return { deleted: result.rows.length > 0 };
}

/**
 * Egy év munkaszüneti napjainak feltöltése.
 *
 * A már meglévő napokat alapból nem bántja, így év közben újrafuttatható a
 * kézzel felvitt áthelyezések elvesztése nélkül. Az `overwrite` csak a
 * korábban generált munkaszüneti napokat írja felül.
 *
 * @param params - A szervezet azonosítója, az év, és hogy felülírja-e a meglévőket.
 * @param context - Remote futási kontextus.
 * @returns Hány nap került be, illetve lett kihagyva.
 */
export async function generateHungarianHolidays(
	params: { organizationId: number; year: number; overwrite?: boolean },
	context: RemoteContext
): Promise<{ created: number; skipped: number; updated: number }> {
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!Number.isInteger(params.year) || params.year < 1970 || params.year > 2200) {
		throw new Error('Érvénytelen év');
	}

	await requireCapability(context, params.organizationId, 'leave.calendar.manage');

	const holidays = hungarianPublicHolidays(params.year);
	let created = 0;
	let updated = 0;
	let skipped = 0;

	for (const holiday of holidays) {
		if (params.overwrite) {
			const result = await context.db.query(
				`INSERT INTO app__racona_work.work_calendar_days
					(organization_id, day, is_working_day, kind, note, created_at, updated_at)
				 VALUES ($1, $2::date, FALSE, 'public_holiday', $3, NOW(), NOW())
				 ON CONFLICT (organization_id, day) DO UPDATE
				 SET is_working_day = FALSE, kind = 'public_holiday', note = EXCLUDED.note, updated_at = NOW()
				 RETURNING (xmax = 0) AS inserted`,
				[params.organizationId, holiday.day, holiday.name]
			);
			if (result.rows[0]?.inserted) created++;
			else updated++;
		} else {
			const result = await context.db.query(
				`INSERT INTO app__racona_work.work_calendar_days
					(organization_id, day, is_working_day, kind, note, created_at, updated_at)
				 VALUES ($1, $2::date, FALSE, 'public_holiday', $3, NOW(), NOW())
				 ON CONFLICT (organization_id, day) DO NOTHING
				 RETURNING id`,
				[params.organizationId, holiday.day, holiday.name]
			);
			if (result.rows.length > 0) created++;
			else skipped++;
		}
	}

	return { created, skipped, updated };
}

/**
 * Naptári kivételek egy dátumtartományra, a munkanap-számításnak.
 *
 * @param context - Remote futási kontextus.
 * @param organizationId - A szervezet azonosítója.
 * @param startDate - Tartomány kezdete (YYYY-MM-DD).
 * @param endDate - Tartomány vége (YYYY-MM-DD).
 * @returns Nap → munkanap-e leképezés.
 */
export async function getWorkCalendarOverrides(
	context: RemoteContext,
	organizationId: number,
	startDate: string,
	endDate: string
): Promise<Map<string, boolean>> {
	const result = await context.db.query(
		`SELECT day, is_working_day
		 FROM app__racona_work.work_calendar_days
		 WHERE organization_id = $1 AND day >= $2::date AND day <= $3::date`,
		[organizationId, startDate, endDate]
	);

	const overrides = new Map<string, boolean>();
	for (const row of result.rows as Array<{ day: string | Date; is_working_day: boolean }>) {
		overrides.set(normalizeDay(row.day), row.is_working_day);
	}
	return overrides;
}

/**
 * A pg DATE oszlopot Date-ként is visszaadhatja — egységes ISO napra hozzuk.
 *
 * @param value - A nyers érték az adatbázisból.
 * @returns A nap YYYY-MM-DD formában.
 */
function normalizeDay(value: string | Date): string {
	if (value instanceof Date) {
		return toIsoDay(
			Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
		);
	}
	return String(value).slice(0, 10);
}

/**
 * Adatbázis sor leképezése.
 *
 * @param row - A nyers sor.
 * @returns A naptári bejegyzés.
 */
function mapCalendarRow(row: {
	id: number;
	organization_id: number;
	day: string | Date;
	is_working_day: boolean;
	kind: string;
	note: string | null;
}): CalendarDay {
	return {
		id: row.id,
		organizationId: row.organization_id,
		day: normalizeDay(row.day),
		isWorkingDay: row.is_working_day,
		kind: row.kind as CalendarDayKind,
		note: row.note ?? null
	};
}
