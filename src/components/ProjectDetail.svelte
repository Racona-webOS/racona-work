<svelte:options customElement={{ tag: 'racona-work-project-detail', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_ProjectDetail = function () {
			return { tagName: 'racona-work-project-detail' };
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
		ProjectMemberRow,
		EmployeeRow,
		PaginatedResult,
		WorkEntryRow,
		WorkEntryListResult,
		ProjectReport
	} from '../../server/functions.js';
	import AccessDenied from './AccessDenied.svelte';
	import Checkbox from './ui/Checkbox.svelte';

	let { pluginId = 'racona-work', projectId }: { pluginId?: string; projectId: number } =
		$props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	function t(key: string, vars?: Record<string, string | number>): string {
		let str = sdk?.i18n?.t(key) ?? key;
		if (vars) {
			for (const [k, v] of Object.entries(vars)) {
				str = str.replace(`{${k}}`, String(v));
			}
		}
		return str;
	}

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let canManage = $state(false);
	let canLogWork = $state(false);
	let canViewAllWork = $state(false);

	type Tab = 'overview' | 'members' | 'work' | 'report' | 'permissions' | 'settings';
	let activeTab = $state<Tab>('overview');

	// Projekt adatok
	let project = $state<ProjectRow | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);

	// Szerkesztő állapot
	let editMode = $state(false);
	let editName = $state('');
	let editDescription = $state('');
	let editStatus = $state<'active' | 'paused' | 'completed' | 'archived'>('active');
	let editStart = $state('');
	let editEnd = $state('');
	let saving = $state(false);

	// Tagok
	let members = $state<ProjectMemberRow[]>([]);
	let membersLoading = $state(false);
	let orgEmployees = $state<EmployeeRow[]>([]);
	let showAddMember = $state(false);
	let addMemberEmployeeId = $state<number | null>(null);
	let addMemberRole = $state<'member' | 'lead' | 'owner'>('member');
	let addMemberSaving = $state(false);

	// --- Munkanapló (work entries) -------------------------------------------
	let workScope = $state<'mine' | 'all'>('mine');
	let workEntries = $state<WorkEntryRow[]>([]);
	let workTotalHours = $state(0);
	let workLoading = $state(false);

	// Új/edit bejegyzés modal
	let showWorkForm = $state(false);
	let workFormMode = $state<'create' | 'edit'>('create');
	let workEditId = $state<number | null>(null);
	let workTitle = $state('');
	let workDescription = $state('');
	let workHours = $state<number>(1);
	let workWorkDate = $state(new Date().toISOString().slice(0, 10));
	let workForEmployeeId = $state<number | null>(null);
	let workSaving = $state(false);

	// --- Riport (aggregált projekt-áttekintés menedzsereknek) ----------------
	let report = $state<ProjectReport | null>(null);
	let reportLoading = $state(false);
	let reportError = $state<string | null>(null);

	// Csak akkor látható a fül és érdemes betölteni, ha van jog.
	let canViewReport = $derived(canViewAllWork);

	// --- Projekt-szintű jogosultságok ----------------------------------------
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

	let orgRoles = $state<RoleRow[]>([]);
	let overrides = $state<OverrideRow[]>([]);
	let overridesLoading = $state(false);
	let savingUserId = $state<number | null>(null);
	let showAddOverride = $state(false);
	let overrideUserId = $state<number | null>(null);
	let overrideRoleIds = $state<Set<number>>(new Set());
	let overrideSaving = $state(false);

	async function loadProject() {
		if (!projectId || !sdk?.remote) return;
		loading = true;
		loadError = null;
		try {
			const result = (await sdk.remote.call('getProject', { id: projectId })) as ProjectRow;
			project = result;
			hydrateEdit(result);
		} catch (err: any) {
			loadError = err?.message ?? t('error.loadFailed');
			project = null;
		} finally {
			loading = false;
		}
	}

	async function loadMembers() {
		if (!projectId || !sdk?.remote) return;
		membersLoading = true;
		try {
			const result = (await sdk.remote.call('listProjectMembers', {
				projectId
			})) as ProjectMemberRow[];
			members = Array.isArray(result) ? result : [];
		} catch {
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
		} catch {
			orgEmployees = [];
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

	async function loadOverrides() {
		if (!projectId || !sdk?.remote) return;
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

	function hydrateEdit(p: ProjectRow) {
		editName = p.name;
		editDescription = p.description ?? '';
		editStatus = p.status as any;
		editStart = p.startDate ?? '';
		editEnd = p.endDate ?? '';
	}

	function handleBack() {
		sdk?.ui?.navigateTo?.('ProjectList', {});
	}

	async function handleSave() {
		if (!project) return;
		if (!editName.trim()) {
			sdk?.ui?.toast?.(t('projects.create.name') + ': ' + t('form.required'), 'error');
			return;
		}
		saving = true;
		try {
			await sdk.remote.call('updateProject', {
				id: project.id,
				name: editName.trim(),
				description: editDescription.trim() || null,
				status: editStatus,
				startDate: editStart || null,
				endDate: editEnd || null
			});
			sdk?.ui?.toast?.(t('projects.detail.saveSuccess'), 'success');
			editMode = false;
			await loadProject();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!project) return;
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('projects.detail.delete'),
			message: t('projects.detail.deleteConfirm'),
			confirmLabel: t('projects.detail.delete'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('deleteProject', { id: project.id });
			sdk?.ui?.toast?.(t('projects.detail.deleteSuccess'), 'success');
			sdk?.ui?.navigateTo?.('ProjectList', {});
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	async function handleAddMember() {
		if (!project || !addMemberEmployeeId) return;
		addMemberSaving = true;
		try {
			await sdk.remote.call('addProjectMember', {
				projectId: project.id,
				employeeId: addMemberEmployeeId,
				role: addMemberRole
			});
			sdk?.ui?.toast?.(t('projects.members.addSuccess'), 'success');
			showAddMember = false;
			addMemberEmployeeId = null;
			addMemberRole = 'member';
			await Promise.all([loadMembers(), loadProject()]);
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			addMemberSaving = false;
		}
	}

	async function handleRemoveMember(employeeId: number) {
		if (!project) return;
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('projects.members.removeConfirm'),
			message: t('projects.members.removeConfirm'),
			confirmLabel: t('projects.members.removeConfirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('removeProjectMember', {
				projectId: project.id,
				employeeId
			});
			sdk?.ui?.toast?.(t('projects.members.removeSuccess'), 'success');
			await Promise.all([loadMembers(), loadProject()]);
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	// --- Munkanapló: handler-ek ---------------------------------------------
	async function loadWorkEntries() {
		if (!projectId || !sdk?.remote) return;
		workLoading = true;
		try {
			const scope: 'mine' | 'all' = canViewAllWork ? workScope : 'mine';
			const result = (await sdk.remote.call('listWorkEntries', {
				projectId,
				scope,
				pageSize: 200,
				sortBy: 'work_date',
				sortOrder: 'desc'
			})) as WorkEntryListResult;
			workEntries = result?.data ?? [];
			workTotalHours = result?.totalHours ?? 0;
		} catch (err: any) {
			console.warn('[ProjectDetail] loadWorkEntries hiba:', err);
			workEntries = [];
			workTotalHours = 0;
		} finally {
			workLoading = false;
		}
	}

	async function loadReport() {
		if (!projectId || !sdk?.remote) return;
		if (!canViewReport) return;
		reportLoading = true;
		reportError = null;
		try {
			const result = (await sdk.remote.call('getProjectReport', {
				projectId
			})) as ProjectReport;
			report = result ?? null;
		} catch (err: any) {
			reportError = err?.message ?? t('error.loadFailed');
			report = null;
		} finally {
			reportLoading = false;
		}
	}

	function openCreateWorkEntry() {
		workFormMode = 'create';
		workEditId = null;
		workTitle = '';
		workDescription = '';
		workHours = 1;
		workWorkDate = new Date().toISOString().slice(0, 10);
		workForEmployeeId = null; // saját magam
		showWorkForm = true;
	}

	function openEditWorkEntry(entry: WorkEntryRow) {
		workFormMode = 'edit';
		workEditId = entry.id;
		workTitle = entry.title;
		workDescription = entry.description ?? '';
		workHours = entry.hours;
		workWorkDate = entry.workDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
		workForEmployeeId = entry.employeeId;
		showWorkForm = true;
	}

	async function submitWorkEntry() {
		if (!project) return;
		if (!workTitle.trim()) {
			sdk?.ui?.toast?.(t('work.form.title') + ': ' + t('form.required'), 'error');
			return;
		}
		workSaving = true;
		try {
			if (workFormMode === 'edit' && workEditId !== null) {
				await sdk.remote.call('updateWorkEntry', {
					id: workEditId,
					title: workTitle.trim(),
					description: workDescription.trim() || null,
					hours: Number(workHours),
					workDate: workWorkDate
				});
			} else {
				await sdk.remote.call('createWorkEntry', {
					projectId: project.id,
					employeeId: workForEmployeeId ?? undefined,
					title: workTitle.trim(),
					description: workDescription.trim() || undefined,
					hours: Number(workHours),
					workDate: workWorkDate
				});
			}
			sdk?.ui?.toast?.(t('work.saveSuccess'), 'success');
			showWorkForm = false;
			await loadWorkEntries();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			workSaving = false;
		}
	}

	async function handleDeleteWorkEntry(entry: WorkEntryRow) {
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('work.deleteConfirm'),
			message: t('work.deleteConfirm'),
			confirmLabel: t('work.deleteConfirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('deleteWorkEntry', { id: entry.id });
			sdk?.ui?.toast?.(t('work.deleteSuccess'), 'success');
			await loadWorkEntries();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	$effect(() => {
		workScope;
		untrack(() => {
			if (projectId && sdk?.remote) loadWorkEntries();
		});
	});

	$effect(() => {
		activeTab;
		untrack(() => {
			if (activeTab === 'report' && canViewReport && !report && !reportLoading) {
				loadReport();
			}
		});
	});

	// --- Projekt-szintű jogosultságok: handler-ek ----------------------------
	function userHasOverrideRole(row: OverrideRow, roleId: number): boolean {
		return row.roles.some((r) => r.id === roleId);
	}

	async function toggleOverrideRoleForUser(userId: number, roleId: number) {
		if (!project) return;
		const row = overrides.find((o) => o.userId === userId);
		const nextIds = new Set(row?.roles.map((r) => r.id) ?? []);
		if (nextIds.has(roleId)) nextIds.delete(roleId);
		else nextIds.add(roleId);

		savingUserId = userId;
		try {
			await sdk.remote.call('setProjectUserRoles', {
				projectId: project.id,
				userId,
				roleIds: [...nextIds]
			});
			await loadOverrides();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			savingUserId = null;
		}
	}

	async function handleRemoveOverride(userId: number) {
		if (!project) return;
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
				projectId: project.id,
				userId,
				roleIds: []
			});
			sdk?.ui?.toast?.(t('projects.permissions.removeSuccess'), 'success');
			await loadOverrides();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	function openOverrideDialog() {
		overrideUserId = null;
		overrideRoleIds = new Set();
		showAddOverride = true;
	}

	function toggleOverrideAddRole(roleId: number) {
		const next = new Set(overrideRoleIds);
		if (next.has(roleId)) next.delete(roleId);
		else next.add(roleId);
		overrideRoleIds = next;
	}

	async function handleAddOverride() {
		if (!project || !overrideUserId) return;
		if (overrideRoleIds.size === 0) {
			sdk?.ui?.toast?.(
				t('projects.permissions.roles') + ': ' + t('form.required'),
				'error'
			);
			return;
		}
		overrideSaving = true;
		try {
			await sdk.remote.call('setProjectUserRoles', {
				projectId: project.id,
				userId: overrideUserId,
				roleIds: [...overrideRoleIds]
			});
			sdk?.ui?.toast?.(t('projects.permissions.saveSuccess'), 'success');
			showAddOverride = false;
			await loadOverrides();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			overrideSaving = false;
		}
	}

	let availableToOverride = $derived.by(() => {
		const existing = new Set(overrides.map((o) => o.userId));
		return orgEmployees.filter((e) => !existing.has(e.userId));
	});

	function formatDate(raw: string | null): string {
		if (!raw) return t('projects.detail.dates.empty');
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
			canManage = orgStore.can('project.manage');
			canLogWork = orgStore.can('work.log');
			canViewAllWork = orgStore.can('work.view.all') || canManage;

			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
				currentOrganization = orgStore.currentOrganization;
				hasAccess = orgStore.hasAccess;
			}

			// Biztosítjuk, hogy a capabilities friss legyen az aktuális szervezetre.
			// A store életciklus-problémája miatt előfordulhat, hogy a halmaz üres,
			// amikor a ProjectDetail mount-ol.
			if (currentOrganization) {
				await orgStore.ensureCapabilities(currentOrganization.id);
				canManage = orgStore.can('project.manage');
				canLogWork = orgStore.can('work.log');
				canViewAllWork = orgStore.can('work.view.all') || canManage;
			}
		}

		await loadProject();
		await loadMembers();
		await loadOrgEmployees();
		if (canManage) {
			await Promise.all([loadOrgRoles(), loadOverrides()]);
		}
		await loadWorkEntries();
	});

	// plugin-capabilities-changed: ha a store capabilities halmaza frissül
	// (pl. szervezet-váltás utáni backend-válasz), itt is szinkronizálunk.
	$effect(() => {
		const handleCaps = () => {
			if (!orgStore) return;
			canManage = orgStore.can('project.manage');
			canLogWork = orgStore.can('work.log');
			canViewAllWork = orgStore.can('work.view.all') || canManage;
		};
		window.addEventListener('plugin-capabilities-changed', handleCaps);
		return () => window.removeEventListener('plugin-capabilities-changed', handleCaps);
	});

	$effect(() => {
		const handleOrgChange = () => {
			const store = (window as any).__racona_work_org_store__ as OrganizationStore | undefined;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
				canManage = store.can('project.manage');
				canLogWork = store.can('work.log');
				canViewAllWork = store.can('work.view.all') || canManage;
				report = null;
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	// Ha projectId prop változik, újratöltjük
	$effect(() => {
		projectId;
		untrack(() => {
			if (projectId && sdk?.remote) {
				loadProject();
				loadMembers();
				if (canManage) loadOverrides();
				loadWorkEntries();
				report = null; // új projekt → lazy újratöltés a fül váltásnál
			}
		});
	});

	let availableToAdd = $derived.by(() => {
		const existing = new Set(members.map((m) => m.employeeId));
		return orgEmployees.filter((e) => !existing.has(e.id));
	});
</script>

<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<button class="btn-back" onclick={handleBack}>← {t('projects.detail.back')}</button>
		</div>

		{#if loading}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if loadError || !project}
			<div class="error-banner">{loadError ?? t('error.loadFailed')}</div>
		{:else}
			<div class="title-row">
				<div>
					<h2>{project.name}</h2>
					<span class="status status-{project.status}">
						{t(`projects.status.${project.status}`)}
					</span>
				</div>
				{#if canManage}
					<div class="title-actions">
						{#if !editMode && activeTab === 'overview'}
							<button class="btn-secondary" onclick={() => (editMode = true)}>
								✏️ {t('projects.detail.edit')}
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<div class="tabs">
				<button
					class="tab"
					class:active={activeTab === 'overview'}
					onclick={() => (activeTab = 'overview')}
				>
					{t('projects.detail.tabs.overview')}
				</button>
				<button
					class="tab"
					class:active={activeTab === 'members'}
					onclick={() => (activeTab = 'members')}
				>
					{t('projects.detail.tabs.members')}
					<span class="tab-badge">{project.memberCount}</span>
				</button>
				{#if canLogWork}
					<button
						class="tab"
						class:active={activeTab === 'work'}
						onclick={() => (activeTab = 'work')}
					>
						{t('projects.detail.tabs.work')}
						{#if workEntries.length > 0}
							<span class="tab-badge">{workEntries.length}</span>
						{/if}
					</button>
				{/if}
				{#if canViewReport}
					<button
						class="tab"
						class:active={activeTab === 'report'}
						onclick={() => (activeTab = 'report')}
					>
						{t('projects.detail.tabs.report')}
					</button>
				{/if}
				{#if canManage}
					<button
						class="tab"
						class:active={activeTab === 'permissions'}
						onclick={() => (activeTab = 'permissions')}
					>
						{t('projects.detail.tabs.permissions')}
						{#if overrides.length > 0}
							<span class="tab-badge">{overrides.length}</span>
						{/if}
					</button>
					<button
						class="tab"
						class:active={activeTab === 'settings'}
						onclick={() => (activeTab = 'settings')}
					>
						{t('projects.detail.tabs.settings')}
					</button>
				{/if}
			</div>

			<!-- Overview -->
			{#if activeTab === 'overview'}
				<div class="tab-content">
					{#if editMode}
						<div class="form">
							<label class="full">
								<span>{t('projects.create.name')} *</span>
								<input class="input" type="text" bind:value={editName} />
							</label>
							<label class="full">
								<span>{t('projects.create.description')}</span>
								<textarea class="input textarea" rows="3" bind:value={editDescription}></textarea>
							</label>
							<label>
								<span>{t('projects.create.status')}</span>
								<select class="input" bind:value={editStatus}>
									<option value="active">{t('projects.status.active')}</option>
									<option value="paused">{t('projects.status.paused')}</option>
									<option value="completed">{t('projects.status.completed')}</option>
									<option value="archived">{t('projects.status.archived')}</option>
								</select>
							</label>
							<div></div>
							<label>
								<span>{t('projects.create.startDate')}</span>
								<input class="input" type="date" bind:value={editStart} />
							</label>
							<label>
								<span>{t('projects.create.endDate')}</span>
								<input class="input" type="date" bind:value={editEnd} />
							</label>
							<div class="form-actions full">
								<button class="btn-secondary" onclick={() => { editMode = false; if (project) hydrateEdit(project); }}>
									{t('form.cancel')}
								</button>
								<button class="btn-primary" onclick={handleSave} disabled={saving}>
									{saving ? t('loading') : t('projects.detail.save')}
								</button>
							</div>
						</div>
					{:else}
						<div class="info-grid">
							<div class="info-item full">
								<span class="label">{t('projects.create.description')}</span>
								<span class="value">{project.description || t('projects.detail.description.empty')}</span>
							</div>
							<div class="info-item">
								<span class="label">{t('projects.create.startDate')}</span>
								<span class="value">{formatDate(project.startDate)}</span>
							</div>
							<div class="info-item">
								<span class="label">{t('projects.create.endDate')}</span>
								<span class="value">{formatDate(project.endDate)}</span>
							</div>
							<div class="info-item">
								<span class="label">{t('projects.detail.createdBy')}</span>
								<span class="value">{project.createdByName ?? '—'}</span>
							</div>
							<div class="info-item">
								<span class="label">{t('projects.detail.createdAt')}</span>
								<span class="value">{formatDate(project.createdAt)}</span>
							</div>
							<div class="info-item">
								<span class="label">{t('projects.detail.updatedAt')}</span>
								<span class="value">{formatDate(project.updatedAt)}</span>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Members -->
			{#if activeTab === 'members'}
				<div class="tab-content">
					<div class="section-header">
						<h3>{t('projects.members.title')}</h3>
						{#if canManage && availableToAdd.length > 0}
							<button class="btn-primary" onclick={() => (showAddMember = true)}>
								+ {t('projects.members.add')}
							</button>
						{/if}
					</div>

					{#if membersLoading}
						<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
					{:else if members.length === 0}
						<p class="empty-state">{t('projects.members.empty')}</p>
					{:else}
						<ul class="member-list">
							{#each members as m (m.employeeId)}
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
										<span class="meta">
											{m.userEmail}
											{#if m.position}· {m.position}{/if}
										</span>
									</div>
									<span class="role-badge">
										{t(`projects.members.roleOptions.${m.role}`) || m.role}
									</span>
									{#if canManage}
										<button
											class="remove-btn"
											title={t('projects.members.removeConfirm')}
											onclick={() => handleRemoveMember(m.employeeId)}
										>
											✕
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}

			<!-- Munkanapló -->
			{#if activeTab === 'work' && canLogWork}
				<div class="tab-content">
					<div class="section-header">
						<div>
							<h3>{t('work.title')}</h3>
							<p class="perm-hint">
								{t('work.totalHours', { hours: workTotalHours.toFixed(2) })}
							</p>
						</div>
						<div class="header-actions">
							{#if canViewAllWork}
								<div class="view-toggle">
									<button
										class="chip"
										class:active={workScope === 'mine'}
										onclick={() => (workScope = 'mine')}
									>
										{t('work.scope.mine')}
									</button>
									<button
										class="chip"
										class:active={workScope === 'all'}
										onclick={() => (workScope = 'all')}
									>
										{t('work.scope.all')}
									</button>
								</div>
							{/if}
							<button class="btn-primary" onclick={openCreateWorkEntry}>
								+ {t('work.newEntry')}
							</button>
						</div>
					</div>

					{#if workLoading}
						<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
					{:else if workEntries.length === 0}
						<p class="empty-state">
							{workScope === 'mine' ? t('work.emptyMine') : t('work.empty')}
						</p>
					{:else}
						<div class="entries-list">
							{#each workEntries as entry (entry.id)}
								<div class="entry-row">
									<div class="entry-date">
										{new Date(entry.workDate).toLocaleDateString()}
									</div>
									<div class="entry-main">
										<div class="entry-title">{entry.title}</div>
										{#if entry.description}
											<div class="entry-desc">{entry.description}</div>
										{/if}
										{#if workScope === 'all'}
											<div class="entry-meta">👤 {entry.employeeName}</div>
										{/if}
									</div>
									<div class="entry-hours">{entry.hours.toFixed(2)} h</div>
									<div class="entry-actions">
										<button
											class="icon-btn"
											title={t('projects.detail.edit')}
											onclick={() => openEditWorkEntry(entry)}
										>
											✏️
										</button>
										<button
											class="icon-btn danger"
											title={t('work.deleteConfirm')}
											onclick={() => handleDeleteWorkEntry(entry)}
										>
											✕
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Riport -->
			{#if activeTab === 'report' && canViewReport}
				<div class="tab-content">
					{#if reportLoading}
						<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
					{:else if reportError}
						<div class="error-banner">{reportError}</div>
					{:else if report}
						<!-- Összegző kártyák -->
						<div class="kpi-grid">
							<div class="kpi">
								<span class="kpi-label">{t('report.totalHours')}</span>
								<span class="kpi-value">{report.totals.totalHours.toFixed(1)} h</span>
							</div>
							<div class="kpi">
								<span class="kpi-label">{t('report.totalEntries')}</span>
								<span class="kpi-value">{report.totals.totalEntries}</span>
							</div>
							<div class="kpi">
								<span class="kpi-label">{t('report.activeMembers')}</span>
								<span class="kpi-value">
									{report.totals.activeMemberCount} / {report.totals.totalMemberCount}
								</span>
							</div>
							<div class="kpi">
								<span class="kpi-label">{t('report.avgHoursPerDay')}</span>
								<span class="kpi-value">{report.totals.avgHoursPerActiveDay.toFixed(1)} h</span>
							</div>
							<div class="kpi">
								<span class="kpi-label">{t('report.firstEntry')}</span>
								<span class="kpi-value small">
									{report.totals.firstEntryDate
										? new Date(report.totals.firstEntryDate).toLocaleDateString()
										: '—'}
								</span>
							</div>
							<div class="kpi">
								<span class="kpi-label">{t('report.lastEntry')}</span>
								<span class="kpi-value small">
									{report.totals.lastEntryDate
										? new Date(report.totals.lastEntryDate).toLocaleDateString()
										: '—'}
								</span>
							</div>
						</div>

						<!-- Projekt idővonal -->
						<div class="report-section">
							<div class="section-header">
								<h3>{t('report.progress')}</h3>
								{#if report.project.isOverdue}
									<span class="tag tag-danger">{t('report.overdue')}</span>
								{/if}
							</div>
							<div class="timeline">
								<div class="timeline-info">
									{#if report.project.daysSinceStart !== null}
										<div>
											<span class="t-label">{t('report.daysSinceStart')}:</span>
											<strong>{report.project.daysSinceStart}</strong>
										</div>
									{/if}
									{#if report.project.daysUntilEnd !== null}
										<div>
											<span class="t-label">{t('report.daysUntilEnd')}:</span>
											<strong
												class:t-danger={report.project.daysUntilEnd < 0}
												class:t-warn={report.project.daysUntilEnd >= 0 &&
													report.project.daysUntilEnd <= 7}
											>
												{report.project.daysUntilEnd}
											</strong>
										</div>
									{/if}
								</div>
								{#if report.project.progressPercent !== null}
									<div class="progress-bar">
										<div
											class="progress-fill"
											class:progress-danger={report.project.isOverdue}
											style="width: {report.project.progressPercent}%"
										></div>
									</div>
									<div class="progress-label">
										{report.project.progressPercent}%
									</div>
								{/if}
							</div>
						</div>

						<!-- Dolgozónkénti bontás -->
						<div class="report-section">
							<h3>{t('report.byEmployee')}</h3>
							{#if report.byEmployee.length === 0}
								<p class="empty-state">{t('report.byEmployee.empty')}</p>
							{:else}
								{@const maxHours = Math.max(
									1,
									...report.byEmployee.map((e) => e.totalHours)
								)}
								<div class="emp-list">
									{#each report.byEmployee as emp (emp.employeeId)}
										<div class="emp-row">
											<div class="avatar">
												{#if emp.userImage}
													<img src={emp.userImage} alt={emp.userName} />
												{:else}
													<div class="avatar-placeholder">
														{emp.userName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
													</div>
												{/if}
											</div>
											<div class="emp-main">
												<div class="emp-head">
													<span class="emp-name">{emp.userName}</span>
													<span class="emp-hours">
														{emp.totalHours.toFixed(1)} {t('report.byEmployee.hours')}
													</span>
												</div>
												<div class="emp-bar">
													<div
														class="emp-bar-fill"
														style="width: {(emp.totalHours / maxHours) * 100}%"
													></div>
												</div>
												<div class="emp-meta">
													<span>
														{emp.entryCount} {t('report.byEmployee.entries')}
													</span>
													<span>·</span>
													<span>
														{t('report.byEmployee.lastEntry')}:
														{emp.lastEntryDate
															? new Date(emp.lastEntryDate).toLocaleDateString()
															: t('report.byEmployee.never')}
													</span>
												</div>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Utolsó 30 nap napi bontás -->
						<div class="report-section">
							<h3>{t('report.daily.title')}</h3>
							{#if report.daily.length === 0}
								<p class="empty-state">{t('report.daily.empty')}</p>
							{:else}
								{@const dailyMax = Math.max(1, ...report.daily.map((d) => d.hours))}
								<div class="daily-chart">
									{#each report.daily as d (d.date)}
										<div class="daily-bar" title="{d.date}: {d.hours.toFixed(1)} h">
											<div
												class="daily-bar-fill"
												style="height: {(d.hours / dailyMax) * 100}%"
											></div>
										</div>
									{/each}
								</div>
								<div class="daily-range">
									<span>{new Date(report.daily[0].date).toLocaleDateString()}</span>
									<span>
										{new Date(
											report.daily[report.daily.length - 1].date
										).toLocaleDateString()}
									</span>
								</div>
							{/if}
						</div>

						<!-- Inaktív tagok -->
						{#if report.inactiveMembers.length > 0}
							<div class="report-section">
								<div class="section-header">
									<div>
										<h3>{t('report.inactive.title')}</h3>
										<p class="perm-hint">{t('report.inactive.description')}</p>
									</div>
								</div>
								<div class="inactive-list">
									{#each report.inactiveMembers as emp (emp.employeeId)}
										<div class="inactive-row">
											<div class="avatar">
												{#if emp.userImage}
													<img src={emp.userImage} alt={emp.userName} />
												{:else}
													<div class="avatar-placeholder">
														{emp.userName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
													</div>
												{/if}
											</div>
											<div class="inactive-info">
												<span class="emp-name">{emp.userName}</span>
												<span class="emp-meta-sub">
													{emp.lastEntryDate
														? `${t('report.byEmployee.lastEntry')}: ${new Date(emp.lastEntryDate).toLocaleDateString()}`
														: t('report.byEmployee.never')}
												</span>
											</div>
											<span class="tag tag-warn">{t('report.byEmployee.inactive')}</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Legutóbbi bejegyzések -->
						<div class="report-section">
							<h3>{t('report.recent.title')}</h3>
							{#if report.recentEntries.length === 0}
								<p class="empty-state">{t('report.recent.empty')}</p>
							{:else}
								<div class="entries-list">
									{#each report.recentEntries as entry (entry.id)}
										<div class="entry-row">
											<div class="entry-date">
												{new Date(entry.workDate).toLocaleDateString()}
											</div>
											<div class="entry-main">
												<div class="entry-title">{entry.title}</div>
												{#if entry.description}
													<div class="entry-desc">{entry.description}</div>
												{/if}
												<div class="entry-meta">👤 {entry.employeeName}</div>
											</div>
											<div class="entry-hours">{entry.hours.toFixed(2)} h</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Settings -->
			{#if activeTab === 'settings' && canManage}
				<div class="tab-content">
					<div class="danger-zone">
						<h3>{t('projects.detail.delete')}</h3>
						<p>{t('projects.detail.deleteConfirm')}</p>
						<button class="btn-danger" onclick={handleDelete}>
							{t('projects.detail.delete')}
						</button>
					</div>
				</div>
			{/if}

			<!-- Permissions -->
			{#if activeTab === 'permissions' && canManage}
				<div class="tab-content">
					<div class="section-header">
						<div>
							<h3>{t('projects.permissions.overridesTitle')}</h3>
							<p class="perm-hint">{t('projects.permissions.overridesHint')}</p>
						</div>
						{#if orgRoles.length > 0 && availableToOverride.length > 0}
							<button class="btn-primary" onclick={openOverrideDialog}>
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
													<span class="mini-badge">{t('permissions.roles.systemBadge')}</span>
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
														checked={userHasOverrideRole(row, r.id)}
														disabled={savingUserId === row.userId}
														onCheckedChange={() => toggleOverrideRoleForUser(row.userId, r.id)}
													/>
												</td>
											{/each}
											<td class="action-col">
												<button
													class="remove-btn"
													title={t('projects.permissions.removeConfirm')}
													onclick={() => handleRemoveOverride(row.userId)}
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
				</div>
			{/if}
		{/if}
	{/if}

	<!-- Add member modal -->
	{#if showAddMember && project}
		<div
			class="modal-overlay"
			onclick={() => (showAddMember = false)}
			role="presentation"
		>
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
				<div class="modal-header">
					<h3>{t('projects.members.add')}</h3>
					<button class="icon-btn" onclick={() => (showAddMember = false)}>✕</button>
				</div>
				<div class="modal-body">
					<label>
						<span>{t('projects.members.selectEmployee')}</span>
						<select class="input" bind:value={addMemberEmployeeId}>
							<option value={null}>{t('projects.members.selectEmployee')}</option>
							{#each availableToAdd as emp (emp.id)}
								<option value={emp.id}>{emp.userName} — {emp.userEmail}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>{t('projects.members.role')}</span>
						<select class="input" bind:value={addMemberRole}>
							<option value="member">{t('projects.members.roleOptions.member')}</option>
							<option value="lead">{t('projects.members.roleOptions.lead')}</option>
							<option value="owner">{t('projects.members.roleOptions.owner')}</option>
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
						disabled={!addMemberEmployeeId || addMemberSaving}
					>
						{addMemberSaving ? t('loading') : t('form.save')}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Permissions: új user felülbírálás modal -->
	{#if showAddOverride && project}
		<div
			class="modal-overlay"
			onclick={() => (showAddOverride = false)}
			role="presentation"
		>
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
				<div class="modal-header">
					<h3>{t('projects.permissions.addUser')}</h3>
					<button class="icon-btn" onclick={() => (showAddOverride = false)}>✕</button>
				</div>
				<div class="modal-body">
					<label>
						<span>{t('projects.permissions.selectUser')}</span>
						<select class="input" bind:value={overrideUserId}>
							<option value={null}>{t('projects.permissions.selectUser')}</option>
							{#each availableToOverride as emp (emp.userId)}
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
											checked={overrideRoleIds.has(r.id)}
											onCheckedChange={() => toggleOverrideAddRole(r.id)}
										/>
										<span class="role-option-name">
											{r.name}
											{#if r.isSystem}
												<span class="mini-badge">{t('permissions.roles.systemBadge')}</span>
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
					<button class="btn-secondary" onclick={() => (showAddOverride = false)}>
						{t('form.cancel')}
					</button>
					<button
						class="btn-primary"
						onclick={handleAddOverride}
						disabled={!overrideUserId || overrideRoleIds.size === 0 || overrideSaving}
					>
						{overrideSaving ? t('loading') : t('form.save')}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Munkabejegyzés modal (új / szerkesztés) -->
	{#if showWorkForm && project}
		<div
			class="modal-overlay"
			onclick={() => (showWorkForm = false)}
			role="presentation"
		>
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
				<div class="modal-header">
					<h3>{workFormMode === 'edit' ? t('projects.detail.edit') : t('work.newEntry')}</h3>
					<button class="icon-btn" onclick={() => (showWorkForm = false)}>✕</button>
				</div>
				<div class="modal-body">
					<label>
						<span>{t('work.form.title')} *</span>
						<input class="input" type="text" bind:value={workTitle} />
					</label>
					<label>
						<span>{t('work.form.description')}</span>
						<textarea class="input textarea" rows="2" bind:value={workDescription}></textarea>
					</label>
					<div class="form-row-2">
						<label>
							<span>{t('work.form.workDate')} *</span>
							<input class="input" type="date" bind:value={workWorkDate} />
						</label>
						<label>
							<span>{t('work.form.hours')} *</span>
							<input
								class="input"
								type="number"
								min="0.25"
								max="24"
								step="0.25"
								bind:value={workHours}
							/>
						</label>
					</div>
					{#if workFormMode === 'create' && canViewAllWork && members.length > 1}
						<label>
							<span>{t('work.form.forEmployee')}</span>
							<select class="input" bind:value={workForEmployeeId}>
								<option value={null}>{t('work.form.forEmployee.self')}</option>
								{#each members as m (m.employeeId)}
									<option value={m.employeeId}>{m.userName} — {m.userEmail}</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>
				<div class="modal-footer">
					<button class="btn-secondary" onclick={() => (showWorkForm = false)}>
						{t('form.cancel')}
					</button>
					<button
						class="btn-primary"
						onclick={submitWorkEntry}
						disabled={workSaving || !workTitle.trim()}
					>
						{workSaving ? t('loading') : t('form.save')}
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

	.page-header {
		display: flex;
		justify-content: space-between;
	}

	.btn-back {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		color: var(--color-foreground, #0f172a);
		padding: 0.4rem 0.75rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.btn-back:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.title-row h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		display: inline-block;
		margin-right: 0.5rem;
	}

	.status {
		display: inline-block;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		vertical-align: middle;
	}

	.status-active { background: #dcfce7; color: #15803d; }
	.status-paused { background: #fef3c7; color: #a16207; }
	.status-completed { background: #dbeafe; color: #1d4ed8; }
	.status-archived { background: #e5e7eb; color: #374151; }

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.tab {
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 0.5rem 0.75rem;
		margin-bottom: -1px;
		font-size: 0.875rem;
		cursor: pointer;
		color: var(--color-muted-foreground, #64748b);
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tab:hover {
		color: var(--color-foreground, #0f172a);
	}

	.tab.active {
		color: var(--color-primary, #3730a3);
		border-bottom-color: var(--color-primary, #3730a3);
		font-weight: 600;
	}

	.tab-badge {
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}

	.tab.active .tab-badge {
		background: var(--color-primary-subtle, #eef2ff);
		color: var(--color-primary, #3730a3);
	}

	.tab-content {
		background: var(--color-card, #fff);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.info-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.info-item.full {
		grid-column: 1 / -1;
	}

	.info-item .label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground, #64748b);
		font-weight: 600;
	}

	.info-item .value {
		font-size: 0.9rem;
		color: var(--color-foreground, #0f172a);
		white-space: pre-wrap;
	}

	.form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.full {
		grid-column: 1 / -1;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
	}

	label span {
		font-weight: 500;
		color: var(--color-foreground, #0f172a);
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

	.textarea {
		resize: vertical;
		font-family: inherit;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.section-header h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
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
		gap: 0.75rem;
		padding: 0.5rem;
		border-radius: 0.375rem;
		border: 1px solid transparent;
	}

	.member-item:hover {
		background: var(--color-accent, #f1f5f9);
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

	.member-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.member-info .name {
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.member-info .meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.role-badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
		text-transform: capitalize;
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

	.danger-zone {
		border: 1px solid #fecaca;
		background: #fef2f2;
		padding: 1rem;
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.danger-zone h3 {
		margin: 0;
		color: #dc2626;
		font-size: 1rem;
	}

	.danger-zone p {
		margin: 0;
		color: #991b1b;
		font-size: 0.85rem;
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

	.btn-danger {
		background: #dc2626;
		color: #fff;
		border: none;
		padding: 0.45rem 0.9rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 500;
	}

	.btn-danger:hover { opacity: 0.9; }

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
		box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1);
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
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
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
		padding: 1rem 0;
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

	:global(.dark) .tab-content,
	:global(.dark) .modal {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .btn-back:hover,
	:global(.dark) .btn-secondary:hover,
	:global(.dark) .icon-btn:hover,
	:global(.dark) .member-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .status-active { background: rgba(22, 163, 74, 0.2); color: #86efac; }
	:global(.dark) .status-paused { background: rgba(202, 138, 4, 0.2); color: #fde68a; }
	:global(.dark) .status-completed { background: rgba(37, 99, 235, 0.2); color: #bfdbfe; }
	:global(.dark) .status-archived { background: oklch(0.3 0 0); color: oklch(0.75 0 0); }

	:global(.dark) .danger-zone {
		background: rgba(220, 38, 38, 0.1);
		border-color: rgba(220, 38, 38, 0.3);
	}

	:global(.dark) .danger-zone p { color: #fca5a5; }

	/* ---------- Permissions fül ---------- */
	.perm-hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0.25rem 0 0;
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

	.mini-badge {
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

	:global(.dark) .role-option:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .mini-badge {
		background: oklch(0.269 0 0);
		color: oklch(0.708 0 0);
	}

	/* ---------- Munkanapló ---------- */
	.header-actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.view-toggle {
		display: flex;
		gap: 0.25rem;
	}

	.chip {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 999px;
		padding: 0.3rem 0.75rem;
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

	.entries-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.entry-row {
		display: grid;
		grid-template-columns: 100px 1fr auto auto;
		gap: 0.75rem;
		align-items: start;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
	}

	.entry-date {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
	}

	.entry-main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.entry-title {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.entry-desc {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.entry-meta {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.entry-hours {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-primary, #3730a3);
		white-space: nowrap;
		align-self: center;
	}

	.entry-actions {
		display: flex;
		gap: 0.25rem;
		align-self: center;
	}

	.icon-btn.danger:hover {
		background: #fee2e2;
		color: #dc2626;
	}

	.form-row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	:global(.dark) .chip:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .chip.active {
		background: var(--color-accent, oklch(0.25 0.03 var(--primary-h, 264)));
	}

	:global(.dark) .entry-row {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	/* ---------- Riport fül ---------- */
	.kpi-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
	}

	.kpi {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.625rem;
		background: var(--color-card, #ffffff);
	}

	.kpi-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground, #64748b);
		font-weight: 600;
	}

	.kpi-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-foreground, #0f172a);
	}

	.kpi-value.small {
		font-size: 1rem;
	}

	.report-section {
		padding: 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.625rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.report-section h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.tag {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.tag-danger {
		background: #fee2e2;
		color: #991b1b;
	}

	.tag-warn {
		background: #fef3c7;
		color: #92400e;
	}

	.timeline {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.timeline-info {
		display: flex;
		gap: 1.5rem;
		font-size: 0.85rem;
		color: var(--color-foreground, #0f172a);
	}

	.timeline-info .t-label {
		color: var(--color-muted-foreground, #64748b);
		margin-right: 0.25rem;
	}

	.t-warn {
		color: #d97706;
	}

	.t-danger {
		color: #dc2626;
	}

	.progress-bar {
		width: 100%;
		height: 8px;
		background: var(--color-muted, #f1f5f9);
		border-radius: 999px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #3730a3, #6366f1);
		transition: width 0.3s;
	}

	.progress-fill.progress-danger {
		background: linear-gradient(90deg, #dc2626, #f97316);
	}

	.progress-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		text-align: right;
	}

	.emp-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.emp-row {
		display: grid;
		grid-template-columns: 2.25rem 1fr;
		gap: 0.625rem;
		align-items: center;
	}

	.emp-main {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.emp-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: baseline;
	}

	.emp-name {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.emp-hours {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-primary, #3730a3);
	}

	.emp-bar {
		width: 100%;
		height: 6px;
		background: var(--color-muted, #f1f5f9);
		border-radius: 999px;
		overflow: hidden;
	}

	.emp-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #3730a3, #6366f1);
		transition: width 0.3s;
	}

	.emp-meta {
		font-size: 0.72rem;
		color: var(--color-muted-foreground, #64748b);
		display: flex;
		gap: 0.35rem;
	}

	.daily-chart {
		display: flex;
		gap: 2px;
		align-items: flex-end;
		height: 120px;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.daily-bar {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
		cursor: help;
	}

	.daily-bar-fill {
		width: 100%;
		min-height: 2px;
		background: var(--color-primary, #3730a3);
		border-radius: 2px 2px 0 0;
		opacity: 0.8;
		transition: opacity 0.15s;
	}

	.daily-bar:hover .daily-bar-fill {
		opacity: 1;
	}

	.daily-range {
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #94a3b8);
		margin-top: 0.25rem;
	}

	.inactive-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.inactive-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: #fffbeb;
	}

	.inactive-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.emp-meta-sub {
		font-size: 0.72rem;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .kpi,
	:global(.dark) .report-section {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .kpi-value {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .progress-bar,
	:global(.dark) .emp-bar {
		background: oklch(0.3 0 0);
	}

	:global(.dark) .inactive-row {
		background: rgba(202, 138, 4, 0.12);
		border-color: rgba(202, 138, 4, 0.3);
	}

	:global(.dark) .tag-danger {
		background: rgba(220, 38, 38, 0.2);
		color: #fca5a5;
	}

	:global(.dark) .tag-warn {
		background: rgba(202, 138, 4, 0.2);
		color: #fde68a;
	}
</style>
