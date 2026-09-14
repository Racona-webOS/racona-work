/**
 * NAV üzemanyagárak félautomata lekérése (K14, D7).
 *
 * A HR a beállításokban kéri le az adott év árait a NAV oldaláról. Először
 * előnézetet kap (`previewNavFuelPrices`): a NAV táblázatának oszlopait, a
 * javasolt vagy a legutóbb használt oszlop-hozzárendelést, és a mostani árakat.
 * Kitöltéskor (`applyNavFuelPrices`) a szerver újra a NAV adataiból számol, nem a
 * klienstől fogad el árat:
 *   - az üres hónapokat kitölti;
 *   - eltérő árat csak akkor ír felül, ha a HR kérte (a kliens a korábban is
 *     NAV-ból jött árakat alapból bejelöli, a kézzel beírtakat nem);
 *   - jóváhagyott rendelvény árát nem módosítja (K14).
 *
 * A NAV oldala szervezetfüggetlen, ezért a letöltött táblázat a folyamatban
 * közös, rövid ideig élő gyorsítótárban van. Így az előnézet és a kitöltés
 * ugyanarra az adatra vonatkozik (a `version` ezt ellenőrzi).
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { requireCapability } from './permissions.js';
import { SCHEMA, num, requireOrganizationId } from './trip-access.js';
import { ENABLED_PRICE_TYPES, isPriceType } from './trip-calc.js';
import type { PriceType } from './trip-calc.js';
import { loadTripPolicy, storeTripPolicy } from './trip-settings.js';
import {
	NAV_BASE_URL,
	NAV_INDEX_PATH,
	NavParseError,
	cellId,
	findArchivePage,
	findYearPage,
	normalizeMapping,
	parseNavFuelTable,
	planNavImport,
	resolveMapping,
	tableVersion
} from './nav-fuel.js';
import type { CurrentFuelPrice, NavFuelTable, NavPriceMapping } from './nav-fuel.js';

const USER_AGENT = 'RaconaWork/1.0 (Racona webOS plugin; NAV fuel prices)';
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60_000;

export const NAV_UNAVAILABLE =
	'A NAV oldala most nem érhető el. Próbáld újra később, vagy rögzítsd az árakat kézzel.';

interface CachedTable {
	table: NavFuelTable;
	version: string;
	sourceUrl: string;
	fetchedAt: string;
	expires: number;
}

const tableCache = new Map<number, CachedTable>();

async function fetchNavPage(path: string): Promise<string> {
	let response: Response;
	try {
		response = await fetch(NAV_BASE_URL + path, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch {
		throw new Error(NAV_UNAVAILABLE);
	}
	if (!response.ok || (response.url && !response.url.startsWith(NAV_BASE_URL + '/'))) {
		throw new Error(NAV_UNAVAILABLE);
	}
	return response.text();
}

/** Az év oldala: a gyűjtőoldalon, ha ott nincs, a „Korábbi években” oldalon keressük. */
async function findYearPath(year: number): Promise<string> {
	const index = await fetchNavPage(NAV_INDEX_PATH);
	const direct = findYearPage(index, year);
	if (direct) return direct;
	const archive = findArchivePage(index);
	if (archive) {
		const older = findYearPage(await fetchNavPage(archive), year);
		if (older) return older;
	}
	throw new NavParseError(`A NAV oldalán még nincs ${year}. évi ártáblázat.`);
}

async function loadNavTable(year: number, refresh = false): Promise<CachedTable> {
	const cached = tableCache.get(year);
	if (cached && !refresh && cached.expires > Date.now()) return cached;

	const path = await findYearPath(year);
	const table = parseNavFuelTable(await fetchNavPage(path), year);
	if (table.rows.length === 0) throw new NavParseError(`A NAV ${year}. évi táblázatában még nincs ár.`);
	const entry: CachedTable = {
		table,
		version: tableVersion(table),
		sourceUrl: NAV_BASE_URL + path,
		fetchedAt: new Date().toISOString(),
		expires: Date.now() + CACHE_TTL_MS
	};
	tableCache.set(year, entry);
	return entry;
}

function requireYear(value: unknown): number {
	const year = Number(value);
	if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Érvénytelen év');
	return year;
}

type Db = Pick<RemoteContext['db'], 'query'>;

async function loadCurrentPrices(db: Db, organizationId: number, year: number, forUpdate = false): Promise<CurrentFuelPrice[]> {
	const r = await db.query(
		`SELECT month, price_type, price_huf, source
		   FROM ${SCHEMA}.trip_fuel_prices
		  WHERE organization_id = $1 AND year = $2${forUpdate ? ' FOR UPDATE' : ''}`,
		[organizationId, year]
	);
	return r.rows
		.filter((row: any) => isPriceType(row.price_type))
		.map((row: any) => ({
			month: row.month,
			priceType: row.price_type as PriceType,
			priceHuf: num(row.price_huf) ?? 0,
			source: row.source === 'nav' ? 'nav' : 'manual'
		}));
}

/** Hónapok és ártípusok, amelyekre jóváhagyott vagy kifizetett rendelvény van (K14). */
async function loadLockedCells(db: Db, organizationId: number, year: number): Promise<{ month: number; priceType: PriceType }[]> {
	const r = await db.query(
		`SELECT DISTINCT month, snapshot->'vehicle'->>'priceType' AS price_type
		   FROM ${SCHEMA}.trip_settlements
		  WHERE organization_id = $1 AND year = $2 AND status IN ('approved', 'paid')`,
		[organizationId, year]
	);
	return r.rows
		.filter((row: any) => isPriceType(row.price_type))
		.map((row: any) => ({ month: row.month, priceType: row.price_type as PriceType }));
}

export interface NavFuelPreview {
	year: number;
	sourceUrl: string;
	fetchedAt: string;
	version: string;
	table: NavFuelTable;
	/** A kitölthető ártípusok (az engedélyezett üzemanyagokéi). */
	priceTypes: PriceType[];
	/** A legutóbb használt hozzárendelés erre a táblázatra, vagy a javaslat. */
	mapping: NavPriceMapping;
	/** A legutóbbi hozzárendelés oszlopai közül valamelyik már nincs a táblázatban. */
	mappingChanged: boolean;
	current: CurrentFuelPrice[];
	locked: { month: number; priceType: PriceType }[];
}

export async function previewNavFuelPrices(
	params: { organizationId: number; year: number; refresh?: boolean },
	context: RemoteContext
): Promise<NavFuelPreview> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.manage');
	const year = requireYear(params.year);

	const nav = await loadNavTable(year, params.refresh === true);
	const policy = await loadTripPolicy(context, organizationId);
	const { mapping, changed } = resolveMapping(policy.navPriceMapping, nav.table.columns, ENABLED_PRICE_TYPES);
	const [current, locked] = await Promise.all([
		loadCurrentPrices(context.db, organizationId, year),
		loadLockedCells(context.db, organizationId, year)
	]);
	return {
		year,
		sourceUrl: nav.sourceUrl,
		fetchedAt: nav.fetchedAt,
		version: nav.version,
		table: nav.table,
		priceTypes: ENABLED_PRICE_TYPES,
		mapping,
		mappingChanged: changed,
		current,
		locked
	};
}

export interface NavFuelApplyResult {
	filled: number;
	overwritten: number;
	/** Eltérő, de felülírásra nem kijelölt vagy zárolt árak. */
	skipped: number;
}

export async function applyNavFuelPrices(
	params: {
		organizationId: number;
		year: number;
		version: string;
		mapping: NavPriceMapping;
		overwrite?: { month: number; priceType: string }[];
	},
	context: RemoteContext
): Promise<NavFuelApplyResult> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'trip.manage');
	const year = requireYear(params.year);

	const nav = await loadNavTable(year);
	if (nav.version !== params.version) {
		throw new Error('A NAV adatai közben megváltoztak. Kérd le újra, és nézd át az előnézetet.');
	}
	const known = new Set(nav.table.columns.map((c) => c.key));
	const requested = normalizeMapping(params.mapping, ENABLED_PRICE_TYPES);
	const mapping: NavPriceMapping = {};
	for (const type of ENABLED_PRICE_TYPES) {
		const keys = requested[type] ?? [];
		if (keys.some((k) => !known.has(k))) throw new Error('A kiválasztott NAV-oszlop nincs a táblázatban.');
		mapping[type] = keys;
	}
	const overwrite = new Set(
		(Array.isArray(params.overwrite) ? params.overwrite : [])
			.filter((c) => isPriceType(c?.priceType))
			.map((c) => cellId(Number(c.month), c.priceType as PriceType))
	);

	const userId = await resolveUserId(context);
	const policy = await loadTripPolicy(context, organizationId);
	const client = await context.db.connect();
	try {
		await client.query('BEGIN');
		const current = await loadCurrentPrices(client, organizationId, year, true);
		const locked = await loadLockedCells(client, organizationId, year);
		const plan = planNavImport(nav.table, mapping, ENABLED_PRICE_TYPES, current, locked);

		const result: NavFuelApplyResult = { filled: 0, overwritten: 0, skipped: 0 };
		for (const cell of plan) {
			const write =
				cell.status === 'new' || (cell.status === 'differs' && overwrite.has(cellId(cell.month, cell.priceType)));
			if (!write) {
				if (cell.status === 'differs' || cell.status === 'locked') result.skipped++;
				continue;
			}
			await client.query(
				`INSERT INTO ${SCHEMA}.trip_fuel_prices (organization_id, year, month, price_type, price_huf, source, updated_by, updated_at)
				 VALUES ($1, $2, $3, $4, $5, 'nav', $6, NOW())
				 ON CONFLICT (organization_id, year, month, price_type)
				 DO UPDATE SET price_huf = EXCLUDED.price_huf, source = 'nav', updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
				[organizationId, year, cell.month, cell.priceType, Math.round(cell.navPrice! * 100) / 100, userId]
			);
			if (cell.status === 'new') result.filled++;
			else result.overwritten++;
		}

		await storeTripPolicy(client, organizationId, { ...policy, navPriceMapping: { ...policy.navPriceMapping, ...mapping } });

		await client.query('COMMIT');
		return result;
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}
