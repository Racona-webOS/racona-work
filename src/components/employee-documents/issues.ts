/**
 * A dokumentumproblémák felületi szövegei (áttekintő oldal, Dashboard kártya).
 */

import type { DocumentIssue } from '../../../server/functions.js';
import { formatDate } from '../../utils/format.js';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** „Ellenőrzésre vár”, „Lejárt (2026. 10. 01.)”, „14 nap múlva lejár”, „Hiányzik”, „Fájl hiányzik” */
export function issueLabel(issue: DocumentIssue, t: Translate): string {
	switch (issue.kind) {
		case 'pending':
			return t('documents.status.pending');
		case 'expired':
			return t('documents.status.expired', { date: formatDate(issue.validUntil) });
		case 'expiring':
			return issue.daysLeft === 0
				? t('documents.status.expiresToday')
				: t('documents.status.expiresIn', { days: issue.daysLeft ?? 0 });
		case 'missing':
			return t('documentOverview.kind.missing');
		case 'fileMissing':
			return t('documents.status.fileMissing');
	}
}
