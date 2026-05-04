<svelte:options customElement={{ tag: 'racona-work-app-settings', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_AppSettings = function () {
			return { tagName: 'racona-work-app-settings' };
		};
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { EmployeeRow, PaginatedResult } from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	// Organization store - inicializálás
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $derived(orgStore?.currentOrganization ?? null);
	let hasAccess = $derived(orgStore?.hasAccess ?? false);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- Állapot ---
	let employees = $state<EmployeeRow[]>([]);
	let employeesLoading = $state(false);
	let selectedNotifierIds = $state<number[]>([]);
	let saving = $state(false);
	let settingsLoading = $state(true);

	// --- Adatok betöltése ---
	async function loadData() {
		if (!currentOrganization) return;

		settingsLoading = true;
		employeesLoading = true;
		try {
			// Dolgozók betöltése - csak az aktuális szervezetből
			const result: PaginatedResult<EmployeeRow> = await sdk?.remote?.call('getEmployees', {
				organizationId: currentOrganization.id,
				pageSize: 200,
				status: 'active'
			});
			employees = result?.data ?? [];

			// Meglévő beállítás betöltése - szervezet-specifikus kulccsal
			const settingsKey = `settings:leave_request_notifiers:org_${currentOrganization.id}`;
			const saved = await sdk?.remote?.call('getSettings', {
				key: settingsKey
			});
			selectedNotifierIds = Array.isArray(saved) ? saved : [];
		} catch {
			sdk?.ui?.toast(t('error.loadFailed'), 'error');
		} finally {
			employeesLoading = false;
			settingsLoading = false;
		}
	}

	// --- Mentés ---
	async function saveSettings() {
		if (!currentOrganization) return;

		saving = true;
		try {
			// Szervezet-specifikus kulccsal mentés
			const settingsKey = `settings:leave_request_notifiers:org_${currentOrganization.id}`;
			await sdk?.remote?.call('saveSettings', {
				key: settingsKey,
				value: selectedNotifierIds
			});
			sdk?.ui?.toast(t('settings.saveSuccess'), 'success');
		} catch {
			sdk?.ui?.toast(t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	// --- Kiválasztás kezelése ---
	function toggleNotifier(employeeId: number) {
		if (selectedNotifierIds.includes(employeeId)) {
			selectedNotifierIds = selectedNotifierIds.filter((id) => id !== employeeId);
		} else {
			selectedNotifierIds = [...selectedNotifierIds, employeeId];
		}
	}

	function isSelected(employeeId: number): boolean {
		return selectedNotifierIds.includes(employeeId);
	}

	onMount(async () => {
		// Store inicializálás
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				// Ha még nincs store, létrehozzuk
				orgStore = createOrganizationStore(pluginId, sdk);
			}

			// Szervezetek betöltése
			await orgStore.loadOrganizations();
		}

		if (sdk?.remote && currentOrganization) loadData();
	});

	// Organization-changed event listener
	$effect(() => {
		const handleOrgChange = () => {
			if (currentOrganization) loadData();
		};

		window.addEventListener('organization-changed', handleOrgChange);

		return () => {
			window.removeEventListener('organization-changed', handleOrgChange);
		};
	});

	// Adatok betöltése amikor a currentOrganization változik
	$effect(() => {
		if (currentOrganization && sdk?.remote) {
			loadData();
		}
	});
</script>

<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<h2>{t('settings.title')}</h2>
			<p class="subtitle">{t('settings.subtitle')}</p>
		</div>

		{#if settingsLoading}
			<div class="loading-state">
				<div class="spinner"></div>
				<span>{t('loading')}</span>
			</div>
		{:else}
			<!-- Szabadságkérelem értesítendők szekció -->
			<div class="settings-section">
				<div class="section-header">
					<h3>{t('settings.leaveNotifiers.title')}</h3>
					<p class="section-description">{t('settings.leaveNotifiers.description')}</p>
				</div>

			{#if employeesLoading}
				<div class="loading-state">
					<div class="spinner"></div>
					<span>{t('loading')}</span>
				</div>
			{:else if employees.length === 0}
				<p class="empty-state">{t('noData')}</p>
			{:else}
				<div class="employee-select-list">
					{#each employees as emp (emp.id)}
						<label class="employee-item {isSelected(emp.id) ? 'selected' : ''}">
							<input
								type="checkbox"
								checked={isSelected(emp.id)}
								onchange={() => toggleNotifier(emp.id)}
								class="checkbox"
							/>
							<div class="employee-avatar">
								{#if emp.userImage}
									<img src={emp.userImage} alt={emp.userName} class="avatar-img" />
								{:else}
									<div class="avatar-placeholder">
										{emp.userName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
									</div>
								{/if}
							</div>
							<div class="employee-info">
								<span class="employee-name">{emp.userName}</span>
								<span class="employee-meta">{emp.userEmail}{emp.position ? ` · ${emp.position}` : ''}</span>
							</div>
							{#if isSelected(emp.id)}
								<span class="selected-badge">✓</span>
							{/if}
						</label>
					{/each}
				</div>

				{#if selectedNotifierIds.length === 0}
					<p class="no-selection-hint">{t('settings.leaveNotifiers.noSelection')}</p>
				{:else}
					<p class="selection-count">{selectedNotifierIds.length} dolgozó kiválasztva</p>
				{/if}
			{/if}
		</div>

		<!-- Mentés gomb -->
		<div class="save-row">
			<button class="btn-primary" onclick={saveSettings} disabled={saving}>
				{saving ? t('loading') : t('settings.save')}
			</button>
		</div>
	{/if}
	{/if}
</section>

<style>
	.page {
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
		max-width: 640px;
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

	/* Szekció */
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
	}

	.section-header h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 0.25rem;
	}

	.section-description {
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
	}

	/* Dolgozó lista */
	.employee-select-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 320px;
		overflow-y: auto;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		padding: 0.25rem;
	}

	.employee-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: background 0.1s;
		position: relative;
	}

	.employee-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.employee-item.selected {
		background: var(--color-primary-subtle, #e0e7ff);
	}

	.checkbox {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		accent-color: var(--color-primary, #3730a3);
		cursor: pointer;
	}

	.employee-avatar {
		flex-shrink: 0;
	}

	.avatar-img {
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

	.employee-info {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
		min-width: 0;
	}

	.employee-name {
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.employee-meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.selected-badge {
		font-size: 0.875rem;
		color: var(--color-primary, #3730a3);
		font-weight: 700;
		flex-shrink: 0;
	}

	.no-selection-hint {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #94a3b8);
		margin: 0;
		font-style: italic;
	}

	.selection-count {
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
		font-weight: 500;
		margin: 0;
	}

	/* Mentés sor */
	.save-row {
		display: flex;
		justify-content: flex-end;
	}

	/* Gombok */
	.btn-primary {
		background: var(--color-primary, #3730a3);
		color: #fff;
		border: none;
		padding: 0.5rem 1.5rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.btn-primary:hover { opacity: 0.9; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

	/* Betöltés */
	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		padding: 1rem 0;
	}

	.spinner {
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid var(--color-border, #e2e8f0);
		border-top-color: var(--color-primary, #3730a3);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.empty-state {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.875rem;
	}

	/* Sötét mód */
	:global(.dark) .settings-section {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .employee-select-list {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .employee-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .employee-item.selected {
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}

	:global(.dark) .employee-name {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .employee-meta {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .avatar-placeholder {
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}
</style>
