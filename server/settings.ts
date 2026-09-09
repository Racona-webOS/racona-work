/**
 * Alkalmazás beállítások — szerver oldali függvények.
 *
 * A plugin saját kulcs-érték tárolóját (app__<pluginId>.kv_store) olvassa/írja.
 */

import type { RemoteContext } from './context.js';
import { requireCapability } from './permissions.js';

/**
 * Alkalmazás beállítás lekérdezése a DataService key-value tárolóból.
 * A plugin adatai a plugin_work.kv_store táblában tárolódnak.
 * Követelmény: 13.2, 13.6
 */
export async function getSettings(
	params: { key: string },
	context: RemoteContext
): Promise<unknown> {
	// Szervezet-specifikus kulcsok esetén (pl. "settings:x:org_123") ellenőrizzük,
	// hogy a hívónak van-e hozzáférése az adott szervezet olvasásához.
	const orgMatch = /:org_(\d+)(?:$|:)/.exec(params.key);
	if (orgMatch) {
		const orgId = Number(orgMatch[1]);
		await requireCapability(context, orgId, 'employee.view');
	}

	// A plugin séma neve: plugin_{pluginId} (kötőjelek aláhúzásra cserélve)
	const schemaName = `app__${context.pluginId.replace(/-/g, '_')}`;

	const result = await context.db.query(`SELECT value FROM ${schemaName}.kv_store WHERE key = $1`, [
		params.key
	]);

	if (result.rows.length === 0) {
		return null;
	}

	return result.rows[0].value;
}

/**
 * Alkalmazás beállítás mentése a DataService key-value tárolóba (UPSERT).
 * A plugin adatai a plugin_work.kv_store táblában tárolódnak.
 * Követelmény: 13.2, 13.6
 */
export async function saveSettings(
	params: { key: string; value: unknown },
	context: RemoteContext
): Promise<void> {
	// Szervezet-specifikus kulcsok esetén (pl. "settings:x:org_123") a hívónak
	// az adott szervezetben org.manage vagy leave.balance.manage-szerű írási
	// képességgel kell rendelkeznie. Egyszerűen: members.manage vagy org.manage
	// közelítés — most a leginkább konzervatív: org.manage.
	const orgMatch = /:org_(\d+)(?:$|:)/.exec(params.key);
	if (orgMatch) {
		const orgId = Number(orgMatch[1]);
		await requireCapability(context, orgId, 'org.manage');
	}

	// A plugin séma neve: plugin_{pluginId} (kötőjelek aláhúzásra cserélve)
	const schemaName = `app__${context.pluginId.replace(/-/g, '_')}`;

	await context.db.query(
		`INSERT INTO ${schemaName}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key)
		 DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[params.key, JSON.stringify(params.value)]
	);
}
