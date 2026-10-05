<!--
	Havi ellenőrzés automatizálása (specs/leave-month-automation.md, K1): automatikus
	kiküldés a hónap vége előtt, emlékeztetők a válaszra váróknak a zárás napjáig,
	zárási összesítő a szabadságkezelőknek.
	A Szabadság beállítások oldalon, `leave.approve` joggal.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { LeaveMonthAutomationInfo, LeaveMonthAutomationSettings } from '../../../server/functions.js';
	import { AUTOMATION_DEFAULTS, AUTOMATION_LIMITS } from '../../../server/leave-month-automation-utils.js';
	import Checkbox from '../ui/Checkbox.svelte';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { formatDate } from '../../utils/format.js';

	let { pluginId = 'racona-work', organizationId }: { pluginId?: string; organizationId: number } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let info = $state<LeaveMonthAutomationInfo | null>(null);
	let form = $state<LeaveMonthAutomationSettings>(structuredClone(AUTOMATION_DEFAULTS));
	let loading = $state(true);
	let saving = $state(false);

	const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	function applyInfo(next: LeaveMonthAutomationInfo) {
		info = next;
		form = structuredClone(next.settings);
	}

	async function load(orgId: number) {
		loading = true;
		try {
			applyInfo(await sdk.remote.call('getLeaveMonthAutomation', { organizationId: orgId }));
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (saving) return;
		saving = true;
		try {
			applyInfo(await sdk.remote.call('saveLeaveMonthAutomation', { organizationId, settings: form }));
			sdk?.ui?.toast(t('settings.saveSuccess'), 'success');
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		const orgId = organizationId;
		untrack(() => load(orgId));
	});

	const nextSendText = $derived.by(() => {
		if (!info?.settings.autoSend.enabled || !info.nextAutoSendDay) return null;
		return info.nextAutoSendDay < todayIso
			? t('settings.leaveMonthAutomation.nextSendDue', { date: formatDate(info.nextAutoSendDay) })
			: t('settings.leaveMonthAutomation.nextSend', { date: formatDate(info.nextAutoSendDay) });
	});

	const lastSendText = $derived.by(() => {
		const last = info?.lastAutoSend;
		if (!last) return null;
		return t('settings.leaveMonthAutomation.lastSend', {
			date: formatDate(last.at),
			count: last.sent + last.resent
		});
	});

	const dirty = $derived(!!info && JSON.stringify(form) !== JSON.stringify(info.settings));

	/**
	 * Munkanap szerinti kiküldésnél a zárásnak a kiküldés után kell lennie,
	 * különben az emlékeztetők el sem indulnak.
	 */
	const closingBeforeSend = $derived(
		form.autoSend.enabled &&
			form.autoSend.dayKind === 'working' &&
			form.closing.workingDaysBeforeMonthEnd >= form.autoSend.daysBeforeMonthEnd
	);

	const closingText = $derived.by(() =>
		info?.nextClosingDay && (form.reminders.enabled || form.closing.notifyHr)
			? t('settings.leaveMonthAutomation.nextClosing', { date: formatDate(info.nextClosingDay) })
			: null
	);
</script>

{#if loading}
	<div class="loading-state">
		<div class="spinner"></div>
		<span>{t('loading')}</span>
	</div>
{:else}
	<div class="automation">
		<!-- Automatikus kiküldés -->
		<div class="block">
			<label class="toggle-row">
				<Checkbox
					checked={form.autoSend.enabled}
					onCheckedChange={(v) => (form.autoSend.enabled = v)}
				/>
				<span class="toggle-label">{t('settings.leaveMonthAutomation.autoSend')}</span>
			</label>
			<p class="hint">{t('settings.leaveMonthAutomation.autoSendHint')}</p>

			{#if form.autoSend.enabled}
				<div class="fields">
					<label>
						<span>{t('settings.leaveMonthAutomation.daysBefore')}</span>
						<input
							class="input"
							type="number"
							min={AUTOMATION_LIMITS.daysBeforeMonthEnd.min}
							max={AUTOMATION_LIMITS.daysBeforeMonthEnd.max}
							bind:value={form.autoSend.daysBeforeMonthEnd}
						/>
					</label>
					<label>
						<span>{t('settings.leaveMonthAutomation.dayKind')}</span>
						<select class="input" bind:value={form.autoSend.dayKind}>
							<option value="calendar">{t('settings.leaveMonthAutomation.dayKind.calendar')}</option>
							<option value="working">{t('settings.leaveMonthAutomation.dayKind.working')}</option>
						</select>
					</label>
				</div>
				<label>
					<span>{t('settings.leaveMonthAutomation.note')}</span>
					<textarea
						class="input textarea"
						rows="2"
						maxlength="1000"
						value={form.autoSend.note ?? ''}
						oninput={(e) => (form.autoSend.note = (e.currentTarget as HTMLTextAreaElement).value || null)}
					></textarea>
				</label>
				{#if info && !info.hasNotifiers}
					<p class="warning">{t('settings.leaveMonthAutomation.noNotifiers')}</p>
				{/if}
			{/if}
		</div>

		<!-- Emlékeztetők -->
		<div class="block">
			<label class="toggle-row">
				<Checkbox
					checked={form.reminders.enabled}
					onCheckedChange={(v) => (form.reminders.enabled = v)}
				/>
				<span class="toggle-label">{t('settings.leaveMonthAutomation.reminders')}</span>
			</label>
			<p class="hint">{t('settings.leaveMonthAutomation.remindersHint')}</p>

			{#if form.reminders.enabled}
				<div class="fields">
					<label>
						<span>{t('settings.leaveMonthAutomation.firstAfterDays')}</span>
						<input
							class="input"
							type="number"
							min={AUTOMATION_LIMITS.firstAfterDays.min}
							max={AUTOMATION_LIMITS.firstAfterDays.max}
							bind:value={form.reminders.firstAfterDays}
						/>
					</label>
					<label>
						<span>{t('settings.leaveMonthAutomation.intervalDays')}</span>
						<input
							class="input"
							type="number"
							min={AUTOMATION_LIMITS.intervalDays.min}
							max={AUTOMATION_LIMITS.intervalDays.max}
							bind:value={form.reminders.intervalDays}
						/>
					</label>
				</div>
				<label class="toggle-row">
					<Checkbox
						checked={form.reminders.workingDaysOnly}
						onCheckedChange={(v) => (form.reminders.workingDaysOnly = v)}
					/>
					<span class="toggle-label normal">{t('settings.leaveMonthAutomation.workingDaysOnly')}</span>
				</label>
			{/if}
		</div>

		<!-- Zárás: az emlékeztetők leállnak, a szabadságkezelők összesítőt kapnak -->
		<div class="block">
			<label class="toggle-row">
				<Checkbox
					checked={form.closing.notifyHr}
					onCheckedChange={(v) => (form.closing.notifyHr = v)}
				/>
				<span class="toggle-label">{t('settings.leaveMonthAutomation.closingNotify')}</span>
			</label>
			<p class="hint">{t('settings.leaveMonthAutomation.closingHint')}</p>
			<div class="fields">
				<label>
					<span>{t('settings.leaveMonthAutomation.closingDays')}</span>
					<input
						class="input"
						type="number"
						min={AUTOMATION_LIMITS.closingWorkingDays.min}
						max={AUTOMATION_LIMITS.closingWorkingDays.max}
						bind:value={form.closing.workingDaysBeforeMonthEnd}
					/>
				</label>
			</div>
			{#if closingBeforeSend}
				<p class="warning">{t('settings.leaveMonthAutomation.closingBeforeSend')}</p>
			{/if}
			{#if form.closing.notifyHr && info && !info.hasNotifiers}
				<p class="warning">{t('settings.leaveMonthAutomation.noNotifiersHr')}</p>
			{/if}
		</div>

		<div class="save-row">
			<div class="status">
				{#if nextSendText}<p>{nextSendText}</p>{/if}
				{#if closingText}<p>{closingText}</p>{/if}
				{#if lastSendText}<p>{lastSendText}</p>{/if}
			</div>
			<button class="btn-primary" onclick={save} disabled={saving || !dirty}>
				{saving ? t('loading') : t('settings.save')}
			</button>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	/* Konténer: a plugin ablak szélessége számít, nem a böngészőé */
	.automation {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		container-type: inline-size;
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.block + .block {
		border-top: 1px solid var(--color-border, #e2e8f0);
		padding-top: 1.25rem;
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

	.toggle-label.normal {
		font-weight: 400;
	}

	.hint {
		margin: -0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	/* A mezők a tartalmukhoz igazodnak: a címke egy sorban marad, a lista a leghosszabb opcióhoz */
	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 1.5rem;
		align-items: flex-end;
	}

	.fields > label > span {
		white-space: nowrap;
	}

	.fields input[type='number'] {
		width: 100%;
		min-width: 6rem;
		box-sizing: border-box;
	}

	.fields select {
		width: auto;
		max-width: 100%;
	}

	.warning {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-warning-subtle, #fef3c7);
		color: var(--color-warning-foreground, #92400e);
		font-size: 0.8125rem;
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

	:global(.dark) .block + .block {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .warning {
		background: oklch(0.3 0.06 80);
		color: oklch(0.9 0.08 85);
	}

	@container (max-width: 480px) {
		.fields > label {
			flex: 1 1 100%;
		}

		.fields > label > span {
			white-space: normal;
		}

		.fields select {
			width: 100%;
		}
	}
</style>
