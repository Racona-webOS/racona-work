<svelte:options customElement={{ tag: 'racona-work-project-permissions', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_ProjectPermissions = function () {
			return { tagName: 'racona-work-project-permissions' };
		};
	}
</script>

<!--
	Projekt-szintű szerep-felülbírálások projektenként.

	Bal oldalt a szervezet projektjei, jobb oldalt a kiválasztott projekt
	mátrixa. A mátrixot és a hozzáadó ablakot a ProjectDetail Jogosultságok
	füle (project-detail/PermissionsTab) adja, itt csak a projektválasztás és
	az adatok betöltése él.
-->
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
		ProjectListResult,
		EmployeeRow,
		PaginatedResult
	} from '../../server/functions.js';
	import AccessDenied from './AccessDenied.svelte';
	import PermissionsTab from './project-detail/PermissionsTab.svelte';
	import type { RoleRow, OverrideRow } from './project-detail/types.js';
	import { resolveSdk, translate } from '../utils/sdk.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	// --- Store / állapot ------------------------------------------------------
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let canManage = $state(false);

	let projects = $state<ProjectRow[]>([]);
	let projectsLoading = $state(false);
	let projectFilter = $state('');
	let selectedProjectId = $state<number | null>(null);
	let selectedProject = $derived(projects.find((p) => p.id === selectedProjectId) ?? null);

	let orgRoles = $state<RoleRow[]>([]);
	let orgEmployees = $state<EmployeeRow[]>([]);

	let overrides = $state<OverrideRow[]>([]);
	let overridesLoading = $state(false);

	// --- Betöltés ------------------------------------------------------------
	async function loadProjects() {
		if (!currentOrganization || !sdk?.remote) return;
		projectsLoading = true;
		try {
			const result = (await sdk.remote.call('listProjects', {
				organizationId: currentOrganization.id,
				pageSize: 500,
				sortBy: 'name',
				sortOrder: 'asc'
			})) as ProjectListResult;
			projects = result?.data ?? [];
			if (projects.length > 0) {
				const stillExists = projects.find((p) => p.id === selectedProjectId);
				if (!stillExists) selectProject(projects[0].id);
			} else {
				selectedProjectId = null;
				overrides = [];
			}
		} catch {
			projects = [];
		} finally {
			projectsLoading = false;
		}
	}

	async function loadOrgRoles() {
		if (!currentOrganization || !sdk?.remote) return;
		try {
			const result = (await sdk.remote.call('listRoles', {
				organizationId: currentOrganization.id
			})) as RoleRow[];
			orgRoles = Array.isArray(result) ? result : [];
		} catch {
			orgRoles = [];
		}
	}

	async function loadOrgEmployees() {
		if (!currentOrganization || !sdk?.remote) return;
		try {
			const result = (await sdk.remote.call('getEmployees', {
				organizationId: currentOrganization.id,
				pageSize: 500,
				status: 'active',
				// A külsősök is kaphatnak projekt-szerepet
				includeExternal: true
			})) as PaginatedResult<EmployeeRow>;
			orgEmployees = result?.data ?? [];
		} catch {
			orgEmployees = [];
		}
	}

	async function loadOverrides(projectId: number) {
		if (!sdk?.remote) return;
		overridesLoading = true;
		try {
			const result = (await sdk.remote.call('listProjectRoleOverrides', {
				projectId
			})) as OverrideRow[];
			overrides = Array.isArray(result) ? result : [];
		} catch {
			overrides = [];
		} finally {
			overridesLoading = false;
		}
	}

	function selectProject(id: number) {
		selectedProjectId = id;
		loadOverrides(id);
	}

	/** A mátrix változása után (PermissionsTab onChanged). */
	async function reloadOverrides() {
		if (selectedProjectId !== null) await loadOverrides(selectedProjectId);
	}

	// Azok a userek, akiket még nem érint projekt-szintű felülbírálás ebben a projektben.
	// (Az org szintű szerepeken felül ide projekt-specifikus extra szerep adható.)
	let availableToAddUsers = $derived.by(() => {
		const existing = new Set(overrides.map((o) => o.userId));
		return orgEmployees.filter((e) => !existing.has(e.userId));
	});

	let filteredProjects = $derived.by(() => {
		const q = projectFilter.trim().toLowerCase();
		if (!q) return projects;
		return projects.filter(
			(p) =>
				p.name.toLowerCase().includes(q) ||
				(p.description ?? '').toLowerCase().includes(q)
		);
	});

	// --- Inicializálás --------------------------------------------------------
	onMount(async () => {
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				orgStore = createOrganizationStore(pluginId, sdk);
			}

			currentOrganization = orgStore.currentOrganization;
			hasAccess = orgStore.hasAccess;
			canManage = orgStore.can('project.manage');

			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
				currentOrganization = orgStore.currentOrganization;
				hasAccess = orgStore.hasAccess;
				canManage = orgStore.can('project.manage');
			}
		}

		if (currentOrganization && canManage) {
			await Promise.all([loadProjects(), loadOrgRoles(), loadOrgEmployees()]);
		}
	});

	$effect(() => {
		const handleOrgChange = () => {
			const store = (window as any).__racona_work_org_store__ as OrganizationStore | undefined;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
				canManage = store.can('project.manage');
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	$effect(() => {
		currentOrganization;
		untrack(() => {
			if (currentOrganization && sdk?.remote && canManage) {
				loadProjects();
				loadOrgRoles();
				loadOrgEmployees();
			}
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
				<h2>{t('projects.permissions.title')}</h2>
				<p class="subtitle">{t('projects.permissions.subtitle')}</p>
			</div>
		</div>

		{#if !canManage}
			<div class="no-access">
				<p>{t('projects.permissions.noAccess')}</p>
			</div>
		{:else if projectsLoading && projects.length === 0}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if projects.length === 0}
			<p class="empty-state">{t('projects.permissions.noProjects')}</p>
		{:else}
			<div class="layout">
				<!-- Projekt lista -->
				<aside class="projects-panel">
					<input
						class="input search"
						type="text"
						placeholder={t('projects.list.search')}
						bind:value={projectFilter}
					/>
					<ul class="project-list">
						{#each filteredProjects as p (p.id)}
							<li>
								<button
									class="project-item"
									class:active={selectedProjectId === p.id}
									onclick={() => selectProject(p.id)}
								>
									<span class="project-name">{p.name}</span>
									<span class="status-pill status-{p.status}">
										{t(`projects.status.${p.status}`)}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</aside>

				<!-- Felülbírálások -->
				<div class="overrides-panel">
					{#if !selectedProject}
						<p class="empty-state">{t('projects.permissions.selectProject')}</p>
					{:else}
						<h3 class="project-title">{selectedProject.name}</h3>
						<!-- Projektváltáskor újraépül, így a nyitott hozzáadó ablak sem marad meg -->
						{#key selectedProject.id}
							<PermissionsTab
								{pluginId}
								project={selectedProject}
								{orgRoles}
								{overrides}
								{overridesLoading}
								availableToOverride={availableToAddUsers}
								onChanged={reloadOverrides}
							/>
						{/key}
					{/if}
				</div>
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

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.layout {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 1rem;
		align-items: start;
	}

	@media (max-width: 960px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}

	.projects-panel,
	.overrides-panel {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #fff);
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.overrides-panel {
		padding: 1rem;
	}

	.project-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
	}

	.search {
		width: 100%;
	}

	.project-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		overflow-y: auto;
		max-height: 480px;
	}

	.project-item {
		width: 100%;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		text-align: left;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.project-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.project-item.active {
		background: var(--color-primary-subtle, #eef2ff);
		border-color: var(--color-primary, #3730a3);
	}

	.project-name {
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status-pill {
		font-size: 0.65rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
		white-space: nowrap;
	}

	.status-active { background: #dcfce7; color: #15803d; }
	.status-paused { background: #fef3c7; color: #a16207; }
	.status-completed { background: #dbeafe; color: #1d4ed8; }
	.status-archived { background: #e5e7eb; color: #374151; }

	:global(.dark) .projects-panel,
	:global(.dark) .overrides-panel {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .project-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .project-item.active {
		background: var(--color-accent, oklch(0.25 0.03 var(--primary-h, 264)));
		border-color: var(--color-primary, oklch(0.66 0.12 264));
	}

	:global(.dark) .status-active { background: rgba(22, 163, 74, 0.2); color: #86efac; }
	:global(.dark) .status-paused { background: rgba(202, 138, 4, 0.2); color: #fde68a; }
	:global(.dark) .status-completed { background: rgba(37, 99, 235, 0.2); color: #bfdbfe; }
	:global(.dark) .status-archived { background: oklch(0.3 0 0); color: oklch(0.75 0 0); }
</style>
