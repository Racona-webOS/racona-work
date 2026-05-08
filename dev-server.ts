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
		await client.query(`
			CREATE TABLE IF NOT EXISTS _migrations (
				id SERIAL PRIMARY KEY,
				filename TEXT NOT NULL UNIQUE,
				applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

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

		const { rows: applied } = await client.query<{ filename: string }>('SELECT filename FROM _migrations');
		const appliedSet = new Set(applied.map((r) => r.filename));

		for (const file of prodFiles) {
			if (appliedSet.has(file)) { console.log(`[DevServer] Migration kihagyva: ${file}`); continue; }
			try {
				const sql = await readFile(join(migrationsDir, file), 'utf-8');
				await client.query(sql);
				await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
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

interface RemoteContext {
	pluginId: string;
	userId: string;
	db: {
		query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
		connect: () => Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; release: () => void }>;
	};
	permissions: string[];
	email: { send: (params: unknown) => Promise<{ success: boolean }> };
}

function buildContext(pool: Pool): RemoteContext {
	return {
		pluginId: PLUGIN_ID,
		userId: DEV_USER_ID,
		db: {
			query: pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>,
			connect: async () => {
				const client = await pool.connect();
				return {
					query: client.query.bind(client) as (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>,
					release: () => client.release()
				};
			}
		},
		permissions: ['database', 'remote_functions', 'notifications'],
		email: {
			send: async (params: unknown) => { console.log('[DevServer] [email.send stub]', params); return { success: true }; }
		}
	};
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
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ success: false, error: message }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
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
