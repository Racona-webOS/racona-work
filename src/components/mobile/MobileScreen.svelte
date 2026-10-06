<!--
	A mobil bejegyzések közös kerete: betölti a szervezetet és a hívó saját dolgozói
	rekordját, ellenőrzi a szükséges képességet, és csak ezután rendereli a tartalmat.
	Szervezetváltáskor (a core a szervezetváltót a képernyő tetején mutatja) újratölt.
-->
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { EmployeeRow, Organization } from '../../../server/functions.js';
	import {
		getOrganizationStore,
		createOrganizationStore,
		type OrganizationStore
	} from '../../stores/organizationStore.svelte.js';
	import AccessDenied from '../AccessDenied.svelte';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import type { MobileContext } from './types.js';

	let {
		pluginId = 'racona-work',
		capability,
		children
	}: {
		pluginId?: string;
		/** A képernyőhöz szükséges képesség (pl. leave.request, work.log) */
		capability: string;
		children: Snippet<[MobileContext]>;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let orgStore = $state<OrganizationStore | null>(null);
	let organization = $state<Organization | null>(null);
	let employee = $state<EmployeeRow | null>(null);
	let hasAccess = $state(true);
	let isExternal = $state(false);
	let capabilities = $state<Set<string>>(new Set());
	let loading = $state(true);
	let error = $state<string | null>(null);

	function syncFromStore() {
		if (!orgStore) return;
		organization = orgStore.currentOrganization;
		hasAccess = orgStore.hasAccess;
		isExternal = orgStore.isExternal;
		capabilities = new Set(orgStore.capabilities);
	}

	/** A hívó dolgozói rekordja a jelenlegi szervezetben */
	async function loadEmployee() {
		if (!organization || isExternal) {
			employee = null;
			loading = false;
			return;
		}
		loading = true;
		error = null;
		const orgId = organization.id;
		try {
			const me = (await sdk.remote.call('getMyEmployee', { organizationId: orgId })) as EmployeeRow | null;
			if (organization?.id === orgId) employee = me;
		} catch (err: any) {
			error = err?.message ?? t('error.loadFailed');
			employee = null;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (!sdk?.remote) {
			error = t('error.sdkUnavailable');
			loading = false;
			return;
		}
		try {
			orgStore = getOrganizationStore();
			// Új ablaknál a core új SDK példányt ad: a tároló ezt használja tovább
			orgStore.init(pluginId, sdk);
		} catch {
			orgStore = createOrganizationStore(pluginId, sdk);
		}
		syncFromStore();
		if (orgStore.availableOrganizations.length === 0) {
			orgStore.loadOrganizations().then(() => {
				syncFromStore();
				loadEmployee();
			});
		} else {
			loadEmployee();
		}

		const onOrgChange = () => {
			syncFromStore();
			loadEmployee();
		};
		const onCapabilities = (e: Event) => {
			if ((e as CustomEvent).detail?.pluginId === pluginId) syncFromStore();
		};
		window.addEventListener('organization-changed', onOrgChange);
		window.addEventListener('plugin-capabilities-changed', onCapabilities);
		return () => {
			window.removeEventListener('organization-changed', onOrgChange);
			window.removeEventListener('plugin-capabilities-changed', onCapabilities);
		};
	});

	// A képességek a szervezetek után, külön kérésben érkeznek: amíg üres a halmaz, még töltünk
	const capabilitiesLoaded = $derived(capabilities.size > 0);
	const allowed = $derived(capabilities.has(capability));
</script>

{#if error}
	<p class="m-error">{error}</p>
{:else if !hasAccess}
	<AccessDenied {pluginId} />
{:else if isExternal}
	<p class="m-empty">{t('mobile.external')}</p>
{:else if loading || (organization && !capabilitiesLoaded)}
	<div class="loading-state"><span class="spinner"></span>{t('loading')}</div>
{:else if !organization}
	<p class="m-empty">{t('error.noOrganization')}</p>
{:else if !allowed}
	<AccessDenied {pluginId} title={t('mobile.noPermission.title')} message={t('mobile.noPermission.message')} />
{:else if !employee}
	<p class="m-empty">{t('dashboard.self.noEmployee')}</p>
{:else}
	{@render children({ sdk, organization, employee, can: (c) => capabilities.has(c), t })}
{/if}

<style>
	@import '../../styles/shared.css';
	@import '../../styles/mobile.css';
</style>
