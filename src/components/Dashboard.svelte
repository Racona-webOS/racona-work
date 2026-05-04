<svelte:options customElement={{ tag: 'racona-work-dashboard', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_Dashboard = function () {
			return { tagName: 'racona-work-dashboard' };
		};
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { DashboardStats, LeaveRequestRow } from '../../server/functions.js';
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
	let hasAccess = $derived(orgStore?.hasAccess ?? false);	let orgLoading = $derived(orgStore?.isLoading ?? false);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- Állapot ---
	let stats = $state<DashboardStats | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Követelmény 19.4: Kombinált betöltési állapot
	let isDataLoading = $derived(loading || orgLoading);

	// --- Adatok betöltése ---
	async function loadStats() {
		if (!currentOrganization) {
			stats = null;
			return;
		}

		loading = true;
		error = null;
		try {
			const result = await sdk?.remote?.call('getDashboardStats', {
				organizationId: currentOrganization.id
			});
			stats = result as DashboardStats;
			error = null; // Sikeres betöltés után töröljük a hibát
		} catch (err: any) {
			// Követelmény 15.1, 15.2: Részletes hibaüzenet
			const errorMessage = err?.message ?? t('error.loadFailed');
			error = formatErrorMessage(errorMessage, t('error.loadFailed'));
			stats = null;
			console.error('[Dashboard] Hiba a statisztikák betöltésekor:', err);
		} finally {
			loading = false;
		}
	}

	/**
	 * Hibaüzenet formázása felhasználóbarát módon
	 * Követelmény: 15.1, 15.2
	 */
	function formatErrorMessage(errorMessage: string, defaultMessage: string): string {
		// Hálózati hiba
		if (errorMessage.toLowerCase().includes('network') ||
		    errorMessage.toLowerCase().includes('fetch') ||
		    errorMessage.toLowerCase().includes('connection')) {
			return 'Hálózati hiba. Kérlek, ellenőrizd az internetkapcsolatot.';
		}

		// Jogosultsági hiba
		if (errorMessage.toLowerCase().includes('unauthorized') ||
		    errorMessage.toLowerCase().includes('forbidden') ||
		    errorMessage.toLowerCase().includes('permission')) {
			return 'Nincs jogosultságod ehhez az adathoz. Kérj hozzáférést egy rendszergazdától.';
		}

		// Használjuk az eredeti üzenetet, ha értelmes
		if (errorMessage && errorMessage !== defaultMessage) {
			return errorMessage;
		}

		return defaultMessage;
	}

	// Inicializálás és organization-changed figyelés
	$effect(() => {
		if (currentOrganization && sdk?.remote) {
			loadStats();
		}

		const handleOrgChange = () => loadStats();
		window.addEventListener('organization-changed', handleOrgChange);

		return () => {
			window.removeEventListener('organization-changed', handleOrgChange);
		};
	});

	// Store inicializálás onMount-ban
	onMount(() => {
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				// Ha még nincs store, létrehozzuk
				orgStore = createOrganizationStore(pluginId, sdk);
			}

			// Szervezetek betöltése
			orgStore.loadOrganizations();
		}
	});

	// --- Segédfüggvények ---
	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '—';
		return new Date(dateStr).toLocaleDateString();
	}

	function leaveTypeLabel(type: string): string {
		const map: Record<string, string> = {
			annual: t('leaveRequests.type.annual'),
			sick: t('leaveRequests.type.sick'),
			unpaid: t('leaveRequests.type.unpaid'),
			other: t('leaveRequests.type.other')
		};
		return map[type] ?? type;
	}
</script>

<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<h2>{t('dashboard.title')}</h2>
			<p class="subtitle">{t('dashboard.subtitle')}</p>
		</div>
    helklllloofhksdjzhgksjhd gjhkosdgflojhsdgfolzj sdgl

		{#if isDataLoading}
			<div class="loading-state">
				<div class="spinner"></div>
				<span>{t('loading')}</span>
			</div>
		{:else if error}
			<div class="error-state">
				<div class="error-icon">⚠️</div>
				<p class="error-message">{error}</p>
				<button class="btn-retry" onclick={loadStats}>
					<span class="retry-icon">🔄</span>
					Újrapróbálás
				</button>
			</div>
		{:else if stats}
			<!-- Összefoglaló kártyák -->
			<div class="stats-grid">
				<div class="stat-card">
					<span class="stat-label">{t('dashboard.totalEmployees')}</span>
					<span class="stat-value">{stats.totalEmployees}</span>
				</div>
				<div class="stat-card">
					<span class="stat-label">{t('dashboard.activeEmployees')}</span>
					<span class="stat-value active">{stats.activeEmployees}</span>
				</div>
				<div class="stat-card">
					<span class="stat-label">{t('dashboard.pendingLeaveRequests')}</span>
					<span class="stat-value pending">{stats.pendingLeaveRequests}</span>
				</div>
				<div class="stat-card">
					<span class="stat-label">{t('dashboard.onLeaveThisMonth')}</span>
					<span class="stat-value on-leave">{stats.onLeaveThisMonth}</span>
				</div>
			</div>

			<!-- Legutóbbi függőben lévő kérelmek -->
			<div class="recent-section">
				<h3>{t('dashboard.recentRequests')}</h3>
				{#if stats.recentPendingRequests.length === 0}
					<p class="empty-state">{t('dashboard.noRecentRequests')}</p>
				{:else}
					<div class="requests-list">
						{#each stats.recentPendingRequests as req (req.id)}
							<div class="request-row">
								<div class="request-employee">{req.employeeName}</div>
								<div class="request-type">{leaveTypeLabel(req.leaveType)}</div>
								<div class="request-dates">
									{formatDate(req.startDate)} – {formatDate(req.endDate)}
								</div>
								<div class="request-days">{req.days} nap</div>
								<span class="badge pending">{t('leaveRequests.status.pending')}</span>
							</div>
						{/each}
					</div>
				{/if}
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

	/* Kártyák */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 1rem;
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.25rem 1.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
	}

	.stat-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		font-weight: 500;
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-foreground, #0f172a);
		line-height: 1;
	}

	.stat-value.active { color: #16a34a; }
	.stat-value.pending { color: #d97706; }
	.stat-value.on-leave { color: #2563eb; }

	/* Legutóbbi kérelmek */
	.recent-section h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
	}

	.empty-state {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.875rem;
		padding: 1rem 0;
	}

	/* No access message */
	.no-access-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 4rem 2rem;
		gap: 1rem;
	}

	.no-access-icon {
		font-size: 4rem;
		opacity: 0.5;
	}

	.no-access-message h2 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-foreground, #0f172a);
		margin: 0;
	}

	.no-access-message p {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.875rem;
		margin: 0;
		max-width: 400px;
	}

	.requests-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.request-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
		font-size: 0.875rem;
	}

	.request-employee {
		font-weight: 600;
		min-width: 140px;
	}

	.request-type {
		color: var(--color-muted-foreground, #64748b);
		min-width: 120px;
	}

	.request-dates {
		color: var(--color-muted-foreground, #64748b);
		flex: 1;
	}

	.request-days {
		font-weight: 500;
		min-width: 60px;
		text-align: right;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.badge.pending {
		background: #fef3c7;
		color: #92400e;
	}

	/* Betöltés / hiba */
	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		padding: 3rem 0;
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

	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 3rem 2rem;
		text-align: center;
	}

	.error-icon {
		font-size: 3rem;
		opacity: 0.7;
	}

	.error-message {
		color: #dc2626;
		font-size: 0.875rem;
		margin: 0;
		max-width: 400px;
		line-height: 1.5;
	}

	.btn-retry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		background: var(--color-background, #fff);
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		transition: all 0.15s;
	}

	.btn-retry:hover {
		background: var(--color-accent, #f1f5f9);
		border-color: var(--color-primary, #3730a3);
	}

	.retry-icon {
		font-size: 1rem;
	}

	.btn-secondary {
		border: 1px solid var(--color-border, #e2e8f0);
		background: transparent;
		padding: 0.4rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		width: fit-content;
	}

	.btn-secondary:hover {
		background: var(--color-accent, #f1f5f9);
	}

	/* Sötét mód */
	:global(.dark) .stat-card {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .stat-label {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .stat-value {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .request-row {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .request-type,
	:global(.dark) .request-dates {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .btn-secondary {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .btn-secondary:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .btn-retry {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		background: var(--color-card, oklch(0.205 0 0));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .btn-retry:hover {
		background: var(--color-accent, oklch(0.269 0 0));
		border-color: var(--color-primary, oklch(0.66 0.12 264));
	}

	:global(.dark) .no-access-message h2 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .no-access-message p {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}
</style>
