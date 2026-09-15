<svelte:options customElement={{ tag: 'racona-work-notification-settings', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_NotificationSettings = function () {
			return { tagName: 'racona-work-notification-settings' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Beállítások → Értesítések (specs/notifications.md).
	 *
	 * Eseményenként egy kapcsoló: menjen-e róla email. Szervezet szintű
	 * beállítás; a rendszeren belüli értesítéseket nem érinti.
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		NotificationEvent,
		NotificationSettings,
		Organization
	} from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import Checkbox from './ui/Checkbox.svelte';
	import { errorMessage } from './trips/format.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived((window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS);

	function t(key: string, vars?: Record<string, string | number>): string {
		let str = sdk?.i18n?.t(key) ?? key;
		if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
		return str;
	}

	/** A felület csoportjai; a szabadság a bal oszlop, a többi a jobb. */
	const COLUMNS: { group: string; events: NotificationEvent[] }[][] = [
		[
			{
				group: 'leave',
				events: [
					'leave.requestCreated',
					'leave.requestWithdrawn',
					'leave.requestDecided',
					'leave.deleted',
					'leave.calendarChanged',
					'leave.mandatoryAssigned',
					'leave.dataRequestCreated',
					'leave.dataRequestDecided',
					'leave.monthConfirmationRequested',
					'leave.monthConfirmationDisputed',
					'leave.monthConfirmationClosed'
				]
			}
		],
		[
			{ group: 'employees', events: ['employee.welcome'] },
			{
				group: 'trips',
				events: ['trip.settlementSubmitted', 'trip.settlementStatus', 'trip.ordererChanged']
			}
		]
	];

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let loading = $state(true);
	let saving = $state(false);

	let email = $state<Record<NotificationEvent, boolean> | null>(null);
	/** A legutóbb betöltött vagy mentett állapot, a változás jelzéséhez. */
	let savedEmail = $state<Record<NotificationEvent, boolean> | null>(null);
	const dirty = $derived(
		!!email &&
			!!savedEmail &&
			(Object.keys(email) as NotificationEvent[]).some((k) => email![k] !== savedEmail![k])
	);

	async function load() {
		if (!currentOrganization) return;
		loading = true;
		try {
			const settings: NotificationSettings = await sdk.remote.call('getNotificationSettings', {
				organizationId: currentOrganization.id
			});
			email = { ...settings.email };
			savedEmail = { ...settings.email };
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (!currentOrganization || !email) return;
		saving = true;
		try {
			const settings: NotificationSettings = await sdk.remote.call('saveNotificationSettings', {
				organizationId: currentOrganization.id,
				email
			});
			email = { ...settings.email };
			savedEmail = { ...settings.email };
			sdk?.ui?.toast(t('settings.saveSuccess'), 'success');
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			saving = false;
		}
	}

	function toggle(event: NotificationEvent, checked: boolean) {
		if (email) email = { ...email, [event]: checked };
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
		if (sdk?.remote && currentOrganization) load();
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
				<h2>{t('notificationSettings.title')}</h2>
				<p class="subtitle">{t('notificationSettings.subtitle')}</p>
			</div>
		</div>

		{#if loading || !email}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else}
			<div class="columns">
				{#each COLUMNS as column, i (i)}
					<div class="column">
						{#each column as section (section.group)}
							<div class="settings-section">
								<h3>{t(`notificationSettings.group.${section.group}`)}</h3>
								<div class="event-list">
									{#each section.events as event (event)}
										<label class="event-row" class:enabled={email[event]}>
											<Checkbox
												checked={email[event]}
												onCheckedChange={(checked) => toggle(event, checked)}
											/>
											<span class="event-text">
												<span class="event-label">{t(`notificationSettings.event.${event}`)}</span>
												<span class="event-recipients">
													{t('notificationSettings.recipients')}: {t(`notificationSettings.event.${event}.recipients`)}
												</span>
											</span>
										</label>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/each}
			</div>

			<div class="save-row">
				<p class="hint">{t('notificationSettings.hint')}</p>
				<button class="btn-primary" onclick={save} disabled={saving || !dirty}>
					{saving ? t('loading') : t('settings.save')}
				</button>
			</div>
		{/if}
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
		gap: 0.75rem;
		padding: 1.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
	}

	.settings-section h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
	}

	.event-list {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	/* A shared.css globális `label { flex-direction: column }` szabályát
	   felül kell írni, különben a sor elemei egymás alá csúsznak. */
	.event-row {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		margin: 0 -0.75rem;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: background 0.1s;
	}

	.event-row:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.event-row :global(.wk-checkbox) {
		margin-top: 0.125rem;
	}

	.event-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.event-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-muted-foreground, #64748b);
	}

	.event-row.enabled .event-label {
		color: var(--color-foreground, #0f172a);
	}

	.event-recipients {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-muted-foreground, #64748b);
	}

	.save-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .settings-section {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .event-row:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .event-row.enabled .event-label {
		color: var(--color-foreground, oklch(0.985 0 0));
	}
</style>
