<svelte:options customElement={{ tag: 'racona-work-permissions-settings', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_PermissionsSettings = function () {
			return { tagName: 'racona-work-permissions-settings' };
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
	import type { EmployeeRow, PaginatedResult, Organization } from '../../server/functions.js';
	import AccessDenied from './AccessDenied.svelte';
	import Checkbox from './ui/Checkbox.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- Képesség csoportok (UI kategorizáláshoz) -----------------------------
	const CAPABILITY_GROUPS: Array<{ labelKey: string; items: string[] }> = [
		{ labelKey: 'capabilities.group.org', items: ['org.manage'] },
		{
			labelKey: 'capabilities.group.members',
			items: ['members.view', 'members.manage', 'roles.manage']
		},
		{
			labelKey: 'capabilities.group.projects',
			items: ['project.create', 'project.manage', 'project.view.all', 'project.view.own']
		},
		{
			labelKey: 'capabilities.group.leave',
			items: ['leave.request', 'leave.approve', 'leave.balance.manage']
		},
		{
			labelKey: 'capabilities.group.employees',
			items: ['employee.view', 'employee.manage']
		}
	];

	// --- Típusok (szerver reexport) ------------------------------------------
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

	interface RoleMemberRow {
		userId: number;
		userName: string;
		userEmail: string;
		userImage: string | null;
		assignedAt: string;
	}

	// --- Store / állapot ------------------------------------------------------
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let canManageRoles = $state(false);

	let roles = $state<RoleRow[]>([]);
	let rolesLoading = $state(false);
	let selectedRoleId = $state<number | null>(null);
	let selectedRole = $derived(roles.find((r) => r.id === selectedRoleId) ?? null);

	let members = $state<RoleMemberRow[]>([]);
	let membersLoading = $state(false);

	// Szerkesztő állapot
	let editName = $state('');
	let editDescription = $state('');
	let editCapabilities = $state<Set<string>>(new Set());
	let saving = $state(false);

	// Create dialógus
	let showCreate = $state(false);
	let newName = $state('');
	let newKey = $state('');
	let newDescription = $state('');
	let newCapabilities = $state<Set<string>>(new Set());

	// Tag hozzáadás dialógus
	let showAddMember = $state(false);
	let orgEmployees = $state<EmployeeRow[]>([]);
	let addMemberUserId = $state<number | null>(null);
	let addMemberLoading = $state(false);

	// --- Betöltés ------------------------------------------------------------
	async function loadRoles() {
		if (!currentOrganization || !sdk?.remote) return;
		rolesLoading = true;
		try {
			const result = (await sdk.remote.call('listRoles', {
				organizationId: currentOrganization.id
			})) as RoleRow[];
			roles = Array.isArray(result) ? result : [];
			if (roles.length > 0) {
				const stillExists = roles.find((r) => r.id === selectedRoleId);
				if (!stillExists) {
					selectRole(roles[0].id);
				} else {
					hydrateEditor(stillExists);
				}
			} else {
				selectedRoleId = null;
				members = [];
			}
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.loadFailed'), 'error');
		} finally {
			rolesLoading = false;
		}
	}

	async function loadMembers(roleId: number) {
		if (!sdk?.remote) return;
		membersLoading = true;
		try {
			const result = (await sdk.remote.call('listRoleMembers', { roleId })) as RoleMemberRow[];
			members = Array.isArray(result) ? result : [];
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.loadFailed'), 'error');
			members = [];
		} finally {
			membersLoading = false;
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
		} catch (err: any) {
			console.warn('[PermissionsSettings] Dolgozók betöltése sikertelen:', err);
			orgEmployees = [];
		}
	}

	function hydrateEditor(role: RoleRow) {
		editName = role.name;
		editDescription = role.description ?? '';
		editCapabilities = new Set(role.capabilities);
	}

	function selectRole(id: number) {
		selectedRoleId = id;
		const role = roles.find((r) => r.id === id);
		if (role) {
			hydrateEditor(role);
			loadMembers(id);
		}
	}

	// --- Mentés / törlés / létrehozás ----------------------------------------
	async function handleSaveRole() {
		if (!selectedRole) return;
		if (!editName.trim()) {
			sdk?.ui?.toast(t('permissions.role.name') + ': ' + t('form.required'), 'error');
			return;
		}
		saving = true;
		try {
			await sdk.remote.call('updateRole', {
				id: selectedRole.id,
				name: editName.trim(),
				description: editDescription.trim() || null,
				capabilities: [...editCapabilities]
			});
			sdk?.ui?.toast(t('permissions.role.saveSuccess'), 'success');
			await loadRoles();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	async function handleDeleteRole() {
		if (!selectedRole || selectedRole.isSystem) return;
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('permissions.role.delete'),
			message: t('permissions.role.deleteConfirm'),
			confirmLabel: t('permissions.role.delete'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		saving = true;
		try {
			await sdk.remote.call('deleteRole', { id: selectedRole.id });
			sdk?.ui?.toast(t('permissions.role.deleteSuccess'), 'success');
			selectedRoleId = null;
			await loadRoles();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.deleteFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	function openCreateDialog() {
		newName = '';
		newKey = '';
		newDescription = '';
		newCapabilities = new Set();
		showCreate = true;
	}

	async function handleCreateRole() {
		if (!currentOrganization) return;
		if (!newName.trim()) {
			sdk?.ui?.toast(t('permissions.role.name') + ': ' + t('form.required'), 'error');
			return;
		}
		saving = true;
		try {
			const created = (await sdk.remote.call('createRole', {
				organizationId: currentOrganization.id,
				name: newName.trim(),
				key: newKey.trim() || undefined,
				description: newDescription.trim() || undefined,
				capabilities: [...newCapabilities]
			})) as RoleRow;
			sdk?.ui?.toast(t('permissions.role.createSuccess'), 'success');
			showCreate = false;
			await loadRoles();
			if (created?.id) selectRole(created.id);
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	// --- Tagok ---------------------------------------------------------------
	async function handleAddMember() {
		if (!selectedRole || !addMemberUserId) return;
		addMemberLoading = true;
		try {
			await sdk.remote.call('addRoleMember', {
				roleId: selectedRole.id,
				userId: addMemberUserId
			});
			sdk?.ui?.toast(t('permissions.members.addSuccess'), 'success');
			showAddMember = false;
			addMemberUserId = null;
			await Promise.all([loadMembers(selectedRole.id), loadRoles()]);
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			addMemberLoading = false;
		}
	}

	async function handleRemoveMember(userId: number) {
		if (!selectedRole) return;
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('permissions.members.removeConfirm'),
			message: t('permissions.members.removeConfirm'),
			confirmLabel: t('permissions.members.removeConfirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('removeRoleMember', { roleId: selectedRole.id, userId });
			sdk?.ui?.toast(t('permissions.members.removeSuccess'), 'success');
			await Promise.all([loadMembers(selectedRole.id), loadRoles()]);
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	// --- Képesség toggle ------------------------------------------------------
	function toggleEditCapability(cap: string) {
		const next = new Set(editCapabilities);
		if (next.has(cap)) next.delete(cap);
		else next.add(cap);
		editCapabilities = next;
	}

	function toggleNewCapability(cap: string) {
		const next = new Set(newCapabilities);
		if (next.has(cap)) next.delete(cap);
		else next.add(cap);
		newCapabilities = next;
	}

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
			canManageRoles = orgStore.can('roles.manage');

			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
				currentOrganization = orgStore.currentOrganization;
				hasAccess = orgStore.hasAccess;
				canManageRoles = orgStore.can('roles.manage');
			}
		}

		if (currentOrganization) {
			await Promise.all([loadRoles(), loadOrgEmployees()]);
		}
	});

	// Szervezet váltás figyelése
	$effect(() => {
		const handleOrgChange = () => {
			const store = (window as any).__racona_work_org_store__ as OrganizationStore | undefined;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
				canManageRoles = store.can('roles.manage');
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	$effect(() => {
		currentOrganization;
		untrack(() => {
			if (currentOrganization && sdk?.remote) {
				loadRoles();
				loadOrgEmployees();
			}
		});
	});

	let availableToAdd = $derived.by(() => {
		if (!selectedRole) return [] as EmployeeRow[];
		const existing = new Set(members.map((m) => m.userId));
		return orgEmployees.filter((e) => !existing.has(e.userId));
	});
</script>

<div class="rw">
<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<h2>{t('settings.permissions.title')}</h2>
			<p class="subtitle">{t('settings.permissions.subtitle')}</p>
		</div>

		{#if !canManageRoles}
			<div class="no-access">
				<p>{t('permissions.noAccess')}</p>
			</div>
		{:else}
			<div class="layout">
				<!-- Szerep lista -->
				<aside class="roles-panel">
					<div class="panel-header">
						<h3>{t('permissions.roles.title')}</h3>
						<button class="btn-primary" onclick={openCreateDialog}>
							+ {t('permissions.roles.new')}
						</button>
					</div>

					{#if rolesLoading}
						<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
					{:else if roles.length === 0}
						<p class="empty-state">{t('permissions.roles.empty')}</p>
					{:else}
						<ul class="role-list">
							{#each roles as role (role.id)}
								<li>
									<button
										class="role-item"
										class:active={selectedRoleId === role.id}
										onclick={() => selectRole(role.id)}
									>
										<span class="role-name">
											{role.name}
											{#if role.isSystem}
												<span class="badge">{t('permissions.roles.systemBadge')}</span>
											{/if}
										</span>
										<span class="role-meta">
											<span>{role.capabilities.length} cap</span>
											<span>·</span>
											<span>{role.memberCount} {t('permissions.roles.members')}</span>
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</aside>

				<!-- Szerkesztő -->
				<div class="editor-panel">
					{#if !selectedRole}
						<p class="empty-state">{t('permissions.roles.empty')}</p>
					{:else}
						<div class="editor-header">
							<h3>
								{selectedRole.name}
								{#if selectedRole.isSystem}
									<span class="badge">{t('permissions.roles.systemBadge')}</span>
								{/if}
							</h3>
							{#if selectedRole.isSystem}
								<p class="hint">{t('permissions.role.systemHint')}</p>
							{/if}
						</div>

						<div class="form-grid">
							<label>
								<span>{t('permissions.role.name')}</span>
								<input
									class="input"
									type="text"
									bind:value={editName}
									disabled={selectedRole.isSystem}
								/>
							</label>
							<label>
								<span>{t('permissions.role.key')}</span>
								<input class="input" type="text" value={selectedRole.key} disabled />
							</label>
							<label class="full">
								<span>{t('permissions.role.description')}</span>
								<textarea
									class="input textarea"
									rows="2"
									bind:value={editDescription}
								></textarea>
							</label>
						</div>

						<div class="caps-section">
							<h4>{t('permissions.role.capabilities')}</h4>
							<div class="caps-groups">
								{#each CAPABILITY_GROUPS as group (group.labelKey)}
									<div class="cap-group">
										<div class="cap-group-label">{t(group.labelKey)}</div>
										<div class="cap-items">
											{#each group.items as cap (cap)}
												<label class="cap-item">
													<Checkbox
														checked={editCapabilities.has(cap)}
														onCheckedChange={() => toggleEditCapability(cap)}
													/>
													<span>{t(`capability.${cap}`)}</span>
												</label>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						</div>

						<div class="editor-actions">
							{#if !selectedRole.isSystem}
								<button
									class="btn-danger"
									onclick={handleDeleteRole}
									disabled={saving}
								>
									{t('permissions.role.delete')}
								</button>
							{/if}
							<div class="spacer"></div>
							<button class="btn-primary" onclick={handleSaveRole} disabled={saving}>
								{saving ? t('loading') : t('permissions.role.save')}
							</button>
						</div>
					{/if}
				</div>

				<!-- Tagok -->
				<aside class="members-panel">
					<div class="panel-header">
						<h3>{t('permissions.members.title')}</h3>
						{#if selectedRole && availableToAdd.length > 0}
							<button class="btn-secondary" onclick={() => (showAddMember = true)}>
								+ {t('permissions.members.add')}
							</button>
						{/if}
					</div>

					{#if !selectedRole}
						<p class="empty-state">—</p>
					{:else if membersLoading}
						<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
					{:else if members.length === 0}
						<p class="empty-state">{t('permissions.members.empty')}</p>
					{:else}
						<ul class="member-list">
							{#each members as m (m.userId)}
								<li class="member-item">
									<div class="avatar">
										{#if m.userImage}
											<img src={m.userImage} alt={m.userName} />
										{:else}
											<div class="avatar-placeholder">
												{m.userName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
											</div>
										{/if}
									</div>
									<div class="member-info">
										<span class="name">{m.userName}</span>
										<span class="email">{m.userEmail}</span>
									</div>
									<button
										class="remove-btn"
										title={t('permissions.members.removeConfirm')}
										onclick={() => handleRemoveMember(m.userId)}
									>
										✕
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</aside>
			</div>
		{/if}
	{/if}

	<!-- Új szerep modal -->
	{#if showCreate}
		<div
			class="modal-overlay"
			onclick={() => (showCreate = false)}
			role="presentation"
		>
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
				<div class="modal-header">
					<h3>{t('permissions.roles.new')}</h3>
					<button class="icon-btn" onclick={() => (showCreate = false)}>✕</button>
				</div>
				<div class="modal-body">
					<label>
						<span>{t('permissions.role.name')} *</span>
						<input class="input" type="text" bind:value={newName} placeholder="pl. Csoportvezető" />
					</label>
					<label>
						<span>{t('permissions.role.key')}</span>
						<input class="input" type="text" bind:value={newKey} placeholder="team_lead" />
						<small class="hint">{t('permissions.role.keyHint')}</small>
					</label>
					<label>
						<span>{t('permissions.role.description')}</span>
						<textarea class="input textarea" rows="2" bind:value={newDescription}></textarea>
					</label>

					<div class="caps-section">
						<h4>{t('permissions.role.capabilities')}</h4>
						<div class="caps-groups">
							{#each CAPABILITY_GROUPS as group (group.labelKey)}
								<div class="cap-group">
									<div class="cap-group-label">{t(group.labelKey)}</div>
									<div class="cap-items">
										{#each group.items as cap (cap)}
											<label class="cap-item">
												<Checkbox
													checked={newCapabilities.has(cap)}
													onCheckedChange={() => toggleNewCapability(cap)}
												/>
												<span>{t(`capability.${cap}`)}</span>
											</label>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn-secondary" onclick={() => (showCreate = false)}>
						{t('form.cancel')}
					</button>
					<button class="btn-primary" onclick={handleCreateRole} disabled={saving}>
						{saving ? t('loading') : t('form.save')}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Tag hozzáadása modal -->
	{#if showAddMember && selectedRole}
		<div
			class="modal-overlay"
			onclick={() => (showAddMember = false)}
			role="presentation"
		>
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
				<div class="modal-header">
					<h3>{t('permissions.members.add')}</h3>
					<button class="icon-btn" onclick={() => (showAddMember = false)}>✕</button>
				</div>
				<div class="modal-body">
					<label>
						<span>{t('permissions.members.selectEmployee')}</span>
						<select class="input" bind:value={addMemberUserId}>
							<option value={null}>{t('permissions.members.selectEmployee')}</option>
							{#each availableToAdd as emp (emp.userId)}
								<option value={emp.userId}>{emp.userName} — {emp.userEmail}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="modal-footer">
					<button class="btn-secondary" onclick={() => (showAddMember = false)}>
						{t('form.cancel')}
					</button>
					<button
						class="btn-primary"
						onclick={handleAddMember}
						disabled={!addMemberUserId || addMemberLoading}
					>
						{addMemberLoading ? t('loading') : t('form.save')}
					</button>
				</div>
			</div>
		</div>
	{/if}
</section>
</div>

<style>
	@import '../styles/shared.css';

	.page {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.layout {
		display: grid;
		grid-template-columns: 260px 1fr 280px;
		gap: 1rem;
		align-items: start;
	}

	@media (max-width: 960px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}

	.roles-panel,
	.editor-panel,
	.members-panel {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #fff);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.panel-header h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
	}

	.role-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.role-item {
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.role-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.role-item.active {
		background: var(--color-primary-subtle, #eef2ff);
		border-color: var(--color-primary, #3730a3);
	}

	.role-name {
		font-size: 0.875rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.role-meta {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #94a3b8);
		display: flex;
		gap: 0.25rem;
	}

	.badge {
		font-size: 0.65rem;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
	}

	.editor-header h3 {
		margin: 0 0 0.25rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.form-grid label.full {
		grid-column: 1 / -1;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--color-foreground, #0f172a);
	}

	.caps-section {
		border-top: 1px solid var(--color-border, #e2e8f0);
		padding-top: 0.75rem;
	}

	.caps-section h4 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.caps-groups {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.cap-group-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: var(--color-muted-foreground, #64748b);
		margin-bottom: 0.35rem;
	}

	.cap-items {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.25rem 0.75rem;
	}

	@media (max-width: 720px) {
		.cap-items {
			grid-template-columns: 1fr;
		}
	}

	.cap-item {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.cap-item input {
		margin: 0;
	}

	.editor-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
		padding-top: 0.75rem;
	}

	.editor-actions .spacer {
		flex: 1;
	}

	.member-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.member-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem;
		border-radius: 0.375rem;
		transition: background 0.1s;
	}

	.member-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.member-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.member-info .name {
		font-size: 0.85rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.member-info .email {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:global(.dark) .roles-panel,
	:global(.dark) .editor-panel,
	:global(.dark) .members-panel {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .role-item:hover,
	:global(.dark) .member-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .role-item.active {
		background: var(--color-accent, oklch(0.25 0.03 var(--primary-h, 264)));
		border-color: var(--color-primary, oklch(0.66 0.12 264));
	}

	:global(.dark) .badge {
		background: oklch(0.269 0 0);
		color: oklch(0.708 0 0);
	}
</style>
