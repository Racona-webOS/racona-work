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
	 * Eseményenként egy kapcsoló: menjen-e róla email, és kategóriánként egy
	 * válaszcím. Szervezet szintű beállítás; a rendszeren belüli értesítéseket
	 * nem érinti.
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		NotificationEvent,
		NotificationGroup,
		NotificationSettings,
		Organization
	} from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import Checkbox from './ui/Checkbox.svelte';
	import { errorMessage } from './trips/format.js';
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { REPLY_TO_MAX_LENGTH, isValidReplyTo } from '../../server/reply-to.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	/** A felület csoportjai; a szabadság a bal oszlop, a többi a jobb. */
	const COLUMNS: { group: NotificationGroup; events: NotificationEvent[] }[][] = [
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
					'leave.monthConfirmationClosed',
					'leave.monthConfirmationReminder',
					'leave.monthConfirmationSummary'
				]
			}
		],
		[
			{ group: 'employees', events: ['employee.welcome'] },
			{
				group: 'documents',
				events: ['document.expiring', 'document.expiringEmployee', 'document.submitted', 'document.reviewed']
			},
			{
				group: 'trips',
				events: ['trip.settlementSubmitted', 'trip.settlementStatus', 'trip.ordererChanged']
			},
			{ group: 'worklog', events: ['worklog.missingEntriesEmployee', 'worklog.missingEntries'] }
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
	/** Kategóriánkénti válaszcím; üres szöveg = a rendszerszintű érvényes. */
	let replyTo = $state<Record<NotificationGroup, string> | null>(null);
	let savedReplyTo = $state<Record<NotificationGroup, string> | null>(null);
	/** Kikapcsolt munkanapló-figyelésnél a kategória emailjei nem mennek ki; null = ismeretlen. */
	let workLogCheckEnabled = $state<boolean | null>(null);
	const dirty = $derived(
		(!!email &&
			!!savedEmail &&
			(Object.keys(email) as NotificationEvent[]).some((k) => email![k] !== savedEmail![k])) ||
			(!!replyTo &&
				!!savedReplyTo &&
				(Object.keys(replyTo) as NotificationGroup[]).some((g) => replyTo![g].trim() !== savedReplyTo![g]))
	);
	const invalidReplyTo = $derived(
		new Set(
			replyTo
				? (Object.keys(replyTo) as NotificationGroup[]).filter((g) => {
						const value = replyTo![g].trim();
						return value !== '' && !isValidReplyTo(value);
					})
				: []
		)
	);

	function apply(settings: NotificationSettings) {
		email = { ...settings.email };
		savedEmail = { ...settings.email };
		const reply = {} as Record<NotificationGroup, string>;
		for (const g of Object.keys(settings.replyTo) as NotificationGroup[]) reply[g] = settings.replyTo[g] ?? '';
		replyTo = { ...reply };
		savedReplyTo = { ...reply };
	}

	async function load() {
		if (!currentOrganization) return;
		const organizationId = currentOrganization.id;
		loading = true;
		workLogCheckEnabled = null;
		loadWorkLogCheckStatus(organizationId);
		try {
			const settings: NotificationSettings = await sdk.remote.call('getNotificationSettings', {
				organizationId
			});
			apply(settings);
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
		} finally {
			loading = false;
		}
	}

	/** Csak tájékoztató: ha nem sikerül lekérni, a figyelmeztetés nem jelenik meg. */
	async function loadWorkLogCheckStatus(organizationId: number) {
		try {
			const status: { enabled: boolean } = await sdk.remote.call('getWorkLogCheckStatus', { organizationId });
			if (currentOrganization?.id === organizationId) workLogCheckEnabled = status.enabled;
		} catch {
			// nincs figyelmeztetés
		}
	}

	async function save() {
		if (!currentOrganization || !email || !replyTo || invalidReplyTo.size > 0) return;
		saving = true;
		try {
			const reply = {} as Record<NotificationGroup, string | null>;
			for (const g of Object.keys(replyTo) as NotificationGroup[]) reply[g] = replyTo[g].trim() || null;
			const settings: NotificationSettings = await sdk.remote.call('saveNotificationSettings', {
				organizationId: currentOrganization.id,
				email,
				replyTo: reply
			});
			apply(settings);
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

		{#if loading || !email || !replyTo}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else}
			<div class="columns">
				{#each COLUMNS as column, i (i)}
					<div class="column">
						{#each column as section (section.group)}
							<div class="settings-section">
								<h3>{t(`notificationSettings.group.${section.group}`)}</h3>
								{#if section.group === 'worklog' && workLogCheckEnabled === false}
									<p class="notice is-warning">{t('notificationSettings.worklog.checkDisabled')}</p>
								{/if}
								<label class="reply-to">
									<span>{t('notificationSettings.replyTo')}</span>
									<input
										class="input"
										type="email"
										maxlength={REPLY_TO_MAX_LENGTH}
										placeholder={t('notificationSettings.replyTo.placeholder')}
										aria-invalid={invalidReplyTo.has(section.group)}
										bind:value={replyTo[section.group]}
									/>
									<small class="reply-to-hint" class:error={invalidReplyTo.has(section.group)}>
										{invalidReplyTo.has(section.group)
											? t('notificationSettings.replyTo.invalid')
											: t('notificationSettings.replyTo.hint')}
									</small>
								</label>
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
				<button class="btn-primary" onclick={save} disabled={saving || !dirty || invalidReplyTo.size > 0}>
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

	.notice {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: 0.375rem;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.notice.is-warning {
		background: #fef3c7;
		color: #92400e;
	}

	:global(.dark) .notice.is-warning {
		background: oklch(0.35 0.07 75 / 40%);
		color: #fcd34d;
	}

	.reply-to {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.reply-to > span {
		font-size: 0.8rem;
		font-weight: 500;
	}

	.reply-to .input[aria-invalid='true'] {
		border-color: var(--color-destructive, #dc2626);
	}

	.reply-to-hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.reply-to-hint.error {
		color: var(--color-destructive, #dc2626);
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

	:global(.dark) .reply-to {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .event-row:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .event-row.enabled .event-label {
		color: var(--color-foreground, oklch(0.985 0 0));
	}
</style>
