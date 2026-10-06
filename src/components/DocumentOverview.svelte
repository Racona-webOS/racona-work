<svelte:options customElement={{ tag: 'racona-work-document-overview', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_DocumentOverview = function () {
			return { tagName: 'racona-work-document-overview' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Dokumentum-áttekintés (specs/employee-documents.md, K10): a szervezet
	 * lejárt, hamarosan lejáró, hiányzó kötelező és fájl nélküli dokumentumai.
	 * A sorra kattintva a dolgozó adatlapja a Dokumentumok fülön nyílik meg.
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { DocumentIssue, DocumentIssueKind, DocumentOverview, Organization } from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { issueLabel } from './employee-documents/issues.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);

	let overview = $state<DocumentOverview | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let filter = $state<DocumentIssueKind | 'all'>('all');
	let search = $state('');

	const KINDS: DocumentIssueKind[] = ['pending', 'expired', 'expiring', 'missing', 'fileMissing'];

	const visible = $derived.by(() => {
		const query = search.trim().toLowerCase();
		return (overview?.issues ?? []).filter(
			(issue) =>
				(filter === 'all' || issue.kind === filter) &&
				(!query || issue.employeeName.toLowerCase().includes(query) || issue.typeName.toLowerCase().includes(query))
		);
	});

	async function load() {
		if (!currentOrganization) return;
		loading = true;
		loadError = null;
		try {
			overview = await sdk.remote.call('getDocumentOverview', { organizationId: currentOrganization.id });
		} catch (err: any) {
			loadError = err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.loadFailed');
		} finally {
			loading = false;
		}
	}

	function open(issue: DocumentIssue) {
		sdk?.ui?.navigateTo?.('EmployeeDetail', { employeeId: issue.employeeId, tab: 'documents' });
	}

	onMount(async () => {
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				orgStore = createOrganizationStore(pluginId, sdk);
			}
			currentOrganization = orgStore.currentOrganization;
			hasAccess = orgStore.hasAccess;
			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
				currentOrganization = orgStore.currentOrganization;
				hasAccess = orgStore.hasAccess;
			}
		}
	});

	$effect(() => {
		const handleOrgChange = () => {
			const store = (window as any).__racona_work_org_store__;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	$effect(() => {
		currentOrganization;
		untrack(() => {
			if (currentOrganization && sdk?.remote) load();
		});
	});
</script>

<div class="rw">
<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<div class="page-header-title">
				<h2>{t('documentOverview.title')}</h2>
				<p class="subtitle">{t('documentOverview.subtitle')}</p>
			</div>
			<button class="btn-secondary" onclick={load} disabled={loading}>{t('documentOverview.refresh')}</button>
		</div>

		{#if loadError}
			<div class="error-banner">{loadError}</div>
		{:else if loading && !overview}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if overview}
			<div class="toolbar">
				<div class="view-toggle">
					<button class="chip" class:active={filter === 'all'} onclick={() => (filter = 'all')}>
						{t('documentOverview.filter.all')} <span class="chip-count">{overview.issues.length}</span>
					</button>
					{#each KINDS as kind (kind)}
						<button class="chip" class:active={filter === kind} onclick={() => (filter = kind)}>
							{t(`documentOverview.filter.${kind}`)} <span class="chip-count">{overview.counts[kind]}</span>
						</button>
					{/each}
				</div>
				<input class="input search" type="search" placeholder={t('documentOverview.search')} bind:value={search} />
			</div>

			{#if overview.issues.length === 0}
				<p class="all-good">{t('documentOverview.allGood')}</p>
			{:else if visible.length === 0}
				<p class="empty-state">{t('documentOverview.noMatch')}</p>
			{:else}
				<ul class="issue-list">
					{#each visible as issue (`${issue.kind}:${issue.employeeId}:${issue.typeId}:${issue.documentId}`)}
						<li>
							<button class="issue" onclick={() => open(issue)}>
								<span class="who">
									<strong>{issue.employeeName}</strong>
									{#if issue.isExternal}<span class="ext">{t('employees.external.badge')}</span>{/if}
								</span>
								<span class="what">{issue.title ?? issue.typeName}</span>
								<span class="badge kind-{issue.kind}">{issueLabel(issue, t)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</section>
</div>

<style>
	@import '../styles/shared.css';

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		max-width: 900px;
	}

	.chip-count {
		font-size: 0.72rem;
		opacity: 0.75;
		margin-left: 0.15rem;
	}

	.search {
		width: 16rem;
	}

	.all-good {
		margin: 0;
		padding: 1rem;
		border-radius: 0.5rem;
		background: #ecfdf5;
		color: #065f46;
		max-width: 900px;
	}

	:global(.dark) .all-good {
		background: rgba(16, 185, 129, 0.15);
		color: #6ee7b7;
	}

	.issue-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		max-width: 900px;
	}

	.issue {
		width: 100%;
		display: grid;
		/* Fix szélességű jelvényoszlop, hogy a sorok oszlopai egy vonalba essenek */
		grid-template-columns: minmax(10rem, 1fr) minmax(10rem, 1.3fr) 11rem;
		align-items: center;
		gap: 1rem;
		padding: 0.625rem 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #fff);
		color: inherit;
		font: inherit;
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}

	.issue:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.who {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	.ext {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: #ede9fe;
		color: #6d28d9;
	}

	.what {
		color: var(--color-muted-foreground, #64748b);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge {
		font-size: 0.75rem;
		padding: 0.15rem 0.6rem;
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
</style>
