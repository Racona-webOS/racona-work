/**
 * Ütemezett feladatok — a core ütemezője hívja (manifest.json `scheduledJobs`).
 *
 * Rendszer-kontextusban futnak: nincs hívó felhasználó (`context.userId === null`),
 * ezért itt nem a jogosultsághoz kötött remote függvényeket, hanem a belső
 * függvényeket hívjuk. Ezt a modult a remote végpont nem éri el; az itt
 * használt belső függvényeket a functions.ts-ből sem szabad exportálni.
 */

import type {
	ScheduledJobContext,
	ScheduledJobHandler,
	ScheduledJobParams,
	ScheduledJobResult
} from '@racona/sdk/server';
import { parseDay, todayInBudapest } from './dates.js';
import { runLeaveMonthAutomationForAll } from './leave-month-automation.js';
import { runDocumentRemindersForAll } from './document-reminders.js';
import { runWorkLogCheckForAll } from './work-log-check.js';

/** A dev-server kiegészítése: szimulált mai nap (YYYY-MM-DD) */
type JobParams = ScheduledJobParams & { today?: string };

/** A dev-server kiegészítése: `devMode` (csak ekkor számít a szimulált nap) */
type JobContext = ScheduledJobContext & { devMode?: boolean };

/**
 * Havi szabadság-ellenőrzés: automatikus kiküldés, emlékeztetők a zárás napjáig,
 * zárási összesítő a szabadságkezelőknek, minden szervezetre (specs/leave-month-automation.md). Naponta egyszer fut.
 *
 * @throws Ha valamelyik szervezet feldolgozása hibás: a futás így „sikertelen”
 *   lesz a core futásnaplójában, ismétlődő hibánál a rendszergazda értesítést kap.
 */
export const runLeaveMonthAutomation = (async (
	params: JobParams,
	context: JobContext
): Promise<ScheduledJobResult> => {
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
}) satisfies ScheduledJobHandler;

/**
 * Dolgozói dokumentumok lejárati emlékeztetői: a HR napi összesítője és a
 * dolgozó saját jelzése (specs/employee-documents.md, K9). Naponta egyszer fut.
 *
 * @throws Ha valamelyik szervezet feldolgozása hibás (a core futásnaplójában „sikertelen”).
 */
export const runEmployeeDocumentReminders = (async (
	params: JobParams,
	context: JobContext
): Promise<ScheduledJobResult> => {
	const simulated = context.devMode ? parseDay(params?.today, 'today') : null;
	const today = simulated ?? todayInBudapest();
	const totals = await runDocumentRemindersForAll(context, today);

	const summary =
		`${totals.organizations} szervezet · dokumentum: ${totals.documents}` +
		` · HR értesítés: ${totals.managerNotices} · dolgozói értesítés: ${totals.employeeNotices}` +
		` · hiba: ${totals.failed.length}`;
	if (totals.failed.length > 0) {
		throw new Error(`${summary} — ${totals.failed.map((f) => `#${f.organizationId}: ${f.error}`).join('; ')}`);
	}
	return { summary, data: { today, ...totals } };
}) satisfies ScheduledJobHandler;

/**
 * Hiányzó munkanapló-bejegyzések figyelése (specs/work-log-check.md): a
 * dolgozók emlékeztetőt kapnak az utolsó napok hiányzó munkanapjairól, az
 * ablakból pótolatlanul kieső napokról a beállított címzettek jelzést.
 * Naponta 23:55-kor fut.
 *
 * @throws Ha valamelyik szervezet feldolgozása hibás (a core futásnaplójában „sikertelen”).
 */
export const runWorkLogCheck = (async (
	params: JobParams,
	context: JobContext
): Promise<ScheduledJobResult> => {
	const simulated = context.devMode ? parseDay(params?.today, 'today') : null;
	const today = simulated ?? todayInBudapest();
	// Szimulált napon a futás ideje annak estéje (23:55 Budapesten, kb. 21:55 UTC)
	const now = simulated ? new Date(`${simulated}T21:55:00Z`) : new Date();
	const totals = await runWorkLogCheckForAll(context, today, now);

	const summary =
		`${totals.organizations} szervezet · emlékeztetett dolgozó: ${totals.reminded}` +
		` · eszkaláció: ${totals.escalatedEmployees} dolgozó, ${totals.escalatedDays} nap · hiba: ${totals.failed.length}`;
	if (totals.failed.length > 0) {
		throw new Error(`${summary} — ${totals.failed.map((f) => `#${f.organizationId}: ${f.error}`).join('; ')}`);
	}
	return { summary, data: { today, ...totals } };
}) satisfies ScheduledJobHandler;
