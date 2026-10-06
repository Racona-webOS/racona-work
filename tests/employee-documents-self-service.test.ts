/**
 * Dolgozói dokumentumok 3. ütem (specs/employee-documents.md, K7, K8): a dolgozó
 * saját feltöltése HR-jóváhagyással, visszavonás, elbírálás.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	attachDocumentFile,
	confirmMyDocumentSubmission,
	deleteEmployeeDocument,
	listEmployeeDocuments,
	prepareDocumentUpload,
	reviewEmployeeDocument,
	submitMyDocument
} from '../server/employee-documents.ts';
import { normalizeDocumentTypeInput } from '../server/document-types.ts';
import type { PluginFileService, RemoteContext } from '../server/context.ts';

/**
 * A 3-as szervezet 40-es dolgozója a 9-es felhasználó. Típusok: 3 (Orvosi,
 * feltölthető), 1 (Munkaszerződés, nem feltölthető). Dokumentumok:
 * 200 = Anna függő beküldése (created_by 9, 1 fájl), 201 = aktív orvosi.
 */
function fakeContext(opts: {
	caps: string[];
	userId: number;
	uploadEnabled?: boolean;
	pendingCreatedBy?: number;
	pendingFiles?: number;
}) {
	const writes: { sql: string; params: unknown[] }[] = [];
	const fileCalls: string[] = [];
	const notifications: any[] = [];
	const docs: Record<number, Record<string, unknown>> = {
		200: { id: 200, employee_id: 40, organization_id: 3, type_id: 3, title: 'Orvosi (új)', status: 'pending', created_by: opts.pendingCreatedBy ?? 9, file_mode: 'required', has_expiry: true, reminder_days: [30], visible_to_employee: true, type_name: 'Orvosi alkalmassági', issued_day: '2026-10-01', valid_day: '2027-10-01' },
		201: { id: 201, employee_id: 40, organization_id: 3, type_id: 3, title: 'Orvosi (régi)', status: 'active', created_by: 7, file_mode: 'required', has_expiry: true, reminder_days: [30], visible_to_employee: true, type_name: 'Orvosi alkalmassági', issued_day: '2025-10-01', valid_day: '2026-10-01' }
	};
	const types: Record<number, Record<string, unknown>> = {
		3: { id: 3, organization_id: 3, name: 'Orvosi alkalmassági', file_mode: 'required', has_expiry: true, reminder_days: [30], visible_to_employee: true, employee_can_upload: true, archived_at: null },
		1: { id: 1, organization_id: 3, name: 'Munkaszerződés', file_mode: 'required', has_expiry: false, reminder_days: [], visible_to_employee: true, employee_can_upload: false, archived_at: null }
	};
	const query = async (sql: string, params: unknown[] = []) => {
		if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
		if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
			writes.push({ sql: sql.trim().replace(/\s+/g, ' '), params });
			if (sql.includes('INSERT INTO app__racona_work.employee_documents')) return { rows: [{ id: 200 }] };
			if (sql.includes('INSERT INTO app__racona_work.employee_document_files')) {
				return { rows: [{ id: 9, document_id: params[0], original_name: params[2], mime_type: params[3], size_bytes: params[4], created_at: 'now' }] };
			}
			if (sql.includes("SET status = 'archived', replaced_by_id")) return { rows: [{ id: 201, title: 'Orvosi (régi)' }] };
			if (sql.includes('DELETE FROM app__racona_work.employee_document_files WHERE document_id')) {
				return { rows: [{ file_id: 'core-a' }] };
			}
			return { rows: [] };
		}
		if (sql.includes('SELECT is_external FROM')) return { rows: [{ is_external: false }] };
		if (sql.includes('rc.capability = $3')) return { rows: opts.caps.includes(String(params[2])) ? [{ ok: 1 }] : [] };
		if (sql.includes('FROM app__racona_work.employees WHERE id = $1')) return { rows: [{ id: 40, organization_id: 3, user_id: 9 }] };
		if (sql.includes('kv_store')) return { rows: opts.uploadEnabled ? [{ value: { employeeUploadEnabled: true } }] : [] };
		if (sql.includes('FROM app__racona_work.document_types WHERE id = $1')) {
			return { rows: types[Number(params[0])] ? [types[Number(params[0])]] : [] };
		}
		if (sql.includes('WHERE d.id = $1')) return { rows: docs[Number(params[0])] ? [docs[Number(params[0])]] : [] };
		if (sql.includes('WHERE d.employee_id = $1')) return { rows: Object.values(docs) };
		if (sql.includes('SELECT * FROM app__racona_work.document_types')) return { rows: Object.values(types) };
		if (sql.includes('COUNT(*)::int AS n')) return { rows: [{ n: 0 }] };
		if (sql.includes('FROM app__racona_work.employee_document_files') && sql.includes('ANY($1::int[])')) {
			const count = opts.pendingFiles ?? 1;
			return { rows: Array.from({ length: count }, (_, i) => ({ id: i + 1, document_id: 200, original_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 10, created_at: 'now' })) };
		}
		if (sql.includes("rc.capability = 'employee.documents.manage'")) {
			return { rows: [{ user_id: 7, full_name: 'HR', email: 'hr@example.com', locale: 'hu' }] };
		}
		if (sql.includes('FROM auth.users WHERE id = $1')) return { rows: [{ name: 'Anna' }] };
		return { rows: [] };
	};
	const files: PluginFileService = {
		get: async () => null,
		read: async () => new Uint8Array(),
		delete: async (id) => void fileCalls.push(`delete:${id}`),
		claim: async (id) => ({ id, originalName: 'a.pdf', mimeType: 'application/pdf', size: 10, sha256: '', ref: null, createdBy: 9, createdAt: new Date(), claimedAt: new Date() }),
		createUploadUrl: async () => ({ uploadUrl: '/api/plugins/racona-work/files/upload/t', expiresAt: new Date() }),
		createDownloadUrl: async (id) => ({ url: `/dl/${id}`, expiresAt: new Date() })
	};
	const context = {
		pluginId: 'racona-work',
		userId: opts.userId,
		permissions: [],
		files,
		db: { query, connect: async () => ({ query, release: () => {} }) },
		notifications: { send: async (p: any) => (notifications.push(p), { success: true }) }
	} as unknown as RemoteContext;
	return { context, writes, fileCalls, notifications };
}

const OWN = ['employee.documents.own'];
const HR = ['employee.documents.view', 'employee.documents.manage'];

describe('típusbeállítás', () => {
	test('a nem látható vagy fájl nélküli típust a dolgozó nem töltheti fel', () => {
		const base = { name: 'X', fileMode: 'required' as const, hasExpiry: false, isRequired: false, visibleToEmployee: true, employeeCanUpload: true };
		expect(normalizeDocumentTypeInput(base).employeeCanUpload).toBe(true);
		expect(normalizeDocumentTypeInput({ ...base, visibleToEmployee: false }).employeeCanUpload).toBe(false);
		expect(normalizeDocumentTypeInput({ ...base, fileMode: 'none' }).employeeCanUpload).toBe(false);
	});
});

describe('saját nézet', () => {
	test('a dolgozó feltölthető típusokat és visszavonhatót kap, a HR nem', async () => {
		const own = await listEmployeeDocuments({ employeeId: 40 }, fakeContext({ caps: OWN, userId: 9, uploadEnabled: true }).context);
		expect(own.selfService).toEqual({ uploadEnabled: true, uploadTypes: [{ id: 3, name: 'Orvosi alkalmassági' }] });
		expect(own.documents.find((d) => d.id === 200)?.canWithdraw).toBe(true);
		expect(own.documents.find((d) => d.id === 201)?.canWithdraw).toBe(false);

		const hr = await listEmployeeDocuments({ employeeId: 40 }, fakeContext({ caps: HR, userId: 7, uploadEnabled: true }).context);
		expect(hr.selfService).toBeNull();
	});

	test('kikapcsolt szervezeti beállításnál nincs feltöltés', async () => {
		const own = await listEmployeeDocuments({ employeeId: 40 }, fakeContext({ caps: OWN, userId: 9 }).context);
		expect(own.selfService).toEqual({ uploadEnabled: false, uploadTypes: [] });
	});
});

describe('beküldés', () => {
	test('függő állapotban jön létre, a dolgozó nevében', async () => {
		const { context, writes } = fakeContext({ caps: OWN, userId: 9, uploadEnabled: true });
		await submitMyDocument({ employeeId: 40, typeId: 3, issuedOn: '2026-10-01', validUntil: '2027-10-01' }, context);
		const insert = writes.find((w) => w.sql.startsWith('INSERT INTO app__racona_work.employee_documents'))!;
		expect(insert.sql).toContain("'pending'");
		expect(insert.params[7]).toBe(9);
		expect(writes.some((w) => w.sql.includes('employee_document_events') && w.params[3] === 'submit')).toBe(true);
	});

	test('kikapcsolt beállításnál, nem engedett típusnál, vagy más nevében hiba', async () => {
		await expect(submitMyDocument({ employeeId: 40, typeId: 3 }, fakeContext({ caps: OWN, userId: 9 }).context)).rejects.toThrow('nem tölthetnek fel');
		await expect(submitMyDocument({ employeeId: 40, typeId: 1 }, fakeContext({ caps: OWN, userId: 9, uploadEnabled: true }).context)).rejects.toThrow('nem tölthetsz fel');
		await expect(submitMyDocument({ employeeId: 40, typeId: 3 }, fakeContext({ caps: OWN, userId: 8, uploadEnabled: true }).context)).rejects.toThrow('saját');
	});

	test('a saját függő beküldéshez fájlt csatolhat, máséhoz és az aktívhoz nem', async () => {
		const own = fakeContext({ caps: OWN, userId: 9, uploadEnabled: true });
		await expect(prepareDocumentUpload({ documentId: 200 }, own.context)).resolves.toBeDefined();
		await expect(attachDocumentFile({ documentId: 200, fileId: 'up-1' }, own.context)).resolves.toBeDefined();
		await expect(prepareDocumentUpload({ documentId: 201 }, own.context)).rejects.toThrow('Nincs jogosultságod');

		const other = fakeContext({ caps: OWN, userId: 9, uploadEnabled: true, pendingCreatedBy: 7 });
		await expect(prepareDocumentUpload({ documentId: 200 }, other.context)).rejects.toThrow('Nincs jogosultságod');
	});

	test('lezáráskor legalább egy fájl kell, és a HR értesítést kap', async () => {
		const empty = fakeContext({ caps: OWN, userId: 9, uploadEnabled: true, pendingFiles: 0 });
		await expect(confirmMyDocumentSubmission({ documentId: 200 }, empty.context)).rejects.toThrow('Legalább egy fájlt');

		const ok = fakeContext({ caps: OWN, userId: 9, uploadEnabled: true, pendingFiles: 2 });
		await confirmMyDocumentSubmission({ documentId: 200 }, ok.context);
		expect(ok.notifications).toHaveLength(1);
		expect(ok.notifications[0].userIds).toEqual([7]);
		expect(ok.notifications[0].message.hu).toBe('Anna feltöltötte: Orvosi (új) (2 fájl).');
	});

	test('a dolgozó visszavonhatja a saját függő beküldését (a fájlokkal együtt)', async () => {
		const { context, writes } = fakeContext({ caps: OWN, userId: 9, uploadEnabled: true });
		await deleteEmployeeDocument({ id: 200 }, context);
		expect(writes.some((w) => w.sql.includes('employee_document_events') && w.params[3] === 'withdraw')).toBe(true);
		await expect(deleteEmployeeDocument({ id: 201 }, context)).rejects.toThrow('Nincs jogosultságod');
	});
});

describe('elbírálás', () => {
	test('elfogadáskor aktív lesz, és a korábbi aktív archivált', async () => {
		const { context, writes, notifications } = fakeContext({ caps: HR, userId: 7 });
		await reviewEmployeeDocument({ id: 200, decision: 'approve' }, context);
		expect(writes.some((w) => w.sql.includes("SET status = 'active'"))).toBe(true);
		expect(writes.some((w) => w.sql.includes("SET status = 'archived', replaced_by_id"))).toBe(true);
		expect(notifications.find((n) => n.userId === 9)?.title.hu).toBe('Dokumentum elfogadva');
	});

	test('a csere kikapcsolható', async () => {
		const { context, writes } = fakeContext({ caps: HR, userId: 7 });
		await reviewEmployeeDocument({ id: 200, decision: 'approve', replaceExisting: false }, context);
		expect(writes.some((w) => w.sql.includes("SET status = 'archived', replaced_by_id"))).toBe(false);
	});

	test('elutasításhoz indoklás kell; a fájlok törlődnek', async () => {
		const missing = fakeContext({ caps: HR, userId: 7 });
		await expect(reviewEmployeeDocument({ id: 200, decision: 'reject' }, missing.context)).rejects.toThrow('indoklása kötelező');

		const { context, writes, fileCalls, notifications } = fakeContext({ caps: HR, userId: 7 });
		await reviewEmployeeDocument({ id: 200, decision: 'reject', note: 'Olvashatatlan' }, context);
		expect(writes.some((w) => w.sql.includes("SET status = 'rejected'"))).toBe(true);
		expect(fileCalls).toEqual(['delete:core-a']);
		expect(notifications.find((n) => n.userId === 9)?.message.hu).toContain('Indoklás: Olvashatatlan');
	});

	test('csak a HR dönthet, és csak függő dokumentumról', async () => {
		await expect(reviewEmployeeDocument({ id: 200, decision: 'approve' }, fakeContext({ caps: OWN, userId: 9 }).context)).rejects.toThrow('Nincs jogosultságod');
		await expect(reviewEmployeeDocument({ id: 201, decision: 'approve' }, fakeContext({ caps: HR, userId: 7 }).context)).rejects.toThrow('ellenőrzésre váró');
	});
});
