<!--
	Szabadságfelhasználási terv szerkesztője (specs/leave-balance-overview.md, K9):
	évenként 12 havi halmozott százalék, tűrés és kritikus küszöb, előnézeti görbe
	egy 25 napos példakerettel.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import type { LeaveUsagePlanView } from '../../../server/functions.js';
	import { uniformMonths, validatePlan } from '../../../server/leave-usage-plan-utils.js';
	import type { PlanError } from '../../../server/leave-usage-plan-utils.js';
	import { formatNumber } from '../../utils/format.js';

	let { pluginId = 'racona-work', organizationId }: { pluginId?: string; organizationId: number } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	/** A táblázat és az előnézet példakerete. */
	const EXAMPLE_DAYS = 25;
	const thisYear = new Date().getFullYear();

	let year = $state(thisYear);
	let view = $state<LeaveUsagePlanView | null>(null);
	let loading = $state(true);
	let saving = $state(false);
	let copying = $state(false);

	// A számmezők üresen null-t adnak; a validatePlan ezt is hibaként jelzi.
	let months = $state<(number | null)[]>(uniformMonths());
	let tolerancePct = $state<number | null>(10);
	let criticalPct = $state<number | null>(20);

	const errors = $derived(validatePlan({ months, tolerancePct, criticalPct }).errors);
	const readOnly = $derived(view?.closed === true);
	const dirty = $derived(
		!!view &&
			(months.some((v, i) => v !== view!.months[i]) ||
				tolerancePct !== view.tolerancePct ||
				criticalPct !== view.criticalPct)
	);
	const canSave = $derived(!!view && !readOnly && dirty && errors.length === 0 && !saving);

	/** A legutolsó megnyitott év és az előző kettő, a következő év, és az idei (legfeljebb a jövő év). */
	const years = $derived.by(() => {
		const base = view?.openedYear ?? thisYear;
		const set = new Set([base - 2, base - 1, base, base + 1, thisYear, year]);
		return [...set].filter((y) => y <= thisYear + 1).sort((a, b) => a - b);
	});

	const monthName = (m: number) => t(`workCalendar.month.${m - 1}`);

	function monthError(m: number): PlanError | undefined {
		return errors.find((e) => e.field === 'months' && e.month === m);
	}

	function errorText(e: PlanError): string {
		return t(`settings.leaveUsagePlan.error.${e.code}`, { month: e.month ? monthName(e.month) : '' });
	}

	function formatDays(value: number): string {
		return formatNumber(value, { maximumFractionDigits: 1 });
	}

	function increment(i: number): string {
		const value = months[i];
		const previous = i === 0 ? 0 : months[i - 1];
		if (typeof value !== 'number' || typeof previous !== 'number') return '';
		const diff = value - previous;
		return `${diff >= 0 ? '+' : ''}${diff}%`;
	}

	function example(value: number | null): string {
		return typeof value === 'number' && value >= 0 && value <= 100
			? formatDays(EXAMPLE_DAYS * (1 - value / 100))
			: '—';
	}

	function applyPlan(p: { months: number[]; tolerancePct: number; criticalPct: number }) {
		months = [...p.months];
		tolerancePct = p.tolerancePct;
		criticalPct = p.criticalPct;
	}

	async function loadPlan(y: number) {
		loading = true;
		try {
			const result: LeaveUsagePlanView = await sdk.remote.call('getLeaveUsagePlan', { organizationId, year: y });
			view = result;
			applyPlan(result);
		} catch (err: any) {
			sdk?.ui?.toast(err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.loadFailed'), 'error');
		} finally {
			loading = false;
		}
	}

	function selectYear(event: Event & { currentTarget: HTMLSelectElement }) {
		const next = Number(event.currentTarget.value);
		if (dirty && !confirm(t('settings.leaveUsagePlan.discardConfirm'))) {
			event.currentTarget.value = String(year);
			return;
		}
		year = next;
		loadPlan(next);
	}

	function fillUniform() {
		months = uniformMonths();
	}

	async function copyPrevious() {
		copying = true;
		try {
			const previous: LeaveUsagePlanView = await sdk.remote.call('getLeaveUsagePlan', {
				organizationId,
				year: year - 1
			});
			applyPlan(previous);
		} catch (err: any) {
			sdk?.ui?.toast(err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.loadFailed'), 'error');
		} finally {
			copying = false;
		}
	}

	async function save() {
		if (!canSave) return;
		saving = true;
		try {
			const result: LeaveUsagePlanView = await sdk.remote.call('saveLeaveUsagePlan', {
				organizationId,
				year,
				months: $state.snapshot(months),
				tolerancePct,
				criticalPct
			});
			view = result;
			applyPlan(result);
			sdk?.ui?.toast(t('settings.leaveUsagePlan.saved', { year }), 'success');
		} catch (err: any) {
			sdk?.ui?.toast(err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		organizationId;
		untrack(() => {
			year = thisYear;
			loadPlan(thisYear);
		});
	});

	// --- Előnézeti görbe ------------------------------------------------------

	const CHART = { width: 360, height: 170, left: 30, right: 10, top: 10, bottom: 24 };

	const chart = $derived.by(() => {
		const valid = months.every((v) => typeof v === 'number' && v >= 0 && v <= 100);
		if (!valid) return null;
		const shares = [0, ...(months as number[])];
		const band =
			typeof tolerancePct === 'number' && tolerancePct > 0 ? (EXAMPLE_DAYS * Math.min(tolerancePct, 100)) / 100 : 0;
		const yMax = Math.ceil((EXAMPLE_DAYS + band) / 5) * 5;
		const plotW = CHART.width - CHART.left - CHART.right;
		const plotH = CHART.height - CHART.top - CHART.bottom;
		const x = (i: number) => CHART.left + (i * plotW) / 12;
		const y = (v: number) => CHART.top + (1 - v / yMax) * plotH;
		const planned = shares.map((s) => EXAMPLE_DAYS * (1 - s / 100));
		const line = planned.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
		const upper = planned.map((v, i) => `${x(i).toFixed(1)},${y(v + band).toFixed(1)}`);
		const lower = planned
			.map((v, i) => `${x(i).toFixed(1)},${y(Math.max(0, v - band)).toFixed(1)}`)
			.reverse();
		return {
			line,
			band: band > 0 ? [...upper, ...lower].join(' ') : null,
			ticks: [0, yMax / 2, yMax].map((v) => ({ value: v, y: y(v) })),
			labels: Array.from({ length: 12 }, (_, i) => ({ x: x(i + 1), text: monthName(i + 1).slice(0, 3) })),
			x0: CHART.left,
			x1: CHART.width - CHART.right
		};
	});

	const december = $derived(months[11]);
</script>

<div class="usage-plan">
	<div class="toolbar">
		<label class="year-field">
			<span>{t('settings.leaveUsagePlan.year')}</span>
			<select class="input" value={year} onchange={selectYear} disabled={loading || saving}>
				{#each years as y (y)}
					<option value={y}>{y}</option>
				{/each}
			</select>
		</label>
		{#if view?.closed}
			<span class="badge">{t('settings.leaveUsagePlan.closedBadge')}</span>
		{/if}
		<div class="toolbar-actions">
			<button class="btn-secondary btn-sm" onclick={fillUniform} disabled={loading || readOnly}>
				{t('settings.leaveUsagePlan.uniform')}
			</button>
			<button class="btn-secondary btn-sm" onclick={copyPrevious} disabled={loading || readOnly || copying}>
				{t('settings.leaveUsagePlan.copyPrevious', { year: year - 1 })}
			</button>
		</div>
	</div>

	{#if loading}
		<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
	{:else if view}
		{#if view.closed}
			<p class="notice">{t('settings.leaveUsagePlan.closedHint')}</p>
		{:else if view.source === 'inherited'}
			<p class="notice">{t('settings.leaveUsagePlan.inherited', { year: view.inheritedFromYear ?? '' })}</p>
		{:else if view.source === 'default'}
			<p class="notice">{t('settings.leaveUsagePlan.default')}</p>
		{/if}

		<div class="body">
			<div class="grid-scroll">
				<table class="plan-grid">
					<thead>
						<tr>
							<th>{t('settings.leaveUsagePlan.columnMonth')}</th>
							<th>{t('settings.leaveUsagePlan.columnTarget')}</th>
							<th class="num">{t('settings.leaveUsagePlan.columnIncrement')}</th>
							<th class="num">{t('settings.leaveUsagePlan.columnExample', { days: EXAMPLE_DAYS })}</th>
						</tr>
					</thead>
					<tbody>
						{#each months as _, i (i)}
							{@const error = monthError(i + 1)}
							<tr>
								<td>{monthName(i + 1)}</td>
								<td>
									<span class="percent-input">
										<input
											class="input"
											class:invalid={!!error}
											type="number"
											min="0"
											max="100"
											step="1"
											title={error ? errorText(error) : ''}
											aria-label={monthName(i + 1)}
											bind:value={months[i]}
											disabled={readOnly}
										/>
										<span>%</span>
									</span>
								</td>
								<td class="num muted">{increment(i)}</td>
								<td class="num">{example(months[i])}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="side">
				<div class="thresholds">
					<label>
						<span>{t('settings.leaveUsagePlan.tolerance')}</span>
						<span class="percent-input">
							<input
								class="input"
								class:invalid={errors.some((e) => e.field === 'tolerancePct')}
								type="number"
								min="1"
								max="100"
								step="1"
								bind:value={tolerancePct}
								disabled={readOnly}
							/>
							<span>%</span>
						</span>
						<small>{t('settings.leaveUsagePlan.toleranceHint')}</small>
					</label>
					<label>
						<span>{t('settings.leaveUsagePlan.critical')}</span>
						<span class="percent-input">
							<input
								class="input"
								class:invalid={errors.some((e) => e.field === 'criticalPct')}
								type="number"
								min="1"
								max="100"
								step="1"
								bind:value={criticalPct}
								disabled={readOnly}
							/>
							<span>%</span>
						</span>
						<small>{t('settings.leaveUsagePlan.criticalHint')}</small>
					</label>
				</div>
				<p class="hint">{t('settings.leaveUsagePlan.thresholdsHint')}</p>

				<figure class="chart">
					<figcaption>{t('settings.leaveUsagePlan.chartTitle', { days: EXAMPLE_DAYS })}</figcaption>
					{#if chart}
						<svg viewBox="0 0 {CHART.width} {CHART.height}" role="img" aria-label={t('settings.leaveUsagePlan.chartTitle', { days: EXAMPLE_DAYS })}>
							{#each chart.ticks as tick (tick.value)}
								<line class="grid-line" x1={chart.x0} x2={chart.x1} y1={tick.y} y2={tick.y} />
								<text class="axis" x={chart.x0 - 6} y={tick.y + 3} text-anchor="end">{formatDays(tick.value)}</text>
							{/each}
							{#if chart.band}
								<polygon class="band" points={chart.band} />
							{/if}
							<polyline class="planned" points={chart.line} />
							{#each chart.labels as label (label.x)}
								<text class="axis" x={label.x} y={CHART.height - 8} text-anchor="middle">{label.text}</text>
							{/each}
						</svg>
						<div class="legend">
							<span><i class="legend-line"></i>{t('settings.leaveUsagePlan.legendPlan')}</span>
							{#if chart.band}
								<span><i class="legend-band"></i>{t('settings.leaveUsagePlan.legendBand')}</span>
							{/if}
						</div>
					{:else}
						<p class="hint">{t('settings.leaveUsagePlan.chartInvalid')}</p>
					{/if}
				</figure>

				{#if typeof december === 'number' && december < 100 && errors.length === 0}
					<p class="notice">{t('settings.leaveUsagePlan.decemberBelow', { value: december })}</p>
				{/if}
			</div>
		</div>

		{#if errors.length > 0}
			<ul class="errors">
				{#each errors as error, i (i)}
					<li>{errorText(error)}</li>
				{/each}
			</ul>
		{/if}

		{#if !readOnly}
			<div class="save-row">
				{#if dirty}
					<span class="unsaved">{t('settings.leaveUsagePlan.unsaved')}</span>
				{/if}
				<button class="btn-primary" onclick={save} disabled={!canSave}>
					{saving ? t('loading') : t('settings.leaveUsagePlan.save')}
				</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	@import '../../styles/shared.css';

	.usage-plan {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		/* A beállítások oldal szélessége a plugin ablakától függ, nem a képernyőtől */
		container-type: inline-size;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
	}

	.year-field {
		width: 7rem;
	}

	.toolbar-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-left: auto;
	}

	.badge {
		align-self: center;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
	}

	.notice {
		margin: 0;
		padding: 0.625rem 0.875rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-foreground, #0f172a);
	}

	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 360px);
		gap: 1.5rem;
		align-items: start;
	}

	@container (max-width: 760px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.grid-scroll {
		overflow-x: auto;
	}

	.plan-grid {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.plan-grid th {
		text-align: left;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
		padding: 0 0.5rem 0.5rem;
		white-space: nowrap;
	}

	.plan-grid td {
		padding: 0.25rem 0.5rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
		white-space: nowrap;
	}

	.plan-grid .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.muted {
		color: var(--color-muted-foreground, #64748b);
	}

	.percent-input {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.percent-input .input {
		width: 4.5rem;
		text-align: right;
	}

	.input.invalid {
		border-color: var(--color-destructive, #dc2626);
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.thresholds {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.thresholds small,
	.hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
	}

	.chart {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.chart figcaption {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.chart svg {
		width: 100%;
		max-width: 420px;
		height: auto;
		display: block;
	}

	.grid-line {
		stroke: var(--color-border, #e2e8f0);
		stroke-width: 1;
	}

	.axis {
		font-size: 9px;
		fill: var(--color-muted-foreground, #64748b);
	}

	.band {
		fill: var(--color-primary, #4f46e5);
		fill-opacity: 0.12;
	}

	.planned {
		fill: none;
		stroke: var(--color-primary, #4f46e5);
		stroke-width: 2;
		stroke-dasharray: 5 4;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.legend-line {
		width: 1.25rem;
		border-top: 2px dashed var(--color-primary, #4f46e5);
	}

	.legend-band {
		width: 1rem;
		height: 0.625rem;
		border-radius: 2px;
		background: var(--color-primary, #4f46e5);
		opacity: 0.12;
	}

	.errors {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.8125rem;
		color: var(--color-destructive, #dc2626);
	}

	.save-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.save-row .btn-primary {
		margin-left: auto;
	}

	.unsaved {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		font-style: italic;
	}

	:global(.dark) .notice,
	:global(.dark) .badge {
		background: var(--color-muted, oklch(0.269 0 0));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .plan-grid td {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .grid-line {
		stroke: var(--color-border, oklch(1 0 0 / 10%));
	}
</style>
