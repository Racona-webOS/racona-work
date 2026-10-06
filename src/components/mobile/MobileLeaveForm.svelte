<!--
	Új szabadságkérelem telefonon: típus (gyerekes típusnál gyerek), napok a havi
	naptárban koppintással (hónapok között lapozva is megmaradnak), indoklás.
	A kijelölésből a szerver élő előnézetet ad (szakaszok, keret, hibák); a beküldés
	szakaszonként egy függő kérelmet hoz létre, mint az asztali naptár kérelmező módja.
-->
<script lang="ts">
	import type { MobileContext } from './types.js';
	import type {
		LeaveCalendar,
		LeaveCalendarChangePlan,
		LeaveRequestBatchResult,
		LeaveAllowances,
		ChildLeaveStatus
	} from '../../../server/functions.js';
	import { CHILD_LEAVE_TYPES } from '../../../server/leave-types.js';
	import type { LeaveType } from '../../../server/leave-types.js';
	import { REQUEST_CALENDAR_LEAVE_TYPES } from '../../../server/leave-day-utils.js';
	import { isWeekend, monthGrid, monthRange } from '../../lib/calendar-grid.js';
	import { formatDate, formatShortDay } from '../../utils/format.js';

	let {
		ctx,
		onSubmitted,
		onCancel
	}: { ctx: MobileContext; onSubmitted: () => void; onCancel: () => void } = $props();

	const t = (key: string, vars?: Record<string, string | number>) => ctx.t(key, vars);
	const organizationId = $derived(ctx.organization.id);
	const employeeId = $derived(ctx.employee.id);

	const now = new Date();
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

	let leaveType = $state<LeaveType>('annual');
	let reason = $state('');

	// A naptárban látott hónap (a gyerekek keretét is ennek az évére kérjük)
	let viewYear = $state(now.getFullYear());
	let viewMonth = $state(now.getMonth());
	let calendar = $state<LeaveCalendar | null>(null);
	let calendarLoading = $state(false);
	let calendarError = $state<string | null>(null);

	// --- Gyerek (apasági és szülői szabadság) ---------------------------------

	let childId = $state<number | null>(null);
	let allowances = $state<LeaveAllowances | null>(null);
	const needsChild = $derived(CHILD_LEAVE_TYPES.has(leaveType));
	const childOptions = $derived<ChildLeaveStatus[]>(
		leaveType === 'paternity'
			? (allowances?.paternity.filter((c) => c.active) ?? [])
			: leaveType === 'parental'
				? (allowances?.parental ?? [])
				: []
	);

	$effect(() => {
		const type = leaveType;
		const year = viewYear;
		childId = null;
		if (!CHILD_LEAVE_TYPES.has(type)) {
			allowances = null;
			return;
		}
		ctx.sdk.remote
			.call('getLeaveAllowances', { employeeId, year })
			.then((result: LeaveAllowances) => {
				if (leaveType === type) allowances = result;
			})
			.catch(() => (allowances = null));
	});

	function childLabel(child: ChildLeaveStatus): string {
		return child.label || formatDate(child.birthDate);
	}

	// --- Naptár ----------------------------------------------------------------

	const cells = $derived(monthGrid(viewYear, viewMonth));
	const monthTitle = $derived.by(() => {
		const name = t(`workCalendar.month.${viewMonth}`);
		return t('leaveSummary.period.month', { year: viewYear, month: name, monthLower: name.toLocaleLowerCase() });
	});

	$effect(() => {
		const { from, to } = monthRange(viewYear, viewMonth);
		loadCalendar(from, to);
	});

	async function loadCalendar(from: string, to: string) {
		calendarLoading = true;
		calendarError = null;
		try {
			const result = (await ctx.sdk.remote.call('getLeaveCalendar', {
				organizationId,
				from,
				to,
				employeeId
			})) as LeaveCalendar;
			if (result.from === from) calendar = result;
		} catch (err: any) {
			calendarError = err?.message ?? t('error.loadFailed');
		} finally {
			calendarLoading = false;
		}
	}

	function shiftMonth(delta: number) {
		const d = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
		viewYear = d.getUTCFullYear();
		viewMonth = d.getUTCMonth();
	}

	const overrides = $derived(new Map((calendar?.calendar ?? []).map((c) => [c.day, c.isWorkingDay])));
	const approvedDays = $derived(
		new Set((calendar?.days ?? []).filter((d) => d.employeeId === employeeId).map((d) => d.day))
	);
	const pendingDays = $derived(
		new Set((calendar?.pending ?? []).filter((d) => d.employeeId === employeeId).map((d) => d.day))
	);

	function isWorkingDay(iso: string): boolean {
		const override = overrides.get(iso);
		return override !== undefined ? override : !isWeekend(iso);
	}

	/** Lezárt vagy még meg nem nyitott év: oda nem lehet kérni */
	function isClosed(iso: string): boolean {
		if (!calendar) return true;
		const year = Number(iso.slice(0, 4));
		if (calendar.closedYear !== null && year <= calendar.closedYear) return true;
		return calendar.openedYear === null || year > calendar.openedYear;
	}

	type CellKind = 'approved' | 'pending' | 'off' | 'closed' | 'selected' | 'free';

	function cellKind(iso: string): CellKind {
		if (approvedDays.has(iso)) return 'approved';
		if (pendingDays.has(iso)) return 'pending';
		if (!isWorkingDay(iso)) return 'off';
		if (isClosed(iso)) return 'closed';
		return selected.has(iso) ? 'selected' : 'free';
	}

	const unopenedHint = $derived.by(() => {
		if (!calendar) return '';
		if (calendar.openedYear === null) return t('leaveCalendar.noOpenYearHint');
		return viewYear > calendar.openedYear
			? t('leaveCalendar.unopenedHint', { year: calendar.openedYear + 1 })
			: '';
	});

	// --- Kijelölés -------------------------------------------------------------

	// Sima Set, minden változásnál újra létrehozva (a svelte/reactivity a plugin
	// csomagban saját runtime-mal kerülne be, lásd LeaveCalendar)
	let selected = $state<Set<string>>(new Set());
	const selectedList = $derived([...selected].sort());

	function toggle(iso: string) {
		const kind = cellKind(iso);
		if (kind !== 'free' && kind !== 'selected') return;
		const next = new Set(selected);
		if (next.has(iso)) next.delete(iso);
		else next.add(iso);
		selected = next;
	}

	// --- Előnézet és beküldés ----------------------------------------------------

	let plan = $state<LeaveCalendarChangePlan | null>(null);
	let planLoading = $state(false);
	let submitting = $state(false);
	let planTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const days = selectedList;
		const type = leaveType;
		const child = childId;
		if (planTimer) clearTimeout(planTimer);
		if (days.length === 0) {
			plan = null;
			planLoading = false;
			return;
		}
		planLoading = true;
		planTimer = setTimeout(async () => {
			try {
				const result = (await ctx.sdk.remote.call('previewLeaveRequestBatch', {
					organizationId,
					employeeId,
					leaveType: type,
					days,
					childId: child
				})) as LeaveCalendarChangePlan;
				// Csak akkor vesszük át, ha közben nem változott a jelölés
				if (days.length === selected.size && type === leaveType) plan = result;
			} catch (err: any) {
				plan = { runs: [], removeDays: [], balances: [], errors: [err?.message ?? t('error.loadFailed')] };
			} finally {
				planLoading = false;
			}
		}, 250);
	});

	const requestedDays = $derived(plan?.runs.reduce((sum, r) => sum + r.days.length, 0) ?? 0);
	const canSubmit = $derived(
		selected.size > 0 &&
			!planLoading &&
			!submitting &&
			!!plan &&
			plan.errors.length === 0 &&
			(!needsChild || childId !== null)
	);

	async function submit() {
		if (!canSubmit) return;
		submitting = true;
		try {
			const result = (await ctx.sdk.remote.call('submitLeaveRequestBatch', {
				organizationId,
				employeeId,
				leaveType,
				days: selectedList,
				childId,
				reason: reason.trim() || null
			})) as LeaveRequestBatchResult;
			ctx.sdk?.ui?.toast(
				t('leaveCalendar.submitted', {
					requests: result.createdRequests.length,
					days: result.createdRequests.reduce((sum, r) => sum + r.days, 0)
				}),
				'success'
			);
			onSubmitted();
		} catch (err: any) {
			ctx.sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			submitting = false;
		}
	}

	function cancel() {
		if (selected.size > 0 && !window.confirm(t('leaveCalendar.discardConfirm'))) return;
		onCancel();
	}

	const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
</script>

<div class="m-screen">
	<h2 class="m-title">{t('mobile.leave.new')}</h2>

	<label class="m-field">
		<span class="m-label">{t('mobile.leave.type')}</span>
		<select class="m-input" bind:value={leaveType} disabled={submitting}>
			{#each REQUEST_CALENDAR_LEAVE_TYPES as type (type)}
				<option value={type}>{t(`leaveRequests.type.${type}`)}</option>
			{/each}
		</select>
	</label>

	{#if needsChild}
		<label class="m-field">
			<span class="m-label">{t('leaveCalendar.child')}</span>
			{#if childOptions.length === 0}
				<p class="m-muted">{t('leaveCalendar.noChild')}</p>
			{:else}
				<select class="m-input" bind:value={childId} disabled={submitting}>
					<option value={null}>{t('leaveCalendar.childSelect')}</option>
					{#each childOptions as child (child.childId)}
						<option value={child.childId}>
							{childLabel(child)} · {t('leaveCalendar.childRemaining', { days: child.remainingDays })}
						</option>
					{/each}
				</select>
			{/if}
		</label>
	{/if}

	<div class="m-card cal">
		<div class="cal-head">
			<button class="cal-nav" onclick={() => shiftMonth(-1)} aria-label={t('leaveCalendar.prev')}>‹</button>
			<span class="cal-title">{monthTitle}</span>
			<button class="cal-nav" onclick={() => shiftMonth(1)} aria-label={t('leaveCalendar.next')}>›</button>
		</div>

		<div class="cal-grid" class:loading={calendarLoading}>
			{#each WEEKDAYS as wd (wd)}
				<span class="cal-weekday">{t(`workCalendar.weekdayShort.${wd}`)}</span>
			{/each}
			{#each cells as iso, i (iso ?? `empty-${i}`)}
				{#if iso === null}
					<span></span>
				{:else}
					{@const kind = cellKind(iso)}
					<button
						class="cal-day {kind}"
						class:today={iso === today}
						disabled={kind !== 'free' && kind !== 'selected'}
						aria-pressed={kind === 'selected'}
						aria-label={formatDate(iso)}
						onclick={() => toggle(iso)}
					>
						{Number(iso.slice(8))}
					</button>
				{/if}
			{/each}
		</div>

		<div class="cal-legend">
			<span><i class="dot selected"></i>{t('leaveCalendar.legend.toRequest')}</span>
			<span><i class="dot approved"></i>{t('leaveCalendar.legend.approved')}</span>
			<span><i class="dot pending"></i>{t('leaveCalendar.legend.pending')}</span>
		</div>

		{#if calendarError}
			<p class="m-error">{calendarError}</p>
		{:else if unopenedHint}
			<p class="m-muted">{unopenedHint}</p>
		{/if}
	</div>

	{#if selected.size > 0}
		<div class="m-card">
			<span class="m-section-title">{t('mobile.leave.selected', { count: selected.size })}</span>
			<p class="selected-days">{selectedList.map((d) => formatShortDay(d)).join(', ')}</p>

			{#if planLoading}
				<div class="loading-state"><span class="spinner"></span>{t('loading')}</div>
			{:else if plan}
				{#if plan.errors.length > 0}
					{#each plan.errors as message (message)}
						<p class="m-error">{message}</p>
					{/each}
				{:else}
					<p class="m-muted">
						{t('leaveCalendar.summary.request', { days: requestedDays, requests: plan.runs.length })}
					</p>
					{#each plan.balances as b (b.year)}
						<p class="m-muted">
							{b.hasBalance
								? t('leaveCalendar.summary.balance', {
										year: b.year,
										before: b.remainingBefore,
										after: b.remainingAfter
									})
								: t('leaveCalendar.summary.noBalance', { year: b.year })}
						</p>
					{/each}
				{/if}
			{/if}
		</div>
	{/if}

	<label class="m-field">
		<span class="m-label">{t('leaveCalendar.reason')}</span>
		<textarea class="m-input" rows="3" maxlength="1000" bind:value={reason} disabled={submitting}></textarea>
	</label>

	<div class="m-actions">
		<button class="m-btn" onclick={cancel} disabled={submitting}>{t('form.cancel')}</button>
		<button class="m-btn m-btn-primary" onclick={submit} disabled={!canSubmit}>
			{submitting ? t('loading') : t('mobile.leave.submit')}
		</button>
	</div>
</div>

<style>
	@import '../../styles/shared.css';
	@import '../../styles/mobile.css';

	.m-title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.cal-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.cal-title {
		font-weight: 600;
	}

	.cal-nav {
		width: 2.75rem;
		height: 2.75rem;
		border: none;
		border-radius: 9999px;
		background: transparent;
		color: var(--color-foreground, #0f172a);
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
	}

	.cal-nav:active {
		background: var(--color-accent, #f1f5f9);
	}

	.cal-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.25rem;
		transition: opacity 0.15s ease;
	}

	.cal-grid.loading {
		opacity: 0.5;
	}

	.cal-weekday {
		padding-bottom: 0.25rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.cal-day {
		aspect-ratio: 1;
		min-height: 2.5rem;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		background: var(--color-accent, #f8fafc);
		color: var(--color-foreground, #0f172a);
		font-size: 0.9375rem;
		cursor: pointer;
	}

	.cal-day.today {
		border-color: var(--color-primary, #3730a3);
	}

	.cal-day.selected {
		background: var(--color-primary, #3730a3);
		color: white;
		font-weight: 600;
	}

	.cal-day.approved {
		background: #dcfce7;
		color: #166534;
	}

	.cal-day.pending {
		background: #fef3c7;
		color: #92400e;
	}

	.cal-day.off,
	.cal-day.closed {
		background: transparent;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.cal-day:disabled {
		cursor: default;
	}

	.cal-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 1rem;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.cal-legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.dot {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 9999px;
	}

	.dot.selected {
		background: var(--color-primary, #3730a3);
	}

	.dot.approved {
		background: #22c55e;
	}

	.dot.pending {
		background: #f59e0b;
	}

	.selected-days {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.4;
	}

	:global(.dark) .cal-day.approved {
		background: rgba(34, 197, 94, 0.2);
		color: #86efac;
	}

	:global(.dark) .cal-day.pending {
		background: rgba(245, 158, 11, 0.2);
		color: #fcd34d;
	}
</style>
