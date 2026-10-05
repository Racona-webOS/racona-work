/**
 * Ütemezett feladatok — a core ütemezője hívja (manifest.json `scheduledJobs`).
 *
 * Rendszer-kontextusban futnak: nincs hívó felhasználó (`context.userId === null`),
 * ezért itt nem a jogosultsághoz kötött remote függvényeket, hanem a belső
 * függvényeket hívjuk. Ezt a modult a remote végpont nem éri el; az itt
 * használt belső függvényeket a functions.ts-ből sem szabad exportálni.
 */

import type { RemoteContext } from './context.js';
import { parseDay, todayInBudapest } from './dates.js';
import { runLeaveMonthAutomationForAll } from './leave-month-automation.js';

/** A core által átadott paraméterek (`@racona/sdk/server` ScheduledJobParams). */
export interface ScheduledJobParams {
	jobId: string;
	runId: number;
	scheduledFor: string;
	trigger: 'schedule' | 'manual';
	/** Csak a dev-server: szimulált mai nap (YYYY-MM-DD) */
	today?: string;
}

/**
 * Havi szabadság-ellenőrzés: automatikus kiküldés, emlékeztetők a zárás napjáig,
 * zárási összesítő a szabadságkezelőknek, minden szervezetre (specs/leave-month-automation.md). Naponta egyszer fut.
 *
 * @throws Ha valamelyik szervezet feldolgozása hibás: a futás így „sikertelen”
 *   lesz a core futásnaplójában, ismétlődő hibánál a rendszergazda értesítést kap.
 */
export async function runLeaveMonthAutomation(
	params: ScheduledJobParams,
	context: RemoteContext
): Promise<{ summary: string; data: Record<string, unknown> }> {
	const simulated = context.devMode ? parseDay(params?.today, 'today') : null;
	const today = simulated ?? todayInBudapest();
	// Szimulált napon a futás ideje annak reggele (07:00 Budapesten, kb. 05:00 UTC)
	const now = simulated ? new Date(`${simulated}T05:00:00Z`) : new Date();
	const totals = await runLeaveMonthAutomationForAll(context, today, now);

	const summary =
		`${totals.organizations} szervezet · kiküldve: ${totals.autoSent} · emlékeztető: ${totals.reminders}` +
		` · zárási összesítő: ${totals.closingNotices} · hiba: ${totals.failed.length}`;
	if (totals.failed.length > 0) {
		throw new Error(`${summary} — ${totals.failed.map((f) => `#${f.organizationId}: ${f.error}`).join('; ')}`);
	}
	return { summary, data: { today, ...totals } };
}
