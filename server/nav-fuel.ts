/**
 * NAV üzemanyagárak — a NAV weboldalának feldolgozása (tiszta függvények, a kliens is importálja).
 *
 * A NAV-nak nincs API-ja: az árakat évenként egy weboldalon, HTML-táblázatban
 * közli (nav.gov.hu/ugyfeliranytu/uzemanyag). A táblázat oszlopai évről évre
 * változnak (2022-ben hatósági és piaci ár, 2026-ban védett és piaci ár), ezért
 * nem égetünk be oszlopot: a HR mondja meg, melyik NAV-oszlop melyik ártípusunkat
 * tölti ki, és ha az üres, melyik a tartalék (`NavPriceMapping`).
 *
 * Ha a táblázat szerkezete nem ismerhető fel, hibát dobunk, és semmit nem írunk.
 * Részletek: specs/business-trips.md (K14, D7)
 */

import type { PriceType } from './trip-calc.js';

export const NAV_BASE_URL = 'https://nav.gov.hu';
export const NAV_INDEX_PATH = '/ugyfeliranytu/uzemanyag';

/** A mentett ár felső határa (Ft/l, Ft/kg), ugyanaz, mint a kézi rögzítésnél. */
export const MAX_PRICE_HUF = 10_000;

export interface NavFuelColumn {
	/** Stabil azonosító a fejléc szövegéből (ékezet nélkül, kötőjellel). */
	key: string;
	/** A fejléc szövege, ahogy a NAV oldalán áll. */
	label: string;
}

export interface NavFuelRow {
	month: number;
	/** Az oszlopok sorrendjében; null, ha a NAV nem közölt árat („-”). */
	values: (number | null)[];
}

export interface NavFuelTable {
	year: number;
	columns: NavFuelColumn[];
	rows: NavFuelRow[];
	/** Nem értelmezhető cellák (pl. szöveg szám helyett). Ezeket nem töltjük ki. */
	invalidCells: { month: number; columnKey: string; raw: string }[];
}

/** Ártípusonként a NAV-oszlopok kulcsai elsőbbségi sorrendben (első az elsődleges, a többi tartalék). */
export type NavPriceMapping = Partial<Record<PriceType, string[]>>;

export class NavParseError extends Error {}

const MONTHS = [
	'januar',
	'februar',
	'marcius',
	'aprilis',
	'majus',
	'junius',
	'julius',
	'augusztus',
	'szeptember',
	'oktober',
	'november',
	'december'
];

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	aacute: 'á',
	Aacute: 'Á',
	eacute: 'é',
	Eacute: 'É',
	iacute: 'í',
	Iacute: 'Í',
	oacute: 'ó',
	Oacute: 'Ó',
	ouml: 'ö',
	Ouml: 'Ö',
	odblac: 'ő',
	Odblac: 'Ő',
	uacute: 'ú',
	Uacute: 'Ú',
	uuml: 'ü',
	Uuml: 'Ü',
	udblac: 'ű',
	Udblac: 'Ű',
	ndash: '–',
	mdash: '—'
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
		if (code[0] === '#') {
			const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(n) ? String.fromCodePoint(n) : match;
		}
		return NAMED_ENTITIES[code] ?? match;
	});
}

/** Egy HTML-darab szövege: a sortörés szóköz lesz, a címkék eltűnnek, a szóközök összevonódnak. */
export function htmlText(fragment: string): string {
	const text = fragment
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<\/(p|div|li)>/gi, ' ')
		.replace(/<[^>]*>/g, '');
	return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function fold(text: string): string {
	return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** A fejléc szövegéből képzett azonosító: „Gázolaj (védett ár) (Ft/l)” → `gazolaj-vedett-ar-ft-l`. */
export function columnKey(label: string): string {
	return fold(label)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * A fejléc zárójeles megkülönböztetője, a mértékegység nélkül:
 * „Gázolaj (védett ár) (Ft/l)” → „védett ár”. Null, ha nincs ilyen.
 */
export function columnQualifier(label: string): string | null {
	const parts = [...label.matchAll(/\(([^)]*)\)/g)]
		.map((m) => m[1].trim())
		.filter((p) => p && !/ft\s*\//i.test(p));
	return parts.length > 0 ? parts.join(', ') : null;
}

function monthOf(text: string): number | null {
	const index = MONTHS.indexOf(fold(text).replace(/\(.*?\)/g, '').replace(/[^a-z]/g, ''));
	return index === -1 ? null : index + 1;
}

/** Egy ár-cella: szám, null („-” vagy üres), vagy undefined, ha nem értelmezhető. */
function parsePrice(text: string): number | null | undefined {
	const value = text.replace(/\s/g, '');
	if (value === '' || /^[-–—]+$/.test(value)) return null;
	const normalized = value.replace(',', '.');
	if (!/^\d+(\.\d+)?$/.test(normalized)) return undefined;
	const n = Number(normalized);
	return n > 0 && n <= MAX_PRICE_HUF ? n : undefined;
}

function tableRows(table: string): { cells: string[]; spans: boolean }[] {
	return [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => {
		const cells = [...m[0].matchAll(/<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)];
		return {
			cells: cells.map((c) => htmlText(c[3])),
			spans: cells.some((c) => /\b(colspan|rowspan)\s*=\s*["']?([2-9]|\d{2,})/i.test(c[2]))
		};
	});
}

/**
 * Az ártáblázat az oldalból. Azt a táblázatot keresi, amelynek sorai hónapnevekkel
 * kezdődnek; a fejléce a hónapok előtti sor. Ha a fejlécben évszám áll, annak
 * egyeznie kell a kért évvel.
 */
export function parseNavFuelTable(html: string, year: number): NavFuelTable {
	for (const match of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
		const rows = tableRows(match[0]);
		const firstMonth = rows.findIndex((r) => r.cells.length > 1 && monthOf(r.cells[0]) !== null);
		if (firstMonth < 1) continue;

		const header = rows[firstMonth - 1];
		if (header.cells.length < 2) continue;
		if (rows.some((r) => r.spans)) {
			throw new NavParseError('A NAV ártáblázatának szerkezete megváltozott (összevont cellák). Az árakat most kézzel kell rögzíteni.');
		}
		const headerYear = header.cells[0].match(/\b(20\d{2})\b/);
		if (headerYear && Number(headerYear[1]) !== year) {
			throw new NavParseError(`A NAV oldalán a(z) ${headerYear[1]}. évi táblázat van, nem a(z) ${year}. évi.`);
		}

		const columns: NavFuelColumn[] = [];
		for (const label of header.cells.slice(1)) {
			const base = columnKey(label) || 'oszlop';
			let key = base;
			for (let n = 2; columns.some((c) => c.key === key); n++) key = `${base}-${n}`;
			columns.push({ key, label });
		}

		const result: NavFuelTable = { year, columns, rows: [], invalidCells: [] };
		for (const row of rows.slice(firstMonth)) {
			const month = monthOf(row.cells[0] ?? '');
			if (month === null) continue;
			// Pl. „december (2024)” a 2025-ös táblázat végén: az előző év sora, kihagyjuk.
			const rowYear = (row.cells[0] ?? '').match(/\b(20\d{2})\b/);
			if (rowYear && Number(rowYear[1]) !== year) continue;
			if (result.rows.some((r) => r.month === month)) {
				throw new NavParseError(`A NAV ártáblázatában kétszer szerepel ugyanaz a hónap (${month}.).`);
			}
			const values = columns.map((column, i) => {
				const raw = row.cells[i + 1] ?? '';
				const price = parsePrice(raw);
				if (price === undefined) {
					result.invalidCells.push({ month, columnKey: column.key, raw });
					return null;
				}
				return price;
			});
			result.rows.push({ month, values });
		}
		result.rows.sort((a, b) => a.month - b.month);
		return result;
	}
	throw new NavParseError(`A NAV oldalán nem találtam a(z) ${year}. évi ártáblázatot.`);
}

export interface NavLink {
	href: string;
	text: string;
}

/** Az oldal linkjei (href és a link szövege). */
export function extractLinks(html: string): NavLink[] {
	return [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
		href: decodeEntities(m[1]),
		text: htmlText(m[2])
	}));
}

/**
 * A NAV saját üzemanyag-oldalára mutató relatív link (más helyre nem megyünk el).
 * Null, ha a link nem ilyen.
 */
export function navPath(href: string): string | null {
	const path = href.startsWith(NAV_BASE_URL + '/') ? href.slice(NAV_BASE_URL.length) : href;
	if (!path.startsWith(NAV_INDEX_PATH + '/') || /[\s?#]|\.\./.test(path)) return null;
	return path;
}

/** Az adott év oldalának linkje („2026-ban alkalmazható üzemanyagárak”), vagy null. */
export function findYearPage(html: string, year: number): string | null {
	const pattern = new RegExp(`^${year}\\s*-\\s*(ban|ben)\\s+alkalmaz(hato|ott)\\s+uzemanyagar`, 'i');
	for (const link of extractLinks(html)) {
		const path = navPath(link.href);
		if (path && pattern.test(fold(link.text))) return path;
	}
	return null;
}

/** A „Korábbi években alkalmazott üzemanyagárak” oldal linkje, vagy null. */
export function findArchivePage(html: string): string | null {
	for (const link of extractLinks(html)) {
		const path = navPath(link.href);
		if (path && /korabbi\s+evekben/.test(fold(link.text))) return path;
	}
	return null;
}

// --- Oszlop-hozzárendelés -----------------------------------------------------

const PRICE_TYPE_KEYWORDS: Record<PriceType, RegExp> = {
	petrol: /benzin|esz-95/,
	diesel: /gazolaj/,
	mixed: /keverek/,
	lpg: /lpg/,
	cng: /cng/,
	electricity: /elektromos|villamos|aram/
};

/** Kedvezményes ár (védett, hatósági): ha van, ez az elsődleges. */
const PREFERRED_KEYWORDS = /vedett|hatosagi/;

/**
 * Javasolt hozzárendelés a fejlécek alapján: az ártípus oszlopai közül a védett
 * vagy hatósági ár az első, a többi a tartalék (legfeljebb kettő összesen).
 */
export function suggestMapping(columns: NavFuelColumn[], priceTypes: PriceType[]): NavPriceMapping {
	const mapping: NavPriceMapping = {};
	for (const type of priceTypes) {
		const candidates = columns.filter((c) => PRICE_TYPE_KEYWORDS[type].test(c.key));
		const ordered = [
			...candidates.filter((c) => PREFERRED_KEYWORDS.test(c.key)),
			...candidates.filter((c) => !PREFERRED_KEYWORDS.test(c.key))
		];
		mapping[type] = ordered.slice(0, 2).map((c) => c.key);
	}
	return mapping;
}

/** Tisztított hozzárendelés: csak ismert ártípusok, legfeljebb két, ismétlés nélküli oszlopkulcs. */
export function normalizeMapping(raw: unknown, priceTypes: readonly PriceType[]): NavPriceMapping {
	const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const mapping: NavPriceMapping = {};
	for (const type of priceTypes) {
		const keys = Array.isArray(value[type]) ? (value[type] as unknown[]) : [];
		const clean = keys.filter((k): k is string => typeof k === 'string' && /^[a-z0-9-]{1,120}$/.test(k));
		mapping[type] = [...new Set(clean)].slice(0, 2);
	}
	return mapping;
}

/**
 * A mentett hozzárendelés erre a táblázatra. Az eltűnt oszlopokat elhagyja; ha egy
 * ártípusnak így nem marad oszlopa, a javaslatot adja, és jelzi, hogy ellenőrizni kell.
 */
export function resolveMapping(
	saved: NavPriceMapping | undefined,
	columns: NavFuelColumn[],
	priceTypes: PriceType[]
): { mapping: NavPriceMapping; changed: boolean } {
	const suggested = suggestMapping(columns, priceTypes);
	const known = new Set(columns.map((c) => c.key));
	const mapping: NavPriceMapping = {};
	let changed = false;
	for (const type of priceTypes) {
		const previous = saved?.[type] ?? [];
		const kept = previous.filter((k) => known.has(k));
		if (previous.length > 0 && kept.length < previous.length) changed = true;
		mapping[type] = kept.length > 0 ? kept : (suggested[type] ?? []);
	}
	return { mapping, changed };
}

// --- Kitöltési terv ---------------------------------------------------------------

export type NavImportStatus =
	/** Nálunk még nincs ár: kitöltjük. */
	| 'new'
	/** Ugyanaz az ár: nincs teendő. */
	| 'same'
	/** Más ár van rögzítve: csak jóváhagyással írjuk felül. */
	| 'differs'
	/** Jóváhagyott rendelvény használja: nem módosítható (K14). */
	| 'locked'
	/** A NAV nem közölt árat a kiválasztott oszlopokban. */
	| 'missing'
	/** A kiválasztott NAV-cella nem értelmezhető. */
	| 'invalid';

export interface NavImportCell {
	month: number;
	priceType: PriceType;
	navPrice: number | null;
	/** Melyik oszlopból jött az ár (tartalék esetén nem az első). */
	columnKey: string | null;
	fallback: boolean;
	current: number | null;
	currentSource: 'manual' | 'nav' | null;
	status: NavImportStatus;
}

export interface CurrentFuelPrice {
	month: number;
	priceType: PriceType;
	priceHuf: number;
	source: 'manual' | 'nav';
}

export const cellId = (month: number, priceType: PriceType) => `${month}:${priceType}`;

/**
 * Hónaponként és ártípusonként mi történne. A cella árát az első olyan kiválasztott
 * oszlop adja, amelyben van ár; ha az elsőbbségi oszlop cellája nem értelmezhető,
 * nem lépünk tovább a tartalékra, hanem hibásnak jelöljük.
 */
export function planNavImport(
	table: NavFuelTable,
	mapping: NavPriceMapping,
	priceTypes: PriceType[],
	current: CurrentFuelPrice[],
	locked: { month: number; priceType: PriceType }[]
): NavImportCell[] {
	const currentById = new Map(current.map((p) => [cellId(p.month, p.priceType), p]));
	const lockedIds = new Set(locked.map((l) => cellId(l.month, l.priceType)));
	const invalidIds = new Set(table.invalidCells.map((c) => `${c.month}:${c.columnKey}`));
	const columnIndex = new Map(table.columns.map((c, i) => [c.key, i]));
	const rowByMonth = new Map(table.rows.map((r) => [r.month, r]));

	const cells: NavImportCell[] = [];
	for (let month = 1; month <= 12; month++) {
		const row = rowByMonth.get(month);
		for (const priceType of priceTypes) {
			const existing = currentById.get(cellId(month, priceType));
			const keys = (mapping[priceType] ?? []).filter((k) => columnIndex.has(k));
			let navPrice: number | null = null;
			let source: string | null = null;
			let invalid = false;
			if (row) {
				for (const key of keys) {
					if (invalidIds.has(`${month}:${key}`)) {
						invalid = true;
						source = key;
						break;
					}
					const value = row.values[columnIndex.get(key)!];
					if (value !== null) {
						navPrice = value;
						source = key;
						break;
					}
				}
			}
			const currentPrice = existing?.priceHuf ?? null;
			let status: NavImportStatus;
			if (invalid) status = 'invalid';
			else if (navPrice === null) status = 'missing';
			else if (currentPrice === null) status = 'new';
			else if (Math.abs(currentPrice - navPrice) < 0.005) status = 'same';
			else if (lockedIds.has(cellId(month, priceType))) status = 'locked';
			else status = 'differs';
			cells.push({
				month,
				priceType,
				navPrice,
				columnKey: source,
				fallback: source !== null && keys.indexOf(source) > 0,
				current: currentPrice,
				currentSource: existing?.source ?? null,
				status
			});
		}
	}
	return cells;
}

/** A táblázat tartalmának ujjlenyomata: az előnézet és a kitöltés ugyanarra az adatra vonatkozzon. */
export function tableVersion(table: NavFuelTable): string {
	const text = JSON.stringify([table.year, table.columns, table.rows, table.invalidCells]);
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	return (hash >>> 0).toString(36);
}
