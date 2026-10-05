<svelte:options customElement={{ tag: 'racona-work-trip-vehicles', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_TripVehicles = function () {
			return { tagName: 'racona-work-trip-vehicles' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Kiküldetések — Autóim (K1).
	 *
	 * A dolgozó a saját autóit kezeli; a HR bármelyik dolgozóét, és egyedi
	 * fogyasztást is megadhat indoklással. A norma a hengerűrtartalomból és az
	 * üzemanyagból azonnal látszik (60/1992. Korm. rendelet).
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { EmployeeRow, FuelType, Organization, PaginatedResult, TripVehicle } from '../../server/functions.js';
	import { ENABLED_FUEL_TYPES, FUEL_LABELS, consumptionUnitLabel, vehicleConsumption } from '../../server/trip-calc.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import { errorMessage, formatDecimal } from './trips/format.js';
	import { resolveSdk, translate } from '../utils/sdk.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const locale = $derived(sdk?.i18n?.locale === 'en' ? 'en' : 'hu');

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);

	let canManage = $state(false);
	let scope = $state<'mine' | 'all'>('mine');
	let employeeFilter = $state<number | null>(null);
	let includeArchived = $state(false);
	let vehicles = $state<TripVehicle[]>([]);
	let employees = $state<EmployeeRow[]>([]);
	let loading = $state(false);

	// Szerkesztő
	type Draft = {
		id?: number;
		employeeId: number | null;
		plateNumber: string;
		model: string;
		engineCc: string;
		fuelType: FuelType;
		isDefault: boolean;
		consumptionOverride: string;
		consumptionOverrideReason: string;
	};
	let draft = $state<Draft | null>(null);
	let saving = $state(false);

	const preview = $derived(
		draft
			? vehicleConsumption({
					fuelType: draft.fuelType,
					engineCc: draft.engineCc ? Number(draft.engineCc) : null,
					consumptionOverride: draft.consumptionOverride ? Number(draft.consumptionOverride) : null
				})
			: null
	);

	async function load() {
		if (!currentOrganization) return;
		loading = true;
		const organizationId = currentOrganization.id;
		try {
			const perms = await sdk.remote.call('getSettlementPermissions', { organizationId });
			canManage = perms.canManage;
			vehicles = await sdk.remote.call('getTripVehicles', {
				organizationId,
				scope,
				employeeId: scope === 'all' ? (employeeFilter ?? undefined) : undefined,
				includeArchived
			});
			if (canManage && employees.length === 0) {
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
		load();
	}

	function openNew() {
		draft = {
			employeeId: scope === 'all' ? employeeFilter : null,
			plateNumber: '',
			model: '',
			engineCc: '',
			fuelType: ENABLED_FUEL_TYPES[0],
			isDefault: false,
			consumptionOverride: '',
			consumptionOverrideReason: ''
		};
	}

	function openEdit(v: TripVehicle) {
		draft = {
			id: v.id,
			employeeId: v.employeeId,
			plateNumber: v.plateNumber,
			model: v.model,
			engineCc: v.engineCc === null ? '' : String(v.engineCc),
			fuelType: v.fuelType,
			isDefault: v.isDefault,
			consumptionOverride: v.consumptionOverride === null ? '' : String(v.consumptionOverride),
			consumptionOverrideReason: v.consumptionOverrideReason ?? ''
		};
	}

	async function save() {
		if (!draft || !currentOrganization) return;
		if (scope === 'all' && !draft.id && !draft.employeeId) {
			sdk?.ui?.toast(t('tripVehicles.employeeRequired'), 'error');
			return;
		}
		saving = true;
		try {
			await sdk.remote.call('saveTripVehicle', {
				id: draft.id,
				organizationId: currentOrganization.id,
				employeeId: draft.employeeId ?? undefined,
				plateNumber: draft.plateNumber,
				model: draft.model,
				engineCc: draft.engineCc ? Number(draft.engineCc) : null,
				fuelType: draft.fuelType,
				isDefault: draft.isDefault,
				...(canManage
					? {
							consumptionOverride: draft.consumptionOverride ? Number(draft.consumptionOverride) : null,
							consumptionOverrideReason: draft.consumptionOverrideReason
						}
					: {})
			});
			sdk?.ui?.toast(t('tripVehicles.saved'), 'success');
			draft = null;
			load();
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			saving = false;
		}
	}

	async function archive(v: TripVehicle, archived: boolean) {
		if (archived) {
			const result = await sdk?.ui?.dialog?.({
				type: 'confirm',
				title: t('tripVehicles.archiveTitle'),
				message: v.tripCount > 0 ? t('tripVehicles.archiveMessage', { plate: v.plateNumber }) : t('tripVehicles.deleteMessage', { plate: v.plateNumber }),
				confirmLabel: v.tripCount > 0 ? t('tripVehicles.archive') : t('tripVehicles.delete'),
				confirmVariant: 'destructive'
			});
			if (result?.action !== 'confirm') return;
		}
		try {
			await sdk.remote.call('archiveTripVehicle', { id: v.id, archived });
			load();
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
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
				load();
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
				<h2>{t('tripVehicles.title')}</h2>
				<p class="subtitle">{t('tripVehicles.subtitle')}</p>
			</div>
			<button class="btn-primary" onclick={openNew}>+ {t('tripVehicles.new')}</button>
		</div>

		<div class="toolbar">
			{#if canManage}
				<div class="view-toggle">
					<button class="chip" class:active={scope === 'mine'} onclick={() => setScope('mine')}>{t('trips.scope.mine')}</button>
					<button class="chip" class:active={scope === 'all'} onclick={() => setScope('all')}>{t('trips.scope.all')}</button>
				</div>
				{#if scope === 'all'}
					<select class="input" value={employeeFilter ?? ''} onchange={(e) => {
						const v = (e.currentTarget as HTMLSelectElement).value;
						employeeFilter = v ? Number(v) : null;
						load();
					}}>
						<option value="">{t('trips.allEmployees')}</option>
						{#each employees as emp (emp.id)}<option value={emp.id}>{emp.userName}</option>{/each}
					</select>
				{/if}
			{/if}
			<label class="inline-check">
				<input type="checkbox" bind:checked={includeArchived} onchange={load} />
				<span>{t('tripVehicles.showArchived')}</span>
			</label>
		</div>

		{#if loading && vehicles.length === 0}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if vehicles.length === 0}
			<p class="empty-state">{t('tripVehicles.empty')}</p>
		{:else}
			<div class="vehicle-grid">
				{#each vehicles as v (v.id)}
					<article class="vehicle-card" class:archived={v.archived}>
						<div class="vc-head">
							<strong class="plate">{v.plateNumber}</strong>
							{#if v.isDefault}<span class="tag">{t('tripVehicles.default')}</span>{/if}
							{#if v.archived}<span class="tag muted-tag">{t('tripVehicles.archived')}</span>{/if}
						</div>
						<div>{v.model}</div>
						{#if scope === 'all'}<div class="muted">{v.employeeName}</div>{/if}
						<div class="muted">
							{v.engineCc ? `${v.engineCc} cm³ · ` : ''}{FUEL_LABELS[v.fuelType]?.[locale] ?? v.fuelType}
						</div>
						<div class="norm">
							{#if v.consumption.value !== null}
								{formatDecimal(v.consumption.value)} {consumptionUnitLabel(v.consumption.unit)}
								<span class="muted">
									· {v.consumption.source === 'override' ? t('tripVehicles.override') : t('tripVehicles.regulation')}
								</span>
							{:else}
								<span class="warn">{t('tripVehicles.noNorm')}</span>
							{/if}
						</div>
						<div class="vc-actions">
							<button class="btn-secondary btn-sm" onclick={() => openEdit(v)}>{t('trips.edit')}</button>
							{#if v.archived}
								<button class="btn-secondary btn-sm" onclick={() => archive(v, false)}>{t('tripVehicles.restore')}</button>
							{:else}
								<button class="btn-secondary btn-sm" onclick={() => archive(v, true)}>
									{v.tripCount > 0 ? t('tripVehicles.archive') : t('tripVehicles.delete')}
								</button>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		{/if}
	{/if}
</section>
</div>

{#if draft}
	<div class="modal-overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (draft = null)}>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="vehicle-form-title">
			<div class="modal-header">
				<h3 id="vehicle-form-title">{draft.id ? t('tripVehicles.editTitle') : t('tripVehicles.newTitle')}</h3>
				<button class="modal-close" onclick={() => (draft = null)} aria-label={t('form.cancel')}>×</button>
			</div>
			<div class="modal-body">
				{#if scope === 'all' && !draft.id}
					<label>
						<span>{t('tripSettlements.employee')}</span>
						<select class="input" bind:value={draft.employeeId}>
							<option value={null}>—</option>
							{#each employees as emp (emp.id)}<option value={emp.id}>{emp.userName}</option>{/each}
						</select>
					</label>
				{/if}
				<div class="grid-2">
					<label>
						<span>{t('tripVehicles.plate')}</span>
						<input class="input" type="text" maxlength="16" placeholder="ABC-123" bind:value={draft.plateNumber} />
					</label>
					<label>
						<span>{t('tripVehicles.model')}</span>
						<input class="input" type="text" maxlength="100" placeholder="Audi A4" bind:value={draft.model} />
					</label>
					<label>
						<span>{t('tripVehicles.engineCc')}</span>
						<input class="input" type="number" min="50" max="10000" step="1" bind:value={draft.engineCc} />
					</label>
					<label>
						<span>{t('tripVehicles.fuel')}</span>
						<select class="input" bind:value={draft.fuelType}>
							{#each ENABLED_FUEL_TYPES as f (f)}<option value={f}>{FUEL_LABELS[f][locale]}</option>{/each}
							{#if !ENABLED_FUEL_TYPES.includes(draft.fuelType)}
								<option value={draft.fuelType}>{FUEL_LABELS[draft.fuelType][locale]}</option>
							{/if}
						</select>
					</label>
				</div>
				<p class="norm-preview">
					{#if preview && preview.value !== null}
						{t('tripVehicles.normPreview', { value: formatDecimal(preview.value), unit: consumptionUnitLabel(preview.unit) })}
						{preview.source === 'regulation' ? t('tripVehicles.regulationSuffix') : t('tripVehicles.overrideSuffix')}
					{:else}
						{t('tripVehicles.normPreviewEmpty')}
					{/if}
				</p>
				<label class="inline-check">
					<input type="checkbox" bind:checked={draft.isDefault} />
					<span>{t('tripVehicles.makeDefault')}</span>
				</label>
				{#if canManage}
					<fieldset class="override">
						<legend>{t('tripVehicles.overrideTitle')}</legend>
						<div class="grid-2">
							<label>
								<span>{t('tripVehicles.overrideValue')}</span>
								<input class="input" type="number" min="0.1" max="100" step="0.1" bind:value={draft.consumptionOverride} />
							</label>
							<label>
								<span>{t('tripVehicles.overrideReason')}</span>
								<input class="input" type="text" maxlength="500" bind:value={draft.consumptionOverrideReason} />
							</label>
						</div>
					</fieldset>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (draft = null)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={save} disabled={saving}>{saving ? t('loading') : t('form.save')}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../styles/shared.css';

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.inline-check {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.vehicle-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 1rem;
	}

	.vehicle-card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
		font-size: 0.875rem;
	}

	.vehicle-card.archived {
		opacity: 0.6;
	}

	.vc-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.plate {
		font-size: 1.05rem;
		letter-spacing: 0.03em;
	}

	.tag {
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		font-size: 0.7rem;
		background: #dcfce7;
		color: #166534;
	}

	.muted-tag {
		background: #f1f5f9;
		color: #475569;
	}

	.muted {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.8rem;
	}

	.norm {
		margin-top: 0.25rem;
	}

	.warn {
		color: #b45309;
	}

	.vc-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.norm-preview {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.override {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		padding: 0.75rem;
		margin: 0;
	}

	.override legend {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .vehicle-card {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}
</style>
