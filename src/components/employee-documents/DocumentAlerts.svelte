<!--
	Vezetői irányítópult — lejárt, hamarosan lejáró, hiányzó kötelező és fájl
	nélküli dolgozói dokumentumok (specs/employee-documents.md, K10). Ha nincs
	ilyen, semmit nem jelenít meg.
-->
<script lang="ts">
	import type { DocumentIssueKind, DocumentOverview } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { issueLabel } from './issues.js';

	let { pluginId = 'racona-work', organizationId }: { pluginId?: string; organizationId: number } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	/** A kártyán legfeljebb ennyi tétel; a többi az áttekintő oldalon. */
	const MAX_ITEMS = 5;
	const KINDS: DocumentIssueKind[] = ['pending', 'expired', 'expiring', 'missing', 'fileMissing'];

	let overview = $state<DocumentOverview | null>(null);

	$effect(() => {
		const orgId = organizationId;
		if (!sdk?.remote || !orgId) return;
		sdk.remote
			.call('getDocumentOverview', { organizationId: orgId })
			.then((result: DocumentOverview) => (overview = result))
			.catch(() => (overview = null));
	});

	function openEmployee(employeeId: number) {
		sdk?.ui?.navigateTo?.('EmployeeDetail', { employeeId, tab: 'documents' });
	}

	function openOverview() {
		sdk?.ui?.navigateTo?.('DocumentOverview');
	}
</script>

{#if overview && overview.issues.length > 0}
	<div class="alerts">
		<div class="header">
			<h3>{t('documentOverview.cardTitle')}</h3>
			<span class="count">{overview.issues.length}</span>
		</div>
		<div class="counts">
			{#each KINDS as kind (kind)}
				{#if overview.counts[kind] > 0}
					<span class="count-chip kind-{kind}">{t(`documentOverview.filter.${kind}`)}: {overview.counts[kind]}</span>
				{/if}
			{/each}
		</div>
		<ul class="alert-list">
			{#each overview.issues.slice(0, MAX_ITEMS) as issue (`${issue.kind}:${issue.employeeId}:${issue.typeId}:${issue.documentId}`)}
				<li class="alert">
					<button class="name" onclick={() => openEmployee(issue.employeeId)}>{issue.employeeName}</button>
					<span class="detail">{issue.title ?? issue.typeName}</span>
					<span class="badge kind-{issue.kind}">{issueLabel(issue, t)}</span>
				</li>
			{/each}
		</ul>
		<button class="more" onclick={openOverview}>{t('documentOverview.showAll')} →</button>
	</div>
{/if}

<style>
	.alerts {
		border: 1px solid var(--color-border, #e2e8f0);
		border-top: 5px solid #f59e0b;
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.header h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
	}

	.count {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		background: #fef3c7;
		color: #92400e;
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.count-chip {
		font-size: 0.75rem;
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
	}

	.alert-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.alert {
		display: grid;
		/* Fix szélességű jelvényoszlop, hogy a sorok oszlopai egy vonalba essenek */
		grid-template-columns: minmax(8rem, 1fr) minmax(8rem, 1.3fr) 11rem;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.85rem;
	}

	.name {
		background: none;
		border: none;
		padding: 0;
		text-align: left;
		font: inherit;
		font-weight: 600;
		color: var(--color-primary, #3730a3);
		cursor: pointer;
	}

	.name:hover {
		text-decoration: underline;
	}

	.detail {
		color: var(--color-muted-foreground, #64748b);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge {
		font-size: 0.72rem;
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
		white-space: nowrap;
		justify-self: end;
	}

	.kind-expired {
		background: #fee2e2;
		color: #b91c1c;
	}

	.kind-pending {
		background: #dbeafe;
		color: #1e40af;
	}

	:global(.dark) .kind-pending {
		background: rgba(59, 130, 246, 0.2);
		color: #93c5fd;
	}

	.kind-expiring,
	.kind-missing,
	.kind-fileMissing {
		background: #fef3c7;
		color: #92400e;
	}

	:global(.dark) .kind-expired {
		background: rgba(239, 68, 68, 0.2);
		color: #fca5a5;
	}

	:global(.dark) .kind-expiring,
	:global(.dark) .kind-missing,
	:global(.dark) .kind-fileMissing {
		background: rgba(245, 158, 11, 0.2);
		color: #fcd34d;
	}

	.more {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.85rem;
		color: var(--color-primary, #3730a3);
		cursor: pointer;
	}
</style>
