/**
 * xlsx-sablon kitöltése a böngészőben (fflate zip, közvetlen XML).
 *
 * A sablon egy Excelben szerkeszthető munkafüzet `{{kulcs}}` jelölőkkel. Az első
 * munkalapon egyetlen „mintasor” van `{{<rowPrefix>…}}` jelölőkkel: ezt a kitöltő
 * annyiszor ismétli, ahány sor kell (legalább `minRows`), és eltolja az alatta
 * lévő sorokat, az összevont cellákat és a képletek hivatkozásait. A mintasorra
 * mutató `X16:X16` tartomány a teljes kitöltött tartományra bővül.
 *
 * A képletek élők maradnak, de a kiszámolt érték is bekerül (`<v>`), hogy az
 * előnézetek (Quick Look, levelezők) is jó számot mutassanak; a munkafüzet
 * `fullCalcOnLoad` jelzést kap, így az Excel megnyitáskor újraszámol.
 *
 * Miért nem ExcelJS / SheetJS: az ExcelJS ~950 KB és `new Function(` van benne,
 * amit a core kódellenőrzője elutasít; a SheetJS ingyenes változata írás közben
 * elhagyja a formázást. A közvetlen XML-kitöltés a sablon formázását érintetlenül hagyja.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** Cellaérték: szám, szöveg, dátum (`YYYY-MM-DD` vagy `YYYY-MM-DD HH:mm`), vagy üres. */
export type CellValue = string | number | { date: string } | null;

export interface TemplateData {
	values: Record<string, CellValue>;
	rows: Record<string, CellValue>[];
	rowPrefix: string;
	minRows: number;
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const SINGLE_PLACEHOLDER = /^\{\{\s*([\w.]+)\s*\}\}$/;

// --- XML segédek -----------------------------------------------------------------

function escapeXml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unescapeXml(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
	const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
	return m ? m[1] : null;
}

function setAttr(tag: string, name: string, value: string | null): string {
	const re = new RegExp(`\\s${name}="[^"]*"`);
	if (value === null) return tag.replace(re, '');
	return re.test(tag) ? tag.replace(re, ` ${name}="${value}"`) : tag.replace(/^<(\w+)/, `<$1 ${name}="${value}"`);
}

/** A `<t>` elemek szövege (a formázott, több futamos szövegeké is). */
function textOf(xml: string): string {
	return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
}

// --- Hivatkozások --------------------------------------------------------------------

function colToNumber(col: string): number {
	return [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function numberToCol(n: number): string {
	let col = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		col = String.fromCharCode(65 + rem) + col;
		n = Math.floor((n - 1) / 26);
	}
	return col;
}

interface ShiftContext {
	protoRow: number;
	/** Ennyivel tolódnak a mintasor alatti sorok (a sorok száma − 1). */
	extra: number;
	/** A mintasor ismétlésénél: az aktuális sor (a mintasorra mutató relatív hivatkozás ide kerül). */
	cloneRow?: number;
}

const REF = /(^|[^A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(])/g;

function shiftRow(row: number, absolute: boolean, ctx: ShiftContext): number {
	if (ctx.cloneRow !== undefined && row === ctx.protoRow && !absolute) return ctx.cloneRow;
	return row > ctx.protoRow ? row + ctx.extra : row;
}

/** Egy képlet vagy hivatkozás-lista sorhivatkozásainak eltolása (a "…" szövegeket kihagyva). */
export function shiftReferences(formula: string, ctx: ShiftContext): string {
	return formula
		.split(/("(?:[^"]|"")*")/)
		.map((part, i) => {
			if (i % 2 === 1) return part; // szövegkonstans
			return part.replace(REF, (match, pre, c1a, col1, r1a, row1, c2a, col2, r2a, row2) => {
				const start = Number(row1);
				if (col2 === undefined) {
					return `${pre}${c1a}${col1}${r1a}${shiftRow(start, r1a === '$', ctx)}`;
				}
				const end = Number(row2);
				// A mintasorra mutató tartomány (G16:G16) a kitöltött sorokra bővül
				if (ctx.cloneRow === undefined && start === ctx.protoRow && end === ctx.protoRow) {
					return `${pre}${c1a}${col1}${r1a}${start}:${c2a}${col2}${r2a}${end + ctx.extra}`;
				}
				return (
					`${pre}${c1a}${col1}${r1a}${shiftRow(start, r1a === '$', ctx)}:` +
					`${c2a}${col2}${r2a}${shiftRow(end, r2a === '$', ctx)}`
				);
			});
		})
		.join('');
}

// --- Dátum ---------------------------------------------------------------------------

/** Excel dátum-sorszám (1900-as rendszer) `YYYY-MM-DD` vagy `YYYY-MM-DD HH:mm` alakból. */
export function excelSerial(value: string): number | null {
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
	if (!m) return null;
	const [, y, mo, d, hh = '0', mm = '0'] = m;
	const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)) - Date.UTC(1899, 11, 30);
	return Math.round((ms / 86_400_000) * 1e10) / 1e10;
}

// --- Cellák ----------------------------------------------------------------------------

type Scalar = number | string | null;

function valueToText(value: CellValue): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') return value.date;
	return String(value);
}

/** Egy cella az új sorszámmal, a jelölők behelyettesítésével. */
function renderCell(
	cellXml: string,
	newRow: number,
	values: Record<string, CellValue> | null,
	ctx: ShiftContext,
	sharedStrings: string[],
	results: Map<string, Scalar>,
	formulas: Map<string, string>
): string {
	const rawOpen = cellXml.match(/^<c\b[^>]*?\/?>/)![0];
	const openTag = rawOpen.replace(/\/>$/, '>');
	const ref = attr(openTag, 'r')!;
	const col = ref.match(/^[A-Z]+/)![0];
	const newRef = `${col}${newRow}`;
	const style = attr(openTag, 's');
	const styleAttr = style !== null ? ` s="${style}"` : '';
	const empty = `<c r="${newRef}"${styleAttr}/>`;

	const formula = cellXml.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/);
	if (formula) {
		// Üres ismétlő sorban nincs képlet
		if (values === null && ctx.cloneRow !== undefined) return empty;
		const shifted = shiftReferences(unescapeXml(formula[1]), ctx);
		formulas.set(newRef, shifted);
		return `<c r="${newRef}"${styleAttr}><f>${escapeXml(shifted)}</f><v>{{__value:${newRef}}}</v></c>`;
	}

	const type = attr(openTag, 't');
	const inner = rawOpen.endsWith('/>') ? '' : cellXml.slice(rawOpen.length).replace(/<\/c>$/, '');
	let text: string | null = null;
	if (type === 's') {
		text = sharedStrings[Number(inner.match(/<v>(\d+)<\/v>/)?.[1])] ?? '';
	} else if (type === 'inlineStr' || type === 'str') {
		text = textOf(inner);
	}

	if (text === null || !text.includes('{{')) {
		// Változatlan cella (szám, szöveg, üres) — csak a hivatkozása változik
		const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
		if (text !== null) results.set(newRef, text);
		else if (value !== undefined && type !== 'b' && type !== 'e') results.set(newRef, Number(value));
		return cellXml.replace(/^<c\b[^>]*?(\/?)>/, (tag) => setAttr(tag, 'r', newRef));
	}

	const lookup = (key: string): CellValue => (values && key in values ? values[key] : null);
	const single = text.match(SINGLE_PLACEHOLDER);
	if (single) {
		const value = lookup(single[1]);
		if (value === null || value === '') return empty;
		if (typeof value === 'number') {
			results.set(newRef, value);
			return `<c r="${newRef}"${styleAttr}><v>${value}</v></c>`;
		}
		if (typeof value === 'object') {
			const serial = excelSerial(value.date);
			if (serial !== null) {
				results.set(newRef, serial);
				return `<c r="${newRef}"${styleAttr}><v>${serial}</v></c>`;
			}
		}
	}
	const replaced = text.replace(PLACEHOLDER, (_, key) => valueToText(lookup(key)));
	if (!replaced.trim()) return empty;
	results.set(newRef, replaced);
	return `<c r="${newRef}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(replaced)}</t></is></c>`;
}

function renderRow(
	rowXml: string,
	newRow: number,
	values: Record<string, CellValue> | null,
	ctx: ShiftContext,
	sharedStrings: string[],
	results: Map<string, Scalar>,
	formulas: Map<string, string>
): string {
	const openTag = rowXml.match(/^<row\b[^>]*?\/?>/)![0];
	const newOpen = setAttr(openTag.replace(/\/>$/, '>'), 'r', String(newRow));
	if (openTag.endsWith('/>')) return newOpen.replace(/>$/, '/>');
	const cells = rowXml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? [];
	const rendered = cells.map((c) => renderCell(c, newRow, values, ctx, sharedStrings, results, formulas));
	return `${newOpen}${rendered.join('')}</row>`;
}

// --- Képletek kiértékelése -----------------------------------------------------------------

/**
 * Egyszerű kiértékelő a sablon képleteihez: számok, hivatkozások, + − * /,
 * zárójel, SUM(tartomány…), ROUND(x; n). Ismeretlen képletnél null (az Excel
 * megnyitáskor úgyis újraszámol).
 */
function evaluate(formulas: Map<string, string>, results: Map<string, Scalar>): Map<string, number> {
	const cache = new Map<string, number | null>();

	const cellValue = (ref: string, depth: number): number => {
		if (formulas.has(ref)) {
			const v = evalRef(ref, depth + 1);
			return v ?? 0;
		}
		const v = results.get(ref);
		return typeof v === 'number' ? v : 0;
	};

	const evalRef = (ref: string, depth: number): number | null => {
		if (cache.has(ref)) return cache.get(ref)!;
		if (depth > 50) return null;
		cache.set(ref, null);
		let value: number | null = null;
		try {
			value = parse(formulas.get(ref)!, depth);
		} catch {
			value = null;
		}
		cache.set(ref, value);
		return value;
	};

	const parse = (formula: string, depth: number): number => {
		const tokens = formula.replace(/\$/g, '').match(/[A-Z]+\d+:[A-Z]+\d+|[A-Z]+\(|[A-Z]+\d+|\d+(?:\.\d+)?|[-+*/(),;]/g) ?? [];
		let pos = 0;
		const peek = () => tokens[pos];
		const next = () => tokens[pos++];

		const rangeValues = (range: string): number[] => {
			const [a, b] = range.split(':');
			const [, c1, r1] = a.match(/([A-Z]+)(\d+)/)!;
			const [, c2, r2] = b.match(/([A-Z]+)(\d+)/)!;
			const out: number[] = [];
			for (let c = colToNumber(c1); c <= colToNumber(c2); c++) {
				for (let r = Number(r1); r <= Number(r2); r++) out.push(cellValue(`${numberToCol(c)}${r}`, depth));
			}
			return out;
		};

		const primary = (): number => {
			const tok = next();
			if (tok === undefined) throw new Error('váratlan vég');
			if (tok === '-') return -primary();
			if (tok === '+') return primary();
			if (tok === '(') {
				const v = expr();
				next();
				return v;
			}
			if (/^\d/.test(tok)) return Number(tok);
			if (tok.endsWith('(')) {
				const name = tok.slice(0, -1);
				const args: number[][] = [];
				while (peek() !== ')') {
					if (/^[A-Z]+\d+:[A-Z]+\d+$/.test(peek()!)) args.push(rangeValues(next()!));
					else args.push([expr()]);
					if (peek() === ',' || peek() === ';') next();
				}
				next();
				if (name === 'SUM') return args.flat().reduce((s, v) => s + v, 0);
				if (name === 'ROUND') {
					const digits = args[1]?.[0] ?? 0;
					const factor = 10 ** digits;
					const x = args[0][0];
					return (Math.sign(x) * Math.round(Math.abs(x) * factor + Number.EPSILON)) / factor;
				}
				throw new Error(`ismeretlen függvény: ${name}`);
			}
			if (/^[A-Z]+\d+$/.test(tok)) return cellValue(tok, depth);
			throw new Error(`váratlan elem: ${tok}`);
		};
		const term = (): number => {
			let v = primary();
			while (peek() === '*' || peek() === '/') v = next() === '*' ? v * primary() : v / primary();
			return v;
		};
		const expr = (): number => {
			let v = term();
			while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term();
			return v;
		};
		return expr();
	};

	const out = new Map<string, number>();
	for (const ref of formulas.keys()) {
		const v = evalRef(ref, 0);
		if (v !== null && Number.isFinite(v)) out.set(ref, Math.round(v * 1e9) / 1e9);
	}
	return out;
}

// --- Munkafüzet ------------------------------------------------------------------------

function firstSheetPath(files: Record<string, Uint8Array>): string {
	const workbook = strFromU8(files['xl/workbook.xml']);
	const rels = strFromU8(files['xl/_rels/workbook.xml.rels']);
	const firstSheet = workbook.match(/<sheet\b[^>]*>/)?.[0];
	const relId = firstSheet ? attr(firstSheet, 'r:id') : null;
	const rel = relId ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${relId}"[^>]*>`))?.[0] : null;
	const target = rel ? attr(rel, 'Target') : null;
	if (!target) return 'xl/worksheets/sheet1.xml';
	return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

export function fillTemplate(template: Uint8Array, data: TemplateData): Uint8Array {
	const files = unzipSync(template);
	const sheetPath = firstSheetPath(files);
	let sheet = strFromU8(files[sheetPath]);

	const sharedStrings = files['xl/sharedStrings.xml']
		? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
		: [];

	const sheetDataMatch = sheet.match(/<sheetData>([\s\S]*?)<\/sheetData>|<sheetData\/>/);
	if (!sheetDataMatch) throw new Error('A sablon munkalapja üres.');
	const rowsXml = sheetDataMatch[1]?.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) ?? [];

	const cellText = (cell: string): string => {
		const type = attr(cell.match(/^<c\b[^>]*>/)?.[0] ?? '', 't');
		if (type === 's') return sharedStrings[Number(cell.match(/<v>(\d+)<\/v>/)?.[1])] ?? '';
		return textOf(cell);
	};
	const protoIndex = rowsXml.findIndex((row) =>
		(row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []).some((c) => cellText(c).includes(`{{${data.rowPrefix}`))
	);
	if (protoIndex < 0) throw new Error('A sablonban nincs mintasor.');
	const protoRow = Number(attr(rowsXml[protoIndex], 'r'));
	const count = Math.max(data.rows.length, data.minRows, 1);
	const extra = count - 1;

	const results = new Map<string, Scalar>();
	const formulas = new Map<string, string>();
	const out: string[] = [];
	rowsXml.forEach((rowXml, i) => {
		const r = Number(attr(rowXml, 'r'));
		if (i === protoIndex) {
			for (let k = 0; k < count; k++) {
				const values = data.rows[k] ? { ...data.values, ...data.rows[k] } : null;
				out.push(renderRow(rowXml, protoRow + k, values, { protoRow, extra, cloneRow: protoRow + k }, sharedStrings, results, formulas));
			}
			return;
		}
		const newRow = r > protoRow ? r + extra : r;
		out.push(renderRow(rowXml, newRow, data.values, { protoRow, extra }, sharedStrings, results, formulas));
	});

	// Kiszámolt értékek a képletek mellé
	const computed = evaluate(formulas, results);
	let sheetData = `<sheetData>${out.join('')}</sheetData>`;
	sheetData = sheetData.replace(/<v>\{\{__value:([A-Z]+\d+)\}\}<\/v>/g, (_, ref) =>
		computed.has(ref) ? `<v>${computed.get(ref)}</v>` : ''
	);
	sheet = sheet.replace(sheetDataMatch[0], () => sheetData);

	// Összevont cellák: a mintasoriak minden új sorba, az alattiak eltolva
	sheet = sheet.replace(/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/, (_, inner: string) => {
		const refs = [...inner.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"[^>]*\/>/g)].map((m) => m[1]);
		const merged: string[] = [];
		for (const ref of refs) {
			const rows = ref.match(/\d+/g)!.map(Number);
			if (rows.every((row) => row === protoRow)) {
				for (let k = 0; k < count; k++) merged.push(ref.replace(/\d+/g, String(protoRow + k)));
			} else {
				merged.push(shiftReferences(ref, { protoRow, extra }));
			}
		}
		return `<mergeCells count="${merged.length}">${merged.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
	});
	sheet = sheet.replace(/<dimension ref="([^"]+)"\s*\/>/, (_, ref) => `<dimension ref="${shiftReferences(ref, { protoRow, extra })}"/>`);
	files[sheetPath] = strToU8(sheet);

	// A munkafüzet: nevesített tartományok eltolása, újraszámolás megnyitáskor, calcChain nélkül
	let workbook = strFromU8(files['xl/workbook.xml']);
	workbook = workbook.replace(/(<definedName\b[^>]*>)([\s\S]*?)(<\/definedName>)/g, (_, open, body, close) =>
		`${open}${escapeXml(shiftReferences(unescapeXml(body), { protoRow, extra }))}${close}`
	);
	if (/<calcPr\b/.test(workbook)) {
		workbook = workbook.replace(/<calcPr\b[^>]*?\/?>/, (tag) => setAttr(tag.replace(/\/>$/, ' />'), 'fullCalcOnLoad', '1'));
	} else {
		workbook = workbook.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
	}
	files['xl/workbook.xml'] = strToU8(workbook);
	if (files['xl/calcChain.xml']) {
		delete files['xl/calcChain.xml'];
		files['[Content_Types].xml'] = strToU8(
			strFromU8(files['[Content_Types].xml']).replace(/<Override\b[^>]*calcChain[^>]*\/>/, '')
		);
		files['xl/_rels/workbook.xml.rels'] = strToU8(
			strFromU8(files['xl/_rels/workbook.xml.rels']).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, '')
		);
	}

	return zipSync(files, { level: 6 });
}
