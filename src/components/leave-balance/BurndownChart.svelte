<!--
	Burn-down grafikon (specs/leave-balance-overview.md, K14, 4.4): tényleges és
	tervezett fennmaradó napok, tűréssáv, a lefoglalt napok utáni folytatás.
	Saját SVG (D16). Összesítve vagy egy kiválasztott dolgozóra.
-->
<script lang="ts">
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import type { BalanceSummary, SeriesPoint } from '../../../server/functions.js';
	import { formatDays, formatSigned } from './format.js';

	let {
		pluginId = 'racona-work',
		summary,
		tolerancePct,
		employeeOptions,
		selectedEmployeeId,
		onSelectEmployee
	}: {
		pluginId?: string;
		summary: BalanceSummary;
		tolerancePct: number;
		employeeOptions: { id: number; name: string }[];
		selectedEmployeeId: number | null;
		onSelectEmployee: (id: number | null) => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);
	const monthName = (m: number) => t(`workCalendar.month.${m - 1}`);

	const HEIGHT = 280;
	const M = { left: 44, right: 16, top: 16, bottom: 30 };

	let width = $state(640);
	let hover = $state<number | null>(null);
	let svgEl = $state<SVGSVGElement | null>(null);

	const chart = $derived(summary.chart);
	const selectedName = $derived(employeeOptions.find((o) => o.id === selectedEmployeeId)?.name ?? null);
	const plotW = $derived(Math.max(120, width - M.left - M.right));
	const plotH = HEIGHT - M.top - M.bottom;

	const scale = $derived.by(() => {
		const values = [...chart.planned, ...chart.bandHigh, ...chart.actual, ...chart.booked].map((p) => p.value);
		const top = Math.max(1, ...values);
		const rough = top / 4;
		const magnitude = 10 ** Math.floor(Math.log10(rough));
		const normalized = rough / magnitude;
		const step = Math.max(1, (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude);
		const max = Math.ceil(top / step) * step;
		const ticks: number[] = [];
		for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
		return { max, ticks };
	});

	const x = (v: number) => M.left + (v / 12) * plotW;
	const y = (v: number) => M.top + (1 - v / scale.max) * plotH;
	const points = (series: SeriesPoint[]) => series.map((p) => `${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

	const bandPoints = $derived(
		[...chart.bandHigh.map((p) => `${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`), ...[...chart.bandLow].reverse().map((p) => `${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`)].join(' ')
	);

	const detail = $derived(hover === null ? null : chart.months[hover - 1]);
	const hoverIsCurrent = $derived(hover !== null && chart.refX !== null && chart.refX > hover - 1 && chart.refX < hover);
	const hoverX = $derived(hover === null ? null : hoverIsCurrent ? (chart.refX as number) : hover);
	const tipLeft = $derived.by(() => {
		if (hoverX === null) return 0;
		const px = x(hoverX);
		return px + 16 + 220 > width ? Math.max(0, px - 236) : px + 16;
	});
	const showEveryOther = $derived(plotW < 420);

	function onMove(event: MouseEvent) {
		if (!svgEl) return;
		const px = event.clientX - svgEl.getBoundingClientRect().left;
		hover = Math.min(12, Math.max(1, Math.ceil(((px - M.left) / plotW) * 12)));
	}
</script>

<div class="chart-card">
	<div class="card-head">
		<div>
			<h3>{t('leaveBalance.chart.title')}</h3>
			<p class="sub">
				{selectedName
					? t('leaveBalance.chart.subtitleEmployee', { name: selectedName })
					: t('leaveBalance.chart.subtitle')}
			</p>
		</div>
		<label class="employee-select">
			<span class="sr-only">{t('leaveBalance.chart.employee')}</span>
			<select
				class="input"
				value={selectedEmployeeId === null ? '' : String(selectedEmployeeId)}
				onchange={(e) => onSelectEmployee(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
			>
				<option value="">{t('leaveBalance.chart.aggregate')}</option>
				{#each employeeOptions as option (option.id)}
					<option value={String(option.id)}>{option.name}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if summary.count === 0}
		<p class="empty-state">{t('leaveBalance.empty')}</p>
	{:else}
		<div class="plot" bind:clientWidth={width}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<svg
				bind:this={svgEl}
				{width}
				height={HEIGHT}
				role="img"
				aria-label={t('leaveBalance.chart.title')}
				onmousemove={onMove}
				onmouseleave={() => (hover = null)}
			>
				{#each scale.ticks as tick (tick)}
					<line class="grid" x1={M.left} x2={M.left + plotW} y1={y(tick)} y2={y(tick)} />
					<text class="axis" x={M.left - 8} y={y(tick) + 4} text-anchor="end">{formatDays(tick, 0)}</text>
				{/each}

				<text class="axis-title" transform="translate(12 {M.top + plotH / 2}) rotate(-90)" text-anchor="middle">
					{t('leaveBalance.chart.axis')}
				</text>

				<polygon class="band" points={bandPoints} />
				<polyline class="planned" points={points(chart.planned)} />
				{#if chart.booked.length > 1}
					<polyline class="booked" points={points(chart.booked)} />
				{/if}
				{#if chart.actual.length > 0}
					<polyline class="actual" points={points(chart.actual)} />
					{#each chart.actual as p (p.x)}
						<circle class="actual-dot" class:ref={p.x === chart.refX} cx={x(p.x)} cy={y(p.value)} r={p.x === chart.refX ? 5 : 3.5} />
					{/each}
				{/if}

				{#if chart.refX !== null}
					<line class="ref" x1={x(chart.refX)} x2={x(chart.refX)} y1={M.top} y2={M.top + plotH} />
				{/if}
				{#if hoverX !== null}
					<line class="guide" x1={x(hoverX)} x2={x(hoverX)} y1={M.top} y2={M.top + plotH} />
				{/if}

				{#each Array.from({ length: 12 }, (_, i) => i + 1) as m (m)}
					{#if !showEveryOther || m % 2 === 1}
						<text class="axis" class:active={hover === m} x={x(m)} y={HEIGHT - 8} text-anchor="middle">
							{monthName(m).slice(0, 3)}
						</text>
					{/if}
				{/each}
			</svg>

			{#if detail && hoverX !== null}
				<div class="tooltip" style="left: {tipLeft}px">
					<strong>{monthName(detail.month)} · {hoverIsCurrent ? t('leaveBalance.chart.today') : t('leaveBalance.chart.monthEnd')}</strong>
					{#if detail.actual !== null}
						<span class="row"><i class="swatch actual"></i>{t('leaveBalance.chart.actual')}: <b>{t('leaveBalance.kpi.days', { value: formatDays(detail.actual) })}</b></span>
					{/if}
					<span class="row"><i class="swatch planned"></i>{t('leaveBalance.chart.planned')}: {t('leaveBalance.kpi.days', { value: formatDays(detail.planned) })}</span>
					{#if detail.actual !== null}
						{@const diff = detail.actual - detail.planned}
						<span class="row diff">
							{t('leaveBalance.kpi.days', { value: formatSigned(diff) })}
							({diff > 0.05 ? t('leaveBalance.chart.more') : diff < -0.05 ? t('leaveBalance.chart.less') : t('leaveBalance.chart.equal')})
						</span>
					{/if}
					{#if detail.booked !== null}
						<span class="row"><i class="swatch booked"></i>{t('leaveBalance.chart.booked')}: {t('leaveBalance.kpi.days', { value: formatDays(detail.booked) })}</span>
					{/if}
				</div>
			{/if}
		</div>

		<div class="legend">
			<span><i class="swatch actual"></i>{t('leaveBalance.chart.actualLegend')}</span>
			<span><i class="swatch planned"></i>{t('leaveBalance.chart.plannedLegend')}</span>
			<span><i class="swatch band"></i>{t('leaveBalance.chart.bandLegend', { pct: tolerancePct })}</span>
			{#if chart.booked.length > 1}
				<span><i class="swatch booked"></i>{t('leaveBalance.chart.bookedLegend')}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	@import '../../styles/shared.css';

	.chart-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
		min-width: 0;
	}

	.card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}

	.sub {
		margin: 0.125rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.employee-select {
		min-width: 12rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	/* A szélességet a kártya adja, nem az SVG: különben a mért szélesség nem csökken */
	.plot {
		position: relative;
		width: 100%;
		overflow: hidden;
	}

	svg {
		display: block;
	}

	.grid {
		stroke: var(--color-border, #e2e8f0);
		stroke-width: 1;
	}

	.axis {
		font-size: 11px;
		fill: var(--color-muted-foreground, #64748b);
	}

	.axis.active {
		fill: var(--color-foreground, #0f172a);
		font-weight: 600;
	}

	.axis-title {
		font-size: 11px;
		fill: var(--color-muted-foreground, #64748b);
	}

	.band {
		fill: #2563eb;
		fill-opacity: 0.08;
	}

	.planned {
		fill: none;
		stroke: #64748b;
		stroke-width: 2;
		stroke-dasharray: 6 5;
	}

	.booked {
		fill: none;
		stroke: #2563eb;
		stroke-opacity: 0.5;
		stroke-width: 2;
		stroke-dasharray: 2 4;
		stroke-linecap: round;
	}

	.actual {
		fill: none;
		stroke: #2563eb;
		stroke-width: 2.5;
		stroke-linejoin: round;
	}

	.actual-dot {
		fill: #2563eb;
	}

	.actual-dot.ref {
		stroke: var(--color-card, #ffffff);
		stroke-width: 2;
	}

	.ref {
		stroke: #2563eb;
		stroke-opacity: 0.4;
		stroke-dasharray: 3 3;
	}

	.guide {
		stroke: var(--color-muted-foreground, #94a3b8);
		stroke-width: 1;
	}

	.tooltip {
		position: absolute;
		top: 1rem;
		width: 220px;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
		box-shadow: 0 6px 20px rgb(15 23 42 / 0.12);
		font-size: 0.8125rem;
		pointer-events: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.diff {
		color: var(--color-muted-foreground, #64748b);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem 1.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.swatch {
		display: inline-block;
		flex-shrink: 0;
		width: 1.25rem;
	}

	.swatch.actual {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 999px;
		background: #2563eb;
	}

	.swatch.planned {
		border-top: 2px dashed #64748b;
	}

	.swatch.band {
		height: 0.75rem;
		border-radius: 3px;
		background: rgb(37 99 235 / 0.12);
	}

	.swatch.booked {
		border-top: 2px dotted rgb(37 99 235 / 0.6);
	}

	:global(.dark) .chart-card,
	:global(.dark) .tooltip {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .grid {
		stroke: var(--color-border, oklch(1 0 0 / 10%));
	}
</style>
