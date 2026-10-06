<!--
	Egy nap saját munkabejegyzései az összes projektből, napok között lapozva,
	a napi összóraszámmal. Koppintásra a bejegyzés szerkeszthető.
-->
<script lang="ts">
	import type { MobileContext } from './types.js';
	import type { WorkEntryListResult, WorkEntryRow } from '../../../server/functions.js';
	import { formatDate, formatNumber } from '../../utils/format.js';

	let {
		ctx,
		day = $bindable(),
		onNew,
		onEdit
	}: {
		ctx: MobileContext;
		/** A mutatott nap (YYYY-MM-DD) */
		day: string;
		onNew: () => void;
		onEdit: (entry: WorkEntryRow) => void;
	} = $props();

	const t = (key: string, vars?: Record<string, string | number>) => ctx.t(key, vars);

	let entries = $state<WorkEntryRow[]>([]);
	let totalHours = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);

	$effect(() => {
		load(day);
	});

	async function load(target: string) {
		loading = true;
		error = null;
		try {
			const result = (await ctx.sdk.remote.call('listWorkEntries', {
				organizationId: ctx.organization.id,
				scope: 'mine',
				from: target,
				to: target,
				pageSize: 100,
				sortBy: 'created_at',
				sortOrder: 'asc'
			})) as WorkEntryListResult;
			if (target !== day) return;
			entries = result.data ?? [];
			totalHours = result.totalHours ?? 0;
		} catch (err: any) {
			if (target === day) error = err?.message ?? t('error.loadFailed');
		} finally {
			if (target === day) loading = false;
		}
	}

	function shiftDay(delta: number) {
		const d = new Date(`${day}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + delta);
		day = d.toISOString().slice(0, 10);
	}

	function todayIso(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	}

	const isToday = $derived(day === todayIso());
	const dayTitle = $derived(formatDate(day, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'long' }));
</script>

<div class="m-screen">
	<div class="m-card day-nav">
		<button class="day-arrow" onclick={() => shiftDay(-1)} aria-label={t('mobile.work.prevDay')}>‹</button>
		<label class="day-label">
			<span class="day-title">{isToday ? t('leaveCalendar.today') : dayTitle}</span>
			{#if isToday}
				<span class="m-muted">{dayTitle}</span>
			{/if}
			<!-- Koppintásra a telefon dátumválasztója nyílik -->
			<input
				class="day-input"
				type="date"
				value={day}
				aria-label={t('work.form.workDate')}
				onchange={(e) => {
					const value = (e.currentTarget as HTMLInputElement).value;
					if (value) day = value;
				}}
			/>
		</label>
		<button class="day-arrow" onclick={() => shiftDay(1)} aria-label={t('mobile.work.nextDay')}>›</button>
	</div>

	<div class="total">
		<span>{t('work.totalHours', { hours: formatNumber(totalHours) })}</span>
	</div>

	<button class="m-btn m-btn-primary m-btn-block" onclick={onNew}>{t('mobile.work.new')}</button>

	{#if error}
		<p class="m-error">{error}</p>
	{:else if loading && entries.length === 0}
		<div class="loading-state"><span class="spinner"></span>{t('loading')}</div>
	{:else if entries.length === 0}
		<p class="m-empty">{t('mobile.work.empty')}</p>
	{:else}
		<ul class="m-list">
			{#each entries as entry (entry.id)}
				<li>
					<button class="m-card entry" onclick={() => onEdit(entry)}>
						<span class="entry-head">
							<span class="entry-project">{entry.projectName}</span>
							<span class="entry-hours">{t('mobile.work.hours', { hours: formatNumber(entry.hours) })}</span>
						</span>
						<span class="entry-title">{entry.title}</span>
						{#if entry.categoryName}
							<span class="m-muted">{entry.categoryName}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	@import '../../styles/shared.css';
	@import '../../styles/mobile.css';

	.day-nav {
		flex-direction: row;
		align-items: center;
		padding: 0.5rem;
	}

	.day-arrow {
		flex-shrink: 0;
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

	.day-arrow:active {
		background: var(--color-accent, #f1f5f9);
	}

	.day-label {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		min-width: 0;
		text-align: center;
	}

	.day-title {
		font-weight: 600;
		text-transform: capitalize;
	}

	/* A natív dátumválasztó a felirat fölött, láthatatlanul: koppintásra nyílik */
	.day-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.total {
		display: flex;
		justify-content: center;
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
	}

	.entry {
		width: 100%;
		text-align: left;
		cursor: pointer;
		font: inherit;
		color: inherit;
	}

	.entry-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.entry-project {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.entry-hours {
		flex-shrink: 0;
		font-weight: 600;
		color: var(--color-foreground, #0f172a);
	}

	.entry-title {
		font-weight: 600;
	}
</style>
