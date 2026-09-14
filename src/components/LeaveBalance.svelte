<svelte:options customElement={{ tag: 'racona-work-leave-balance', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_LeaveBalance = function () {
			return { tagName: 'racona-work-leave-balance' };
		};
	}
</script>

<!--
	Szabadság egyenleg — a szervezet vagy egy projekt szabadságfelhasználása az
	év során, a felhasználási tervhez mérve: mutatók, burn-down grafikon,
	dolgozói táblázat státusszal és trenddel.
	A HR és a jóváhagyók látják. Részletek: specs/leave-balance-overview.md
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { BalanceFilter, LeaveBalanceOverview, Organization } from '../../server/functions.js';
	import {
		aggregate,
		employeeFigures,
		filterRows,
		RUNNING_PROJECT_STATUSES
	} from '../../server/leave-balance-utils.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import { translate } from '../utils/sdk.js';
	import AccessDenied from './AccessDenied.svelte';
	import ProjectFilter from './leave-balance/ProjectFilter.svelte';
	import BalanceKpis from './leave-balance/BalanceKpis.svelte';
	import BurndownChart from './leave-balance/BurndownChart.svelte';
	import BalanceTable from './leave-balance/BalanceTable.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived((window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS);
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const thisYear = new Date().getFullYear();

	// --- Store ---
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let canView = $state(false);

	function syncFromStore() {
		const store = orgStore ?? (window as any).__racona_work_org_store__;
		if (!store) return;
		currentOrganization = store.currentOrganization;
		hasAccess = store.hasAccess;
		canView = store.can('leave.approve') || store.can('leave.balance.manage');
	}

	// --- Állapot ---
	let year = $state(thisYear);
	let data = $state<LeaveBalanceOverview | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let filterValue = $state('all');
	let showClosed = $state(false);
	let selectedEmployeeId = $state<number | null>(null);

	const yearOptions = $derived(data?.years ?? [thisYear - 1, thisYear, thisYear + 1]);

	function filterStorageKey(organizationId: number): string {
		return `racona-work:leave-balance:filter:org_${organizationId}`;
	}

	function restoreFilter(organizationId: number) {
		try {
			filterValue = localStorage.getItem(filterStorageKey(organizationId)) ?? 'all';
		} catch {
			filterValue = 'all';
		}
	}

	function changeFilter(value: string) {
		filterValue = value;
		selectedEmployeeId = null;
		try {
			if (currentOrganization) localStorage.setItem(filterStorageKey(currentOrganization.id), value);
		} catch {
			// a böngésző tilthatja a tárolást; a szűrő akkor csak most él
		}
	}

	function parseFilter(value: string): BalanceFilter {
		if (value === 'no_project') return { kind: 'no_project' };
		if (value.startsWith('project:')) {
			const projectId = Number(value.slice('project:'.length));
			if (Number.isInteger(projectId)) return { kind: 'project', projectId };
		}
		return { kind: 'all' };
	}

	const runningProjectIds = $derived(
		new Set((data?.projects ?? []).filter((p) => RUNNING_PROJECT_STATUSES.includes(p.status)).map((p) => p.id))
	);
	/** Egy megszűnt (vagy tag nélküli) projekt mentett szűrője helyett mindenki. */
	const filter = $derived.by((): BalanceFilter => {
		const parsed = parseFilter(filterValue);
		if (parsed.kind === 'project' && data && !data.projects.some((p) => p.id === parsed.projectId)) {
			return { kind: 'all' };
		}
		return parsed;
	});
	const effectiveFilterValue = $derived(
		filter.kind === 'project' ? `project:${filter.projectId}` : filter.kind
	);

	const rows = $derived(data ? filterRows(data.employees, filter, runningProjectIds) : []);
	const tableRows = $derived(
		data ? rows.map((row) => ({ row, figures: employeeFigures(row, data!.plan, data!.year, data!.refDay) })) : []
	);
	const summary = $derived(data ? aggregate(rows, data.plan, data.year, data.today) : null);
	const selectedRow = $derived(
		selectedEmployeeId === null ? null : (rows.find((r) => r.employeeId === selectedEmployeeId) ?? null)
	);
	const chartSummary = $derived(
		data && selectedRow ? aggregate([selectedRow], data.plan, data.year, data.today) : summary
	);
	const projectsById = $derived(new Map((data?.projects ?? []).map((p) => [p.id, p])));

	const planNote = $derived.by(() => {
		if (!data) return '';
		const vars = { tolerance: data.plan.tolerancePct, critical: data.plan.criticalPct };
		if (data.plan.source === 'own') return t('leaveBalance.planNote.own', { ...vars, year: data.year });
		if (data.plan.source === 'inherited') {
			return t('leaveBalance.planNote.inherited', { ...vars, year: data.plan.inheritedFromYear ?? '' });
		}
		return t('leaveBalance.planNote.default', vars);
	});

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.loadFailed');
	}

	async function load() {
		if (!currentOrganization || !canView) return;
		loading = true;
		error = null;
		try {
			data = await sdk.remote.call('getLeaveBalanceOverview', {
				organizationId: currentOrganization.id,
				year
			});
		} catch (err: any) {
			error = errorText(err);
			data = null;
		} finally {
			loading = false;
		}
	}

	function openEmployee(employeeId: number) {
		sdk?.ui?.navigateTo?.('EmployeeDetail', { employeeId });
	}

	function openCalendar(employeeId: number) {
		sdk?.ui?.navigateTo?.('LeaveRequests', { employeeId });
	}

	// --- Inicializálás ---
	onMount(async () => {
		if (!sdk?.remote) return;
		try {
			orgStore = getOrganizationStore();
		} catch {
			orgStore = createOrganizationStore(pluginId, sdk);
		}
		if (orgStore.availableOrganizations.length === 0) await orgStore.loadOrganizations();
		syncFromStore();
	});

	$effect(() => {
		const handleOrgChange = () => syncFromStore();
		const handleCapabilities = (e: Event) => {
			if ((e as CustomEvent).detail?.pluginId === pluginId) syncFromStore();
		};
		window.addEventListener('organization-changed', handleOrgChange);
		window.addEventListener('plugin-capabilities-changed', handleCapabilities);
		return () => {
			window.removeEventListener('organization-changed', handleOrgChange);
			window.removeEventListener('plugin-capabilities-changed', handleCapabilities);
		};
	});

	$effect(() => {
		const organizationId = currentOrganization?.id;
		untrack(() => {
			selectedEmployeeId = null;
			if (organizationId) restoreFilter(organizationId);
		});
	});

	$effect(() => {
		currentOrganization;
		canView;
		year;
		untrack(() => {
			if (currentOrganization && canView && sdk?.remote) load();
		});
	});
</script>

<div class="rw">
	<section class="page">
		{#if !hasAccess || (orgStore && !canView)}
			<AccessDenied />
		{:else}
			<div class="page-header">
				<div class="page-header-title">
					<h2>{t('leaveBalance.title')}</h2>
					<p class="subtitle">{t('leaveBalance.subtitle')}</p>
				</div>
				<div class="header-controls">
					<label class="year-select">
						<span>{t('leaveBalance.year')}</span>
						<select class="input" bind:value={year}>
							{#each yearOptions as y (y)}
								<option value={y}>{y}</option>
							{/each}
						</select>
					</label>
					<ProjectFilter
						{pluginId}
						projects={data?.projects ?? []}
						value={effectiveFilterValue}
						{showClosed}
						onChange={changeFilter}
						onToggleClosed={(v) => (showClosed = v)}
					/>
				</div>
			</div>

			{#if error}
				<div class="error-banner">
					<span>{error}</span>
					<button class="btn-secondary btn-sm" onclick={load}>{t('leaveBalance.retry')}</button>
				</div>
			{:else if !data || !summary || !chartSummary}
				<div class="loading-state">
					<div class="spinner"></div>
					<span>{t('loading')}</span>
				</div>
			{:else}
				<p class="plan-note" class:is-loading={loading}>{planNote}</p>

				<div class="content" class:is-loading={loading}>
					<BalanceKpis {pluginId} {summary} />

					<BurndownChart
						{pluginId}
						summary={chartSummary}
						tolerancePct={data.plan.tolerancePct}
						employeeOptions={rows.map((r) => ({ id: r.employeeId, name: r.name }))}
						{selectedEmployeeId}
						onSelectEmployee={(id) => (selectedEmployeeId = id)}
					/>

					<BalanceTable
						{pluginId}
						rows={tableRows}
						{projectsById}
						year={data.year}
						refDay={data.refDay}
						{selectedEmployeeId}
						onSelect={(id) => (selectedEmployeeId = selectedEmployeeId === id ? null : id)}
						onOpenEmployee={openEmployee}
						onOpenCalendar={openCalendar}
					/>

					{#if data.missingBalance.length > 0}
						<p class="missing">
							{t('leaveBalance.missingBalance', { count: data.missingBalance.length, year: data.year })}
							<button class="link" onclick={() => sdk?.ui?.navigateTo?.('LeaveEntitlements')}>
								{t('leaveBalance.missingBalanceLink')}
							</button>
						</p>
					{/if}
				</div>
			{/if}
		{/if}
	</section>
</div>

<style>
	@import '../styles/shared.css';

	.page {
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.page-header {
		align-items: flex-end;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 0;
	}

	.header-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.year-select {
		min-width: 6.5rem;
	}

	/* A széles táblázat a saját görgetősávjával görgessen, ne az oldal */
	.page,
	.content {
		min-width: 0;
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		transition: opacity 0.15s;
	}

	.is-loading {
		opacity: 0.6;
	}

	.plan-note {
		margin: -0.5rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.missing {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.link {
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		cursor: pointer;
		color: var(--color-primary, #3730a3);
		text-decoration: underline;
	}

	@media (max-width: 640px) {
		.page {
			padding: 1rem;
		}
	}
</style>
