<svelte:options customElement={{ tag: 'racona-work-plugin', shadow: 'none' }} />

<script lang="ts">
	/**
	 * Plugin Standalone Shell
	 *
	 * Generikus standalone nézet layout módú pluginokhoz.
	 * Automatikusan beolvassa a menu.json-t, a locale fájlokat és a komponenseket.
	 */

	import { onMount } from 'svelte';
	import menuData from '../menu.json';
	import OrganizationSwitcher from './components/OrganizationSwitcher.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	// --- ActionBar (standalone dev mode) ---
	let actionBarItems = $state<Array<{ label: string; onClick: () => void; variant?: string }>>([]);

	// --- Komponensek ---
	const componentModules = import.meta.glob<{ default: any }>(
		'./components/*.svelte',
		{ eager: true }
	);

	function buildComponentMap() {
		const map: Record<string, any> = {};
		for (const [path, mod] of Object.entries(componentModules)) {
			const name = path.replace('./components/', '').replace('.svelte', '');
			map[name] = mod.default;
		}
		return map;
	}

	const componentMap = buildComponentMap();

	// --- Locale-ok ---
	const localeModules = import.meta.glob<Record<string, string>>(
		'../locales/*.json',
		{ eager: true, import: 'default' }
	);

	const availableLocales = Object.keys(localeModules).map((path) =>
		path.replace('../locales/', '').replace('.json', '')
	);

	function getLocaleData(locale: string): Record<string, string> {
		return localeModules[`../locales/${locale}.json`] ?? {};
	}

	let currentLocale = $state(availableLocales.includes('hu') ? 'hu' : availableLocales[0] ?? 'en');
	let translations = $derived(getLocaleData(currentLocale));

	function switchLocale(locale: string) {
		const sdk = (window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS;
		if (sdk?.i18n?.setLocale) sdk.i18n.setLocale(locale);
		currentLocale = locale;
	}

	// --- Menü ---
	function resolveLabel(labelKey: string): string {
		if (!labelKey) return '';
		return translations[labelKey] ?? labelKey.split('.').pop() ?? labelKey;
	}

	interface FlatMenuItem {
		id: string;
		componentName: string;
		label: string;
		parentLabel?: string;
	}

	// Lapos lista, a `children` tömbökben levő komponens-menüpontokat is beleértve.
	// A core oldalon az AppLayout kezeli a collapsible renderelést; standalone dev módban
	// ezt a lapos listát jelenítjük meg, szülő csoportcímkékkel.
	function flattenMenuForDev(items: any[], parentLabel?: string): FlatMenuItem[] {
		const out: FlatMenuItem[] = [];
		for (const item of items) {
			if (item?.component && item?.href) {
				out.push({
					id: item.href.replace('#', '') ?? item.component,
					componentName: item.component,
					label: resolveLabel(item.labelKey ?? ''),
					parentLabel
				});
			}
			if (Array.isArray(item?.children) && item.children.length > 0) {
				const groupLabel = resolveLabel(item.labelKey ?? '');
				out.push(...flattenMenuForDev(item.children, groupLabel));
			}
		}
		return out;
	}

	const menuItems = $derived(flattenMenuForDev(menuData as any[]));

	let menuLabels = $derived(
		Object.fromEntries(menuItems.map((m) => [m.id, m.label]))
	);

	let activeId = $state('');
	$effect(() => {
		if (!activeId && menuItems.length > 0) {
			activeId = menuItems[0].id;
		}
	});
	let activeItem = $derived(menuItems.find((m) => m.id === activeId) ?? menuItems[0]);
	let ActiveComponent = $derived(activeItem ? componentMap[activeItem.componentName] : null);

	// Dev sidebar csoportosítás — parentLabel szerint rendezzük a lapos listát.
	let groupedMenu = $derived.by(() => {
		const groups = new Map<string, FlatMenuItem[]>();
		for (const item of menuItems) {
			const key = item.parentLabel ?? '';
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(item);
		}
		return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
	});

	// --- ActionBar setup (standalone dev mode) ---
	onMount(() => {
		const sdk = (window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS;
		if (sdk?.ui) {
			// Hook into MockUIService to render ActionBar
			sdk.ui._setActionBarFn = (items: typeof actionBarItems) => {
				actionBarItems = items;
			};
			sdk.ui._clearActionBarFn = () => {
				actionBarItems = [];
			};
		}
	});
</script>

<div class="layout">
	<aside class="sidebar">
		<div class="sidebar-header">
			<span class="app-name">{translations['app.name'] ?? pluginId}</span>
		</div>

		<nav>
			{#each groupedMenu as group (group.label)}
				{#if group.label}
					<div class="menu-group-label">{group.label}</div>
				{/if}
				{#each group.items as item (item.id)}
					<button
						class="menu-item"
						class:nested={!!group.label}
						class:active={activeId === item.id}
						onclick={() => (activeId = item.id)}
					>
						{menuLabels[item.id] ?? item.id}
					</button>
				{/each}
			{/each}
		</nav>

		<!-- Szervezet váltó a sidebar alján -->
		<div class="org-switcher-container">
			<OrganizationSwitcher {pluginId} />
		</div>

		{#if availableLocales.length > 1}
			<div class="locale-switcher">
				{#each availableLocales as locale (locale)}
					<button
						class="locale-btn"
						class:active={currentLocale === locale}
						onclick={() => switchLocale(locale)}
					>
						{locale.toUpperCase()}
					</button>
				{/each}
			</div>
		{/if}
	</aside>
	<main class="content">
		{#if actionBarItems.length > 0}
			<div class="action-bar">
				{#each actionBarItems as item (item.label)}
					<button
						class="action-btn"
						class:primary={item.variant === 'default'}
						onclick={item.onClick}
					>
						{item.label}
					</button>
				{/each}
			</div>
		{/if}
		{#if ActiveComponent}
			{#key `${activeId}-${currentLocale}`}
				<!-- svelte-ignore svelte_component_deprecated -->
				<svelte:component this={ActiveComponent} {pluginId} />
			{/key}
		{:else}
			<div class="no-component"><p>{translations['error.componentNotFound'] ?? 'Komponens nem található'}: {activeItem?.componentName}</p></div>
		{/if}
	</main>
</div>

<style>
	.layout {
		display: flex;
		height: 100vh;
		font-family: system-ui, -apple-system, sans-serif;
		background: var(--color-background, #ffffff);
		color: var(--color-foreground, #0f172a);
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		border-right: 1px solid var(--color-border, #e2e8f0);
		background: var(--color-sidebar, #f8fafc);
		padding: 1rem;
		width: 220px;
		flex-shrink: 0;
		height: 100%;
		overflow: hidden;
	}

	.sidebar-header {
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		margin-bottom: 0.5rem;
		flex-shrink: 0;
	}

	.app-name {
		font-weight: 700;
		font-size: 0.95rem;
		color: var(--color-foreground, #0f172a);
	}

	.org-switcher-container {
		margin-top: auto;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
		flex-shrink: 0;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}

	.menu-item {
		border: none;
		background: transparent;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #475569);
		width: 100%;
		text-align: left;
		transition: all 0.15s ease;
	}

	.menu-item.nested {
		padding-left: 1.25rem;
	}

	.menu-group-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground, #94a3b8);
		padding: 0.75rem 0.75rem 0.25rem;
	}

	.menu-item:hover {
		background: var(--color-accent, #e2e8f0);
		color: var(--color-foreground, #1e293b);
	}

	.menu-item.active {
		background: var(--color-primary-subtle, #e0e7ff);
		color: var(--color-primary, #3730a3);
		font-weight: 600;
	}

	.content {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.action-bar {
		display: flex;
		gap: 0.5rem;
		padding: 1rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		background: var(--color-background, #ffffff);
	}

	.action-btn {
		border: 1px solid var(--color-border, #e2e8f0);
		background: transparent;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.action-btn:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.action-btn.primary {
		background: var(--color-primary, #3730a3);
		color: #ffffff;
		border-color: var(--color-primary, #3730a3);
	}

	.action-btn.primary:hover {
		opacity: 0.9;
	}

	.no-component {
		display: flex;
		justify-content: center;
		align-items: center;
		height: 100%;
		color: var(--color-muted-foreground, #94a3b8);
	}

	:global(.dark) .layout {
		background: var(--color-background, oklch(26.448% 0.00003 271.152));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .sidebar {
		background: var(--color-sidebar, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .sidebar-header {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .menu-item {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .menu-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .menu-item.active {
		background: var(--color-accent, oklch(0.25 0.03 var(--primary-h, 264)));
		color: var(--color-primary, oklch(0.66 0.12 264));
	}

	.locale-switcher {
		display: flex;
		gap: 0.25rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
		margin-top: 0.5rem;
		flex-shrink: 0;
	}

	.locale-btn {
		border: 1px solid var(--color-border, #e2e8f0);
		background: transparent;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		transition: all 0.15s ease;
	}

	.locale-btn:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.locale-btn.active {
		background: var(--color-primary-subtle, #e0e7ff);
		color: var(--color-primary, #3730a3);
		border-color: var(--color-primary-border, #c7d2fe);
		font-weight: 600;
	}
</style>
