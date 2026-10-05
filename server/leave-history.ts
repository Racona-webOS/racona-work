/**
 * Szabadságkeret változásnapló — ki, mikor, mit módosított egy kereten.
 *
 * Minden keretet módosító művelet (létrehozás, újraszámolás, korrekció,
 * számítás alkalmazása, kézi beállítás) ide ír egy sort az előtte és utána
 * állapottal. A felhasznált napok változását (kérelmek jóváhagyása) nem
 * naplózzuk: azt a kérelmek maguk mutatják.
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';
import type { LeaveBalance } from './leave.js';

const SCHEMA = 'app__racona_work';

export type BalanceHistoryAction =
	| 'created'
	| 'bulk_created'
	| 'year_opened'
	| 'recalculated'
	| 'adjusted'
	| 'calculation_applied'
	/** Csak régi naplósorokban: a keret közvetlen kézi beállítása megszűnt. */
	| 'manual_set';

/** A keret naplózott mezői. */
export interface BalanceSnapshot {
	totalDays: number;
	calculatedDays: number | null;
	adjustmentDays: number;
	adjustmentNote: string | null;
	carriedOverDays: number;
	/** A régebbi naplósorokban nincs. */
	carryOverDeadline?: string | null;
	isLocked: boolean;
}

export interface BalanceHistoryEntry {
	id: number;
	action: BalanceHistoryAction;
	totalBefore: number | null;
	totalAfter: number;
	before: BalanceSnapshot | null;
	after: BalanceSnapshot;
	actorName: string | null;
	createdAt: string;
}

function snapshot(balance: LeaveBalance): BalanceSnapshot {
	return {
		totalDays: balance.totalDays,
		calculatedDays: balance.calculatedDays,
		adjustmentDays: balance.adjustmentDays,
		adjustmentNote: balance.adjustmentNote,
		carriedOverDays: balance.carriedOverDays,
		carryOverDeadline: balance.carryOverDeadline,
		isLocked: balance.isLocked
	};
}

/**
 * Belső segéd (a functions.ts NEM reexportálja): egy keretváltozás naplózása.
 * A tranzakciós kliens is átadható, így a napló a módosítással együtt gördül vissza.
 */
export async function logBalanceChange(
	db: Pick<RemoteContext['db'], 'query'>,
	entry: {
		action: BalanceHistoryAction;
		before: LeaveBalance | null;
		after: LeaveBalance;
		actorUserId: number | null;
	}
): Promise<void> {
	await db.query(
		`INSERT INTO ${SCHEMA}.leave_balance_history
			(balance_id, employee_id, year, action, total_before, total_after, details, actor_user_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
		[
			entry.after.id,
			entry.after.employeeId,
			entry.after.year,
			entry.action,
			entry.before?.totalDays ?? null,
			entry.after.totalDays,
			JSON.stringify({
				before: entry.before ? snapshot(entry.before) : null,
				after: snapshot(entry.after)
			}),
			entry.actorUserId
		]
	);
}

/** Egy keret változásai, a legújabb elöl. Csak leave.balance.manage joggal. */
export async function getLeaveBalanceHistory(
	params: { balanceId: number },
	context: RemoteContext
): Promise<BalanceHistoryEntry[]> {
	const balance = await context.db.query(
		`SELECT organization_id FROM ${SCHEMA}.leave_balances WHERE id = $1`,
		[params.balanceId]
	);
	if (balance.rows.length === 0) throw new Error('Nem található a szabadságkeret.');
	await requireCapability(context, balance.rows[0].organization_id, 'leave.balance.manage');

	const r = await context.db.query(
		`SELECT h.id, h.action, h.total_before, h.total_after, h.details, h.created_at,
		        u.full_name AS actor_name
		   FROM ${SCHEMA}.leave_balance_history h
		   LEFT JOIN auth.users u ON u.id = h.actor_user_id
		  WHERE h.balance_id = $1
		  ORDER BY h.created_at DESC, h.id DESC
		  LIMIT 200`,
		[params.balanceId]
	);
	return r.rows.map((row: any) => ({
		id: row.id,
		action: row.action,
		totalBefore: row.total_before ?? null,
		totalAfter: row.total_after,
		before: row.details?.before ?? null,
		after: row.details?.after,
		actorName: row.actor_name ?? null,
		createdAt: row.created_at
	}));
}
