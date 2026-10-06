/**
 * Remote hívás kontextus — közös típusok és segédfüggvények.
 *
 * A Racona core minden szerver függvénynek átad egy `context` objektumot
 * (pluginId, userId, db, permissions, email, notifications). A dev-server (`dev-server.ts`)
 * ugyanezt a formát építi fel, kiegészítve a `devMode: true` jelzővel.
 *
 * Itt él minden olyan segéd, amit több szerver modul is használ
 * (functions.ts, permissions.ts, projects.ts, work-entries.ts), hogy ne
 * legyen belőlük fájlonként másolat.
 */

export interface PluginEmailService {
	send(params: {
		to: string | string[];
		template: string;
		data: Record<string, unknown>;
		locale?: string;
	}): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

/** Lokalizált szöveg a core értesítési rendszer számára. */
export interface LocalizedText {
	hu: string;
	en: string;
}

/**
 * Rendszeren belüli értesítés a core notification rendszerén keresztül
 * (adatbázisba írás + valós idejű push). A core csak a 'notifications'
 * jogosultságú pluginnak adja át.
 */
export interface PluginNotificationService {
	send(params: {
		userId?: number;
		userIds?: number[];
		title: string | LocalizedText;
		message: string | LocalizedText;
		type?: 'info' | 'success' | 'warning' | 'error' | 'critical';
		data?: Record<string, unknown>;
	}): Promise<{ success: boolean; error?: string }>;
}

/** A core által tárolt fájl adatai (`context.files`). */
export interface PluginFileInfo {
	id: string;
	originalName: string;
	mimeType: string;
	size: number;
	sha256: string;
	ref: string | null;
	createdBy: number | null;
	createdAt: Date;
	claimedAt: Date | null;
}

/**
 * A core fájltárolója (lemezen, nem az adatbázisban). Csak a 'file_access'
 * jogosultságú plugin kapja meg. A hibáknak `code` mezője van
 * (FILE_NOT_FOUND, PERMISSION_DENIED, INVALID_INPUT, INVALID_MIME, FILE_TOO_LARGE).
 */
export interface PluginFileService {
	get(fileId: string): Promise<PluginFileInfo | null>;
	read(fileId: string): Promise<Uint8Array>;
	delete(fileId: string): Promise<void>;
	claim(fileId: string, options?: { ref?: string }): Promise<PluginFileInfo>;
	createUploadUrl(options: {
		allowedMimeTypes: string[];
		maxBytes?: number;
		ref?: string;
		ttlSeconds?: number;
	}): Promise<{ uploadUrl: string; expiresAt: Date }>;
	createDownloadUrl(
		fileId: string,
		options?: { disposition?: 'inline' | 'attachment'; ttlSeconds?: number }
	): Promise<{ url: string; expiresAt: Date }>;
}

export interface RemoteContext {
	pluginId: string;
	/**
	 * A hívó user azonosítója. A core stringként küldi (pl. "12").
	 * Ütemezett futásban (server/jobs.ts) null: nincs hívó felhasználó.
	 */
	userId: string | number | null;
	db: {
		query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
		connect: () => Promise<{
			query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
			release: () => void;
		}>;
	};
	/** A hívó user core jogosultságai (jelenleg csak 'admin' vagy üres). */
	permissions: string[];
	email?: PluginEmailService;
	notifications?: PluginNotificationService;
	/** A core fájltárolója; csak 'file_access' jogosultsággal (specs/employee-documents.md). */
	files?: PluginFileService;
	/**
	 * Csak a lokális dev-server állítja be. Dev módban a jogosultság-ellenőrzések
	 * lazábbak, és nem numerikus userId esetén az első auth.users rekordot használjuk.
	 */
	devMode?: boolean;
	/** Ütemezett futásban: mi indította (a core ütemezője vagy kézi „Futtatás most”). */
	trigger?: 'schedule' | 'manual';
	/** Ütemezett futásban: a core futásnaplójába ír. */
	logger?: { info(message: string): void; warn(message: string): void; error(message: string): void };
	/** Ütemezett futásban: időtúllépéskor abortál. */
	signal?: AbortSignal;
}

/**
 * Ütemezett futás (rendszer-kontextus): nincs hívó felhasználó. Itt minden
 * jogosultsághoz kötött művelet elutasít; a feladatok a belső, jogosultság-
 * ellenőrzés nélküli függvényeket hívják (specs/leave-month-automation.md, D12).
 */
export function isSystemContext(context: RemoteContext): boolean {
	return context.userId === null;
}

/**
 * Lokális fejlesztői mód — kizárólag a dev-server explicit jelzője alapján.
 * (Korábban a nem numerikus userId jelentette a dev módot; ez éles környezetben
 * is megnyithatta volna az összes képességet, ezért explicit jelzőre cseréltük.)
 */
export function isDevMode(context: RemoteContext): boolean {
	return context.devMode === true;
}

/** A hívó core adminisztrátor (Rendszergazda szerep). Felülírja a plugin szerepeket. */
export function isCoreAdmin(context: RemoteContext): boolean {
	return context.permissions?.includes('admin') === true;
}

/**
 * A hívó numerikus user id-ja.
 * Dev módban, ha a userId nem numerikus, az első auth.users rekordot adja vissza.
 * Éles környezetben nem numerikus userId hibát dob.
 */
export async function resolveUserId(context: RemoteContext): Promise<number> {
	if (isSystemContext(context)) throw new Error('Ütemezett futásban nincs felhasználó.');
	if (typeof context.userId === 'number') return context.userId;
	if (typeof context.userId === 'string' && /^\d+$/.test(context.userId)) {
		return Number(context.userId);
	}
	if (!isDevMode(context)) {
		throw new Error('Érvénytelen felhasználó azonosító');
	}
	const result = await context.db.query(`SELECT id FROM auth.users ORDER BY id LIMIT 1`);
	if (result.rows.length === 0) throw new Error('Nincs felhasználó az adatbázisban');
	return (result.rows[0] as { id: number }).id;
}
