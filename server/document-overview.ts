/**
 * Dokumentum-áttekintés (specs/employee-documents.md, K10, K11): a szervezet
 * lejárt, hamarosan lejáró, hiányzó kötelező és fájl nélküli dokumentumai.
 *
 * Egy helyen számoljuk, és ezt használja az áttekintő oldal, a Dashboard
 * kártya és a dolgozólista jelvénye/szűrője. A kilépett (inaktív) dolgozók
 * kimaradnak; a külsős dolgozókra is vonatkozik (D7).
 */

import type { RemoteContext } from './context.js';
import { todayInBudapest } from './dates.js';
import { computeExpiry } from './employee-documents.js';
import { hasCapability, requireCapability } from './permissions.js';

const SCHEMA = 'app__racona_work';

export type DocumentIssueKind = 'pending' | 'expired' | 'expiring' | 'missing' | 'fileMissing';

export interface DocumentIssue {
	kind: DocumentIssueKind;
	employeeId: number;
	employeeName: string;
	isExternal: boolean;
	typeId: number;
	typeName: string;
	/** Hiányzó típusnál nincs dokumentum */
	documentId: number | null;
	title: string | null;
	validUntil: string | null;
	daysLeft: number | null;
}

export type DocumentIssueCounts = Record<DocumentIssueKind, number>;

export interface DocumentOverview {
	issues: DocumentIssue[];
	counts: DocumentIssueCounts;
	/** Hány (nem kilépett) dolgozót érint */
	employeeCount: number;
}

/** Az elemek sorrendje: a teendő előre (ellenőrzésre vár, lejárt, lejáró, hiányzó, fájl nélküli). */
const KIND_ORDER: Record<DocumentIssueKind, number> = { pending: 0, expired: 1, expiring: 2, missing: 3, fileMissing: 4 };

export function emptyCounts(): DocumentIssueCounts {
	return { pending: 0, expired: 0, expiring: 0, missing: 0, fileMissing: 0 };
}

export function countIssues(issues: DocumentIssue[]): DocumentIssueCounts {
	const counts = emptyCounts();
	for (const issue of issues) counts[issue.kind]++;
	return counts;
}

/**
 * Belső segéd, jogosultság-ellenőrzés nélkül: a szervezet összes problémája.
 *
 * @param employeeIds - Csak ezekre a dolgozókra (pl. egy lista lapja); üres: mind.
 */
export async function loadDocumentIssues(
	context: RemoteContext,
	organizationId: number,
	today: string = todayInBudapest(),
	employeeIds?: number[]
): Promise<DocumentIssue[]> {
	const onlySome = Array.isArray(employeeIds) && employeeIds.length > 0;

	const employees = await context.db.query(
		`SELECT e.id, e.is_external, COALESCE(NULLIF(trim(u.full_name), ''), u.email) AS name
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.organization_id = $1 AND e.status <> 'inactive'
		    AND ($2::boolean IS FALSE OR e.id = ANY($3::int[]))`,
		[organizationId, onlySome, onlySome ? employeeIds : []]
	);
	if (employees.rows.length === 0) return [];
	const byId = new Map<number, { name: string; isExternal: boolean }>(
		employees.rows.map((row: any) => [row.id, { name: row.name ?? '—', isExternal: row.is_external === true }])
	);
	const ids = [...byId.keys()];

	const docs = await context.db.query(
		`SELECT d.id, d.employee_id, d.title, d.type_id, d.status,
		        to_char(d.valid_until, 'YYYY-MM-DD') AS valid_day,
		        t.name AS type_name, t.file_mode, t.has_expiry, t.reminder_days,
		        EXISTS (SELECT 1 FROM ${SCHEMA}.employee_document_files f WHERE f.document_id = d.id) AS has_file
		   FROM ${SCHEMA}.employee_documents d
		   JOIN ${SCHEMA}.document_types t ON t.id = d.type_id
		  WHERE d.employee_id = ANY($1::int[]) AND d.status IN ('active', 'pending')`,
		[ids]
	);

	const requiredTypes = await context.db.query(
		`SELECT id, name FROM ${SCHEMA}.document_types
		  WHERE organization_id = $1 AND is_required AND archived_at IS NULL
		  ORDER BY sort_order, lower(name)`,
		[organizationId]
	);

	const issues: DocumentIssue[] = [];
	const present = new Set<string>();

	for (const row of docs.rows) {
		const employee = byId.get(row.employee_id);
		if (!employee) continue;
		const base = {
			employeeId: row.employee_id,
			employeeName: employee.name,
			isExternal: employee.isExternal,
			typeId: row.type_id,
			typeName: row.type_name,
			documentId: row.id,
			title: row.title,
			validUntil: row.valid_day ?? null
		};
		// A dolgozó beküldése: a HR-nek el kell bírálnia; addig nem számít meglévőnek
		if (row.status === 'pending') {
			issues.push({ ...base, kind: 'pending', daysLeft: null });
			continue;
		}
		present.add(`${row.employee_id}:${row.type_id}`);
		if (row.has_expiry && row.valid_day) {
			const { expiryStatus, daysLeft } = computeExpiry(row.valid_day, today, (row.reminder_days ?? []).map(Number));
			if (expiryStatus === 'expired' || expiryStatus === 'expiring') {
				issues.push({ ...base, kind: expiryStatus, daysLeft });
			}
		}
		if (row.file_mode === 'required' && row.has_file !== true) {
			issues.push({ ...base, kind: 'fileMissing', daysLeft: null });
		}
	}

	for (const [employeeId, employee] of byId) {
		for (const type of requiredTypes.rows) {
			if (present.has(`${employeeId}:${type.id}`)) continue;
			issues.push({
				kind: 'missing',
				employeeId,
				employeeName: employee.name,
				isExternal: employee.isExternal,
				typeId: type.id,
				typeName: type.name,
				documentId: null,
				title: null,
				validUntil: null,
				daysLeft: null
			});
		}
	}

	return issues.sort(
		(a, b) =>
			KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
			(a.daysLeft ?? 0) - (b.daysLeft ?? 0) ||
			a.employeeName.localeCompare(b.employeeName, 'hu') ||
			a.typeName.localeCompare(b.typeName, 'hu')
	);
}

/** A hívó láthatja-e a szervezet dokumentumait (áttekintés, dolgozólista jelvény). */
export async function canViewOrganizationDocuments(
	context: RemoteContext,
	organizationId: number
): Promise<boolean> {
	return (
		(await hasCapability(context, organizationId, 'employee.documents.view')) ||
		(await hasCapability(context, organizationId, 'employee.documents.manage'))
	);
}

/** Az áttekintő oldal és a Dashboard kártya adatai. */
export async function getDocumentOverview(
	params: { organizationId: number },
	context: RemoteContext
): Promise<DocumentOverview> {
	const organizationId = Number(params?.organizationId);
	if (!Number.isInteger(organizationId) || organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!(await canViewOrganizationDocuments(context, organizationId))) {
		await requireCapability(context, organizationId, 'employee.documents.view');
	}
	const issues = await loadDocumentIssues(context, organizationId);
	return {
		issues,
		counts: countIssues(issues),
		employeeCount: new Set(issues.map((i) => i.employeeId)).size
	};
}
