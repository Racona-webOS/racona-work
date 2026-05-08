<svelte:options customElement={{ tag: "racona-work-organizationswitcher", shadow: "none" }} />

<script lang="ts">
	/**
	 * OrganizationSwitcher - Szervezet váltó UI komponens
	 * Követelmények: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
	 */

	import { onMount } from 'svelte';
	import { createOrganizationStore, getOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { Organization } from '../../server/functions.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	console.log('[OrganizationSwitcher] Component initialized with pluginId:', pluginId);

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	console.log('[OrganizationSwitcher] SDK:', sdk);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- Store ---
	let store = $state<OrganizationStore | null>(null);

	// --- Dropdown állapot ---
	let isOpen = $state(false);

	// --- Lokális $state a store értékeiből (cross-bundle reaktivitáshoz) ---
	let currentOrganization = $state<Organization | null>(null);
	let availableOrganizations = $state<Organization[]>([]);
	let hasMultipleOrganizations = $derived(availableOrganizations.length > 1);
	let isLoading = $state(false);

	// Store értékek szinkronizálása
	function syncFromStore() {
		if (store) {
			currentOrganization = store.currentOrganization;
			availableOrganizations = store.availableOrganizations;
			isLoading = store.isLoading;
		}
	}

	console.log('[OrganizationSwitcher] currentOrganization:', currentOrganization);
	console.log('[OrganizationSwitcher] availableOrganizations:', availableOrganizations);

	// --- Inicializálás ---
	onMount(() => {
		console.log('[OrganizationSwitcher] onMount called');
		console.log('[OrganizationSwitcher] sdk:', sdk);
		console.log('[OrganizationSwitcher] sdk.remote:', sdk?.remote);

		if (sdk?.remote) {
			try {
				store = getOrganizationStore();
				console.log('[OrganizationSwitcher] Got existing store');
			} catch {
				store = createOrganizationStore(pluginId, sdk);
				console.log('[OrganizationSwitcher] Created new store');
			}

			// Kezdeti értékek szinkronizálása
			syncFromStore();

			// Csak akkor töltjük be, ha még nincs adat
			if (store.availableOrganizations.length === 0) {
				console.log('[OrganizationSwitcher] Loading organizations...');
				store.loadOrganizations().then(() => syncFromStore());
			} else {
				console.log('[OrganizationSwitcher] Store already has organizations, skipping load');
				// Újranyitáskor a plugin singleton store élve maradt, de a core
				// pluginCapabilitiesStore üres lehet (pl. ha az ablakot bezárták
				// és most nyitottuk újra). A capabilities-t publikáljuk, hogy a
				// menü-szűrés helyes legyen.
				store.publishCapabilities();
			}
		} else {
			console.warn('[OrganizationSwitcher] SDK or SDK.remote not available');
		}

		// Kattintás figyelő a dropdown bezárásához
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			if (!target.closest('.org-switcher')) {
				isOpen = false;
			}
		};

		// Szervezet változás figyelő
		const handleOrganizationChanged = () => {
			if (store) {
				store.loadOrganizations().then(() => syncFromStore());
			}
		};

		// organization-changed: csak szinkronizálás, nem újratöltés (a store már frissült)
		const handleOrgChanged = () => {
			syncFromStore();
		};

		document.addEventListener('click', handleClickOutside);
		window.addEventListener('organization-changed', handleOrgChanged);
		window.addEventListener('organization-updated', handleOrgChanged);
		window.addEventListener('organization-deleted', handleOrganizationChanged);
		window.addEventListener('organization-created', handleOrganizationChanged);

		return () => {
			document.removeEventListener('click', handleClickOutside);
			window.removeEventListener('organization-changed', handleOrgChanged);
			window.removeEventListener('organization-updated', handleOrgChanged);
			window.removeEventListener('organization-deleted', handleOrganizationChanged);
			window.removeEventListener('organization-created', handleOrganizationChanged);
		};
	});

	// --- Szervezet váltás ---
	async function handleOrganizationChange(org: Organization) {
		if (store && org.id !== currentOrganization?.id) {
			await store.switchOrganization(org.id);
			syncFromStore();
			isOpen = false;
		}
	}

	// --- Dropdown toggle ---
	function toggleDropdown() {
		isOpen = !isOpen;
	}
</script>

<!-- Követelmény 10.6: Mindig megjelenítjük, hogy a user lássa melyik szervezetben van -->
{#if currentOrganization}
	<div class="org-switcher">
		<button
			class="org-switcher-button"
			onclick={toggleDropdown}
			aria-expanded={isOpen}
			aria-haspopup="true"
			disabled={isLoading || !hasMultipleOrganizations}
			class:loading={isLoading}
			class:single-org={!hasMultipleOrganizations}
		>
			<div class="org-info">
				<span class="org-icon">
					{#if isLoading}
						<span class="spinner-icon">⏳</span>
					{/if}
				</span>
				<div class="org-details">
					<span class="org-label">{t('organizations.current')}</span>
					<span class="org-name">
						{#if isLoading}
							<span class="loading-text">{t('loading')}</span>
						{:else if currentOrganization}
							{currentOrganization.name}
						{:else}
							{t('organizations.selectOrganization')}
						{/if}
					</span>
				</div>
			</div>
			{#if hasMultipleOrganizations}
				<svg
					class="chevron"
					class:open={isOpen}
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M4 6L8 10L12 6"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			{/if}
		</button>

		{#if isOpen && hasMultipleOrganizations}
			<div class="org-dropdown">
				<div class="org-dropdown-header">
					<span>{t('organizations.switchTo')}</span>
				</div>
				<div class="org-list">
					{#each availableOrganizations as org (org.id)}
						<button
							class="org-item"
							class:active={currentOrganization?.id === org.id}
							onclick={() => handleOrganizationChange(org)}
						>
							<div class="org-item-details">
								<span class="org-item-name">{org.name}</span>
								<span class="org-item-slug">{org.slug}</span>
							</div>
							{#if currentOrganization?.id === org.id}
								<svg
									class="check-icon"
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										d="M13.3333 4L6 11.3333L2.66667 8"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.org-switcher {
		position: relative;
		display: inline-block;
        width: 100%;
	}

	.org-switcher-button {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
		cursor: pointer;
		transition: all 0.15s ease;
		width: 100%;
	}

	.org-switcher-button:hover {
		background: var(--color-accent, #f8fafc);
		border-color: var(--color-primary, #3730a3);
	}

	.org-switcher-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		pointer-events: none;
	}

	.org-switcher-button.loading {
		opacity: 0.8;
	}

	.org-switcher-button.single-org {
		cursor: default;
	}

	.org-switcher-button.single-org:hover {
		background: var(--color-card, #ffffff);
		border-color: var(--color-border, #e2e8f0);
	}

	.spinner-icon {
		display: inline-block;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.org-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
	}

	.org-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.org-details {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}

	.org-label {
		font-size: 0.65rem;
		color: var(--color-muted-foreground, #64748b);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
	}

	.org-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-foreground, #0f172a);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.loading-text {
		color: var(--color-muted-foreground, #94a3b8);
		font-weight: 400;
	}

	.chevron {
		flex-shrink: 0;
		color: var(--color-muted-foreground, #64748b);
		transition: transform 0.2s ease;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	/* Dropdown */
	.org-dropdown {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 0;
		width: 100%;
		background: var(--color-card, #ffffff);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
		z-index: 50;
		overflow: hidden;
	}

	.org-dropdown-header {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		background: var(--color-muted, #f8fafc);
	}

	.org-dropdown-header span {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.org-list {
		max-height: 300px;
		overflow-y: auto;
	}

	.org-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 1rem;
		border: none;
		background: transparent;
		cursor: pointer;
		transition: background 0.15s ease;
		text-align: left;
	}

	.org-item:hover {
		background: var(--color-accent, #f8fafc);
	}

	.org-item.active {
		background: var(--color-primary-subtle, #eef2ff);
	}

	.org-item-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.org-item-details {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}

	.org-item-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-foreground, #0f172a);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.org-item.active .org-item-name {
		color: var(--color-primary, #3730a3);
	}

	.org-item-slug {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
		font-family: 'Courier New', monospace;
	}

	.check-icon {
		flex-shrink: 0;
		color: var(--color-primary, #3730a3);
	}

	/* Sötét mód */
	:global(.dark) .org-switcher-button {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .org-switcher-button:hover {
		background: var(--color-accent, oklch(0.269 0 0));
		border-color: var(--color-primary, oklch(0.66 0.12 264));
	}

	:global(.dark) .org-label {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .org-name {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .chevron {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .org-dropdown {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .org-dropdown-header {
		background: var(--color-muted, oklch(0.15 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .org-dropdown-header span {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .org-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .org-item.active {
		background: var(--color-accent, oklch(0.25 0.03 var(--primary-h, 264)));
	}

	:global(.dark) .org-item-name {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .org-item.active .org-item-name {
		color: var(--color-primary, oklch(0.66 0.12 264));
	}

	:global(.dark) .org-item-slug {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .check-icon {
		color: var(--color-primary, oklch(0.66 0.12 264));
	}
</style>
