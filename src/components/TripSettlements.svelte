<svelte:options customElement={{ tag: 'racona-work-trip-settlements', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_TripSettlements = function () {
			return { tagName: 'racona-work-trip-settlements' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Kiküldetések — Rendelvények (K10, K11).
	 *
	 * A dolgozó a saját beküldött rendelvényeit látja, a HR mindenkiét,
	 * alapból a jóváhagyásra várókat. Egy sorra kattintva nyílik a részletes
	 * nézet a műveletekkel (jóváhagyás, visszaküldés, kifizetés, nyomtatás, xlsx).
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		EmployeeRow,
		Organization,
		PaginatedResult,
		SettlementListRow,
		SettlementStatus
	} from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import SettlementDetail from './trips/SettlementDetail.svelte';
	import { errorMessage, formatHuf, monthLabel, statusLabel } from './trips/format.js';
	import { resolveSdk, translate } from '../utils/sdk.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const locale = $derived(sdk?.i18n?.locale ?? 'hu');

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);

	let perms = $state<{ canApprove: boolean; canManage: boolean; employeeId: number | null }>({
		canApprove: false,
		canManage: false,
		employeeId: null
	});
	let scope = $state<'mine' | 'all'>('mine');
	let status = $state<SettlementStatus | ''>('');
	let year = $state<number | ''>('');
	let employeeFilter = $state<number | null>(null);
	let page = $state(1);

	let rows = $state<SettlementListRow[]>([]);
	let totalPages = $state(1);
	let employees = $state<EmployeeRow[]>([]);
	let orderers = $state<{ userId: number; name: string }[]>([]);
	let loading = $state(false);
	let initialized = $state(false);
	let openId = $state<number | null>(null);

	const openRow = $derived(rows.find((r) => r.id === openId) ?? null);
	const years = $derived.by(() => {
		const current = new Date().getFullYear();
		return [current + 1, current, current - 1, current - 2, current - 3];
	});

	async function init() {
		if (!currentOrganization) return;
		const organizationId = currentOrganization.id;
		try {
			perms = await sdk.remote.call('getSettlementPermissions', { organizationId });
			orderers = await sdk.remote.call('getTripOrderers', { organizationId });
			if (perms.canApprove || perms.canManage) {
				scope = 'all';
				status = 'submitted';
				const result: PaginatedResult<EmployeeRow> = await sdk.remote.call('getEmployees', {
					organizationId,
					pageSize: 500,
					status: 'active'
				});
				employees = result?.data ?? [];
			}
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
		}
		initialized = true;
		await load();
	}

	async function load() {
		if (!currentOrganization) return;
		loading = true;
		try {
			const result: PaginatedResult<SettlementListRow> = await sdk.remote.call('getSettlements', {
				organizationId: currentOrganization.id,
				scope,
				status: status || undefined,
				year: year || undefined,
				employeeId: scope === 'all' ? (employeeFilter ?? undefined) : undefined,
				page,
				pageSize: 50
			});
			rows = result.data;
			totalPages = result.pagination.totalPages;
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
		} finally {
			loading = false;
		}
	}

	function applyFilter() {
		page = 1;
		load();
	}

	function goToPage(next: number) {
		page = next;
		load();
	}

	function setStatus(next: SettlementStatus | '') {
		status = next;
		applyFilter();
	}

	function setScope(next: 'mine' | 'all') {
		scope = next;
		applyFilter();
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
			if (currentOrganization && sdk?.remote) init();
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
				<h2>{t('tripSettlements.title')}</h2>
				<p class="subtitle">{t('tripSettlements.subtitle')}</p>
			</div>
		</div>

		<div class="toolbar">
			{#if perms.canApprove || perms.canManage}
				<div class="view-toggle">
					<button class="chip" class:active={scope === 'mine'} onclick={() => setScope('mine')}>{t('trips.scope.mine')}</button>
					<button class="chip" class:active={scope === 'all'} onclick={() => setScope('all')}>{t('trips.scope.all')}</button>
				</div>
			{/if}
			<div class="view-toggle">
				{#each ['', 'submitted', 'approved', 'paid', 'draft'] as s (s)}
					<button class="chip" class:active={status === s} onclick={() => setStatus(s as SettlementStatus | '')}>
						{s === '' ? t('tripSettlements.allStatuses') : s === 'submitted' ? t('tripSettlements.waiting') : statusLabel(t, s as SettlementStatus)}
					</button>
				{/each}
			</div>
			<select class="input" bind:value={year} onchange={applyFilter}>
				<option value="">{t('tripSettlements.allYears')}</option>
				{#each years as y (y)}<option value={y}>{y}</option>{/each}
			</select>
			{#if scope === 'all' && employees.length > 0}
				<select class="input" value={employeeFilter ?? ''} onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					employeeFilter = v ? Number(v) : null;
					applyFilter();
				}}>
					<option value="">{t('trips.allEmployees')}</option>
					{#each employees as emp (emp.id)}<option value={emp.id}>{emp.userName}</option>{/each}
				</select>
			{/if}
		</div>

		{#if loading && rows.length === 0}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if initialized && rows.length === 0}
			<p class="empty-state">{t('tripSettlements.empty')}</p>
		{:else}
			<div class="table-wrap">
				<table class="list-table">
					<thead>
						<tr>
							<th>{t('tripSettlements.period')}</th>
							{#if scope === 'all'}<th>{t('tripSettlements.employee')}</th>{/if}
							<th>{t('trips.settlement.vehicle')}</th>
							<th>{t('tripSettlements.status')}</th>
							<th>{t('tripSettlements.number')}</th>
							<th class="r">km</th>
							<th class="r">{t('trips.table.amount')}</th>
							<th>{t('tripSettlements.missing')}</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.id)}
							<tr class="clickable" onclick={() => (openId = row.id)}>
								<td>{monthLabel(row.year, row.month, locale)}</td>
								{#if scope === 'all'}<td>{row.employeeName}</td>{/if}
								<td>{row.plateNumber}</td>
								<td><span class="status status-{row.status}">{statusLabel(t, row.status)}</span></td>
								<td>{row.documentNumber ?? '—'}</td>
								<td class="r">{row.totalKm}</td>
								<td class="r">{formatHuf(row.totalAmount)}</td>
								<td>
									{#if row.warningCount > 0}
										<span class="warn-count" class:blocking={row.blocking}>⚠ {row.warningCount}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if totalPages > 1}
				<div class="pager">
					<button class="btn-secondary btn-sm" disabled={page <= 1} onclick={() => goToPage(page - 1)}>‹</button>
					<span>{page} / {totalPages}</span>
					<button class="btn-secondary btn-sm" disabled={page >= totalPages} onclick={() => goToPage(page + 1)}>›</button>
				</div>
			{/if}
		{/if}
	{/if}
</section>
</div>

{#if openId !== null}
	<SettlementDetail
		{pluginId}
		settlementId={openId}
		canApprove={perms.canApprove}
		canManage={perms.canManage}
		isOwner={openRow?.employeeId === perms.employeeId}
		{orderers}
		onChanged={load}
		onClose={() => (openId = null)}
	/>
{/if}

<style>
	@import '../styles/shared.css';

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.list-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.list-table th,
	.list-table td {
		padding: 0.55rem 0.6rem;
		border-bottom: 1px solid var(--color-border, #f1f5f9);
		text-align: left;
	}

	.list-table th {
		font-weight: 500;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.clickable {
		cursor: pointer;
	}

	.clickable:hover {
		background: var(--color-accent, #f8fafc);
	}

	.r {
		text-align: right !important;
		white-space: nowrap;
	}

	.status {
		font-weight: 600;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.status-submitted {
		color: #b45309;
	}

	.status-approved {
		color: #15803d;
	}

	.status-paid {
		color: #1d4ed8;
	}

	.warn-count {
		font-size: 0.8rem;
		color: #b45309;
	}

	.warn-count.blocking {
		color: #dc2626;
		font-weight: 600;
	}

	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		font-size: 0.85rem;
	}
</style>
