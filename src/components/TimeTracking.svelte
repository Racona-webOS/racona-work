<svelte:options customElement={{ tag: 'racona-work-time-tracking', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_TimeTracking = function () {
			return { tagName: 'racona-work-time-tracking' };
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

<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="placeholder">
			<div class="icon-wrapper">🕐</div>
			<h2>{t('timeTracking.title')}</h2>
			<p>{t('timeTracking.comingSoon')}</p>
			<p class="description">{t('timeTracking.description')}</p>
		</div>
	{/if}
</section>

<style>
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

	/* No access message */
	.no-access-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 4rem 2rem;
		gap: 1rem;
	}

	.no-access-icon {
		font-size: 4rem;
		opacity: 0.5;
	}

	.no-access-message h2 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-foreground, #0f172a);
		margin: 0;
	}

	.no-access-message p {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.875rem;
		margin: 0;
		max-width: 400px;
	}

	/* Sötét mód */
	:global(.dark) .placeholder h2 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .placeholder p {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .no-access-message h2 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .no-access-message p {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}
</style>
