<svelte:options customElement={{ tag: 'racona-work-dashboard', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_Dashboard = function () {
			return { tagName: 'racona-work-dashboard' };
		};
	}
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		DashboardStats,
		EmployeeRow,
		LeaveBalance,
		LeaveRequestRow,
		PaginatedResult
	} from '../../server/functions.js';
	import {
		getOrganizationStore,
		createOrganizationStore
	} from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

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

	// --- Store ---
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<
		import('../../server/functions.js').Organization | null
	>(null);
	let hasAccess = $state(false);
	let canManagerView = $state(false);
	let orgLoading = $derived(orgStore?.isLoading ?? false);

	// --- Vezetői nézet állapota ---
	let stats = $state<DashboardStats | null>(null);
	let statsLoading = $state(false);
	let statsError = $state<string | null>(null);

	// --- Self-service nézet állapota ---
	let myEmployee = $state<EmployeeRow | null>(null);
	let myBalance = $state<LeaveBalance | null>(null);
	let myRequests = $state<LeaveRequestRow[]>([]);
	let selfLoading = $state(false);
	let selfError = $state<string | null>(null);

	let isDataLoading = $derived(statsLoading || selfLoading || orgLoading);
	const thisYear = new Date().getFullYear();

	// --- Adatbetöltés --------------------------------------------------------
	async function loadManagerStats() {
		if (!currentOrganization) {
			stats = null;
			return;
		}
		statsLoading = true;
		statsError = null;
		try {
			const result = await sdk?.remote?.call('getDashboardStats', {
				organizationId: currentOrganization.id
			});
			stats = result as DashboardStats;
		} catch (err: any) {
			statsError = formatErrorMessage(err?.message ?? t('error.loadFailed'));
			stats = null;
		} finally {
			statsLoading = false;
		}
	}

	async function loadSelfOverview() {
		if (!currentOrganization) {
			myEmployee = null;
			myBalance = null;
			myRequests = [];
			return;
		}
		selfLoading = true;
		selfError = null;
		try {
			const me = (await sdk.remote.call('getMyEmployee', {
				organizationId: currentOrganization.id
			})) as EmployeeRow | null;
			myEmployee = me;

			if (!me) {
				myBalance = null;
				myRequests = [];
				return;
			}

			const [balances, requests] = await Promise.all([
				sdk.remote.call('getLeaveBalances', { employeeId: me.id }) as Promise<
					LeaveBalance[]
				>,
				sdk.remote.call('getLeaveRequests', {
					organizationId: currentOrganization.id,
					employeeId: me.id,
					pageSize: 5,
					sortBy: 'createdAt',
					sortOrder: 'desc'
				}) as Promise<PaginatedResult<LeaveRequestRow>>
			]);

			myBalance =
				(balances ?? []).find((b) => b.year === thisYear) ?? null;
			myRequests = requests?.data ?? [];
		} catch (err: any) {
			selfError = formatErrorMessage(err?.message ?? t('error.loadFailed'));
		} finally {
			selfLoading = false;
		}
	}

	function formatErrorMessage(errorMessage: string): string {
		const lower = errorMessage.toLowerCase();
		if (
			lower.includes('network') ||
			lower.includes('fetch') ||
			lower.includes('connection')
		) {
			return 'Hálózati hiba. Kérlek, ellenőrizd az internetkapcsolatot.';
		}
		if (
			lower.includes('unauthorized') ||
			lower.includes('forbidden') ||
			lower.includes('permission') ||
			lower.includes('jogosult')
		) {
			return 'Nincs jogosultságod ehhez az adathoz.';
		}
		return errorMessage;
	}

	function reload() {
		if (canManagerView) loadManagerStats();
		else loadSelfOverview();
	}

	// --- Inicializálás ------------------------------------------------------
	function syncFromStore() {
		if (!orgStore) return;
		currentOrganization = orgStore.currentOrganization;
		hasAccess = orgStore.hasAccess;
		canManagerView =
			orgStore.can('leave.approve') || orgStore.can('employee.manage');
	}

	onMount(() => {
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				orgStore = createOrganizationStore(pluginId, sdk);
			}
			syncFromStore();

			if (orgStore!.availableOrganizations.length === 0) {
				orgStore!.loadOrganizations().then(() => {
					syncFromStore();
					if (currentOrganization) reload();
				});
			} else if (currentOrganization) {
				reload();
			}
		}
	});

	$effect(() => {
		const handleOrgChange = () => {
			syncFromStore();
			if (currentOrganization) reload();
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	$effect(() => {
		currentOrganization;
		canManagerView;
		untrack(() => {
			if (currentOrganization && sdk?.remote) reload();
		});
	});

	// --- Segédfüggvények ----------------------------------------------------
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

	function statusLabel(status: string): string {
		const map: Record<string, string> = {
			pending: t('leaveRequests.status.pending'),
			approved: t('leaveRequests.status.approved'),
			rejected: t('leaveRequests.status.rejected')
		};
		return map[status] ?? status;
	}

	function statusClass(status: string): string {
		const map: Record<string, string> = {
			pending: 'badge-pending',
			approved: 'badge-approved',
			rejected: 'badge-rejected'
		};
		return map[status] ?? 'badge-pending';
	}

	function handleNewRequest() {
		sdk?.ui?.navigateTo?.('LeaveRequests', {});
	}
</script>

<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else if isDataLoading && !stats && !myEmployee}
		<div class="loading-state">
			<div class="spinner"></div>
			<span>{t('loading')}</span>
		</div>
	{:else if canManagerView}
		<!-- ========== Vezetői / manager nézet ========== -->
		<div class="page-header">
			<h2>{t('dashboard.title')}</h2>
			<p class="subtitle">{t('dashboard.subtitle')}</p>
		</div>

		{#if statsError}
			<div class="error-state">
				<div class="error-icon">⚠️</div>
				<p class="error-message">{statsError}</p>
				<button class="btn-retry" onclick={reload}>
					<span class="retry-icon">🔄</span>
					Újrapróbálás
				</button>
			</div>
		{:else if stats}
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
								<span class="badge {statusClass(req.status)}">{statusLabel(req.status)}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{:else}
		<!-- ========== Self-service nézet ========== -->
		{#if selfError}
			<div class="error-state">
				<div class="error-icon">⚠️</div>
				<p class="error-message">{selfError}</p>
				<button class="btn-retry" onclick={reload}>
					<span class="retry-icon">🔄</span>
					Újrapróbálás
				</button>
			</div>
		{:else if !myEmployee}
			<div class="page-header">
				<h2>{t('dashboard.title')}</h2>
			</div>
			<p class="empty-state">{t('dashboard.self.noEmployee')}</p>
		{:else}
			<div class="page-header self">
				<div>
					<h2>{t('dashboard.self.title', { name: myEmployee.userName })}</h2>
					<p class="subtitle">{t('dashboard.self.subtitle')}</p>
				</div>
				<button class="btn-primary" onclick={handleNewRequest}>
					+ {t('dashboard.self.newRequest')}
				</button>
			</div>

			<div class="balance-card">
				<div class="balance-header">
					<span class="balance-title">{t('dashboard.self.balance', { year: thisYear })}</span>
				</div>
				{#if myBalance}
					<div class="balance-stats">
						<div class="balance-stat">
							<span class="b-label">{t('dashboard.self.totalDays')}</span>
							<span class="b-value">{myBalance.totalDays}</span>
						</div>
						<div class="balance-stat">
							<span class="b-label">{t('dashboard.self.usedDays')}</span>
							<span class="b-value used">{myBalance.usedDays}</span>
						</div>
						<div
							class="balance-stat"
							class:warning={myBalance.remainingDays < 5}
						>
							<span class="b-label">{t('dashboard.self.remainingDays')}</span>
							<span class="b-value remaining">{myBalance.remainingDays}</span>
						</div>
					</div>
					<div class="balance-bar">
						<div
							class="balance-bar-fill"
							style="width: {myBalance.totalDays > 0
								? Math.min(100, (myBalance.usedDays / myBalance.totalDays) * 100)
								: 0}%"
						></div>
					</div>
				{:else}
					<p class="empty-state">{t('dashboard.self.noBalance')}</p>
				{/if}
			</div>

			<div class="recent-section">
				<h3>{t('dashboard.self.myRequests')}</h3>
				{#if myRequests.length === 0}
					<p class="empty-state">{t('dashboard.self.noMyRequests')}</p>
				{:else}
					<div class="requests-list">
						{#each myRequests as req (req.id)}
							<div class="request-row">
								<div class="request-type">{leaveTypeLabel(req.leaveType)}</div>
								<div class="request-dates">
									{formatDate(req.startDate)} – {formatDate(req.endDate)}
								</div>
								<div class="request-days">{req.days} nap</div>
								<span class="badge {statusClass(req.status)}">{statusLabel(req.status)}</span>
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

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
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

	/* Manager nézet — kártyák */
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

	/* Self-service nézet — keret kártya */
	.balance-card {
		padding: 1.25rem 1.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.balance-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.balance-title {
		font-size: 0.95rem;
		font-weight: 600;
	}

	.balance-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
	}

	.balance-stat {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.b-label {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.b-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-foreground, #0f172a);
		line-height: 1;
	}

	.b-value.used { color: #d97706; }
	.b-value.remaining { color: #16a34a; }

	.balance-stat.warning .b-value.remaining { color: #dc2626; }

	.balance-bar {
		width: 100%;
		height: 6px;
		background: var(--color-muted, #f1f5f9);
		border-radius: 999px;
		overflow: hidden;
	}

	.balance-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #3730a3, #6366f1);
		transition: width 0.3s;
	}

	/* Közös — request rows */
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

	.badge-pending { background: #fef3c7; color: #92400e; }
	.badge-approved { background: #dcfce7; color: #166534; }
	.badge-rejected { background: #fee2e2; color: #991b1b; }

	.btn-primary {
		background: var(--color-primary, #3730a3);
		color: #fff;
		border: none;
		padding: 0.55rem 1rem;
		border-radius: 0.5rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.btn-primary:hover { opacity: 0.9; }

	/* Loading / error */
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

	/* Sötét mód */
	:global(.dark) .stat-card,
	:global(.dark) .balance-card,
	:global(.dark) .request-row {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .stat-label,
	:global(.dark) .request-type,
	:global(.dark) .request-dates,
	:global(.dark) .b-label {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .stat-value,
	:global(.dark) .b-value {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .balance-bar {
		background: oklch(0.3 0 0);
	}

	:global(.dark) .badge-pending { background: oklch(0.3 0.05 60); color: #fde68a; }
	:global(.dark) .badge-approved { background: oklch(0.25 0.05 145); color: #86efac; }
	:global(.dark) .badge-rejected { background: oklch(0.25 0.05 20); color: #fca5a5; }

	:global(.dark) .btn-retry {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}
</style>
