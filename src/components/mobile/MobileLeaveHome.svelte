<!--
	A szabadság mobil áttekintése: az idei keret, a saját kérelmek (a függőt vissza
	lehet vonni) és az „Új kérelem” gomb. Megjelenéskor tölt (a szülő szervezet- és
	nézetváltáskor újra létrehozza).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { MobileContext } from './types.js';
	import type { LeaveBalance, LeaveRequestRow, PaginatedResult } from '../../../server/functions.js';
	import { consumesAnnualBalance, LEAVE_TYPES } from '../../../server/leave-types.js';
	import { formatDate } from '../../utils/format.js';

	let { ctx, onNew }: { ctx: MobileContext; onNew: () => void } = $props();

	const t = (key: string, vars?: Record<string, string | number>) => ctx.t(key, vars);
	const thisYear = new Date().getFullYear();

	let balance = $state<LeaveBalance | null>(null);
	let requests = $state<LeaveRequestRow[]>([]);
	let pendingDays = $state(0);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let withdrawingId = $state<number | null>(null);

	async function load() {
		loading = true;
		loadError = null;
		try {
			const [balances, recent, pending] = await Promise.all([
				ctx.sdk.remote.call('getLeaveBalances', { employeeId: ctx.employee.id }) as Promise<LeaveBalance[]>,
				ctx.sdk.remote.call('getLeaveRequests', {
					organizationId: ctx.organization.id,
					employeeId: ctx.employee.id,
					pageSize: 20,
					sortBy: 'createdAt',
					sortOrder: 'desc'
				}) as Promise<PaginatedResult<LeaveRequestRow>>,
				ctx.sdk.remote.call('getLeaveRequests', {
					organizationId: ctx.organization.id,
					employeeId: ctx.employee.id,
					status: 'pending',
					pageSize: 200
				}) as Promise<PaginatedResult<LeaveRequestRow>>
			]);
			balance = (balances ?? []).find((b) => b.year === thisYear) ?? null;
			requests = recent?.data ?? [];
			// A függő kérelmek az idei keretből (mint az irányítópulton)
			pendingDays = (pending?.data ?? [])
				.filter(
					(r) => consumesAnnualBalance(r.leaveType) && String(r.startDate).slice(0, 4) === String(thisYear)
				)
				.reduce((sum, r) => sum + r.days, 0);
		} catch (err: any) {
			loadError = err?.message ?? t('error.loadFailed');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function typeLabel(type: string): string {
		return (LEAVE_TYPES as readonly string[]).includes(type) ? t(`leaveRequests.type.${type}`) : type;
	}

	function period(r: LeaveRequestRow): string {
		const start = formatDate(r.startDate);
		return r.startDate === r.endDate ? start : `${start} – ${formatDate(r.endDate)}`;
	}

	async function withdraw(r: LeaveRequestRow) {
		if (withdrawingId !== null) return;
		if (!window.confirm(t('leaveCalendar.withdrawConfirm', { period: period(r) }))) return;
		withdrawingId = r.id;
		try {
			await ctx.sdk.remote.call('withdrawLeaveRequest', { id: r.id });
			ctx.sdk?.ui?.toast(t('leaveCalendar.withdrawn'), 'success');
			await load();
		} catch (err: any) {
			ctx.sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			withdrawingId = null;
		}
	}
</script>

<div class="m-screen">
	{#if loadError}
		<p class="m-error">{loadError}</p>
	{/if}

	<div class="m-card balance">
		<span class="m-section-title">{t('mobile.leave.balanceTitle', { year: thisYear })}</span>
		{#if balance}
			<div class="balance-main">
				<strong>{balance.remainingDays - pendingDays}</strong>
				<span>{t('mobile.leave.available')}</span>
			</div>
			<p class="m-muted">
				{t('dashboard.self.totalDays')}: {balance.totalDays} ·
				{t('dashboard.self.usedDays')}: {balance.usedDays}
				{#if pendingDays > 0}
					· {t('dashboard.self.pendingDays')}: {pendingDays}
				{/if}
			</p>
		{:else if !loading}
			<p class="m-muted">{t('dashboard.self.noBalance')}</p>
		{/if}
	</div>

	<button class="m-btn m-btn-primary m-btn-block" onclick={onNew}>
		{t('mobile.leave.new')}
	</button>

	<h3 class="m-section-title">{t('dashboard.self.myRequests')}</h3>
	{#if loading && requests.length === 0}
		<div class="loading-state"><span class="spinner"></span>{t('loading')}</div>
	{:else if requests.length === 0}
		<p class="m-empty">{t('dashboard.self.noMyRequests')}</p>
	{:else}
		<ul class="m-list">
			{#each requests as r (r.id)}
				<li class="m-card request">
					<div class="request-head">
						<span class="request-type">{typeLabel(r.leaveType)}</span>
						<span class="m-chip status-{r.status}">{t(`leaveRequests.status.${r.status}`)}</span>
					</div>
					<span class="m-muted">{period(r)} · {t('mobile.leave.days', { days: r.days })}</span>
					{#if r.status === 'pending'}
						<button
							class="m-btn m-btn-danger"
							onclick={() => withdraw(r)}
							disabled={withdrawingId !== null}
						>
							{withdrawingId === r.id ? t('loading') : t('mobile.leave.withdraw')}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	@import '../../styles/shared.css';
	@import '../../styles/mobile.css';

	.balance-main {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.balance-main strong {
		font-size: 2.25rem;
		line-height: 1;
		color: var(--color-primary, #3730a3);
	}

	.request-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.request-type {
		font-weight: 600;
	}
</style>
