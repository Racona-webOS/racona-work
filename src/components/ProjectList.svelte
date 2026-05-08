<svelte:options customElement={{ tag: 'racona-work-project-list', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_ProjectList = function () {
			return { tagName: 'racona-work-project-list' };
		};
	}
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import {
		getOrganizationStore,
		createOrganizationStore
	} from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import type {
		Organization,
		ProjectRow,
		ProjectListResult
	} from '../../server/functions.js';
	import AccessDenied from './AccessDenied.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let canCreate = $state(false);

	let projects = $state<ProjectRow[]>([]);
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);

	let search = $state('');
	let statusFilter = $state<'all' | 'active' | 'paused' | 'completed' | 'archived'>('all');

	type StatusFilter = typeof statusFilter;
	const STATUS_OPTIONS: Array<{ value: StatusFilter; labelKey: string }> = [
		{ value: 'all', labelKey: 'projects.list.all' },
		{ value: 'active', labelKey: 'projects.status.active' },
		{ value: 'paused', labelKey: 'projects.status.paused' },
		{ value: 'completed', labelKey: 'projects.status.completed' },
		{ value: 'archived', labelKey: 'projects.status.archived' }
	];

	async function loadProjects() {
		if (!currentOrganization || !sdk?.remote) return;
		loading = true;
		errorMsg = null;
		try {
			const result = (await sdk.remote.call('listProjects', {
				organizationId: currentOrganization.id,
				status: statusFilter,
				search: search.trim() || undefined,
				pageSize: 200,
				sortBy: 'updated_at',
				sortOrder: 'desc'
			})) as ProjectListResult;
			projects = result?.data ?? [];
		} catch (err: any) {
			errorMsg = err?.message ?? t('error.loadFailed');
			projects = [];
		} finally {
			loading = false;
		}
	}

	function handleOpen(project: ProjectRow) {
		sdk?.ui?.navigateTo?.('ProjectDetail', { projectId: project.id });
	}

	function handleCreate() {
		sdk?.ui?.navigateTo?.('ProjectCreate', {});
	}

	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	function onSearchInput() {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(() => loadProjects(), 250);
	}

	function formatDate(raw: string | null): string {
		if (!raw) return '—';
		try {
			return new Date(raw).toLocaleDateString();
		} catch {
			return raw;
		}
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
			canCreate = orgStore.can('project.create');

			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
				currentOrganization = orgStore.currentOrganization;
				hasAccess = orgStore.hasAccess;
				canCreate = orgStore.can('project.create');
			}
		}

		if (currentOrganization) await loadProjects();
	});

	$effect(() => {
		const handleOrgChange = () => {
			const store = (window as any).__racona_work_org_store__ as OrganizationStore | undefined;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
				canCreate = store.can('project.create');
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	$effect(() => {
		currentOrganization;
		untrack(() => {
			if (currentOrganization && sdk?.remote) loadProjects();
		});
	});

	$effect(() => {
		statusFilter;
		untrack(() => {
			if (currentOrganization && sdk?.remote) loadProjects();
		});
	});
</script>

<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<div>
				<h2>{t('projects.list.title')}</h2>
				<p class="subtitle">{t('projects.subtitle')}</p>
			</div>
			{#if canCreate}
				<button class="btn-primary" onclick={handleCreate}>
					+ {t('projects.list.create')}
				</button>
			{/if}
		</div>

		<div class="toolbar">
			<input
				class="input search"
				type="text"
				placeholder={t('projects.list.search')}
				bind:value={search}
				oninput={onSearchInput}
			/>
			<div class="status-filter">
				{#each STATUS_OPTIONS as opt (opt.value)}
					<button
						class="chip"
						class:active={statusFilter === opt.value}
						onclick={() => (statusFilter = opt.value)}
					>
						{t(opt.labelKey)}
					</button>
				{/each}
			</div>
		</div>

		{#if errorMsg}
			<div class="error-banner">{errorMsg}</div>
		{/if}

		{#if loading}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if projects.length === 0}
			<p class="empty-state">{t('projects.list.empty')}</p>
		{:else}
			<div class="project-list">
				{#each projects as p (p.id)}
					<button class="project-card" onclick={() => handleOpen(p)}>
						<div class="project-main">
							<span class="project-name">{p.name}</span>
							<span class="status status-{p.status}">{t(`projects.status.${p.status}`)}</span>
						</div>
						{#if p.description}
							<p class="project-desc">{p.description}</p>
						{/if}
						<div class="project-meta">
							<span>📅 {formatDate(p.startDate)} – {formatDate(p.endDate)}</span>
							<span>👥 {p.memberCount} {t('projects.list.columns.members').toLowerCase()}</span>
							{#if p.createdByName}
								<span>✍️ {p.createdByName}</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</section>

<style>
	.page {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.subtitle {
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
		font-size: 0.875rem;
	}

	.toolbar {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.input {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
	}

	.search {
		flex: 1;
		min-width: 220px;
		max-width: 420px;
	}

	.status-filter {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.chip {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 999px;
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
		cursor: pointer;
		color: var(--color-muted-foreground, #64748b);
	}

	.chip:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.chip.active {
		background: var(--color-primary-subtle, #eef2ff);
		border-color: var(--color-primary, #3730a3);
		color: var(--color-primary, #3730a3);
		font-weight: 600;
	}

	.project-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 0.75rem;
	}

	.project-card {
		text-align: left;
		background: var(--color-card, #fff);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		padding: 1rem;
		cursor: pointer;
		transition: all 0.15s ease;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.project-card:hover {
		border-color: var(--color-primary, #3730a3);
		transform: translateY(-1px);
	}

	.project-main {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.project-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-foreground, #0f172a);
	}

	.project-desc {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-muted-foreground, #64748b);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.project-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.status {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		white-space: nowrap;
	}

	.status-active {
		background: #dcfce7;
		color: #15803d;
	}

	.status-paused {
		background: #fef3c7;
		color: #a16207;
	}

	.status-completed {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.status-archived {
		background: #e5e7eb;
		color: #374151;
	}

	.btn-primary {
		background: var(--color-primary, #3730a3);
		color: #fff;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		flex-shrink: 0;
	}

	.btn-primary:hover {
		opacity: 0.9;
	}

	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-muted-foreground, #64748b);
		padding: 1rem 0;
		font-size: 0.875rem;
	}

	.spinner {
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid var(--color-border, #e2e8f0);
		border-top-color: var(--color-primary, #3730a3);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.empty-state {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.875rem;
		margin: 0;
		padding: 2rem 0;
		text-align: center;
	}

	.error-banner {
		padding: 0.75rem 1rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.5rem;
		color: #dc2626;
		font-size: 0.875rem;
	}

	:global(.dark) .project-card {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .project-card:hover {
		border-color: var(--color-primary, oklch(0.66 0.12 264));
	}

	:global(.dark) .project-name {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .chip:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .chip.active {
		background: var(--color-accent, oklch(0.25 0.03 var(--primary-h, 264)));
	}

	:global(.dark) .status-active { background: rgba(22, 163, 74, 0.2); color: #86efac; }
	:global(.dark) .status-paused { background: rgba(202, 138, 4, 0.2); color: #fde68a; }
	:global(.dark) .status-completed { background: rgba(37, 99, 235, 0.2); color: #bfdbfe; }
	:global(.dark) .status-archived { background: oklch(0.3 0 0); color: oklch(0.75 0 0); }
</style>
