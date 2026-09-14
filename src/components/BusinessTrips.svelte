<svelte:options customElement={{ tag: 'racona-work-business-trips', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_BusinessTrips = function () {
			return { tagName: 'racona-work-business-trips' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Kiküldetések — Utaim (K8, K9, K13).
	 *
	 * Havi nézet: az utak dolgozónként és autónként csoportosítva, a havi
	 * rendelvény összesítőjével, állapotával és a hiányzó adatokkal. A HR a
	 * „Mindenki” nézetben a szervezet összes útját látja, és bárki nevében rögzíthet.
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		Organization,
		SettlementKey,
		TripDetail,
		TripMonthGroup,
		TripRow,
		TripVehicle,
		EmployeeRow,
		PaginatedResult
	} from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import TripForm from './trips/TripForm.svelte';
	import SettlementDetail from './trips/SettlementDetail.svelte';
	import WarningList from './trips/WarningList.svelte';
	import { errorMessage, formatHuf, formatTimeRange, localDateTime, monthLabel, statusLabel } from './trips/format.js';
	import { routeLabel } from '../../server/trip-calc.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived((window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS);

	function t(key: string, vars?: Record<string, string | number>): string {
		let str = sdk?.i18n?.t(key) ?? key;
		if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
		return str;
	}
	const locale = $derived(sdk?.i18n?.locale ?? 'hu');

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);

	const today = localDateTime(new Date());
	let year = $state(Number(today.slice(0, 4)));
	let month = $state(Number(today.slice(5, 7)));
	let scope = $state<'mine' | 'all'>('mine');
	let employeeFilter = $state<number | null>(null);

	let perms = $state<{ canApprove: boolean; canManage: boolean; employeeId: number | null }>({
		canApprove: false,
		canManage: false,
		employeeId: null
	});
	let trips = $state<TripRow[]>([]);
	let groups = $state<TripMonthGroup[]>([]);
	let vehicles = $state<TripVehicle[]>([]);
	let orderers = $state<{ userId: number; name: string }[]>([]);
	let employees = $state<EmployeeRow[]>([]);
	let loading = $state(false);

	// Űrlap és részletek
	let formOpen = $state(false);
	let editTrip = $state<TripDetail | null>(null);
	let copyFrom = $state<TripRow | null>(null);
	let formEmployeeId = $state<number | null>(null);
	let formVehicles = $state<TripVehicle[]>([]);
	let detailKey = $state<SettlementKey | null>(null);

	const isManagerView = $derived(scope === 'all' && (perms.canApprove || perms.canManage));
	const myVehicles = $derived(vehicles.filter((v) => v.employeeId === perms.employeeId && !v.archived));

	function tripsOf(group: TripMonthGroup): TripRow[] {
		return trips.filter((t) => t.employeeId === group.employeeId && t.vehicleId === group.vehicleId);
	}

	async function loadAll() {
		if (!currentOrganization) return;
		loading = true;
		const organizationId = currentOrganization.id;
		try {
			perms = await sdk.remote.call('getSettlementPermissions', { organizationId });
			const [month_, vehicleList, ordererList] = await Promise.all([
				sdk.remote.call('getTripMonth', {
					organizationId,
					scope,
					year,
					month,
					employeeId: scope === 'all' ? (employeeFilter ?? undefined) : undefined
				}),
				sdk.remote.call('getTripVehicles', { organizationId, scope: 'mine' }),
				sdk.remote.call('getTripOrderers', { organizationId })
			]);
			trips = month_.trips;
			groups = month_.groups;
			vehicles = vehicleList;
			orderers = ordererList;
			if ((perms.canApprove || perms.canManage) && employees.length === 0) {
				const result: PaginatedResult<EmployeeRow> = await sdk.remote.call('getEmployees', {
					organizationId,
					pageSize: 500,
					status: 'active'
				});
				employees = result?.data ?? [];
			}
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
		} finally {
			loading = false;
		}
	}

	function setScope(next: 'mine' | 'all') {
		scope = next;
		loadAll();
	}

	function shiftMonth(delta: number) {
		const d = new Date(Date.UTC(year, month - 1 + delta, 1));
		year = d.getUTCFullYear();
		month = d.getUTCMonth() + 1;
		loadAll();
	}

	/** Kinek az útját rögzítjük: HR-nél a kiválasztott dolgozóét, egyébként a sajátot. */
	async function vehiclesFor(employeeId: number | null): Promise<TripVehicle[]> {
		if (!currentOrganization) return [];
		if (employeeId === null || employeeId === perms.employeeId) return vehicles;
		return sdk.remote.call('getTripVehicles', { organizationId: currentOrganization.id, scope: 'all', employeeId });
	}

	async function openNew() {
		const target = isManagerView && employeeFilter ? employeeFilter : null;
		formVehicles = await vehiclesFor(target);
		if (formVehicles.filter((v) => !v.archived).length === 0) {
			sdk?.ui?.toast(t('trips.noVehicleToast'), 'error');
			return;
		}
		formEmployeeId = target;
		editTrip = null;
		copyFrom = null;
		formOpen = true;
	}

	async function openEdit(row: TripRow) {
		try {
			editTrip = await sdk.remote.call('getTrip', { id: row.id });
			formEmployeeId = row.employeeId === perms.employeeId ? null : row.employeeId;
			formVehicles = await vehiclesFor(formEmployeeId);
			copyFrom = null;
			formOpen = true;
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
		}
	}

	async function openCopy(row: TripRow) {
		formEmployeeId = row.employeeId === perms.employeeId ? null : row.employeeId;
		formVehicles = await vehiclesFor(formEmployeeId);
		editTrip = null;
		copyFrom = row;
		formOpen = true;
	}

	async function remove(row: TripRow) {
		const result = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('trips.deleteTitle'),
			message: t('trips.deleteMessage', { when: formatTimeRange(row.startedAt, row.endedAt) }),
			confirmLabel: t('trips.delete'),
			confirmVariant: 'destructive'
		});
		if (result?.action !== 'confirm') return;
		try {
			await sdk.remote.call('deleteTrip', { id: row.id });
			sdk?.ui?.toast(t('trips.deleted'), 'success');
			loadAll();
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		}
	}

	function onSaved(saved: TripDetail) {
		formOpen = false;
		// Ha az út másik hónapba került, oda lapozunk
		const y = Number(saved.startedAt.slice(0, 4));
		const m = Number(saved.startedAt.slice(5, 7));
		if (y !== year || m !== month) {
			year = y;
			month = m;
		}
		loadAll();
	}

	function openDetail(group: TripMonthGroup) {
		detailKey = { employeeId: group.employeeId, vehicleId: group.vehicleId, year, month };
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
			if (currentOrganization && sdk?.remote) {
				employees = [];
				loadAll();
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
			<div class="page-header-title">
				<h2>{t('trips.title')}</h2>
				<p class="subtitle">{t('trips.subtitle')}</p>
			</div>
			<button class="btn-primary" onclick={openNew}>+ {t('trips.new')}</button>
		</div>

		<div class="toolbar">
			<div class="month-nav">
				<button class="icon-btn" onclick={() => shiftMonth(-1)} aria-label={t('trips.prevMonth')}>‹</button>
				<strong>{monthLabel(year, month, locale)}</strong>
				<button class="icon-btn" onclick={() => shiftMonth(1)} aria-label={t('trips.nextMonth')}>›</button>
			</div>
			{#if perms.canApprove || perms.canManage}
				<div class="view-toggle">
					<button class="chip" class:active={scope === 'mine'} onclick={() => setScope('mine')}>{t('trips.scope.mine')}</button>
					<button class="chip" class:active={scope === 'all'} onclick={() => setScope('all')}>{t('trips.scope.all')}</button>
				</div>
				{#if scope === 'all'}
					<select class="input" value={employeeFilter ?? ''} onchange={(e) => {
						const v = (e.currentTarget as HTMLSelectElement).value;
						employeeFilter = v ? Number(v) : null;
						loadAll();
					}}>
						<option value="">{t('trips.allEmployees')}</option>
						{#each employees as emp (emp.id)}<option value={emp.id}>{emp.userName}</option>{/each}
					</select>
				{/if}
			{/if}
		</div>

		{#if loading && groups.length === 0}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if scope === 'mine' && myVehicles.length === 0 && groups.length === 0}
			<div class="empty-card">
				<p>{t('trips.noVehicle')}</p>
				<button class="btn-secondary" onclick={() => sdk?.ui?.navigateTo?.('TripVehicles', {})}>{t('trips.addVehicle')}</button>
			</div>
		{:else if groups.length === 0}
			<p class="empty-state">{t('trips.empty')}</p>
		{:else}
			{#each groups as group (`${group.employeeId}:${group.vehicleId}`)}
				<article class="group-card">
					<header class="group-head">
						<div>
							<h3>
								{#if scope === 'all'}{group.employeeName} · {/if}{group.plateNumber}
								<span class="muted">{group.model}</span>
							</h3>
							<span class="status status-{group.status ?? 'none'}">{statusLabel(t, group.status)}</span>
							{#if group.documentNumber}<span class="muted"> · {group.documentNumber}</span>{/if}
						</div>
						<div class="group-total">
							<span>{group.totalKm} km</span>
							<strong>{formatHuf(group.total)}</strong>
							{#if group.total === null}<span class="muted small">{t('trips.noPrice')}</span>{/if}
						</div>
					</header>

					{#if group.note && (group.status === 'draft' || group.status === null)}
						<div class="note-box"><strong>{t('trips.settlement.noteLabel')}</strong> {group.note}</div>
					{/if}

					{#if group.status !== 'approved' && group.status !== 'paid'}
						<WarningList {pluginId} warnings={group.warnings} employeeId={group.employeeId} manager={perms.canApprove || perms.canManage} compact />
					{/if}

					<div class="table-wrap">
						<table class="trips-table">
							<thead>
								<tr>
									<th>{t('trips.table.when')}</th>
									<th>{t('trips.table.route')}</th>
									<th class="r">km</th>
									<th>{t('trips.form.orderedBy')}</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each tripsOf(group) as row (row.id)}
									<tr>
										<td class="nowrap">{formatTimeRange(row.startedAt, row.endedAt)}</td>
										<td>
											{routeLabel(row.waypoints, row.returnMode)}
											<div class="muted">{row.purpose}</div>
										</td>
										<td class="r">
											<span class:warn={!!row.distanceReason} title={row.distanceReason ?? ''}>{row.distanceKm}</span>
											{#if row.routedKm === null}<span class="muted small"> ({t('trips.table.manual')})</span>{/if}
										</td>
										<td>{row.orderedByName ?? '—'}{#if row.orderedByOverride}<span class="badge" title={t('trips.table.overriddenBy', { name: row.orderedByOverride.byName })}>{t('trips.table.overridden')}</span>{/if}</td>
										<td class="actions">
											{#if !row.locked}
												<button class="icon-btn" title={t('trips.edit')} onclick={() => openEdit(row)}>✎</button>
											{/if}
											<button class="icon-btn" title={t('trips.copy')} onclick={() => openCopy(row)}>⧉</button>
											{#if !row.locked}
												<button class="remove-btn" title={t('trips.delete')} onclick={() => remove(row)}>×</button>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<footer class="group-foot">
						<button class="btn-secondary btn-sm" onclick={() => openDetail(group)}>{t('trips.settlement.open')}</button>
					</footer>
				</article>
			{/each}
		{/if}
	{/if}
</section>
</div>

{#if formOpen && currentOrganization}
	<TripForm
		{pluginId}
		organizationId={currentOrganization.id}
		employeeId={formEmployeeId}
		vehicles={formVehicles}
		{orderers}
		trip={editTrip}
		{copyFrom}
		{onSaved}
		onClose={() => (formOpen = false)}
	/>
{/if}

{#if detailKey}
	<SettlementDetail
		{pluginId}
		settlementKey={detailKey}
		canApprove={perms.canApprove}
		canManage={perms.canManage}
		isOwner={detailKey.employeeId === perms.employeeId}
		{orderers}
		onChanged={loadAll}
		onClose={() => (detailKey = null)}
	/>
{/if}

<style>
	@import '../styles/shared.css';

	.toolbar {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.month-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 12rem;
	}

	.month-nav strong {
		min-width: 9rem;
		text-align: center;
	}

	.group-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
	}

	.group-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.group-head h3 {
		margin: 0 0 0.2rem;
		font-size: 1rem;
	}

	.group-total {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
		font-size: 0.85rem;
	}

	.group-total strong {
		font-size: 1.1rem;
	}

	.group-foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.trips-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.trips-table th,
	.trips-table td {
		padding: 0.45rem 0.5rem;
		border-bottom: 1px solid var(--color-border, #f1f5f9);
		text-align: left;
		vertical-align: top;
	}

	.trips-table th {
		font-weight: 500;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.r {
		text-align: right !important;
		white-space: nowrap;
	}

	.nowrap {
		white-space: nowrap;
	}

	.actions {
		white-space: nowrap;
		text-align: right;
	}

	.muted {
		color: var(--color-muted-foreground, #64748b);
		font-weight: normal;
		font-size: 0.8rem;
	}

	.small {
		font-size: 0.75rem;
	}

	.warn {
		color: #b45309;
		font-weight: 600;
		cursor: help;
	}

	.badge {
		display: inline-block;
		margin-left: 0.3rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.7rem;
		background: #e0e7ff;
		color: #3730a3;
	}

	.status {
		font-size: 0.8rem;
		font-weight: 600;
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

	.note-box {
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: #eff6ff;
		color: #1e40af;
		font-size: 0.85rem;
	}

	.empty-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1.25rem;
		border: 1px dashed var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
	}

	.empty-card p {
		margin: 0;
	}

	:global(.dark) .group-card {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .note-box {
		background: rgba(59, 130, 246, 0.15);
		color: #bfdbfe;
	}
</style>
