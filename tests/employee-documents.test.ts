/**
 * Dolgozói dokumentumok (specs/employee-documents.md): lejárati állapot,
 * típusbeállítások ellenőrzése, hozzáférés (az employee.view nem elég, a
 * dolgozó csak a saját, látható dokumentumait éri el), és a fájlok kezelése
 * a core fájltárolóján keresztül.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	attachDocumentFile,
	computeExpiry,
	daysBetween,
	deleteEmployeeDocument,
	fileErrorMessage,
	getDocumentFileUrl,
	listEmployeeDocuments,
	prepareDocumentUpload
} from '../server/employee-documents.ts';
import { normalizeDocumentTypeInput } from '../server/document-types.ts';
import type { PluginFileService, RemoteContext } from '../server/context.ts';

describe('lejárati állapot', () => {
	test('napok két dátum között', () => {
		expect(daysBetween('2026-10-06', '2026-10-06')).toBe(0);
		expect(daysBetween('2026-10-06', '2026-11-05')).toBe(30);
		expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // óraátállítás
		expect(daysBetween('2026-10-06', '2026-10-01')).toBe(-5);
	});

	test('érvényes, hamarosan lejár, lejárt', () => {
		expect(computeExpiry(null, '2026-10-06', [30, 7])).toEqual({ expiryStatus: null, daysLeft: null });
		expect(computeExpiry('2026-12-31', '2026-10-06', [30, 7]).expiryStatus).toBe('valid');
		expect(computeExpiry('2026-11-05', '2026-10-06', [30, 7])).toEqual({ expiryStatus: 'expiring', daysLeft: 30 });
		expect(computeExpiry('2026-10-06', '2026-10-06', [30, 7])).toEqual({ expiryStatus: 'expiring', daysLeft: 0 });
		expect(computeExpiry('2026-10-05', '2026-10-06', [30, 7])).toEqual({ expiryStatus: 'expired', daysLeft: -1 });
	});

	test('emlékeztető nélkül 30 nap a jelzési idő', () => {
		expect(computeExpiry('2026-11-05', '2026-10-06', []).expiryStatus).toBe('expiring');
		expect(computeExpiry('2026-11-06', '2026-10-06', []).expiryStatus).toBe('valid');
	});
});

describe('dokumentumtípus beállításai', () => {
	const base = {
		name: '  Orvosi   alkalmassági ',
		fileMode: 'required' as const,
		hasExpiry: true,
		defaultValidityMonths: 12,
		reminderDays: [7, 30, 30],
		isRequired: true,
		visibleToEmployee: true
	};

	test('normalizálja a nevet és az emlékeztetőket', () => {
		const v = normalizeDocumentTypeInput(base);
		expect(v.name).toBe('Orvosi alkalmassági');
		expect(v.reminderDays).toEqual([30, 7]);
		expect(v.defaultValidityMonths).toBe(12);
	});

	test('lejárat nélkül nincs érvényesség és emlékeztető', () => {
		const v = normalizeDocumentTypeInput({ ...base, hasExpiry: false });
		expect(v.defaultValidityMonths).toBeNull();
		expect(v.reminderDays).toEqual([]);
	});

	test('elutasítja az érvénytelen értékeket', () => {
		expect(() => normalizeDocumentTypeInput({ ...base, name: ' ' })).toThrow('kötelező');
		expect(() => normalizeDocumentTypeInput({ ...base, fileMode: 'maybe' as never })).toThrow('fájlkezelési');
		expect(() => normalizeDocumentTypeInput({ ...base, defaultValidityMonths: 0 })).toThrow('240');
		expect(() => normalizeDocumentTypeInput({ ...base, reminderDays: [400] })).toThrow('365');
		expect(() => normalizeDocumentTypeInput({ ...base, reminderDays: [1, 2, 3, 4, 5, 6] })).toThrow('Legfeljebb');
	});
});

test('a core fájlhibák magyar üzenetet kapnak', () => {
	expect(fileErrorMessage({ code: 'FILE_TOO_LARGE' })).toContain('10 MB');
	expect(fileErrorMessage({ code: 'INVALID_MIME' })).toContain('PDF');
	expect(fileErrorMessage(new Error('x'))).toBeNull();
});

// --- Ál-kontextus ---------------------------------------------------------------

/**
 * A 3-as szervezet; a 40-es dolgozó a 9-es felhasználó. A 100-as dokumentum
 * (Munkaszerződés, kötelező fájl) a 40-es dolgozóé, egy fájllal (a core-ban
 * `core-1`). A 101-es dokumentum fájl nélküli típusú (erkölcsi), a dolgozónak
 * nem látható.
 */
function fakeContext(opts: {
	caps: string[];
	userId?: number;
	fileCount?: number;
	failFileInsert?: boolean;
}) {
	const writes: string[] = [];
	const fileCalls: string[] = [];
	const docs: Record<number, Record<string, unknown>> = {
		100: { id: 100, employee_id: 40, organization_id: 3, type_id: 1, title: 'Munkaszerződés', status: 'active', file_mode: 'required', has_expiry: false, reminder_days: [], visible_to_employee: true, type_name: 'Munkaszerződés' },
		101: { id: 101, employee_id: 40, organization_id: 3, type_id: 4, title: 'Erkölcsi bizonyítvány', status: 'active', file_mode: 'none', has_expiry: true, reminder_days: [30], visible_to_employee: false, type_name: 'Erkölcsi bizonyítvány' }
	};
	const query = async (sql: string, params: unknown[] = []) => {
		if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
		if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
			writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
			if (sql.includes('INSERT INTO app__racona_work.employee_document_files')) {
				if (opts.failFileInsert) throw Object.assign(new Error('dup'), { code: '23505' });
				return { rows: [{ id: 5, document_id: params[0], original_name: params[2], mime_type: params[3], size_bytes: params[4], created_at: 'now' }] };
			}
			return { rows: [] };
		}
		if (sql.includes('SELECT is_external FROM')) return { rows: [{ is_external: false }] };
		if (sql.includes('rc.capability = $3')) return { rows: opts.caps.includes(String(params[2])) ? [{ ok: 1 }] : [] };
		if (sql.includes('FROM app__racona_work.employees WHERE id = $1')) {
			return { rows: params[0] === 40 ? [{ id: 40, organization_id: 3, user_id: 9 }] : [] };
		}
		if (sql.includes('WHERE d.id = $1')) return { rows: docs[Number(params[0])] ? [docs[Number(params[0])]] : [] };
		if (sql.includes('WHERE d.employee_id = $1')) return { rows: Object.values(docs) };
		if (sql.includes('COUNT(*)::int AS n')) return { rows: [{ n: opts.fileCount ?? 1 }] };
		if (sql.includes('FROM app__racona_work.employee_document_files WHERE id = $1')) {
			return { rows: [{ id: 5, document_id: Number(params[0]) === 6 ? 101 : 100, file_id: 'core-1', original_name: 'szerzodes.pdf' }] };
		}
		if (sql.includes('SELECT file_id FROM app__racona_work.employee_document_files WHERE document_id')) {
			return { rows: [{ file_id: 'core-1' }, { file_id: 'core-2' }] };
		}
		return { rows: [] };
	};
	const files: PluginFileService = {
		get: async () => null,
		read: async () => new Uint8Array(),
		delete: async (id) => void fileCalls.push(`delete:${id}`),
		claim: async (id, o) => {
			fileCalls.push(`claim:${id}:${o?.ref}`);
			return { id, originalName: 'a.pdf', mimeType: 'application/pdf', size: 10, sha256: '', ref: o?.ref ?? null, createdBy: 7, createdAt: new Date(), claimedAt: new Date() };
		},
		createUploadUrl: async (o) => {
			fileCalls.push(`upload:${o.ref}:${o.maxBytes}`);
			return { uploadUrl: '/api/plugins/racona-work/files/upload/tok', expiresAt: new Date() };
		},
		createDownloadUrl: async (id, o) => {
			fileCalls.push(`download:${id}:${o?.disposition}`);
			return { url: `/dl/${id}`, expiresAt: new Date() };
		}
	};
	const context = {
		pluginId: 'racona-work',
		userId: opts.userId ?? 7,
		permissions: [],
		files,
		db: { query, connect: async () => ({ query, release: () => {} }) }
	} as unknown as RemoteContext;
	return { context, writes, fileCalls };
}

const HR = ['employee.documents.view', 'employee.documents.manage'];

describe('hozzáférés', () => {
	test('az employee.view nem ad hozzáférést', async () => {
		const { context } = fakeContext({ caps: ['employee.view', 'employee.manage'] });
		await expect(listEmployeeDocuments({ employeeId: 40 }, context)).rejects.toThrow('Nincs jogosultságod');
	});

	test('a HR mindent lát, a hiányzó kötelező típusokkal', async () => {
		const { context } = fakeContext({ caps: HR });
		const view = await listEmployeeDocuments({ employeeId: 40 }, context);
		expect(view.canManage).toBe(true);
		expect(view.documents.map((d) => d.id)).toEqual([100, 101]);
		expect(view.documents[0].fileMissing).toBe(true); // a lista lekérdezésben nincs fájl
		expect(view.limits.maxFileBytes).toBe(10 * 1024 * 1024);
	});

	test('a dolgozó csak a saját, neki látható dokumentumait látja', async () => {
		const { context } = fakeContext({ caps: ['employee.documents.own'], userId: 9 });
		const view = await listEmployeeDocuments({ employeeId: 40, includeArchived: true }, context);
		expect(view.canManage).toBe(false);
		expect(view.documents.map((d) => d.id)).toEqual([100]);
	});

	test('a saját joggal más dokumentumait nem látja', async () => {
		const { context } = fakeContext({ caps: ['employee.documents.own'], userId: 8 });
		await expect(listEmployeeDocuments({ employeeId: 40 }, context)).rejects.toThrow('Nincs jogosultságod');
	});

	test('a dolgozónak nem látható típus fájlját nem nyithatja meg', async () => {
		const { context } = fakeContext({ caps: ['employee.documents.own'], userId: 9 });
		await expect(getDocumentFileUrl({ fileRowId: 6 }, context)).rejects.toThrow('Nincs jogosultságod');
		const ok = await getDocumentFileUrl({ fileRowId: 5, disposition: 'inline' }, fakeContext({ caps: ['employee.documents.own'], userId: 9 }).context);
		expect(ok.url).toBe('/dl/core-1');
	});

	test('a megtekintés naplózódik', async () => {
		const { context, writes, fileCalls } = fakeContext({ caps: ['employee.documents.view'] });
		await getDocumentFileUrl({ fileRowId: 5, disposition: 'inline' }, context);
		expect(fileCalls).toEqual(['download:core-1:inline']);
		expect(writes).toContain('INSERT INTO app__racona_work.employee_document_events');
	});

	test('olvasási joggal nem tölthet fel', async () => {
		const { context } = fakeContext({ caps: ['employee.documents.view'] });
		await expect(prepareDocumentUpload({ documentId: 100 }, context)).rejects.toThrow('Nincs jogosultságod');
	});
});

describe('fájlok', () => {
	test('feltöltési link a dokumentum hivatkozásával és 10 MB-os korláttal', async () => {
		const { context, fileCalls } = fakeContext({ caps: HR });
		const result = await prepareDocumentUpload({ documentId: 100 }, context);
		expect(result.uploadUrl).toContain('/files/upload/');
		expect(fileCalls).toEqual([`upload:employee-document:100:${10 * 1024 * 1024}`]);
	});

	test('fájl nélküli típushoz nem tölthető fel', async () => {
		const { context } = fakeContext({ caps: HR });
		await expect(prepareDocumentUpload({ documentId: 101 }, context)).rejects.toThrow('nem tartozik fájl');
	});

	test('legfeljebb 5 fájl', async () => {
		const { context } = fakeContext({ caps: HR, fileCount: 5 });
		await expect(prepareDocumentUpload({ documentId: 100 }, context)).rejects.toThrow('legfeljebb 5');
	});

	test('csatoláskor claimel, és hibánál törli a core fájlt', async () => {
		const ok = fakeContext({ caps: HR });
		const file = await attachDocumentFile({ documentId: 100, fileId: 'up-1' }, ok.context);
		expect(file.originalName).toBe('a.pdf');
		expect(ok.fileCalls).toEqual(['claim:up-1:employee-document:100']);

		const failing = fakeContext({ caps: HR, failFileInsert: true });
		await expect(attachDocumentFile({ documentId: 100, fileId: 'up-1' }, failing.context)).rejects.toThrow('már csatolva');
		expect(failing.fileCalls).toEqual(['claim:up-1:employee-document:100', 'delete:up-1']);
	});

	test('a dokumentum törlése a core fájlokat is törli', async () => {
		const { context, fileCalls, writes } = fakeContext({ caps: HR });
		await deleteEmployeeDocument({ id: 100 }, context);
		expect(writes).toContain('DELETE FROM app__racona_work.employee_documents');
		expect(fileCalls).toEqual(['delete:core-1', 'delete:core-2']);
	});

	test('fájltárolás nélküli core-on érthető hiba', async () => {
		const { context } = fakeContext({ caps: HR });
		delete (context as { files?: unknown }).files;
		await expect(prepareDocumentUpload({ documentId: 100 }, context)).rejects.toThrow('frissebb Racona');
	});
});
