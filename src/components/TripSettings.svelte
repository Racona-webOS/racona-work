<svelte:options customElement={{ tag: 'racona-work-trip-settings', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_TripSettings = function () {
			return { tagName: 'racona-work-trip-settings' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Kiküldetések — beállítások (K14, D7, D20, D22).
	 *
	 * Normaköltség és bizonylatszám-előtag, a NAV havi üzemanyagárai, a céges
	 * helyek (munkahely-jelöléssel) és a címkereső / útvonaltervező címe.
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		FuelPrice,
		NavFuelApplyResult,
		Organization,
		PlaceResult,
		PriceType,
		TripPlace,
		TripPolicy
	} from '../../server/functions.js';
	import { ENABLED_PRICE_TYPES } from '../../server/trip-calc.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import NavPriceImport from './trips/NavPriceImport.svelte';
	import { errorMessage, monthName, priceTypeLabel } from './trips/format.js';
	import { resolveSdk, translate } from '../utils/sdk.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const locale = $derived(sdk?.i18n?.locale ?? 'hu');

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let loading = $state(true);

	// Költségtérítés és szolgáltatók
	let policy = $state<TripPolicy | null>(null);
	let policySaving = $state(false);

	// NAV-árak
	let priceYear = $state(new Date().getFullYear());
	let prices = $state<Record<string, string>>({});
	/** Cellánként: kézzel rögzítették, vagy a NAV oldaláról kérték le. */
	let priceSources = $state<Record<string, FuelPrice['source']>>({});
	let savingCell = $state<string | null>(null);
	let showNavImport = $state(false);
	const hasNavPrices = $derived(Object.values(priceSources).includes('nav'));

	// Céges helyek
	let places = $state<TripPlace[]>([]);
	let placeQuery = $state('');
	let placeResults = $state<PlaceResult[] | null>(null);
	let placeSearching = $state(false);
	let newPlace = $state<{ label: string; result: PlaceResult; isWorkplace: boolean } | null>(null);

	const cellKey = (month: number, type: PriceType) => `${month}:${type}`;

	async function load() {
		if (!currentOrganization) return;
		loading = true;
		const organizationId = currentOrganization.id;
		try {
			const [p, company] = await Promise.all([
				sdk.remote.call('getTripPolicy', { organizationId }),
				sdk.remote.call('getCompanyTripPlaces', { organizationId })
			]);
			policy = p;
			places = company;
			await loadPrices();
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
		} finally {
			loading = false;
		}
	}

	async function loadPrices() {
		if (!currentOrganization) return;
		const list: FuelPrice[] = await sdk.remote.call('getFuelPrices', { organizationId: currentOrganization.id, year: priceYear });
		const next: Record<string, string> = {};
		const sources: Record<string, FuelPrice['source']> = {};
		for (const p of list) {
			next[cellKey(p.month, p.priceType)] = String(p.priceHuf);
			sources[cellKey(p.month, p.priceType)] = p.source;
		}
		prices = next;
		priceSources = sources;
	}

	async function handleNavImported(result: NavFuelApplyResult) {
		showNavImport = false;
		sdk?.ui?.toast(
			t('tripSettings.nav.done', { filled: result.filled, overwritten: result.overwritten }),
			'success'
		);
		await loadPrices();
	}

	async function savePolicy() {
		if (!policy || !currentOrganization) return;
		policySaving = true;
		try {
			policy = await sdk.remote.call('saveTripPolicy', {
				organizationId: currentOrganization.id,
				policy: { ...policy, normCostPerKm: Number(policy.normCostPerKm) }
			});
			sdk?.ui?.toast(t('settings.saveSuccess'), 'success');
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			policySaving = false;
		}
	}

	async function savePrice(month: number, type: PriceType) {
		if (!currentOrganization) return;
		const key = cellKey(month, type);
		const raw = (prices[key] ?? '').trim().replace(',', '.');
		savingCell = key;
		try {
			await sdk.remote.call('saveFuelPrice', {
				organizationId: currentOrganization.id,
				year: priceYear,
				month,
				priceType: type,
				priceHuf: raw === '' ? null : Number(raw)
			});
			const { [key]: _, ...rest } = priceSources;
			priceSources = raw === '' ? rest : { ...rest, [key]: 'manual' };
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
			await loadPrices();
		} finally {
			savingCell = null;
		}
	}

	async function searchPlace() {
		if (!currentOrganization || placeQuery.trim().length < 3) return;
		placeSearching = true;
		try {
			placeResults = await sdk.remote.call('searchPlaces', { organizationId: currentOrganization.id, query: placeQuery });
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('trips.place.searchFailed')), 'error');
		} finally {
			placeSearching = false;
		}
	}

	async function addPlace() {
		if (!currentOrganization || !newPlace || !newPlace.label.trim()) return;
		try {
			await sdk.remote.call('saveTripPlace', {
				organizationId: currentOrganization.id,
				scope: 'company',
				label: newPlace.label,
				address: newPlace.result.address,
				lat: newPlace.result.lat,
				lng: newPlace.result.lng,
				isWorkplace: newPlace.isWorkplace
			});
			newPlace = null;
			placeResults = null;
			placeQuery = '';
			places = await sdk.remote.call('getCompanyTripPlaces', { organizationId: currentOrganization.id });
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		}
	}

	async function toggleWorkplace(place: TripPlace) {
		if (!currentOrganization) return;
		try {
			await sdk.remote.call('saveTripPlace', {
				id: place.id,
				organizationId: currentOrganization.id,
				scope: 'company',
				label: place.label,
				address: place.address,
				lat: place.lat,
				lng: place.lng,
				isWorkplace: !place.isWorkplace
			});
			places = await sdk.remote.call('getCompanyTripPlaces', { organizationId: currentOrganization.id });
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		}
	}

	async function removePlace(place: TripPlace) {
		if (!currentOrganization) return;
		const result = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('tripSettings.places.deleteTitle'),
			message: t('tripSettings.places.deleteMessage', { label: place.label }),
			confirmLabel: t('trips.delete'),
			confirmVariant: 'destructive'
		});
		if (result?.action !== 'confirm') return;
		try {
			await sdk.remote.call('deleteTripPlace', { id: place.id });
			places = places.filter((p) => p.id !== place.id);
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		}
	}

	function shiftYear(delta: number) {
		priceYear += delta;
		loadPrices();
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
			if (currentOrganization && sdk?.remote) load();
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
				<h2>{t('tripSettings.title')}</h2>
				<p class="subtitle">{t('tripSettings.subtitle')}</p>
			</div>
		</div>

		{#if loading || !policy}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else}
			<div class="columns">
			<div class="column">
			<div class="settings-section">
				<div class="section-head">
					<h3>{t('tripSettings.reimbursement.title')}</h3>
					<p class="section-description">{t('tripSettings.reimbursement.description')}</p>
				</div>
				<div class="fields">
					<label>
						<span>{t('tripSettings.reimbursement.normCost')}</span>
						<input class="input" type="number" min="0" max="1000" step="0.5" bind:value={policy.normCostPerKm} />
					</label>
					<label>
						<span>{t('tripSettings.reimbursement.prefix')}</span>
						<input class="input" type="text" maxlength="10" bind:value={policy.documentNumberPrefix} />
						<small class="hint">{t('tripSettings.reimbursement.prefixHint', { example: `${policy.documentNumberPrefix ? `${policy.documentNumberPrefix}-` : ''}${new Date().getFullYear()}-0001` })}</small>
					</label>
				</div>
				<div class="save-row">
					<button class="btn-primary" onclick={savePolicy} disabled={policySaving}>{t('settings.save')}</button>
				</div>
			</div>

			<div class="settings-section">
				<div class="section-head">
					<h3>{t('tripSettings.prices.title')}</h3>
					<p class="section-description">{t('tripSettings.prices.description')}</p>
				</div>
				<div class="year-nav">
					<button class="icon-btn" onclick={() => shiftYear(-1)} aria-label="‹">‹</button>
					<strong>{priceYear}</strong>
					<button class="icon-btn" onclick={() => shiftYear(1)} aria-label="›">›</button>
					<button class="btn-secondary btn-sm nav-fetch" onclick={() => (showNavImport = true)}>
						{t('tripSettings.nav.fetch')}
					</button>
				</div>
				<div class="table-wrap">
					<table class="price-table">
						<thead>
							<tr>
								<th>{t('tripSettings.prices.month')}</th>
								{#each ENABLED_PRICE_TYPES as type (type)}<th>{priceTypeLabel(type, locale)} (Ft/l)</th>{/each}
							</tr>
						</thead>
						<tbody>
							{#each Array.from({ length: 12 }, (_, i) => i + 1) as month (month)}
								<tr>
									<td>{monthName(month, locale)}</td>
									{#each ENABLED_PRICE_TYPES as type (type)}
										<td>
											<span class="price-cell">
												<input
													class="input price-input"
													class:saving={savingCell === cellKey(month, type)}
													title={priceSources[cellKey(month, type)] === 'nav' ? t('tripSettings.nav.cellHint') : undefined}
													type="text"
													inputmode="decimal"
													placeholder="—"
													bind:value={prices[cellKey(month, type)]}
													onchange={() => savePrice(month, type)}
												/>
												{#if priceSources[cellKey(month, type)] === 'nav'}
													<span class="nav-badge" aria-hidden="true">NAV</span>
												{/if}
											</span>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if hasNavPrices}
					<p class="hint legend"><span class="nav-badge static">NAV</span>{t('tripSettings.nav.legend')}</p>
				{/if}
			</div>

			</div>

			<div class="column">
			<div class="settings-section">
				<div class="section-head">
					<h3>{t('tripSettings.places.title')}</h3>
					<p class="section-description">{t('tripSettings.places.description')}</p>
				</div>
				{#if places.length === 0}
					<p class="empty-state">{t('tripSettings.places.empty')}</p>
				{:else}
					<ul class="place-list">
						{#each places as place (place.id)}
							<li>
								<div>
									<strong>{place.label}</strong>
									{#if place.isWorkplace}<span class="tag">{t('tripSettings.places.workplace')}</span>{/if}
									<div class="muted">{place.address}</div>
								</div>
								<div class="place-actions">
									<button class="btn-secondary btn-sm" onclick={() => toggleWorkplace(place)}>
										{place.isWorkplace ? t('tripSettings.places.unsetWorkplace') : t('tripSettings.places.setWorkplace')}
									</button>
									<button class="remove-btn" onclick={() => removePlace(place)} title={t('trips.delete')}>×</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="add-place">
					<div class="row">
						<input
							class="input"
							type="text"
							placeholder={t('tripSettings.places.searchPlaceholder')}
							bind:value={placeQuery}
							onkeydown={(e) => e.key === 'Enter' && searchPlace()}
						/>
						<button class="btn-primary" onclick={searchPlace} disabled={placeSearching}>{t('trips.place.searchButton')}</button>
					</div>
					{#if placeResults}
						{#if placeResults.length === 0}
							<p class="hint">{t('trips.place.noResults')}</p>
						{:else}
							<ul class="results">
								{#each placeResults as r (`${r.lat},${r.lng}`)}
									<li><button onclick={() => (newPlace = { label: '', result: r, isWorkplace: false })}>{r.label}</button></li>
								{/each}
							</ul>
						{/if}
						<p class="hint">{t('trips.place.attribution')}</p>
					{/if}
					{#if newPlace}
						<div class="row">
							<input class="input" type="text" maxlength="100" placeholder={t('trips.place.saveLabel')} bind:value={newPlace.label} />
							<label class="inline-check"><input type="checkbox" bind:checked={newPlace.isWorkplace} /><span>{t('tripSettings.places.workplace')}</span></label>
							<button class="btn-primary" onclick={addPlace} disabled={!newPlace.label.trim()}>{t('form.save')}</button>
						</div>
						<p class="hint">{newPlace.result.address}</p>
					{/if}
				</div>
			</div>

			<div class="settings-section">
				<div class="section-head">
					<h3>{t('tripSettings.providers.title')}</h3>
					<p class="section-description">{t('tripSettings.providers.description')}</p>
				</div>
				<div class="fields">
					<label>
						<span>{t('tripSettings.providers.geocoder')}</span>
						<input class="input" type="url" bind:value={policy.geocoder.baseUrl} />
						<small class="hint">{t('tripSettings.providers.geocoderHint')}</small>
					</label>
					<label>
						<span>{t('tripSettings.providers.countries')}</span>
						<input class="input" type="text" bind:value={policy.geocoder.countryCodes} />
						<small class="hint">{t('tripSettings.providers.countriesHint')}</small>
					</label>
					<label>
						<span>{t('tripSettings.providers.router')}</span>
						<input class="input" type="url" bind:value={policy.router.baseUrl} />
						<small class="hint">{t('tripSettings.providers.routerHint')}</small>
					</label>
				</div>
				<p class="hint change-hint">{t('tripSettings.providers.changeHint')}</p>
				<div class="save-row">
					<button class="btn-primary" onclick={savePolicy} disabled={policySaving}>{t('settings.save')}</button>
				</div>
			</div>
			</div>
			</div>
		{/if}
	{/if}

	{#if showNavImport && currentOrganization}
		<NavPriceImport
			{pluginId}
			organizationId={currentOrganization.id}
			year={priceYear}
			onDone={handleNavImported}
			onClose={() => (showNavImport = false)}
		/>
	{/if}
</section>
</div>

<style>
	@import '../styles/shared.css';

	.page {
		max-width: 1280px;
	}

	/* Két oszlop; ha nincs elég hely, a konténer szélessége alapján egymás alá kerülnek. */
	.columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr));
		gap: 1.25rem;
		align-items: start;
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
	}

	.section-head h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 0.25rem;
	}

	.section-description {
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
	}

	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 640px) {
		.fields {
			grid-template-columns: 1fr;
		}
	}

	.save-row {
		display: flex;
		justify-content: flex-end;
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.year-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.price-table {
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.price-table th,
	.price-table td {
		padding: 0.25rem 0.75rem 0.25rem 0;
		text-align: left;
	}

	.price-table th {
		font-weight: 500;
		color: var(--color-muted-foreground, #64748b);
	}

	.price-input {
		width: 7rem;
		padding: 0.3rem 0.5rem;
		text-align: right;
	}

	.price-input.saving {
		opacity: 0.6;
	}

	.price-cell {
		position: relative;
		display: inline-block;
	}

	/* A NAV-ból lekért ár jelölése: kis címke a mező bal oldalán (a szám jobbra van igazítva). */
	.nav-badge {
		position: absolute;
		left: 0.4rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		padding: 0.05rem 0.3rem;
		border-radius: 0.25rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		line-height: 1.3;
		color: var(--color-primary, #3730a3);
		background: color-mix(in oklab, var(--color-primary, #3730a3) 12%, transparent);
	}

	.nav-badge.static {
		position: static;
		transform: none;
		flex-shrink: 0;
	}

	.change-hint {
		padding: 0.625rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--color-muted, #f1f5f9);
	}

	.nav-fetch {
		margin-left: auto;
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.place-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.place-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		font-size: 0.875rem;
	}

	.place-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.tag {
		margin-left: 0.4rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		font-size: 0.7rem;
		background: #dcfce7;
		color: #166534;
	}

	.muted {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.8rem;
	}

	.add-place {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--color-border, #e2e8f0);
	}

	.add-place .row {
		display: flex;
		gap: 0.5rem;
		align-items: stretch;
	}

	.add-place .row .input {
		flex: 1;
	}

	.inline-check {
		flex-direction: row;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
	}

	.results {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.results button {
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		padding: 0.35rem 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--color-foreground, #0f172a);
	}

	.results button:hover {
		background: var(--color-accent, #f1f5f9);
	}

	:global(.dark) .settings-section {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	/* Sötét mód: a világos státuszszínek sötét párjai */
	:global(.dark) .tag {
		background: var(--rw-dark-success-bg);
		color: var(--rw-dark-success-fg);
	}
</style>
