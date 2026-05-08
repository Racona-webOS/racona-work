<svelte:options customElement={{ tag: 'racona-work-project-permissions', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_ProjectPermissions = function () {
			return { tagName: 'racona-work-project-permissions' };
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
		ProjectListResult,
		EmployeeRow,
		PaginatedResult
	} from '../../server/functions.js';
	import AccessDenied from './AccessDenied.svelte';
	import Checkbox from './ui/Checkbox.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- Típusok (a szerver-oldali kivonat) ----------------------------------
	interface RoleRow {
		id: number;
		organizationId: number;
		key: string;
		name: string;
		description: string | null;
		isSystem: boolean;
		capabilities: string[];
		memberCount: number;
	}

	interface OverrideRow {
		userId: number;
		userName: string;
		userEmail: string;
		userImage: string | null;
		roles: Array<{ id: number; key: string; name: string; isSystem: boolean }>;
	}

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
	let savingUserId = $state<number | null>(null);

	// Új user modal
	let showAdd = $state(false);
	let addUserId = $state<number | null>(null);
	let addRoleIds = $state<Set<number>>(new Set());
	let addSaving = $state(false);

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
				status: 'active'
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

	// --- Szerepek mentése user-enként ----------------------------------------
	async function toggleRoleForUser(userId: number, roleId: number) {
		if (!selectedProject) return;
		const row = overrides.find((o) => o.userId === userId);
		const nextRoleIds = new Set(row?.roles.map((r) => r.id) ?? []);
		if (nextRoleIds.has(roleId)) nextRoleIds.delete(roleId);
		else nextRoleIds.add(roleId);

		savingUserId = userId;
		try {
			await sdk.remote.call('setProjectUserRoles', {
				projectId: selectedProject.id,
				userId,
				roleIds: [...nextRoleIds]
			});
			await loadOverrides(selectedProject.id);
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			savingUserId = null;
		}
	}

	async function handleRemoveUser(userId: number) {
		if (!selectedProject) return;
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('projects.permissions.removeConfirm'),
			message: t('projects.permissions.removeConfirm'),
			confirmLabel: t('projects.permissions.removeConfirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;

		try {
			await sdk.remote.call('setProjectUserRoles', {
				projectId: selectedProject.id,
				userId,
				roleIds: []
			});
			sdk?.ui?.toast?.(t('projects.permissions.removeSuccess'), 'success');
			await loadOverrides(selectedProject.id);
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	function openAddDialog() {
		addUserId = null;
		addRoleIds = new Set();
		showAdd = true;
	}

	function toggleAddRole(roleId: number) {
		const next = new Set(addRoleIds);
		if (next.has(roleId)) next.delete(roleId);
		else next.add(roleId);
		addRoleIds = next;
	}

	async function handleAddUser() {
		if (!selectedProject || !addUserId) return;
		if (addRoleIds.size === 0) {
			sdk?.ui?.toast?.(t('projects.permissions.roles') + ': ' + t('form.required'), 'error');
			return;
		}
		addSaving = true;
		try {
			await sdk.remote.call('setProjectUserRoles', {
				projectId: selectedProject.id,
				userId: addUserId,
				roleIds: [...addRoleIds]
			});
			sdk?.ui?.toast?.(t('projects.permissions.saveSuccess'), 'success');
			showAdd = false;
			await loadOverrides(selectedProject.id);
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			addSaving = false;
		}
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

	function userHasRole(row: OverrideRow, roleId: number): boolean {
		return row.roles.some((r) => r.id === roleId);
	}
</script>

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
						<div class="panel-header">
							<div>
								<h3>{selectedProject.name}</h3>
								<p class="hint">{t('projects.permissions.overridesHint')}</p>
							</div>
							{#if orgRoles.length > 0 && availableToAddUsers.length > 0}
								<button class="btn-primary" onclick={openAddDialog}>
									+ {t('projects.permissions.addUser')}
								</button>
							{/if}
						</div>

						{#if orgRoles.length === 0}
							<p class="empty-state">{t('projects.permissions.noOrgRoles')}</p>
						{:else if overridesLoading}
							<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
						{:else if overrides.length === 0}
							<p class="empty-state">{t('projects.permissions.empty')}</p>
						{:else}
							<div class="matrix-wrapper">
								<table class="matrix">
									<thead>
										<tr>
											<th class="user-col">User</th>
											{#each orgRoles as r (r.id)}
												<th class="role-col" title={r.description ?? ''}>
													{r.name}
													{#if r.isSystem}
														<span class="badge">{t('permissions.roles.systemBadge')}</span>
													{/if}
												</th>
											{/each}
											<th class="action-col"></th>
										</tr>
									</thead>
									<tbody>
										{#each overrides as row (row.userId)}
											<tr>
												<td class="user-col">
													<div class="user-cell">
														<div class="avatar">
															{#if row.userImage}
																<img src={row.userImage} alt={row.userName} />
															{:else}
																<div class="avatar-placeholder">
																	{row.userName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
																</div>
															{/if}
														</div>
														<div class="user-info">
															<span class="name">{row.userName}</span>
															<span class="email">{row.userEmail}</span>
														</div>
													</div>
												</td>
												{#each orgRoles as r (r.id)}
													<td class="role-col">
														<Checkbox
															checked={userHasRole(row, r.id)}
															disabled={savingUserId === row.userId}
															onCheckedChange={() => toggleRoleForUser(row.userId, r.id)}
														/>
													</td>
												{/each}
												<td class="action-col">
													<button
														class="remove-btn"
														title={t('projects.permissions.removeConfirm')}
														onclick={() => handleRemoveUser(row.userId)}
													>
														✕
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	{/if}

	<!-- Új user hozzárendelése modal -->
	{#if showAdd && selectedProject}
		<div class="modal-overlay" onclick={() => (showAdd = false)} role="presentation">
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
				<div class="modal-header">
					<h3>{t('projects.permissions.addUser')}</h3>
					<button class="icon-btn" onclick={() => (showAdd = false)}>✕</button>
				</div>
				<div class="modal-body">
					<label>
						<span>{t('projects.permissions.selectUser')}</span>
						<select class="input" bind:value={addUserId}>
							<option value={null}>{t('projects.permissions.selectUser')}</option>
							{#each availableToAddUsers as emp (emp.userId)}
								<option value={emp.userId}>{emp.userName} — {emp.userEmail}</option>
							{/each}
						</select>
					</label>

					<div class="roles-section">
						<h4>{t('projects.permissions.roles')}</h4>
						{#if orgRoles.length === 0}
							<p class="empty-state">{t('projects.permissions.noOrgRoles')}</p>
						{:else}
							<div class="role-options">
								{#each orgRoles as r (r.id)}
									<label class="role-option">
										<Checkbox
											checked={addRoleIds.has(r.id)}
											onCheckedChange={() => toggleAddRole(r.id)}
										/>
										<span class="role-option-name">
											{r.name}
											{#if r.isSystem}
												<span class="badge">{t('permissions.roles.systemBadge')}</span>
											{/if}
										</span>
										{#if r.description}
											<span class="role-option-desc">{r.description}</span>
										{/if}
									</label>
								{/each}
							</div>
						{/if}
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn-secondary" onclick={() => (showAdd = false)}>
						{t('form.cancel')}
					</button>
					<button
						class="btn-primary"
						onclick={handleAddUser}
						disabled={!addUserId || addRoleIds.size === 0 || addSaving}
					>
						{addSaving ? t('loading') : t('form.save')}
					</button>
				</div>
			</div>
		</div>
	{/if}
</section>

<style>
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

	.subtitle {
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
		font-size: 0.875rem;
	}

	.no-access {
		padding: 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		color: var(--color-muted-foreground, #64748b);
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

	.search {
		width: 100%;
	}

	.input {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
	}

	.input:focus {
		outline: none;
		border-color: var(--color-primary, #3730a3);
		box-shadow: 0 0 0 3px var(--color-primary-subtle, #eef2ff);
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

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.panel-header h3 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
		max-width: 520px;
	}

	.matrix-wrapper {
		overflow-x: auto;
	}

	.matrix {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.matrix th,
	.matrix td {
		padding: 0.5rem 0.5rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		text-align: left;
		vertical-align: middle;
	}

	.matrix thead th {
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.user-col {
		min-width: 200px;
	}

	.role-col {
		text-align: center;
		min-width: 120px;
	}

	.action-col {
		width: 32px;
		text-align: right;
	}

	.user-cell {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.avatar img {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		object-fit: cover;
	}

	.avatar-placeholder {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--color-primary-subtle, #e0e7ff);
		color: var(--color-primary, #3730a3);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.user-info .name {
		font-size: 0.85rem;
		font-weight: 500;
	}

	.user-info .email {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.badge {
		font-size: 0.6rem;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
		margin-left: 0.25rem;
	}

	.remove-btn {
		border: none;
		background: transparent;
		color: var(--color-muted-foreground, #94a3b8);
		cursor: pointer;
		font-size: 1rem;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
	}

	.remove-btn:hover {
		background: #fee2e2;
		color: #dc2626;
	}

	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-muted-foreground, #64748b);
		padding: 1rem 0;
		font-size: 0.85rem;
	}

	.spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--color-border, #e2e8f0);
		border-top-color: var(--color-primary, #3730a3);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.empty-state {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.85rem;
		padding: 1rem 0;
		text-align: center;
	}

	.btn-primary {
		background: var(--color-primary, #3730a3);
		color: #fff;
		border: none;
		padding: 0.45rem 0.9rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.btn-primary:hover { opacity: 0.9; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		color: var(--color-foreground, #0f172a);
		padding: 0.45rem 0.9rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.btn-secondary:hover { background: var(--color-accent, #f1f5f9); }

	.icon-btn {
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: 1.1rem;
		color: var(--color-muted-foreground, #64748b);
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
	}

	.icon-btn:hover { background: var(--color-accent, #f1f5f9); }

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: var(--color-card, #fff);
		border-radius: 0.75rem;
		width: 90%;
		max-width: 480px;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.modal-body {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		overflow-y: auto;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
	}

	.roles-section h4 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.role-options {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.role-option {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		cursor: pointer;
		align-items: start;
	}

	.role-option:hover {
		background: var(--color-accent, #f8fafc);
	}

	.role-option input {
		margin-top: 0.1rem;
	}

	.role-option-name {
		font-size: 0.85rem;
		font-weight: 500;
		display: flex;
		gap: 0.25rem;
		align-items: center;
		grid-column: 2;
	}

	.role-option-desc {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		grid-column: 2;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
	}

	:global(.dark) .projects-panel,
	:global(.dark) .overrides-panel,
	:global(.dark) .modal {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .project-item:hover,
	:global(.dark) .role-option:hover,
	:global(.dark) .btn-secondary:hover,
	:global(.dark) .icon-btn:hover {
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

	:global(.dark) .badge {
		background: oklch(0.269 0 0);
		color: oklch(0.708 0 0);
	}
</style>
