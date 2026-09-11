<script lang="ts">
	/**
	 * Helyválasztó az út pontjaihoz (K2, K3).
	 *
	 * Választható: lakcím, munkahely, céges és saját mentett helyek, vagy címkeresés.
	 * A keresés gombra / Enterre indul, gépelés közben nem (Nominatim szabály).
	 * A keresésből választott hely egy kattintással elmenthető saját helyként.
	 */
	import type { PlaceResult, TripPlaces, Waypoint } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { errorMessage } from './format.js';

	let {
		pluginId = 'racona-work',
		organizationId,
		employeeId = null,
		label,
		value = null,
		places = null,
		onChange,
		onPlacesChanged,
		removable = false,
		onRemove
	}: {
		pluginId?: string;
		organizationId: number;
		/** HR más nevében: a saját hely ennek a dolgozónak mentődik. */
		employeeId?: number | null;
		label: string;
		value?: Waypoint | null;
		places?: TripPlaces | null;
		onChange: (waypoint: Waypoint | null) => void;
		onPlacesChanged?: () => void;
		removable?: boolean;
		onRemove?: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	type Option = { key: string; waypoint: Waypoint; group: 'fixed' | 'company' | 'personal' };

	const options = $derived.by<Option[]>(() => {
		const list: Option[] = [];
		if (places?.home) list.push({ key: 'home', waypoint: places.home, group: 'fixed' });
		if (places?.workplace) list.push({ key: 'workplace', waypoint: places.workplace, group: 'fixed' });
		for (const p of places?.company ?? []) list.push({ key: `c${p.id}`, waypoint: p, group: 'company' });
		for (const p of places?.personal ?? []) list.push({ key: `p${p.id}`, waypoint: p, group: 'personal' });
		return list;
	});

	function samePlace(a: Waypoint | null, b: Waypoint | null): boolean {
		return !!a && !!b && a.lat === b.lat && a.lng === b.lng && a.address === b.address;
	}

	const selectedKey = $derived.by(() => {
		if (!value) return '';
		const match = options.find((o) => samePlace(o.waypoint, value) && o.waypoint.label === value.label);
		return match?.key ?? 'custom';
	});

	let searchOpen = $state(false);
	let query = $state('');
	let searching = $state(false);
	let results = $state<PlaceResult[] | null>(null);

	let saveOpen = $state(false);
	let saveLabel = $state('');
	let saving = $state(false);

	function onSelect(event: Event) {
		const key = (event.currentTarget as HTMLSelectElement).value;
		if (key === '__search') {
			searchOpen = true;
			results = null;
			return;
		}
		searchOpen = false;
		const option = options.find((o) => o.key === key);
		onChange(option ? { ...option.waypoint } : key === 'custom' ? value : null);
	}

	async function search() {
		if (query.trim().length < 3) {
			sdk?.ui?.toast(t('trips.place.searchTooShort'), 'error');
			return;
		}
		searching = true;
		try {
			results = await sdk.remote.call('searchPlaces', { organizationId, query });
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('trips.place.searchFailed')), 'error');
		} finally {
			searching = false;
		}
	}

	function pick(result: PlaceResult) {
		onChange({ label: result.label, address: result.address, lat: result.lat, lng: result.lng });
		searchOpen = false;
		results = null;
		query = '';
	}

	function openSave() {
		saveOpen = true;
		saveLabel = '';
	}

	async function savePlace() {
		if (!value || !saveLabel.trim()) return;
		saving = true;
		try {
			const saved = await sdk.remote.call('saveTripPlace', {
				organizationId,
				scope: 'personal',
				employeeId: employeeId ?? undefined,
				label: saveLabel.trim(),
				address: value.address,
				lat: value.lat,
				lng: value.lng
			});
			onChange({ label: saved.label, address: saved.address, lat: saved.lat, lng: saved.lng });
			saveOpen = false;
			saveLabel = '';
			onPlacesChanged?.();
			sdk?.ui?.toast(t('trips.place.saved'), 'success');
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			saving = false;
		}
	}
</script>

<div class="place-picker">
	<div class="pp-head">
		<span class="pp-label">{label}</span>
		{#if removable}
			<button type="button" class="remove-btn" title={t('trips.place.remove')} onclick={() => onRemove?.()}>×</button>
		{/if}
	</div>

	<select class="input" value={searchOpen ? '__search' : selectedKey} onchange={onSelect}>
		<option value="">{t('trips.place.choose')}</option>
		{#each options.filter((o) => o.group === 'fixed') as o (o.key)}
			<option value={o.key}>{o.waypoint.label} — {o.waypoint.address}</option>
		{/each}
		{#if options.some((o) => o.group === 'company')}
			<optgroup label={t('trips.place.company')}>
				{#each options.filter((o) => o.group === 'company') as o (o.key)}
					<option value={o.key}>{o.waypoint.label}</option>
				{/each}
			</optgroup>
		{/if}
		{#if options.some((o) => o.group === 'personal')}
			<optgroup label={t('trips.place.personal')}>
				{#each options.filter((o) => o.group === 'personal') as o (o.key)}
					<option value={o.key}>{o.waypoint.label}</option>
				{/each}
			</optgroup>
		{/if}
		{#if selectedKey === 'custom' && value}
			<option value="custom">{value.label}</option>
		{/if}
		<option value="__search">{t('trips.place.search')}</option>
	</select>

	{#if searchOpen}
		<div class="pp-search">
			<div class="pp-search-row">
				<input
					class="input"
					type="text"
					placeholder={t('trips.place.searchPlaceholder')}
					bind:value={query}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							search();
						}
					}}
				/>
				<button type="button" class="btn-secondary btn-sm" onclick={search} disabled={searching}>
					{searching ? t('loading') : t('trips.place.searchButton')}
				</button>
			</div>
			{#if results}
				{#if results.length === 0}
					<p class="pp-hint">{t('trips.place.noResults')}</p>
				{:else}
					<ul class="pp-results">
						{#each results as result (`${result.lat},${result.lng}`)}
							<li><button type="button" onclick={() => pick(result)}>{result.label}</button></li>
						{/each}
					</ul>
				{/if}
			{/if}
			<p class="pp-attribution">{t('trips.place.attribution')}</p>
		</div>
	{/if}

	{#if selectedKey === 'custom' && value && !searchOpen}
		{#if saveOpen}
			<div class="pp-search-row">
				<input class="input" type="text" maxlength="100" placeholder={t('trips.place.saveLabel')} bind:value={saveLabel} />
				<button type="button" class="btn-secondary btn-sm" onclick={savePlace} disabled={saving || !saveLabel.trim()}>
					{t('form.save')}
				</button>
			</div>
		{:else}
			<button type="button" class="pp-link" onclick={openSave}>
				{t('trips.place.saveAsPersonal')}
			</button>
		{/if}
	{/if}
</div>

<style>
	@import '../../styles/shared.css';

	.place-picker {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.pp-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.pp-label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.pp-search {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem;
		border: 1px dashed var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
	}

	.pp-search-row {
		display: flex;
		gap: 0.5rem;
	}

	.pp-search-row .input {
		flex: 1;
		min-width: 0;
	}

	.pp-results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.pp-results button {
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

	.pp-results button:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.pp-hint,
	.pp-attribution {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.pp-link {
		align-self: flex-start;
		border: none;
		background: transparent;
		padding: 0;
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
		cursor: pointer;
	}
</style>
