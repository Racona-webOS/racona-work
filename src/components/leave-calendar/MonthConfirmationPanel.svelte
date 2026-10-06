<!--
	Havi szabadság-ellenőrzés a csapatnézet alatt (specs/leave-month-confirmation.md, K1–K3).

	A megjelenített hónapra: állapot-számlálók, „A hónap zárható” jelvény, a
	kiküldés gomb megerősítéssel, az eltérések kezelése (újraküldés, lezárás
	elfogadás nélkül) és a válaszra várók összecsukott listája. Az adatokat a
	LeaveCalendar tölti (a csapattáblázat állapotjeleihez is kell), ez a
	komponens csak a műveleteket végzi és utána szól a szülőnek.
-->
<script lang="ts">
	import type {
		MonthConfirmation,
		MonthConfirmationOverview,
		MonthConfirmationRow,
		MonthConfirmationSendResult
	} from '../../../server/functions.js';
	import { LEAVE_TYPES } from '../../../server/leave-types.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { formatDate as formatAppDate } from '../../utils/format.js';
	import { isCoreAdminViewer } from '../../stores/organizationStore.svelte.js';

	let {
		pluginId = 'racona-work',
		organizationId,
		year,
		month,
		employeeId = null,
		period,
		overview,
		loadError = null,
		onChanged,
		onOpenEmployee
	}: {
		pluginId?: string;
		organizationId: number;
		year: number;
		/** 1–12 */
		month: number;
		/** Dolgozószűrő: csak neki megy a kiküldés. */
		employeeId?: number | null;
		/** A hónap olvasható neve, pl. „2026. szeptember”. */
		period: string;
		overview: MonthConfirmationOverview | null;
		loadError?: string | null;
		/** Művelet után: a szülő újratölti az állapotot. */
		onChanged: () => void;
		/** „Megnyitás a naptárban”: havi nézet a dolgozóra szűrve. */
		onOpenEmployee: (employeeId: number) => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	const counts = $derived(overview?.counts);
	const toSendTotal = $derived((counts?.toSend ?? 0) + (counts?.toResend ?? 0));
	const skippedCount = $derived((overview?.rows.filter((r) => r.eligible).length ?? 0) - toSendTotal);
	const canSend = $derived(!!overview && !overview.blocker && toSendTotal > 0);

	const disputed = $derived(overview?.rows.filter((r) => r.confirmation?.status === 'disputed') ?? []);
	const waiting = $derived(overview?.rows.filter((r) => r.confirmation?.status === 'pending' && !r.confirmation.stale) ?? []);
	const stale = $derived(overview?.rows.filter((r) => r.confirmation?.stale && r.confirmation.status !== 'disputed') ?? []);

	// --- Kiküldés ------------------------------------------------------------

	let confirming = $state(false);
	let sendNote = $state('');
	let sending = $state(false);

	// Hónap- vagy szűrőváltáskor a megerősítés bezárul
	$effect(() => {
		year;
		month;
		employeeId;
		confirming = false;
		action = null;
	});

	async function send() {
		if (sending) return;
		sending = true;
		try {
			const result: MonthConfirmationSendResult = await sdk.remote.call('sendMonthConfirmations', {
				organizationId,
				year,
				month,
				employeeId: employeeId ?? undefined,
				note: sendNote.trim() || null
			});
			sdk?.ui?.toast(t('monthConfirmation.sent', { sent: result.sent, resent: result.resent }), 'success');
			confirming = false;
			sendNote = '';
			onChanged();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			sending = false;
		}
	}

	// --- Eltérés kezelése ----------------------------------------------------

	let action = $state<{ id: number; kind: 'resend' | 'close' } | null>(null);
	let actionNote = $state('');
	let resolving = $state(false);

	function startAction(id: number, kind: 'resend' | 'close') {
		action = { id, kind };
		actionNote = '';
	}

	async function resolve() {
		if (!action || resolving) return;
		if (action.kind === 'close' && !actionNote.trim()) {
			sdk?.ui?.toast(t('monthConfirmation.close.noteRequired'), 'warning');
			return;
		}
		resolving = true;
		try {
			await sdk.remote.call('resolveMonthConfirmation', {
				id: action.id,
				action: action.kind,
				note: actionNote.trim() || null
			});
			sdk?.ui?.toast(
				t(action.kind === 'close' ? 'monthConfirmation.close.done' : 'monthConfirmation.resend.done'),
				'success'
			);
			action = null;
			actionNote = '';
			onChanged();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			resolving = false;
		}
	}

	// --- Megjelenítés --------------------------------------------------------

	function formatDate(value: string | null): string {
		return formatAppDate(value);
	}

	/** Kiküldés (kézi vagy automatikus) és az emlékeztetők (specs/leave-month-automation.md, K5). */
	function sentMeta(conf: MonthConfirmation): string {
		const parts = [
			t(conf.sendSource === 'automatic' ? 'monthConfirmation.sentAtAuto' : 'monthConfirmation.sentAt', {
				date: formatDate(conf.sentAt)
			})
		];
		if (conf.reminderCount > 0) {
			parts.push(
				t('monthConfirmation.reminders', { count: conf.reminderCount, date: formatDate(conf.lastRemindedAt) })
			);
		}
		return parts.join(' · ');
	}

	const automationHint = $derived.by(() => {
		const a = overview?.automation;
		if (!a || overview?.blocker) return null;
		const parts: string[] = [];
		if (a.autoSendEnabled && !a.autoSent && a.autoSendDay) {
			parts.push(t('monthConfirmation.automation.autoSend', { date: formatDate(a.autoSendDay) }));
		} else if (a.autoSent) {
			parts.push(t('monthConfirmation.automation.autoSent'));
		}
		if (a.remindersEnabled && a.closingDay) {
			parts.push(t('monthConfirmation.automation.reminders', { date: formatDate(a.closingDay) }));
		}
		if (a.closingNotifyHr && a.closingDay) {
			parts.push(t('monthConfirmation.automation.closing', { date: formatDate(a.closingDay) }));
		}
		return parts.length > 0 ? parts.join(' ') : null;
	});

	function formatDay(iso: string): string {
		return formatAppDate(iso, { month: 'short', day: 'numeric' });
	}

	function typeLabel(type: string | undefined): string {
		if (!type) return '—';
		return (LEAVE_TYPES as readonly string[]).includes(type) ? t(`leaveRequests.type.${type}`) : type;
	}

	function itemLines(conf: MonthConfirmation): string[] {
		return conf.disputeItems.map((item) =>
			t(`monthConfirmation.item.${item.kind}`, {
				day: formatDay(item.day),
				type: typeLabel(conf.snapshot.days.find((d) => d.day === item.day)?.leaveType),
				correct: typeLabel(item.leaveType)
			})
		);
	}
</script>

{#snippet actionForm(row: MonthConfirmationRow)}
	{#if action && action.id === row.confirmation?.id}
		<div class="action-form">
			<input
				class="input"
				type="text"
				maxlength="1000"
				bind:value={actionNote}
				placeholder={t(action.kind === 'close' ? 'monthConfirmation.close.note' : 'monthConfirmation.resend.note')}
				aria-label={t(action.kind === 'close' ? 'monthConfirmation.close.note' : 'monthConfirmation.resend.note')}
			/>
			<div class="actions">
				<button class="btn-secondary btn-sm" onclick={() => (action = null)} disabled={resolving}>
					{t('monthConfirmation.confirm.cancel')}
				</button>
				<button
					class={action.kind === 'close' ? 'btn-danger btn-sm' : 'btn-primary btn-sm'}
					onclick={resolve}
					disabled={resolving}
				>
					{resolving
						? t('loading')
						: t(action.kind === 'close' ? 'monthConfirmation.close.submit' : 'monthConfirmation.actions.resend')}
				</button>
			</div>
		</div>
	{/if}
{/snippet}

<section class="mc">
	<div class="mc-head">
		<div class="mc-title">
			<h3>{t('monthConfirmation.panel.title', { period })}</h3>
			<p class="hint">{t(employeeId ? 'monthConfirmation.panel.hintOne' : 'monthConfirmation.panel.hint')}</p>
		</div>
		<button class="btn-primary" onclick={() => (confirming = true)} disabled={!canSend || confirming || sending}>
			{t('monthConfirmation.panel.send')}
		</button>
	</div>

	{#if loadError}
		<p class="hint is-warning">{loadError}</p>
	{:else if overview && counts}
		<div class="counts">
			<span class="count-chip status-accepted">{t('monthConfirmation.status.accepted')}: {counts.accepted}</span>
			<span class="count-chip status-pending">{t('monthConfirmation.status.pending')}: {counts.pending}</span>
			<span class="count-chip status-disputed">{t('monthConfirmation.status.disputed')}: {counts.disputed}</span>
			{#if counts.closed > 0}
				<span class="count-chip status-closed">{t('monthConfirmation.status.closed')}: {counts.closed}</span>
			{/if}
			{#if counts.stale > 0}
				<span class="count-chip status-stale">{t('monthConfirmation.status.stale')}: {counts.stale}</span>
			{/if}
			<span class="count-chip">{t('monthConfirmation.status.notSent')}: {counts.notSent}</span>
			{#if overview.closable}
				<span class="closable">✓ {t('monthConfirmation.panel.closable')}</span>
			{/if}
		</div>

		{#if automationHint}
			<p class="hint">{automationHint}</p>
		{/if}

		{#if overview.blocker}
			<p class="hint is-warning">{t(`monthConfirmation.panel.blocker.${overview.blocker}`)}</p>
		{:else if toSendTotal === 0 && overview.rows.length > 0}
			<p class="hint">{t('monthConfirmation.panel.nothingToSend')}</p>
		{/if}

		{#if confirming}
			<div class="confirm">
				<ul>
					{#if counts.toSend > 0}
						<li>{t('monthConfirmation.confirm.new', { count: counts.toSend })}</li>
					{/if}
					{#if counts.toResend > 0}
						<li>{t('monthConfirmation.confirm.resend', { count: counts.toResend })}</li>
					{/if}
					{#if skippedCount > 0}
						<li>{t('monthConfirmation.confirm.skipped', { count: skippedCount })}</li>
					{/if}
					{#if overview.pendingEmployeeCount > 0}
						<li class="is-warning">
							{t('monthConfirmation.confirm.pendingWarning', { count: overview.pendingEmployeeCount })}
						</li>
					{/if}
				</ul>
				<input
					class="input"
					type="text"
					maxlength="1000"
					bind:value={sendNote}
					placeholder={t('monthConfirmation.confirm.note')}
					aria-label={t('monthConfirmation.confirm.note')}
				/>
				<div class="actions">
					<button class="btn-secondary btn-sm" onclick={() => (confirming = false)} disabled={sending}>
						{t('monthConfirmation.confirm.cancel')}
					</button>
					<button class="btn-primary btn-sm" onclick={send} disabled={sending}>
						{sending ? t('loading') : t('monthConfirmation.confirm.submit')}
					</button>
				</div>
			</div>
		{/if}

		{#if disputed.length > 0}
			<div class="group">
				<h4>{t('monthConfirmation.disputes.title')} <span class="badge-count">{disputed.length}</span></h4>
				<ul class="list">
					{#each disputed as row (row.employeeId)}
						{@const conf = row.confirmation!}
						<li class="item">
							<div class="item-main">
								<span class="name">{row.employeeName}</span>
								<span class="meta">
									{t('monthConfirmation.disputes.respondedAt', { date: formatDate(conf.respondedAt) })}
									{#if conf.stale}· {t('monthConfirmation.status.stale')}{/if}
								</span>
								{#each itemLines(conf) as line, i (i)}
									<span class="detail">{line}</span>
								{:else}
									<span class="detail">{t('monthConfirmation.item.noItems')}</span>
								{/each}
								{#if conf.employeeNote}
									<span class="note">„{conf.employeeNote}”</span>
								{/if}
							</div>
							<div class="actions">
								<button class="btn-secondary btn-sm" onclick={() => onOpenEmployee(row.employeeId)}>
									{t('monthConfirmation.actions.openCalendar')}
								</button>
								{#if !row.isOwn || isCoreAdminViewer()}
									<button class="btn-secondary btn-sm" onclick={() => startAction(conf.id, 'close')} disabled={resolving}>
										{t('monthConfirmation.actions.close')}
									</button>
								{/if}
								<button class="btn-primary btn-sm" onclick={() => startAction(conf.id, 'resend')} disabled={resolving}>
									{t('monthConfirmation.actions.resend')}
								</button>
							</div>
							{@render actionForm(row)}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if stale.length > 0}
			<details class="group">
				<summary>{t('monthConfirmation.stale.title', { count: stale.length })}</summary>
				<p class="hint">{t('monthConfirmation.stale.hint')}</p>
				<ul class="list">
					{#each stale as row (row.employeeId)}
						<li class="item compact">
							<span class="name">{row.employeeName}</span>
							<span class="meta">
								{t(`monthConfirmation.status.${row.confirmation!.status}`)} · {sentMeta(row.confirmation!)}
							</span>
							<button class="link-btn" onclick={() => onOpenEmployee(row.employeeId)}>
								{t('monthConfirmation.actions.openCalendar')}
							</button>
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		{#if waiting.length > 0}
			<details class="group">
				<summary>{t('monthConfirmation.waiting.title', { count: waiting.length })}</summary>
				<ul class="list">
					{#each waiting as row (row.employeeId)}
						<li class="item compact">
							<span class="name">{row.employeeName}</span>
							<span class="meta">{sentMeta(row.confirmation!)}</span>
							{#if !row.isOwn || isCoreAdminViewer()}
								<button class="link-btn" onclick={() => startAction(row.confirmation!.id, 'close')} disabled={resolving}>
									{t('monthConfirmation.actions.close')}
								</button>
							{/if}
							{@render actionForm(row)}
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
</section>

<style>
	@import '../../styles/shared.css';

	.mc {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1rem 1.25rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-top: 4px solid #3b82f6;
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
		min-width: 0;
	}

	.mc-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.mc-title {
		flex: 1;
		min-width: 16rem;
	}

	h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	h4 {
		margin: 0 0 0.4rem;
		font-size: 0.875rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.hint {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.is-warning {
		color: #b45309;
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}

	.count-chip {
		padding: 0.15rem 0.55rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-foreground, #0f172a);
	}

	.status-accepted {
		background: #dcfce7;
		color: #166534;
	}

	.status-pending {
		background: #fef3c7;
		color: #92400e;
	}

	.status-disputed {
		background: #fee2e2;
		color: #991b1b;
	}

	.status-closed {
		background: #e2e8f0;
		color: #334155;
	}

	.status-stale {
		background: #dbeafe;
		color: #1e40af;
	}

	.closable {
		margin-left: 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #166534;
	}

	.confirm {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0.9rem;
		border-radius: 0.5rem;
		background: var(--color-accent, #f8fafc);
		font-size: 0.85rem;
	}

	.confirm ul {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	details.group summary {
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.badge-count {
		min-width: 1.3rem;
		padding: 0.05rem 0.4rem;
		border-radius: 9999px;
		background: #fee2e2;
		color: #991b1b;
		font-size: 0.72rem;
		text-align: center;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.item {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 0.8rem;
		border-radius: 0.5rem;
		background: var(--color-accent, #f8fafc);
		font-size: 0.85rem;
	}

	.item.compact {
		align-items: center;
		justify-content: flex-start;
		padding: 0.4rem 0.8rem;
	}

	.item-main {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
		min-width: 14rem;
	}

	.name {
		font-weight: 600;
	}

	.meta,
	.detail {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.detail {
		color: var(--color-foreground, #0f172a);
	}

	.note {
		font-size: 0.8rem;
		font-style: italic;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.action-form {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.action-form .input {
		flex: 1;
		min-width: 14rem;
	}

	.link-btn {
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
		margin-left: auto;
	}

	.link-btn:hover {
		text-decoration: underline;
	}

	:global(.dark) .mc {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		border-top-color: #3b82f6;
	}

	/* Sötét mód: a világos státuszszínek sötét párjai */
	:global(.dark) .status-accepted {
		background: var(--rw-dark-success-bg);
		color: var(--rw-dark-success-fg);
	}

	:global(.dark) .status-pending {
		background: var(--rw-dark-warning-bg);
		color: var(--rw-dark-warning-fg);
	}

	:global(.dark) .status-disputed {
		background: var(--rw-dark-danger-bg);
		color: var(--rw-dark-danger-fg);
	}

	:global(.dark) .status-closed {
		background: var(--rw-dark-neutral-bg);
		color: var(--rw-dark-neutral-fg);
	}

	:global(.dark) .status-stale {
		background: var(--rw-dark-info-bg);
		color: var(--rw-dark-info-fg);
	}

	:global(.dark) .badge-count {
		background: var(--rw-dark-danger-bg);
		color: var(--rw-dark-danger-fg);
	}
</style>
