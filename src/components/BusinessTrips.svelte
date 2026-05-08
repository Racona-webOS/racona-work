<svelte:options customElement={{ tag: 'racona-work-business-trips', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_BusinessTrips = function () {
			return { tagName: 'racona-work-business-trips' };
		};
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type {} from '@racona/sdk/types';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	// Organization store - inicializálás
	let orgStore = $state<OrganizationStore | null>(null);
	let hasAccess = $derived(orgStore?.hasAccess ?? false);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// Store inicializálás
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
</script>

<div class="rw">
<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="placeholder">
			<div class="icon-wrapper">🚗</div>
			<h2>{t('businessTrips.title')}</h2>
			<p>{t('businessTrips.comingSoon')}</p>
			<p class="description">{t('businessTrips.description')}</p>
		</div>
	{/if}
</section>
</div>

<style>
	@import '../styles/shared.css';

	.page {
		padding: 2rem;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.placeholder {
		text-align: center;
		max-width: 400px;
	}

	.icon-wrapper {
		font-size: 3rem;
		margin-bottom: 1rem;
	}

	h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}

	p {
		color: var(--color-muted-foreground, #64748b);
		margin-bottom: 0.5rem;
	}

	.description {
		font-size: 0.875rem;
	}

	/* Sötét mód */
	:global(.dark) .placeholder h2 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .placeholder p {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}
</style>
