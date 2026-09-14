<script lang="ts">
	/**
	 * Út rögzítése / szerkesztése / másolása (K4, K5, K7).
	 *
	 * A távolságot a szerver útvonaltervezője adja; a pontok változása után
	 * magától újraszámol. Az elszámolt km szerkeszthető, de ha eltér a tervezettől,
	 * indoklás kell (D2). Ha az útvonaltervező nem érhető el, kézi km is megadható.
	 */
	import { onMount, untrack } from 'svelte';
	import type {
		ReturnMode,
		RouteResult,
		TripDetail,
		TripPlaces,
		TripRow,
		TripVehicle,
		Waypoint
	} from '../../../server/functions.js';
	import { roundKm } from '../../../server/trip-calc.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import PlacePicker from './PlacePicker.svelte';
	import RouteMap from './RouteMap.svelte';
	import { errorMessage, formatKm, localDateTime } from './format.js';

	let {
		pluginId = 'racona-work',
		organizationId,
		employeeId = null,
		vehicles,
		orderers,
		trip = null,
		copyFrom = null,
		onSaved,
		onClose
	}: {
		pluginId?: string;
		organizationId: number;
		/** HR más nevében; null = a hívó saját útja. */
		employeeId?: number | null;
		vehicles: TripVehicle[];
		orderers: { userId: number; name: string }[];
		trip?: TripDetail | null;
		copyFrom?: TripRow | null;
		onSaved: (trip: TripDetail) => void;
		onClose: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const source = untrack(() => trip ?? copyFrom);
	const originKey = untrack(() => `racona-work:trip-origin:${organizationId}:${employeeId ?? 'me'}`);

	function initialTimes(): { start: string; end: string } {
		const today = localDateTime(new Date()).slice(0, 10);
		if (trip) return { start: trip.startedAt, end: trip.endedAt };
		if (copyFrom) return { start: `${today}T${copyFrom.startedAt.slice(11)}`, end: `${today}T${copyFrom.endedAt.slice(11)}` };
		return { start: `${today}T08:00`, end: `${today}T16:00` };
	}

	const times = untrack(initialTimes);
	const activeVehicles = $derived(vehicles.filter((v) => !v.archived || v.id === trip?.vehicleId));

	let vehicleId = $state<number | null>(
		untrack(() => source?.vehicleId ?? vehicles.find((v) => v.isDefault && !v.archived)?.id ?? vehicles.find((v) => !v.archived)?.id ?? null)
	);
	let startedAt = $state(times.start);
	let endedAt = $state(times.end);
	let purpose = $state(untrack(() => source?.purpose ?? ''));
	let orderedByUserId = $state<number | null>(untrack(() => source?.orderedByUserId ?? null));
	let returnMode = $state<ReturnMode>(untrack(() => source?.returnMode ?? 'origin'));
	/** Új útnál a dolgozó legutóbbi választása (a helyekkel együtt töltődik be), különben az úté. */
	let avoidTolls = $state(untrack(() => source?.avoidTolls ?? false));

	function splitWaypoints(): { origin: Waypoint | null; stops: (Waypoint | null)[]; destination: Waypoint | null; back: Waypoint | null } {
		if (!source) return { origin: null, stops: [], destination: null, back: null };
		const points = [...source.waypoints];
		const back = source.returnMode === 'other' ? (points.pop() ?? null) : null;
		const origin = points.shift() ?? null;
		const destination = points.pop() ?? null;
		return { origin, stops: points, destination, back };
	}
	const initialPoints = untrack(splitWaypoints);

	let origin = $state<Waypoint | null>(initialPoints.origin);
	let stops = $state<(Waypoint | null)[]>(initialPoints.stops);
	let destination = $state<Waypoint | null>(initialPoints.destination);
	let backPoint = $state<Waypoint | null>(initialPoints.back);

	let places = $state<TripPlaces | null>(null);

	// Távolság
	let route = $state<RouteResult | null>(
		untrack(() =>
			trip && trip.routedKm !== null
				? { km: trip.routedKm, legsKm: trip.routeLegsKm ?? [], durationMin: 0, geometry: trip.routeGeometry ?? '' }
				: null
		)
	);
	let routing = $state(false);
	let routeError = $state<string | null>(null);
	let manualDistance = $state(untrack(() => !!trip && trip.routedKm === null));
	let distanceKm = $state<string>(untrack(() => (source ? String(source.distanceKm) : '')));
	let distanceReason = $state(untrack(() => source?.distanceReason ?? ''));
	/** A km mező a tervezettet követi, amíg a felhasználó át nem írja. */
	let kmFollowsRoute = $state(untrack(() => !source || (source.routedKm !== null && source.distanceKm === roundKm(source.routedKm))));

	let saving = $state(false);

	const waypoints = $derived.by<Waypoint[] | null>(() => {
		if (!origin || !destination) return null;
		if (returnMode === 'other' && !backPoint) return null;
		const list = [origin, ...stops.filter((s): s is Waypoint => s !== null), destination];
		if (returnMode === 'other' && backPoint) list.push(backPoint);
		return list;
	});

	const plannedKm = $derived(route ? roundKm(route.km) : null);
	const distanceNumber = $derived(Number(distanceKm));
	const reasonRequired = $derived(
		manualDistance || (plannedKm !== null && Number.isInteger(distanceNumber) && distanceNumber !== plannedKm)
	);

	onMount(async () => {
		try {
			places = await sdk.remote.call('getTripPlaces', { organizationId, employeeId: employeeId ?? undefined });
			if (!origin) origin = rememberedOrigin() ?? places?.home ?? places?.workplace ?? null;
			if (!source && places) avoidTolls = places.lastAvoidTolls;
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
		}
	});

	async function reloadPlaces() {
		try {
			places = await sdk.remote.call('getTripPlaces', { organizationId, employeeId: employeeId ?? undefined });
		} catch {
			/* a lista marad */
		}
	}

	function rememberedOrigin(): Waypoint | null {
		try {
			const raw = localStorage.getItem(originKey);
			return raw ? (JSON.parse(raw) as Waypoint) : null;
		} catch {
			return null;
		}
	}

	function rememberOrigin(point: Waypoint) {
		try {
			localStorage.setItem(originKey, JSON.stringify(point));
		} catch {
			/* nem baj, ha nem menthető */
		}
	}

	// Útvonal újraszámolása, amikor a pontok változnak (a szerver gyorsítótáraz)
	let routeTimer: ReturnType<typeof setTimeout> | undefined;
	let lastRouteKey = untrack(() => (trip && waypoints ? JSON.stringify([waypoints, returnMode, avoidTolls]) : ''));
	$effect(() => {
		const points = waypoints;
		const mode = returnMode;
		const tolls = avoidTolls;
		if (!points || manualDistance) return;
		const key = JSON.stringify([points, mode, tolls]);
		if (key === lastRouteKey) return;
		clearTimeout(routeTimer);
		routeTimer = setTimeout(() => calculate(points, mode, tolls, key), 300);
		return () => clearTimeout(routeTimer);
	});

	async function calculate(points: Waypoint[], mode: ReturnMode, tolls: boolean, key: string) {
		routing = true;
		routeError = null;
		try {
			const result: RouteResult = await sdk.remote.call('calculateRoute', {
				organizationId,
				waypoints: points,
				returnMode: mode,
				avoidTolls: tolls
			});
			lastRouteKey = key;
			route = result;
			if (kmFollowsRoute || !distanceKm) {
				distanceKm = String(roundKm(result.km));
				kmFollowsRoute = true;
			}
		} catch (err) {
			route = null;
			routeError = errorMessage(err, t('trips.form.routeFailed'));
		} finally {
			routing = false;
		}
	}

	function recalculate() {
		if (waypoints) calculate(waypoints, returnMode, avoidTolls, JSON.stringify([waypoints, returnMode, avoidTolls]));
	}

	function setOrigin(point: Waypoint | null) {
		origin = point;
		if (point) rememberOrigin(point);
	}

	function onStartChange() {
		// A vége ne kerüljön a kezdés elé: ugyanarra a napra, 8 órával később
		if (endedAt <= startedAt) {
			const day = startedAt.slice(0, 10);
			const hour = Math.min(23, Number(startedAt.slice(11, 13)) + 8);
			endedAt = `${day}T${String(hour).padStart(2, '0')}:${startedAt.slice(14, 16)}`;
		}
	}

	async function save() {
		if (!vehicleId) return sdk?.ui?.toast(t('trips.form.vehicleRequired'), 'error');
		if (!waypoints) return sdk?.ui?.toast(t('trips.form.routeRequired'), 'error');
		if (!Number.isInteger(distanceNumber) || distanceNumber < 1) return sdk?.ui?.toast(t('trips.form.kmRequired'), 'error');
		if (reasonRequired && !distanceReason.trim()) return sdk?.ui?.toast(t('trips.form.reasonRequired'), 'error');

		saving = true;
		try {
			const saved: TripDetail = await sdk.remote.call('saveTrip', {
				id: trip?.id,
				organizationId,
				employeeId: employeeId ?? undefined,
				vehicleId,
				startedAt,
				endedAt,
				purpose,
				waypoints,
				returnMode,
				avoidTolls,
				distanceKm: distanceNumber,
				distanceReason: reasonRequired ? distanceReason : null,
				orderedByUserId,
				manualDistance
			});
			sdk?.ui?.toast(t('trips.form.saved'), 'success');
			onSaved(saved);
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			saving = false;
		}
	}
</script>

<div class="modal-overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="modal trip-modal" role="dialog" aria-modal="true" aria-labelledby="trip-form-title">
		<div class="modal-header">
			<h3 id="trip-form-title">{trip ? t('trips.form.editTitle') : copyFrom ? t('trips.form.copyTitle') : t('trips.form.newTitle')}</h3>
			<button class="modal-close" onclick={onClose} aria-label={t('form.cancel')}>×</button>
		</div>

		<div class="modal-body">
			<div class="grid-3">
				<label>
					<span>{t('trips.form.vehicle')}</span>
					<select class="input" bind:value={vehicleId}>
						{#each activeVehicles as v (v.id)}
							<option value={v.id}>{v.plateNumber} — {v.model}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>{t('trips.form.start')}</span>
					<input class="input" type="datetime-local" bind:value={startedAt} onchange={onStartChange} />
				</label>
				<label>
					<span>{t('trips.form.end')}</span>
					<input class="input" type="datetime-local" bind:value={endedAt} />
				</label>
			</div>

			<fieldset class="route-block">
				<legend>{t('trips.form.route')}</legend>

				<div class="quick-origin">
					<button
						type="button"
						class="chip"
						class:active={!!places?.home && origin?.label === places.home.label && origin?.address === places.home.address}
						disabled={!places?.home}
						title={places?.home ? places.home.address : t('trips.form.noHome')}
						onclick={() => places?.home && setOrigin({ ...places.home })}
					>
						{t('trips.form.fromHome')}
					</button>
					<button
						type="button"
						class="chip"
						class:active={!!places?.workplace && origin?.label === places.workplace.label && origin?.address === places.workplace.address}
						disabled={!places?.workplace}
						title={places?.workplace ? places.workplace.address : t('trips.form.noWorkplace')}
						onclick={() => places?.workplace && setOrigin({ ...places.workplace })}
					>
						{t('trips.form.fromWorkplace')}
					</button>
					{#if places && !places.home}<span class="hint">{t('trips.form.noHome')}</span>{/if}
				</div>

				<PlacePicker {pluginId} {organizationId} {employeeId} label={t('trips.form.from')} value={origin} {places} onChange={setOrigin} onPlacesChanged={reloadPlaces} />

				{#each stops as stop, i (i)}
					<PlacePicker
						{pluginId}
						{organizationId}
						{employeeId}
						label={t('trips.form.stop', { n: i + 1 })}
						value={stop}
						{places}
						removable
						onRemove={() => (stops = stops.filter((_, j) => j !== i))}
						onChange={(w) => (stops = stops.map((s, j) => (j === i ? w : s)))}
						onPlacesChanged={reloadPlaces}
					/>
				{/each}
				{#if stops.length < 8}
					<button type="button" class="link-btn" onclick={() => (stops = [...stops, null])}>+ {t('trips.form.addStop')}</button>
				{/if}

				<PlacePicker {pluginId} {organizationId} {employeeId} label={t('trips.form.to')} value={destination} {places} onChange={(w) => (destination = w)} onPlacesChanged={reloadPlaces} />

				<div class="return-mode">
					<span>{t('trips.form.return')}</span>
					<div class="view-toggle">
						{#each ['origin', 'other', 'none'] as mode (mode)}
							<button type="button" class="chip" class:active={returnMode === mode} onclick={() => (returnMode = mode as ReturnMode)}>
								{t(`trips.returnMode.${mode}`)}
							</button>
						{/each}
					</div>
				</div>
				{#if returnMode === 'other'}
					<PlacePicker {pluginId} {organizationId} {employeeId} label={t('trips.form.returnTo')} value={backPoint} {places} onChange={(w) => (backPoint = w)} onPlacesChanged={reloadPlaces} />
				{/if}

				<label class="route-option" title={manualDistance ? t('trips.form.avoidTollsManual') : undefined}>
					<input type="checkbox" bind:checked={avoidTolls} disabled={manualDistance} />
					<span>{t('trips.form.avoidTolls')}</span>
				</label>
			</fieldset>

			<fieldset class="route-block">
				<legend>{t('trips.form.distance')}</legend>
				{#if manualDistance}
					<p class="hint">{t('trips.form.manualHint')}</p>
				{:else if routing}
					<div class="loading-state"><div class="spinner"></div><span>{t('trips.form.routing')}</span></div>
				{:else if routeError}
					<div class="route-error">
						<span>{routeError}</span>
						<button type="button" class="btn-secondary btn-sm" onclick={recalculate}>{t('trips.form.retry')}</button>
					</div>
				{:else if route}
					<div class="route-summary">
						<strong>{formatKm(route.km)}</strong>
						{#if route.durationMin}<span>· {t('trips.form.duration', { min: route.durationMin })}</span>{/if}
						{#if route.legsKm.length > 1}
							<span class="legs">({route.legsKm.map((km) => formatKm(km)).join(' + ')})</span>
						{/if}
						<button type="button" class="link-btn" onclick={recalculate}>{t('trips.form.recalculate')}</button>
					</div>
					<RouteMap {pluginId} geometry={route.geometry} waypoints={waypoints ?? []} />
				{:else}
					<p class="hint">{t('trips.form.routeHint')}</p>
				{/if}

				<div class="grid-2">
					<label>
						<span>{t('trips.form.km')}{plannedKm !== null && !manualDistance ? ` (${t('trips.form.planned', { km: plannedKm })})` : ''}</span>
						<input
							class="input"
							type="number"
							min="1"
							max="5000"
							step="1"
							bind:value={distanceKm}
							oninput={() => (kmFollowsRoute = false)}
						/>
					</label>
					<label class="manual-toggle">
						<input type="checkbox" bind:checked={manualDistance} />
						<span>{t('trips.form.manual')}</span>
					</label>
				</div>
				{#if reasonRequired}
					<label>
						<span>{t('trips.form.reason')}</span>
						<input class="input" type="text" maxlength="500" placeholder={t('trips.form.reasonPlaceholder')} bind:value={distanceReason} />
					</label>
				{/if}
			</fieldset>

			<label>
				<span>{t('trips.form.purpose')}</span>
				<textarea class="input textarea" maxlength="1000" placeholder={t('trips.form.purposePlaceholder')} bind:value={purpose}></textarea>
			</label>

			<label>
				<span>{t('trips.form.orderedBy')}</span>
				<select class="input" bind:value={orderedByUserId}>
					<option value={null}>{t('trips.form.noOrderer')}</option>
					{#each orderers as o (o.userId)}
						<option value={o.userId}>{o.name}</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="modal-footer">
			<button class="btn-secondary" onclick={onClose}>{t('form.cancel')}</button>
			<button class="btn-primary" onclick={save} disabled={saving || routing}>
				{saving ? t('loading') : t('form.save')}
			</button>
		</div>
	</div>
</div>

<style>
	@import '../../styles/shared.css';

	.trip-modal {
		max-width: 760px;
	}

	.grid-3 {
		display: grid;
		grid-template-columns: 1.2fr 1fr 1fr;
		gap: 0.75rem;
	}

	.grid-2 {
		display: grid;
		grid-template-columns: 10rem 1fr;
		gap: 0.75rem;
		align-items: end;
	}

	@media (max-width: 640px) {
		.grid-3,
		.grid-2 {
			grid-template-columns: 1fr;
		}
	}

	.route-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem 1rem;
		margin: 0;
	}

	legend {
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0 0.25rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.quick-origin {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.return-mode {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.route-summary {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-size: 0.9rem;
	}

	.legs,
	.hint {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
	}

	.route-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: #fef3c7;
		color: #92400e;
		font-size: 0.8rem;
	}

	.route-option {
		flex-direction: row;
		align-items: center;
		align-self: flex-start;
		gap: 0.5rem;
		cursor: pointer;
	}

	.route-option:has(input:disabled) {
		opacity: 0.55;
		cursor: default;
	}

	.manual-toggle {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		padding-bottom: 0.5rem;
	}

	.link-btn {
		align-self: flex-start;
		border: none;
		background: transparent;
		padding: 0;
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
		cursor: pointer;
	}

	:global(.dark) .route-error {
		background: oklch(0.3 0.05 60);
		color: #fde68a;
	}
</style>
