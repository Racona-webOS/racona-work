<!--
	Trend-vonal a dolgozói táblázatban: az eltérés az elmúlt hónapok végén és ma
	(specs/leave-balance-overview.md, 4.3). A színe a mostani státuszé.
-->
<script lang="ts">
	import type { BalanceStatus } from '../../../server/functions.js';

	let { values, status }: { values: number[]; status: BalanceStatus } = $props();

	const WIDTH = 72;
	const HEIGHT = 22;
	const PAD = 3;

	const geometry = $derived.by(() => {
		const min = Math.min(0, ...values);
		const max = Math.max(0, ...values);
		const range = max - min || 1;
		const y = (v: number) => PAD + (1 - (v - min) / range) * (HEIGHT - 2 * PAD);
		const step = values.length > 1 ? (WIDTH - 2 * PAD) / (values.length - 1) : 0;
		const points = values.map((v, i) => ({ x: PAD + i * step, y: y(v) }));
		return { points, zero: y(0) };
	});
</script>

<svg class="sparkline status-{status}" width={WIDTH} height={HEIGHT} viewBox="0 0 {WIDTH} {HEIGHT}" aria-hidden="true">
	<line class="zero" x1={PAD} x2={WIDTH - PAD} y1={geometry.zero} y2={geometry.zero} />
	{#if geometry.points.length > 1}
		<polyline points={geometry.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
	{/if}
	{#if geometry.points.length > 0}
		{@const last = geometry.points[geometry.points.length - 1]}
		<circle cx={last.x} cy={last.y} r="2" />
	{/if}
</svg>

<style>
	.sparkline {
		display: block;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.zero {
		stroke: var(--color-border, #e2e8f0);
		stroke-width: 1;
	}

	polyline {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linejoin: round;
	}

	circle {
		fill: currentColor;
	}

	.status-ok {
		color: #16a34a;
	}

	.status-slightly_high {
		color: #d97706;
	}

	.status-too_high {
		color: #dc2626;
	}

	.status-fast {
		color: #2563eb;
	}
</style>
