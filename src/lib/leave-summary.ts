/**
 * A szabadságnaptár táblázatos összesítője (specs/leave-days.md, K18).
 *
 * A naptár már letöltött napjaiból számol: dolgozónként a jóváhagyott napok
 * típusonként, összesen és a függő kérelmek napjai; éves nézetben a keret és a
 * maradék is (a keretet terhelő napokkal csökkentve). Tiszta modul, tesztelhető.
 */

import { BALANCE_LEAVE_TYPES, LEAVE_TYPES, isLeaveType } from '../../server/leave-types.js';
import type { LeaveType } from '../../server/leave-types.js';

export interface SummaryDay {
	employeeId: number;
	employeeName?: string;
	/** null: a hívó nem látja a típust. */
	leaveType: string | null;
}

export interface LeaveSummaryCounts {
	byType: Record<LeaveType, number>;
	/** Ismeretlen vagy nem látható típusú napok. */
	unknown: number;
	/** A jóváhagyott napok összesen. */
	total: number;
	/** A függő kérelmek napjai (nincsenek benne az összesenben). */
	pending: number;
	/** Az éves keret; null, ha nincs (vagy nem éves nézet). */
	allowance: number | null;
	/** keret − a keretet terhelő napok; null, ha nincs keret. */
	remaining: number | null;
}

export interface LeaveSummaryRow extends LeaveSummaryCounts {
	employeeId: number;
	name: string;
}

export interface LeaveSummary {
	rows: LeaveSummaryRow[];
	totals: LeaveSummaryCounts;
}

function emptyCounts(): LeaveSummaryCounts {
	return {
		byType: Object.fromEntries(LEAVE_TYPES.map((type) => [type, 0])) as Record<LeaveType, number>,
		unknown: 0,
		total: 0,
		pending: 0,
		allowance: null,
		remaining: null
	};
}

/**
 * Az összesítő sorai és az összesen sor.
 *
 * @param input.employees - A megjelenítendő dolgozók sorrendben (a szűrt dolgozó, vagy az aktívak).
 * @param input.days - A jóváhagyott napok az időszakban.
 * @param input.pending - A függő kérelmek munkanapjai az időszakban.
 * @param input.allowances - Dolgozónként az éves keret (éves nézetben); null: nincs keret-oszlop.
 */
export function summarizeLeave(input: {
	employees: { id: number; name: string }[];
	days: SummaryDay[];
	pending: SummaryDay[];
	allowances?: ReadonlyMap<number, number> | null;
}): LeaveSummary {
	const rows = new Map<number, LeaveSummaryRow>();
	for (const e of input.employees) {
		rows.set(e.id, { employeeId: e.id, name: e.name, ...emptyCounts() });
	}
	/** Aki a listában nincs (pl. azóta kilépett), de az időszakban szabadságon volt. */
	const extra = (d: SummaryDay): LeaveSummaryRow => {
		let row = rows.get(d.employeeId);
		if (!row) {
			row = { employeeId: d.employeeId, name: d.employeeName ?? '—', ...emptyCounts() };
			rows.set(d.employeeId, row);
		}
		return row;
	};

	for (const d of input.days) {
		const row = extra(d);
		if (d.leaveType && isLeaveType(d.leaveType)) row.byType[d.leaveType] += 1;
		else row.unknown += 1;
		row.total += 1;
	}
	for (const d of input.pending) extra(d).pending += 1;

	const listed = new Set(input.employees.map((e) => e.id));
	const ordered = [
		...input.employees.map((e) => rows.get(e.id)!),
		...[...rows.values()].filter((r) => !listed.has(r.employeeId)).sort((a, b) => a.name.localeCompare(b.name, 'hu'))
	];

	const totals = emptyCounts();
	for (const row of ordered) {
		if (input.allowances) {
			const allowance = input.allowances.get(row.employeeId);
			if (allowance !== undefined) {
				const consumed = [...BALANCE_LEAVE_TYPES].reduce((sum, type) => sum + row.byType[type], 0);
				row.allowance = allowance;
				row.remaining = allowance - consumed;
			}
		}
		for (const type of LEAVE_TYPES) totals.byType[type] += row.byType[type];
		totals.unknown += row.unknown;
		totals.total += row.total;
		totals.pending += row.pending;
		if (row.allowance !== null) totals.allowance = (totals.allowance ?? 0) + row.allowance;
		if (row.remaining !== null) totals.remaining = (totals.remaining ?? 0) + row.remaining;
	}

	return { rows: ordered, totals };
}

/** A képernyőn mutatott típusoszlopok: amelyikben van nap, és mindig az éves szabadság. */
export function visibleLeaveTypes(summary: LeaveSummary): LeaveType[] {
	return LEAVE_TYPES.filter((type) => type === 'annual' || summary.totals.byType[type] > 0);
}
