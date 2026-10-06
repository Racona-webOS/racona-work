<svelte:options customElement={{ tag: 'racona-work-my-documents', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_MyDocuments = function () {
			return { tagName: 'racona-work-my-documents' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Saját dokumentumaim (specs/employee-documents.md, K7, K8): a dolgozó a
	 * saját, neki látható dokumentumait nézi meg, és ha a szervezet engedi,
	 * ellenőrzésre feltölthet.
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { Organization } from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import EmployeeDocumentsTab from './employee-documents/EmployeeDocumentsTab.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let employeeId = $state<number | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);

	async function load() {
		if (!currentOrganization) return;
		loading = true;
		loadError = null;
		try {
			const me: { employeeId: number } | null = await sdk.remote.call('getMyDocumentsEmployee', {
				organizationId: currentOrganization.id
			});
			employeeId = me?.employeeId ?? null;
		} catch (err: any) {
			loadError = err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.loadFailed');
		} finally {
			loading = false;
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
				<h2>{t('myDocuments.title')}</h2>
				<p class="subtitle">{t('myDocuments.subtitle')}</p>
			</div>
		</div>
		{#if loadError}
			<div class="error-banner">{loadError}</div>
		{:else if loading && employeeId === null}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if employeeId === null}
			<p class="empty-state">{t('myDocuments.notEmployee')}</p>
		{:else}
			<div class="content">
				{#key employeeId}
					<EmployeeDocumentsTab {pluginId} {employeeId} />
				{/key}
			</div>
		{/if}
	{/if}
</section>
</div>

<style>
	@import '../styles/shared.css';

	.content {
		max-width: 900px;
	}
</style>
