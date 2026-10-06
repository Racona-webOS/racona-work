<svelte:options customElement={{ tag: 'racona-work-work-log-settings', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_WorkLogSettings = function () {
			return { tagName: 'racona-work-work-log-settings' };
		};
	}
</script>

<!--
	Munkanapló-figyelés beállítása (specs/work-log-check.md): a napi 23:55-ös
	futás a dolgozóknak emlékeztetőt küld az utolsó napok hiányzó munkanapjairól,
	az ablakból pótolatlanul kieső napokról pedig a megadott címekre jelzést.
	Beállítások → Munkanapló, `project.manage` joggal.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { Organization, WorkLogCheckInfo, WorkLogCheckSettings } from '../../server/functions.js';
	import {
		invalidRecipients,
		splitRecipients,
		WORK_LOG_CHECK_DEFAULTS,
		WORK_LOG_CHECK_LIMITS
	} from '../../server/work-log-check-utils.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import Checkbox from './ui/Checkbox.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { formatDate, formatDateTime } from '../utils/format.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);

	let info = $state<WorkLogCheckInfo | null>(null);
	let enabled = $state(false);
	let lookbackDays = $state(WORK_LOG_CHECK_DEFAULTS.lookbackDays);
	let recipientsText = $state('');
	let excluded = $state<number[]>([]);
	let search = $state('');
	let loading = $state(true);
	let saving = $state(false);

	function errorText(err: any, fallback: string): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? fallback;
	}

	function applyInfo(next: WorkLogCheckInfo) {
		info = next;
		enabled = next.settings.enabled;
		lookbackDays = next.settings.lookbackDays;
		recipientsText = next.settings.recipients.join('\n');
		excluded = [...next.settings.excludedEmployeeIds];
	}

	async function load(orgId: number) {
		loading = true;
		try {
			applyInfo(await sdk.remote.call('getWorkLogCheck', { organizationId: orgId }));
		} catch (err) {
			sdk?.ui?.toast(errorText(err, t('error.loadFailed')), 'error');
		} finally {
			loading = false;
		}
	}

	const recipients = $derived(splitRecipients(recipientsText));
	const invalid = $derived(invalidRecipients(recipients));

	function formSettings(): Partial<WorkLogCheckSettings> {
		return {
			enabled,
			lookbackDays: Number(lookbackDays),
			recipients,
			excludedEmployeeIds: [...excluded].sort((a, b) => a - b)
		};
	}

	const dirty = $derived.by(() => {
		if (!info) return false;
		const s = info.settings;
		const f = formSettings();
		return (
			f.enabled !== s.enabled ||
			f.lookbackDays !== s.lookbackDays ||
			JSON.stringify(f.recipients) !== JSON.stringify(s.recipients) ||
			JSON.stringify(f.excludedEmployeeIds) !== JSON.stringify(s.excludedEmployeeIds)
		);
	});

	async function save() {
		if (saving || !currentOrganization) return;
		saving = true;
		try {
			applyInfo(
				await sdk.remote.call('saveWorkLogCheck', {
					organizationId: currentOrganization.id,
					settings: formSettings()
				})
			);
			sdk?.ui?.toast(t('settings.saveSuccess'), 'success');
		} catch (err) {
			sdk?.ui?.toast(errorText(err, t('error.saveFailed')), 'error');
		} finally {
			saving = false;
		}
	}

	function toggleExcluded(employeeId: number, checked: boolean) {
		excluded = checked ? [...excluded, employeeId] : excluded.filter((id) => id !== employeeId);
	}

	const visibleEmployees = $derived.by(() => {
		const query = search.trim().toLowerCase();
		const list = info?.employees ?? [];
		if (!query) return list;
		return list.filter((e) =>
			[e.name, e.email, e.position].some((v) => v?.toLowerCase().includes(query))
		);
	});

	/** A ma esti futás napjai a még el nem mentett beállítással. */
	const scheduleText = $derived.by(() => {
		const days = Number(lookbackDays);
		if (!enabled || !Number.isInteger(days) || days < 0) return [];
		const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());
		const [y, m, d] = today.split('-').map(Number);
		const shift = (n: number) => new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
		const lines = [
			days === 0
				? t('workLogSettings.reminderToday')
				: t('workLogSettings.reminderRange', { from: formatDate(shift(days)), to: formatDate(today) })
		];
		if (recipients.length > 0) {
			lines.push(t('workLogSettings.escalationDay', { date: formatDate(shift(days + 1)) }));
		}
		return lines;
	});

	const lastRunText = $derived.by(() => {
		const last = info?.lastRun;
		if (!last) return null;
		return t('workLogSettings.lastRun', {
			date: formatDateTime(last.at),
			reminded: last.reminded,
			escalated: last.escalatedEmployees
		});
	});

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

	// organization-changed event: frissíti a currentOrganization $state-et
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
		const org = currentOrganization;
		untrack(() => {
			if (org && sdk?.remote) load(org.id);
		});
	});
</script>

<div class="rw">
<section class="page">
	{#if !hasAccess || (orgStore && !orgStore.can('project.manage'))}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<h2>{t('workLogSettings.title')}</h2>
			<p class="subtitle">{t('workLogSettings.subtitle')}</p>
		</div>

		{#if loading}
			<div class="loading-state">
				<div class="spinner"></div>
				<span>{t('loading')}</span>
			</div>
		{:else}
			<div class="settings-section">
				<label class="toggle-row">
					<Checkbox checked={enabled} onCheckedChange={(v) => (enabled = v)} />
					<span class="toggle-label">{t('workLogSettings.enabled')}</span>
				</label>
				<p class="hint">{t('workLogSettings.enabledHint')}</p>

				<div class="fields">
					<label class="lookback">
						<span>{t('workLogSettings.lookbackDays')}</span>
						<input
							class="input"
							type="number"
							min={WORK_LOG_CHECK_LIMITS.lookbackDays.min}
							max={WORK_LOG_CHECK_LIMITS.lookbackDays.max}
							bind:value={lookbackDays}
						/>
					</label>
					<p class="hint field-hint">{t('workLogSettings.lookbackHint')}</p>
				</div>

				<label>
					<span>{t('workLogSettings.recipients')}</span>
					<textarea
						class="input textarea"
						rows="3"
						placeholder={t('workLogSettings.recipientsPlaceholder')}
						aria-invalid={invalid.length > 0}
						bind:value={recipientsText}
					></textarea>
				</label>
				{#if invalid.length > 0}
					<p class="warning">{t('workLogSettings.recipientsInvalid', { emails: invalid.join(', ') })}</p>
				{:else}
					<p class="hint">{t('workLogSettings.recipientsHint', { max: WORK_LOG_CHECK_LIMITS.recipients })}</p>
				{/if}
			</div>

			<div class="settings-section">
				<div class="section-header">
					<h3>{t('workLogSettings.excluded.title')}</h3>
					<p class="section-description">{t('workLogSettings.excluded.description')}</p>
				</div>

				{#if (info?.employees.length ?? 0) === 0}
					<p class="empty-state">{t('noData')}</p>
				{:else}
					<input
						class="input search"
						type="search"
						placeholder={t('workLogSettings.excluded.search')}
						bind:value={search}
					/>
					<div class="employee-select-list">
						{#each visibleEmployees as emp (emp.id)}
							<label class="employee-item" class:selected={excluded.includes(emp.id)}>
								<Checkbox
									checked={excluded.includes(emp.id)}
									onCheckedChange={(v) => toggleExcluded(emp.id, v)}
								/>
								<div class="employee-info">
									<span class="employee-name">{emp.name}</span>
									<span class="employee-meta">{emp.email ?? ''}{emp.position ? ` · ${emp.position}` : ''}</span>
								</div>
								{#if excluded.includes(emp.id)}
									<span class="excluded-badge">{t('workLogSettings.excluded.badge')}</span>
								{/if}
							</label>
						{/each}
					</div>
					<p class="hint">
						{t('workLogSettings.excluded.count', { count: excluded.length, total: info?.employees.length ?? 0 })}
					</p>
				{/if}
			</div>

			<div class="save-row">
				<div class="status">
					{#each scheduleText as line}<p>{line}</p>{/each}
					{#if lastRunText}<p>{lastRunText}</p>{/if}
				</div>
				<button
					class="btn-primary"
					onclick={save}
					disabled={saving || !dirty || invalid.length > 0}
				>
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
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		max-width: 960px;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.page .page-header,
	.settings-section .section-header {
		gap: 1.5rem;
	}

	.settings-section .section-header {
		justify-content: flex-start;
	}

	.page-header h2,
	.section-header h3 {
		flex-shrink: 0;
		white-space: nowrap;
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

	.section-header h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 0.25rem;
	}

	.section-description {
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
	}

	/* A shared.css globális `label { flex-direction: column }` szabályát felülírjuk */
	.toggle-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.625rem;
		cursor: pointer;
	}

	.toggle-label {
		font-weight: 600;
	}

	.hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		align-items: flex-end;
	}

	.lookback > span {
		white-space: nowrap;
	}

	.lookback input {
		width: 7rem;
	}

	.field-hint {
		flex: 1 1 16rem;
		padding-bottom: 0.5rem;
	}

	.textarea {
		resize: vertical;
		font-family: inherit;
	}

	.warning {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-warning-subtle, #fef3c7);
		color: var(--color-warning-foreground, #92400e);
		font-size: 0.8125rem;
	}

	.search {
		max-width: 20rem;
	}

	.employee-select-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 360px;
		overflow-y: auto;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		padding: 0.25rem;
	}

	.employee-item {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: background 0.1s;
	}

	.employee-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.employee-item.selected {
		background: var(--color-primary-subtle, #e0e7ff);
	}

	.employee-info {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
		min-width: 0;
	}

	.employee-name {
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.employee-meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.excluded-badge {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-primary, #3730a3);
	}

	.save-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.save-row .btn-primary {
		margin-left: auto;
	}

	.status p {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .settings-section {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .employee-select-list {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .employee-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .employee-item.selected {
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}

	:global(.dark) .warning {
		background: oklch(0.3 0.06 80);
		color: oklch(0.9 0.08 85);
	}
</style>
