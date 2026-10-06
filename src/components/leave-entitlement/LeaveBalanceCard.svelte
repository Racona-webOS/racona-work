<!--
	Dolgozó adatlapja — Szabadságkeret kártya (csak leave.balance.manage joggal).

	Évenkénti keretek a számítás bontásával, és a HR műveletei: keret
	létrehozása a számításból, korrekció és zárolás, illetve a számítás
	alkalmazása kézi vagy zárolt keretre. Szabályok: specs/leave-entitlement.md
-->
<script lang="ts">
	import type {
		BalanceHistoryEntry,
		BalanceSnapshot,
		LeaveBalance,
		LeaveBalanceCalculation,
		PreviousYearBalance
	} from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import Checkbox from '../ui/Checkbox.svelte';
	import EntitlementBreakdown from './EntitlementBreakdown.svelte';
	import CarryOverDeadlineField from './CarryOverDeadlineField.svelte';
	import { balanceTotal } from '../../../server/leave-entitlement.js';
	import { formatDate, formatDateTime } from '../../utils/format.js';

	let {
		pluginId = 'racona-work',
		employeeId,
		refreshKey = 0
	}: {
		pluginId?: string;
		employeeId: number;
		/** A szülő növeli, ha a dolgozó adatai változtak (újraszámolás történt). */
		refreshKey?: number;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const thisYear = new Date().getFullYear();

	let balances = $state<LeaveBalance[]>([]);
	let loading = $state(false);
	let expandedYear = $state<number | null>(null);
	/**
	 * A kézi és a zárolt keretek mostani számított értéke. Ezek nem számolódnak
	 * újra maguktól, ezért külön kérjük le, hogy látszódjon, ha eltérnek.
	 */
	let freshCalculated = $state<Record<number, number>>({});

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	async function load() {
		loading = true;
		try {
			balances = (await sdk?.remote?.call('getLeaveBalances', { employeeId })) ?? [];
			await loadFreshCalculations();
		} catch (err) {
			balances = [];
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			loading = false;
		}
	}

	async function loadFreshCalculations() {
		const stale = balances.filter(
			(b) => b.year >= thisYear && (b.calculatedDays === null || b.isLocked)
		);
		const entries = await Promise.all(
			stale.map(async (b) => {
				try {
					const r = await sdk.remote.call('previewLeaveEntitlement', { employeeId, year: b.year });
					return [b.year, r.calculation.result.totalDays] as const;
				} catch {
					return null;
				}
			})
		);
		freshCalculated = Object.fromEntries(entries.filter((e) => e !== null));
	}

	$effect(() => {
		refreshKey;
		if (sdk?.remote && employeeId) load();
	});

	function replaceBalance(saved: LeaveBalance) {
		const exists = balances.some((b) => b.id === saved.id);
		balances = exists
			? balances.map((b) => (b.id === saved.id ? saved : b))
			: [saved, ...balances].sort((a, b) => b.year - a.year);
		loadFreshCalculations();
	}

	/** Ennyivel térne el a keret a mostani számítástól (kézi vagy zárolt keretnél). */
	function diffFromFresh(b: LeaveBalance): number {
		const fresh = freshCalculated[b.year];
		if (fresh === undefined) return 0;
		return b.calculatedDays === null ? fresh - b.totalDays : fresh - b.calculatedDays;
	}

	/** A következő év keretébe innen áthozott napok (csak tájékoztatás). */
	function carriedToNextYear(b: LeaveBalance): number {
		return balances.find((x) => x.year === b.year + 1)?.carriedOverDays ?? 0;
	}

	/** YYYY-MM-DD → helyi dátum, időzóna-csúszás nélkül. */
	function formatDay(day: string): string {
		return formatDate(day);
	}

	function signed(n: number): string {
		return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
	}

	// --- Keret létrehozása ---
	let createOpen = $state(false);
	let createYear = $state(thisYear);
	let createPreview = $state<LeaveBalanceCalculation | null>(null);
	let createPreviewError = $state<string | null>(null);
	let createAdjustment = $state(0);
	let createNote = $state('');
	let createCarryOver = $state(0);
	let createDeadline = $state<string | null>(null);
	let createPrevious = $state<PreviousYearBalance | null>(null);
	let createSaving = $state(false);

	function openCreate() {
		// Az idei évtől az első, amelyre még nincs keret
		const years = new Set(balances.map((b) => b.year));
		let year = thisYear;
		while (years.has(year)) year++;
		createYear = year;
		createAdjustment = 0;
		createNote = '';
		createCarryOver = 0;
		createOpen = true;
	}

	$effect(() => {
		if (!createOpen) return;
		const year = createYear;
		createPreview = null;
		createPreviewError = null;
		createPrevious = null;
		if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
		sdk?.remote
			?.call('previewLeaveEntitlement', { employeeId, year })
			.then(
				(r: {
					calculation: LeaveBalanceCalculation;
					balance: LeaveBalance | null;
					previousBalance: PreviousYearBalance | null;
					suggestedCarryOver: number;
				}) => {
					if (createYear !== year) return;
					createPreview = r.calculation;
					createPrevious = r.previousBalance;
					createCarryOver = r.suggestedCarryOver;
					createPreviewError = r.balance ? t('leaveEntitlement.create.exists', { year }) : null;
				}
			)
			.catch((err: any) => (createPreviewError = errorText(err)));
	});

	async function submitCreate() {
		createSaving = true;
		try {
			const saved: LeaveBalance = await sdk.remote.call('createLeaveBalanceFromCalculation', {
				employeeId,
				year: createYear,
				adjustmentDays: createAdjustment || 0,
				adjustmentNote: createNote,
				carriedOverDays: createCarryOver || 0,
				carryOverDeadline: (createCarryOver || 0) > 0 ? createDeadline : null
			});
			replaceBalance(saved);
			expandedYear = saved.year;
			createOpen = false;
			sdk?.ui?.toast(t('leaveEntitlement.balance.saved'), 'success');
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			createSaving = false;
		}
	}

	// --- Korrekció ---
	let adjustTarget = $state<LeaveBalance | null>(null);
	let adjustDays = $state(0);
	let adjustNote = $state('');
	let adjustLocked = $state(false);
	let adjustCarryOver = $state(0);
	let adjustDeadline = $state<string | null>(null);
	let adjustSaving = $state(false);

	function openAdjust(b: LeaveBalance) {
		adjustTarget = b;
		adjustDays = b.adjustmentDays;
		adjustNote = b.adjustmentNote ?? '';
		adjustLocked = b.isLocked;
		adjustCarryOver = b.carriedOverDays;
		adjustDeadline = b.carryOverDeadline;
	}

	async function submitAdjust() {
		if (!adjustTarget) return;
		if ((adjustDays || 0) !== 0 && !adjustNote.trim()) {
			sdk?.ui?.toast(t('leaveEntitlement.adjust.noteRequired'), 'warning');
			return;
		}
		adjustSaving = true;
		try {
			const saved: LeaveBalance = await sdk.remote.call('setLeaveBalanceAdjustment', {
				balanceId: adjustTarget.id,
				adjustmentDays: adjustDays || 0,
				adjustmentNote: adjustNote,
				carriedOverDays: adjustCarryOver || 0,
				carryOverDeadline: (adjustCarryOver || 0) > 0 ? adjustDeadline : null,
				isLocked: adjustLocked
			});
			replaceBalance(saved);
			adjustTarget = null;
			sdk?.ui?.toast(t('leaveEntitlement.balance.saved'), 'success');
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			adjustSaving = false;
		}
	}

	// --- Előzmények ---
	let historyTarget = $state<LeaveBalance | null>(null);
	let historyEntries = $state<BalanceHistoryEntry[]>([]);
	let historyLoading = $state(false);

	async function openHistory(b: LeaveBalance) {
		historyTarget = b;
		historyEntries = [];
		historyLoading = true;
		try {
			historyEntries = await sdk.remote.call('getLeaveBalanceHistory', { balanceId: b.id });
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			historyLoading = false;
		}
	}

	/** A két állapot közti eltérések olvasható formában. */
	function historyChanges(before: BalanceSnapshot | null, after: BalanceSnapshot): string[] {
		const changes: string[] = [];
		const field = (key: string, from: string | number | null, to: string | number | null) => {
			if (from !== to) {
				changes.push(
					before === null
						? `${t(`leaveEntitlement.history.field.${key}`)}: ${to ?? '—'}`
						: `${t(`leaveEntitlement.history.field.${key}`)}: ${from ?? '—'} → ${to ?? '—'}`
				);
			}
		};
		field('calculated', before?.calculatedDays ?? null, after.calculatedDays);
		field('adjustment', before ? signed(before.adjustmentDays) : null, signed(after.adjustmentDays));
		field('carriedOver', before?.carriedOverDays ?? null, after.carriedOverDays);
		field(
			'carryOverDeadline',
			before?.carryOverDeadline ? formatDay(before.carryOverDeadline) : null,
			after.carryOverDeadline ? formatDay(after.carryOverDeadline) : null
		);
		if (after.adjustmentNote && after.adjustmentNote !== (before?.adjustmentNote ?? null)) {
			changes.push(`${t('leaveEntitlement.history.field.note')}: ${after.adjustmentNote}`);
		}
		if (before && before.isLocked !== after.isLocked) {
			changes.push(t(after.isLocked ? 'leaveEntitlement.history.locked' : 'leaveEntitlement.history.unlocked'));
		}
		return before === null ? changes.filter((c) => !c.endsWith(': 0') && !c.endsWith(': —')) : changes;
	}

	// --- Számítás alkalmazása ---
	let applyTarget = $state<LeaveBalance | null>(null);
	let applyKeepTotal = $state(false);
	let applySaving = $state(false);

	function openApply(b: LeaveBalance) {
		applyTarget = b;
		applyKeepTotal = false;
	}

	async function submitApply() {
		if (!applyTarget) return;
		applySaving = true;
		try {
			const saved: LeaveBalance = await sdk.remote.call('applyCalculationToBalance', {
				balanceId: applyTarget.id,
				keepTotal: applyKeepTotal
			});
			replaceBalance(saved);
			applyTarget = null;
			sdk?.ui?.toast(t('leaveEntitlement.balance.saved'), 'success');
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			applySaving = false;
		}
	}
</script>

<div class="card accent-blue">
	<div class="card-header">
		<h3>{t('leaveEntitlement.balance.title')}</h3>
		<button class="btn-ghost" onclick={openCreate}>+ {t('leaveEntitlement.balance.create')}</button>
	</div>

	{#if loading && balances.length === 0}
		<div class="loading-state"><div class="spinner"></div></div>
	{:else if balances.length === 0}
		<p class="empty-hint">{t('leaveEntitlement.balance.empty')}</p>
	{:else}
		<ul class="balance-list">
			{#each balances as b (b.id)}
				{@const diff = diffFromFresh(b)}
				<li class="balance-item">
					<div class="balance-head">
						<span class="balance-year">{b.year}</span>
						<span class="badges">
							{#if b.calculatedDays === null}
								<span class="badge badge-manual">{t('leaveEntitlement.balance.badge.manual')}</span>
							{:else}
								<span class="badge badge-calculated">{t('leaveEntitlement.balance.badge.calculated')}</span>
							{/if}
							{#if b.isLocked}
								<span class="badge badge-locked">{t('leaveEntitlement.balance.badge.locked')}</span>
							{/if}
							{#if diff !== 0}
								<span class="badge badge-differs">
									{t('leaveEntitlement.balance.badge.differs', { diff: signed(diff) })}
								</span>
							{/if}
						</span>
						<span class="balance-total">{t('leaveEntitlement.days', { days: b.totalDays })}</span>
					</div>

					<div class="balance-usage">
						<span>{t('leaveEntitlement.balance.used')}: <strong>{b.usedDays}</strong></span>
						<span>
							{t('leaveEntitlement.balance.remaining')}:
							<strong class={b.remainingDays < 0 ? 'text-danger' : 'text-success'}>{b.remainingDays}</strong>
						</span>
					</div>

					{#if b.remainingDays < 0}
						<p class="hint warn">{t('leaveEntitlement.balance.overdrawn')}</p>
					{/if}
					{#if b.carryOver}
						<p class="hint carry carry-{b.carryOver.status}">
							{t('carryOver.status.line', {
								carried: b.carryOver.carriedDays,
								remaining: b.carryOver.remainingDays,
								deadline: formatDay(b.carryOver.deadline)
							})}
							{#if b.carryOver.status === 'expired' || b.carryOver.status === 'due_soon'}
								<span class="badge badge-carry-{b.carryOver.status}">
									{t(`carryOver.status.${b.carryOver.status}`, { days: b.carryOver.daysLeft })}
								</span>
							{/if}
						</p>
					{/if}
					{#if carriedToNextYear(b) > 0}
						<p class="hint">
							{t('leaveEntitlement.balance.carriedToNext', { days: carriedToNextYear(b) })}
						</p>
					{/if}

					<div class="balance-actions">
						{#if b.calculation}
							<button class="btn-ghost-sm" onclick={() => (expandedYear = expandedYear === b.year ? null : b.year)}>
								{expandedYear === b.year ? '▾' : '▸'} {t('leaveEntitlement.balance.breakdown')}
							</button>
						{/if}
						{#if b.calculatedDays !== null}
							<button class="btn-ghost-sm" onclick={() => openAdjust(b)}>{t('leaveEntitlement.balance.adjust')}</button>
						{/if}
						{#if b.calculatedDays === null || (b.isLocked && diff !== 0)}
							<button class="btn-ghost-sm" onclick={() => openApply(b)}>
								{t('leaveEntitlement.balance.applyCalculation')}
							</button>
						{/if}
						<button class="btn-ghost-sm" onclick={() => openHistory(b)}>
							{t('leaveEntitlement.history.open')}
						</button>
					</div>

					{#if b.calculatedDays === null}
						<p class="hint">{t('leaveEntitlement.balance.manualHint')}</p>
					{:else if b.isLocked}
						<p class="hint">{t('leaveEntitlement.balance.lockedHint')}</p>
					{/if}

					{#if expandedYear === b.year && b.calculation}
						<div class="breakdown-box">
							<EntitlementBreakdown
								{pluginId}
								result={b.calculation.result}
								adjustmentDays={b.adjustmentDays}
								adjustmentNote={b.adjustmentNote}
								carriedOverDays={b.carriedOverDays}
								carryOverDeadline={b.carryOverDeadline}
							/>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- Keret létrehozása -->
{#if createOpen}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (createOpen = false)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{t('leaveEntitlement.create.title')}</h3>
				<button class="icon-btn" onclick={() => (createOpen = false)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('leaveEntitlement.balance.year')}</span>
					<input class="input" type="number" bind:value={createYear} min="2000" max="2100" />
				</label>

				{#if createPreviewError}
					<p class="form-error">{createPreviewError}</p>
				{:else if createPreview}
					<div class="breakdown-box">
						<EntitlementBreakdown
							{pluginId}
							result={createPreview.result}
							adjustmentDays={createAdjustment || 0}
							adjustmentNote={createNote || null}
							carriedOverDays={createCarryOver || 0}
							carryOverDeadline={(createCarryOver || 0) > 0 ? createDeadline : null}
						/>
					</div>

					<label>
						<span>{t('leaveEntitlement.carryOver.label')}</span>
						<input class="input" type="number" bind:value={createCarryOver} min="0" max="60" />
						<small class="field-hint">
							{createPrevious
								? t('leaveEntitlement.carryOver.previousHint', {
										year: createPrevious.year,
										remaining: createPrevious.remainingDays
									})
								: t('leaveEntitlement.carryOver.noPrevious')}
						</small>
					</label>
					{#if (createCarryOver || 0) > 0}
						<CarryOverDeadlineField {pluginId} year={createYear} bind:value={createDeadline} />
					{/if}

					<label>
						<span>{t('leaveEntitlement.adjust.days')}</span>
						<input class="input" type="number" bind:value={createAdjustment} min="-365" max="365" />
					</label>
					{#if (createAdjustment || 0) !== 0}
						<label>
							<span>{t('leaveEntitlement.adjust.note')}</span>
							<input class="input" type="text" bind:value={createNote} />
						</label>
					{/if}
				{:else}
					<div class="loading-state"><div class="spinner"></div></div>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (createOpen = false)}>{t('form.cancel')}</button>
				<button
					class="btn-primary"
					onclick={submitCreate}
					disabled={createSaving || !createPreview || !!createPreviewError ||
						((createAdjustment || 0) !== 0 && !createNote.trim())}
				>
					{createSaving ? t('loading') : t('leaveEntitlement.create.submit')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Korrekció -->
{#if adjustTarget}
	{@const calculated = adjustTarget.calculatedDays ?? 0}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (adjustTarget = null)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{t('leaveEntitlement.adjust.title', { year: adjustTarget.year })}</h3>
				<button class="icon-btn" onclick={() => (adjustTarget = null)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('leaveEntitlement.adjust.days')}</span>
					<input class="input" type="number" bind:value={adjustDays} min="-365" max="365" />
				</label>
				<label>
					<span>{t('leaveEntitlement.adjust.note')}</span>
					<input class="input" type="text" bind:value={adjustNote} />
				</label>
				<label>
					<span>{t('leaveEntitlement.carryOver.label')}</span>
					<input class="input" type="number" bind:value={adjustCarryOver} min="0" max="60" />
				</label>
				{#if (adjustCarryOver || 0) > 0}
					<CarryOverDeadlineField {pluginId} year={adjustTarget.year} bind:value={adjustDeadline} />
				{/if}
				<label class="checkbox-row">
					<Checkbox checked={adjustLocked} onCheckedChange={(v) => (adjustLocked = v)} />
					<span>{t('leaveEntitlement.adjust.lock')}</span>
				</label>
				<p class="result-line">
					{t('leaveEntitlement.adjust.result', {
						calculated,
						adjustment: signed(adjustDays || 0),
						carriedOver: signed(adjustCarryOver || 0),
						total: balanceTotal(calculated, adjustDays || 0, adjustCarryOver || 0)
					})}
				</p>
				{#if calculated + (adjustDays || 0) + (adjustCarryOver || 0) < 0}
					<p class="modal-text hint">{t('leaveEntitlement.breakdown.floored')}</p>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (adjustTarget = null)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submitAdjust} disabled={adjustSaving}>
					{adjustSaving ? t('loading') : t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Előzmények -->
{#if historyTarget}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (historyTarget = null)} role="presentation">
		<div class="modal modal-history" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{t('leaveEntitlement.history.title', { year: historyTarget.year })}</h3>
				<button class="icon-btn" onclick={() => (historyTarget = null)}>✕</button>
			</div>
			<div class="modal-body">
				{#if historyLoading}
					<div class="loading-state"><div class="spinner"></div></div>
				{:else if historyEntries.length === 0}
					<p class="modal-text">{t('leaveEntitlement.history.empty')}</p>
				{:else}
					<ul class="history-list">
						{#each historyEntries as entry (entry.id)}
							<li class="history-item">
								<div class="history-head">
									<span class="history-action">{t(`leaveEntitlement.history.action.${entry.action}`)}</span>
									<span class="history-total">
										{entry.totalBefore === null
											? t('leaveEntitlement.days', { days: entry.totalAfter })
											: `${entry.totalBefore} → ${t('leaveEntitlement.days', { days: entry.totalAfter })}`}
									</span>
								</div>
								<span class="history-meta">
									{formatDateTime(entry.createdAt)}{entry.actorName ? ` · ${entry.actorName}` : ''}
								</span>
								{#each historyChanges(entry.before, entry.after) as change, i (i)}
									<span class="history-change">{change}</span>
								{/each}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Számítás alkalmazása -->
{#if applyTarget}
	{@const fresh = freshCalculated[applyTarget.year]}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (applyTarget = null)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{t('leaveEntitlement.apply.title', { year: applyTarget.year })}</h3>
				<button class="icon-btn" onclick={() => (applyTarget = null)}>✕</button>
			</div>
			<div class="modal-body">
				{#if applyTarget.calculatedDays === null}
					<p class="modal-text">
						{t('leaveEntitlement.apply.description', {
							current: applyTarget.totalDays,
							calculated: fresh ?? '?'
						})}
					</p>
					<label class="radio-row">
						<input type="radio" name="apply-mode" checked={!applyKeepTotal} onchange={() => (applyKeepTotal = false)} />
						<span>{t('leaveEntitlement.apply.useCalculated', { calculated: fresh ?? '?' })}</span>
					</label>
					<label class="radio-row">
						<input type="radio" name="apply-mode" checked={applyKeepTotal} onchange={() => (applyKeepTotal = true)} />
						<span>{t('leaveEntitlement.apply.keepTotal', { current: applyTarget.totalDays })}</span>
					</label>
				{:else}
					<p class="modal-text">
						{t('leaveEntitlement.apply.lockedDescription', {
							from: applyTarget.calculatedDays,
							to: fresh ?? '?'
						})}
					</p>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (applyTarget = null)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submitApply} disabled={applySaving}>
					{applySaving ? t('loading') : t('leaveEntitlement.apply.submit')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	.card {
		--card-accent: #3b82f6;
		border: 1px solid var(--color-border, #e2e8f0);
		border-top: 5px solid var(--card-accent);
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.card-header h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
	}

	.balance-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.balance-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
	}

	.balance-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.balance-year {
		font-weight: 700;
		font-size: 0.95rem;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		flex: 1;
	}

	.balance-total {
		font-weight: 700;
		font-size: 1rem;
		white-space: nowrap;
	}

	.balance-usage {
		display: flex;
		gap: 1.25rem;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.balance-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-left: -0.4rem;
	}

	.breakdown-box {
		padding: 0.6rem 0.8rem;
		border-radius: 0.375rem;
		background: var(--color-accent, #f8fafc);
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.hint.warn {
		color: #b45309;
	}

	.hint.carry {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.hint.carry-expired {
		color: #b91c1c;
	}

	.badge-carry-due_soon { background: #fef3c7; color: #92400e; }
	.badge-carry-expired { background: #fee2e2; color: #991b1b; }

	:global(.dark) .badge-carry-due_soon { background: oklch(0.3 0.05 60); color: #fde68a; }
	:global(.dark) .badge-carry-expired { background: oklch(0.25 0.05 20); color: #fca5a5; }

	.empty-hint {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.875rem;
		margin: 0;
	}

	.text-danger { color: #dc2626; }
	.text-success { color: #16a34a; }

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.7rem;
		font-weight: 500;
	}

	.badge-calculated { background: #dbeafe; color: #1e40af; }
	.badge-manual { background: #f1f5f9; color: #475569; }
	.badge-locked { background: #ede9fe; color: #5b21b6; }
	.badge-differs { background: #fef3c7; color: #92400e; }

	.btn-ghost {
		border: none;
		background: transparent;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
	}

	.btn-ghost:hover { background: var(--color-primary-subtle, #e0e7ff); }

	.btn-ghost-sm {
		border: none;
		background: transparent;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.75rem;
		color: var(--color-primary, #3730a3);
	}

	.btn-ghost-sm:hover { background: var(--color-accent, #f1f5f9); }

	/* A shared.css globális label szabálya oszlopba rendezne */
	.checkbox-row,
	.radio-row {
		flex-direction: row;
		align-items: center;
		gap: 0.6rem;
		cursor: pointer;
	}

	.checkbox-row span,
	.radio-row span {
		font-weight: 400;
	}

	.modal-text,
	.result-line {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.45;
	}

	.result-line {
		font-weight: 600;
	}

	.modal-history {
		max-width: 560px;
	}

	.history-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.history-item {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-accent, #f8fafc);
		font-size: 0.85rem;
	}

	.history-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.history-action {
		font-weight: 600;
	}

	.history-total {
		font-weight: 600;
		white-space: nowrap;
	}

	.history-meta,
	.history-change {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .history-item {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	.field-hint {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.form-error {
		margin: 0;
		color: #dc2626;
		font-size: 0.85rem;
	}

	:global(.dark) .card {
		background: var(--color-card, oklch(0.205 0 0));
		border: none;
		border-top: 3px solid var(--card-accent);
	}

	:global(.dark) .balance-item {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .breakdown-box {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .badge-calculated { background: oklch(0.3 0.06 260); color: #bfdbfe; }
	:global(.dark) .badge-manual { background: oklch(0.3 0 0); color: #cbd5e1; }
	:global(.dark) .badge-locked { background: oklch(0.3 0.06 300); color: #ddd6fe; }
	:global(.dark) .badge-differs { background: oklch(0.3 0.05 60); color: #fde68a; }

	/* Sötét mód: a világos státuszszínek sötét párjai */
	:global(.dark) .hint.carry-expired {
		color: var(--rw-dark-danger-fg);
	}
</style>
