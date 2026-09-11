<script lang="ts">
	/**
	 * Útvonal-előnézet térképen.
	 *
	 * A térképkönyvtárat (svelte-maplibre-gl) a core adja (`sdk.libs.maplibre`),
	 * a plugin nem csomagolja be: a maplibre-gl kódjában `.innerHTML =` van, amit a
	 * core kódellenőrzője elutasítana. Ha a könyvtár nem érhető el (régebbi core),
	 * a komponens nem rajzol semmit, az űrlap a km-adatokkal így is használható.
	 */
	import type { Waypoint } from '../../../server/functions.js';
	import { decodePolyline } from '../../../server/polyline.js';
	import { resolveSdk } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		geometry = null,
		waypoints = []
	}: {
		pluginId?: string;
		geometry?: string | null;
		waypoints?: Waypoint[];
	} = $props();

	const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

	const sdk = $derived(resolveSdk(pluginId));
	const lib = $derived(sdk?.libs?.maplibre ?? sdk?.libs?.get?.('svelte-maplibre-gl'));
	const MapLibre = $derived(lib?.MapLibre);
	const GeoJSONSource = $derived(lib?.GeoJSONSource);
	const LineLayer = $derived(lib?.LineLayer);
	const Marker = $derived(lib?.Marker);
	const NavigationControl = $derived(lib?.NavigationControl);

	let map = $state<any>();

	const coords = $derived(geometry ? decodePolyline(geometry) : []);
	const line = $derived({
		type: 'Feature' as const,
		properties: {},
		geometry: { type: 'LineString' as const, coordinates: coords }
	});

	/** A teljes útvonal és a pontok befoglaló téglalapja. */
	const bounds = $derived.by(() => {
		const all = [...coords, ...waypoints.map((w) => [w.lng, w.lat] as [number, number])];
		if (all.length === 0) return null;
		let [minLng, minLat] = all[0];
		let [maxLng, maxLat] = all[0];
		for (const [lng, lat] of all) {
			minLng = Math.min(minLng, lng);
			maxLng = Math.max(maxLng, lng);
			minLat = Math.min(minLat, lat);
			maxLat = Math.max(maxLat, lat);
		}
		return [
			[minLng, minLat],
			[maxLng, maxLat]
		] as [[number, number], [number, number]];
	});

	$effect(() => {
		if (map && bounds) map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });
	});

	/** Az utolsó pont a kiindulópont ismétlése is lehet — a jelölők a különböző pontokra kerülnek. */
	const markers = $derived(
		waypoints.filter(
			(w, i) => waypoints.findIndex((o) => o.lat === w.lat && o.lng === w.lng) === i
		)
	);
</script>

{#if MapLibre && bounds}
	<div class="route-map">
		<MapLibre style={MAP_STYLE} bind:map bounds={bounds} fitBoundsOptions={{ padding: 40, maxZoom: 14 }} class="route-map-canvas">
			{#if NavigationControl}<NavigationControl position="top-right" showCompass={false} />{/if}
			{#if coords.length > 1 && GeoJSONSource && LineLayer}
				<GeoJSONSource id="trip-route" data={line}>
					<LineLayer
						id="trip-route-line"
						layout={{ 'line-join': 'round', 'line-cap': 'round' }}
						paint={{ 'line-color': '#3b82f6', 'line-width': 5, 'line-opacity': 0.85 }}
					/>
				</GeoJSONSource>
			{/if}
			{#if Marker}
				{#each markers as point, i (`${point.lat},${point.lng},${i}`)}
					<Marker lnglat={[point.lng, point.lat]} color={i === 0 ? '#16a34a' : '#dc2626'} />
				{/each}
			{/if}
		</MapLibre>
	</div>
{/if}

<style>
	.route-map {
		height: 240px;
		border-radius: 0.5rem;
		overflow: hidden;
		border: 1px solid var(--color-border, #e2e8f0);
	}

	.route-map :global(.route-map-canvas) {
		width: 100%;
		height: 100%;
	}
</style>
