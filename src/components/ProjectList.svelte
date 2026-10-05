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
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { formatDate as formatAppDate } from '../utils/format.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

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
		return formatAppDate(raw);
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

<div class="rw">
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
						<div class="project-card-top">
							<div class="project-icon" data-status={p.status}>
								{p.name.charAt(0).toUpperCase()}
							</div>
							<span class="card-badges">
								{#if p.closedAt}
									<span class="status status-closed"><svg class="lock-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> {t('projects.closed')}</span>
								{/if}
								<span class="status status-{p.status}">{t(`projects.status.${p.status}`)}</span>
							</span>
						</div>
						<div class="project-body">
							<span class="project-name">{p.name}</span>
							{#if p.description}
								<p class="project-desc">{p.description}</p>
							{/if}
						</div>
						<div class="project-footer">
							<div class="project-meta-item">
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
								<span>{formatDate(p.startDate)} – {formatDate(p.endDate)}</span>
							</div>
							<div class="project-meta-right">
								<div class="project-meta-item">
									<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
									<span>{p.memberCount}</span>
								</div>
								{#if p.createdByName}
									<div class="project-meta-item">
										<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
										<span>{p.createdByName}</span>
									</div>
								{/if}
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</section>
</div>

<style>
	@import '../styles/shared.css';

	.page {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.toolbar {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
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

	.project-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 0.75rem;
	}

	.project-card {
		text-align: left;
		background: var(--color-card, #fff);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 1rem;
		padding: 1.25rem;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		position: relative;
		overflow: hidden;
	}

	.project-card::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: var(--card-accent, #e2e8f0);
		transition: background 0.2s ease;
	}

	.project-card:has(.status-active)::before { background: #22c55e; }
	.project-card:has(.status-paused)::before { background: #f59e0b; }
	.project-card:has(.status-completed)::before { background: #3b82f6; }
	.project-card:has(.status-archived)::before { background: #9ca3af; }

	.project-card:hover {
		border-color: var(--color-primary, #3730a3);
		box-shadow: 0 4px 16px rgba(55, 48, 163, 0.1);
		transform: translateY(-2px);
	}

	.project-card-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.project-icon {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.625rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		font-weight: 700;
		background: var(--color-primary-subtle, #eef2ff);
		color: var(--color-primary, #3730a3);
		flex-shrink: 0;
	}

	.project-icon[data-status="active"] { background: #dcfce7; color: #15803d; }
	.project-icon[data-status="paused"] { background: #fef3c7; color: #a16207; }
	.project-icon[data-status="completed"] { background: #dbeafe; color: #1d4ed8; }
	.project-icon[data-status="archived"] { background: #f3f4f6; color: #6b7280; }

	.project-body {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		flex: 1;
	}

	.project-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-foreground, #0f172a);
		line-height: 1.3;
	}

	.project-desc {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.5;
	}

	.project-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border, #f1f5f9);
		flex-wrap: wrap;
	}

	.project-meta-right {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.project-meta-item {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.project-meta-item svg {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.status {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		white-space: nowrap;
	}

	.status-active { background: #dcfce7; color: #15803d; }
	.status-paused { background: #fef3c7; color: #a16207; }
	.status-completed { background: #dbeafe; color: #1d4ed8; }
	.status-archived { background: #e5e7eb; color: #374151; }
	.status-closed {
		background: #fee2e2;
		color: #b91c1c;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.card-badges {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	:global(.dark) .project-card {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .project-card:hover {
		border-color: var(--color-primary, oklch(0.66 0.12 264));
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
	}

	:global(.dark) .project-name {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .project-footer {
		border-top-color: oklch(1 0 0 / 8%);
	}

	:global(.dark) .project-icon[data-status="active"] { background: rgba(22, 163, 74, 0.2); color: #86efac; }
	:global(.dark) .project-icon[data-status="paused"] { background: rgba(202, 138, 4, 0.2); color: #fde68a; }
	:global(.dark) .project-icon[data-status="completed"] { background: rgba(37, 99, 235, 0.2); color: #bfdbfe; }
	:global(.dark) .project-icon[data-status="archived"] { background: oklch(0.28 0 0); color: oklch(0.65 0 0); }
	:global(.dark) .project-icon { background: oklch(0.28 0.04 264); color: oklch(0.75 0.12 264); }

	:global(.dark) .status-active { background: rgba(22, 163, 74, 0.2); color: #86efac; }
	:global(.dark) .status-paused { background: rgba(202, 138, 4, 0.2); color: #fde68a; }
	:global(.dark) .status-completed { background: rgba(37, 99, 235, 0.2); color: #bfdbfe; }
	:global(.dark) .status-archived { background: oklch(0.3 0 0); color: oklch(0.75 0 0); }
	:global(.dark) .status-closed { background: rgba(220, 38, 38, 0.2); color: #fca5a5; }
</style>
