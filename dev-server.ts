/**
 * Dev szerver a plugin fejlesztéshez.
 * Statikus fájlokat szolgál ki és POST /api/remote/:functionName endpointot biztosít
 * a server/functions.ts függvényeinek lokális adatbázison való futtatásához.
 *
 * Indítás előtt:
 *   1. cp .env.example .env
 *   2. bun db:up
 *   3. bun dev:server
 *
 * Használat: bun dev-server.ts
 */

import { serve } from 'bun';
import { readFile } from 'fs/promises';
import { join, extname, resolve, normalize } from 'path';
import { Pool } from 'pg';
import type { RemoteContext } from './server/context.ts';

const PORT = parseInt(process.env.PORT ?? '5175', 10);
const ROOT = import.meta.dir;
const PLUGIN_ID = 'racona-work';
const PLUGIN_SCHEMA = 'app__racona_work';
const DEV_USER_ID = process.env.DEV_USER_ID ?? 'dev-user';

const MIME: Record<string, string> = {
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.css': 'text/css',
	'.html': 'text/html'
};

function createPool(databaseUrl: string): Pool {
	return new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
}

async function checkDbConnection(pool: Pool): Promise<void> {
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error('Kapcsolat timeout (10s)')), 10000)
	);
	try {
		await Promise.race([pool.query('SELECT 1'), timeout]);
		console.log('[DevServer] Adatbázis kapcsolat OK');
	} catch (err) {
		console.error('[DevServer] HIBA: Nem sikerült csatlakozni az adatbázishoz. Ellenőrizd, hogy fut-e a Docker container (bun db:up).', err);
		process.exit(1);
	}
}

async function runMigrations(pool: Pool): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query(`CREATE SCHEMA IF NOT EXISTS ${PLUGIN_SCHEMA}`);
		await client.query(`SET search_path TO ${PLUGIN_SCHEMA}, auth, public`);
		// Ugyanaz a nyilvántartó tábla, mint amit a core PluginInstaller használ
		// (app__<id>.migrations), hogy a dev és az éles séma megegyezzen.
		await client.query(`
			CREATE TABLE IF NOT EXISTS migrations (
				id SERIAL PRIMARY KEY,
				filename VARCHAR(255) NOT NULL UNIQUE,
				applied_at TIMESTAMPTZ DEFAULT NOW()
			)
		`);
		// Régebbi dev adatbázisok a _migrations nevet használták — átvesszük a
		// bejegyzéseket, hogy ne fussanak le újra a már alkalmazott migrációk.
		await client.query(`
			INSERT INTO migrations (filename, applied_at)
			SELECT filename, applied_at FROM _migrations
			ON CONFLICT (filename) DO NOTHING
		`).catch(() => { /* nincs _migrations tábla — friss adatbázis */ });
		await client.query('DROP TABLE IF EXISTS _migrations');

		const devMigrationsDir = join(ROOT, 'migrations', 'dev');
		let devFiles: string[] = [];
		try {
			const { readdirSync } = await import('fs');
			devFiles = readdirSync(devMigrationsDir).filter((f) => f.endsWith('.sql')).sort();
		} catch { /* nincs dev mappa */ }

		for (const file of devFiles) {
			try {
				const sql = await readFile(join(devMigrationsDir, file), 'utf-8');
				await client.query(sql);
				console.log(`[DevServer] Dev migration futtatva: ${file}`);
			} catch (err) {
				console.error(`[DevServer] HIBA: Migráció sikertelen: ${file}`, err);
				process.exit(1);
			}
		}

		const migrationsDir = join(ROOT, 'migrations');
		let prodFiles: string[] = [];
		try {
			const { readdirSync } = await import('fs');
			prodFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
		} catch { /* nincs mappa */ }

		const { rows: applied } = await client.query<{ filename: string }>('SELECT filename FROM migrations');
		const appliedSet = new Set(applied.map((r) => r.filename));

		for (const file of prodFiles) {
			if (appliedSet.has(file)) { console.log(`[DevServer] Migration kihagyva: ${file}`); continue; }
			try {
				const sql = await readFile(join(migrationsDir, file), 'utf-8');
				await client.query(sql);
				await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
				console.log(`[DevServer] Migration alkalmazva: ${file}`);
			} catch (err) {
				console.error(`[DevServer] HIBA: Migráció sikertelen: ${file}`, err);
				process.exit(1);
			}
		}
		console.log('[DevServer] Migrációk alkalmazva.');
	} finally {
		client.release();
	}
}

/**
 * Ugyanaz a kontextus forma, mint amit a Racona core ad át a szerver
 * függvényeknek, kiegészítve a `devMode: true` jelzővel. A jelző alapján a
 * jogosultság-logika (server/context.ts) lazább: nem numerikus DEV_USER_ID
 * esetén az első auth.users rekordot használja hívóként.
 */
function buildContext(pool: Pool): RemoteContext {
	return {
		pluginId: PLUGIN_ID,
		userId: DEV_USER_ID,
		db: {
			query: pool.query.bind(pool) as RemoteContext['db']['query'],
			connect: async () => {
				const client = await pool.connect();
				return {
					query: client.query.bind(client) as RemoteContext['db']['query'],
					release: () => client.release()
				};
			}
		},
		// A core itt a hívó user core jogait adja ('admin' vagy üres);
		// dev módban nincs core admin, a képességeket a devMode jelző nyitja meg.
		permissions: [],
		email: {
			send: async (params) => {
				console.log('[DevServer] [email.send stub]', params);
				return { success: true };
			}
		},
		notifications: {
			send: async (params) => {
				console.log('[DevServer] [notifications.send stub]', params);
				return { success: true };
			}
		},
		devMode: true
	};
}

/** pg SQLSTATE (pl. 42703), illetve Node rendszerhiba kód (pl. ECONNREFUSED). */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const SYSTEM_ERROR_CODE_PATTERN = /^(E[A-Z0-9]+|ERR_[A-Z0-9_]+)$/;
const RUNTIME_ERROR_NAMES = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError']);

/** Belső (nem a felhasználónak szánt) hiba-e? */
function isInternalError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	if (err instanceof Error && RUNTIME_ERROR_NAMES.has(err.name)) return true;
	const candidate = err as { severity?: unknown; code?: unknown; routine?: unknown };
	if (typeof candidate.severity === 'string' && typeof candidate.code === 'string') return true;
	if (typeof candidate.routine === 'string' && typeof candidate.code === 'string') return true;
	if (typeof candidate.code === 'string') {
		return SQLSTATE_PATTERN.test(candidate.code) || SYSTEM_ERROR_CODE_PATTERN.test(candidate.code);
	}
	return false;
}

/** A kliensnek visszaadható hibaüzenet — a belső hibák általános szöveget kapnak. */
function toClientError(err: unknown): { message: string; reference?: string; internal: boolean } {
	if (isInternalError(err)) {
		const reference = Math.random().toString(16).slice(2, 10).padStart(8, '0');
		return { message: `The operation failed due to a server error (ref: ${reference})`, reference, internal: true };
	}
	if (err instanceof Error && err.message) return { message: err.message, internal: false };
	return { message: 'Remote function execution failed', internal: false };
}

async function handleRemoteRequest(req: Request, functionName: string, pool: Pool): Promise<Response> {
	const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
	let params: unknown;
	try {
		const body = await req.json();
		params = (body as Record<string, unknown>).params;
	} catch {
		return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
	}
	let serverModule: Record<string, unknown>;
	try {
		serverModule = (await import('./server/functions.ts')) as Record<string, unknown>;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ success: false, error: `Failed to load server/functions.ts: ${message}` }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
	}
	const fn = serverModule[functionName];
	if (typeof fn !== 'function') {
		return new Response(JSON.stringify({ success: false, error: `Function '${functionName}' not found in server/functions.ts` }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
	}
	try {
		const context = buildContext(pool);
		const result = await (fn as (params: unknown, context: RemoteContext) => Promise<unknown>)(params, context);
		return new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
	} catch (err) {
		// Ugyanaz a szűrés, mint az éles remote endpointon (core:
		// apps/web/src/lib/server/plugins/utils/remote-error.ts): a váratlan hibák
		// (adatbázis, programhiba) nem mennek ki a felületre. A teljes hiba a dev
		// szerver konzoljára kerül.
		const clientError = toClientError(err);
		console.error(
			`[DevServer] ${functionName} hiba` + (clientError.reference ? ` (ref: ${clientError.reference})` : '') + ':',
			err
		);
		return new Response(
			JSON.stringify({
				success: false,
				error: clientError.message,
				...(clientError.internal ? { errorCode: 'SERVER_ERROR', reference: clientError.reference } : {})
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
		);
	}
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('[DevServer] HIBA: DATABASE_URL környezeti változó nincs beállítva. Állítsd be a .env fájlban.');
	process.exit(1);
}

const pool = createPool(DATABASE_URL);

process.on('SIGINT', async () => { console.log('\n[DevServer] Leállítás (SIGINT)...'); await pool.end(); process.exit(0); });
process.on('SIGTERM', async () => { console.log('[DevServer] Leállítás (SIGTERM)...'); await pool.end(); process.exit(0); });

(async () => {
	console.log('[DevServer] Plugin dev szerver indul...');
	await checkDbConnection(pool);
	console.log('[DevServer] Migrációk futtatása...');
	await runMigrations(pool);

	serve({
		port: PORT,
		async fetch(req) {
			const url = new URL(req.url);
			const pathname = url.pathname;
			const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };

			if (req.method === 'OPTIONS' && pathname.startsWith('/api/remote/')) {
				return new Response(null, { status: 204, headers: corsHeaders });
			}
			if (req.method === 'POST' && pathname.startsWith('/api/remote/')) {
				return handleRemoteRequest(req, pathname.slice('/api/remote/'.length), pool);
			}
			if (req.method === 'OPTIONS') {
				return new Response(null, { status: 204, headers: corsHeaders });
			}

			const staticPathname = pathname === '/' ? '/index.html' : pathname;
			const safePath = normalize(staticPathname).replace(/^(\.\.(\/|\\|$))+/, '');
			const searchPaths = [join(ROOT, 'dist', safePath), join(ROOT, safePath)];

			for (const filePath of searchPaths) {
				const resolvedPath = resolve(filePath);
				if (!resolvedPath.startsWith(ROOT + '/') && resolvedPath !== ROOT) {
					return new Response('Forbidden', { status: 403, headers: corsHeaders });
				}
				try {
					const content = await readFile(resolvedPath);
					const ext = extname(resolvedPath);
					return new Response(content, { headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream', ...corsHeaders } });
				} catch { /* Nem található */ }
			}
			return new Response('Not Found', { status: 404, headers: corsHeaders });
		}
	});

	console.log(`[DevServer] Plugin dev szerver fut: http://localhost:${PORT}`);
	console.log(`[DevServer] Remote endpoint: POST http://localhost:${PORT}/api/remote/:functionName`);
	console.log('[DevServer] Futtasd párhuzamosan: bun run dev');
})();
