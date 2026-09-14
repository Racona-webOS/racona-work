<!--
	A Szabadság egyenleg oldal mutatói (specs/leave-balance-overview.md, K13, 4.4).
-->
<script lang="ts">
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import type { BalanceSummary } from '../../../server/functions.js';
	import { formatDays } from './format.js';

	let { pluginId = 'racona-work', summary }: { pluginId?: string; summary: BalanceSummary } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const change = $derived(
		summary.previousMonthRemaining === null ? null : summary.remaining - summary.previousMonthRemaining
	);
</script>

<div class="kpis">
	<div class="kpi">
		<span class="icon green" aria-hidden="true">
			<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" /></svg>
		</span>
		<div class="body">
			<span class="label">{t('leaveBalance.kpi.remaining')}</span>
			<strong class="value">{t('leaveBalance.kpi.days', { value: formatDays(summary.remaining) })}</strong>
			{#if change !== null}
				<span class="hint" class:down={change < 0} class:up={change > 0}>
					{change < 0
						? `↓ ${t('leaveBalance.kpi.remainingLess', { days: formatDays(-change) })}`
						: change > 0
							? `↑ ${t('leaveBalance.kpi.remainingMore', { days: formatDays(change) })}`
							: t('leaveBalance.kpi.remainingSame')}
				</span>
			{/if}
		</div>
	</div>

	<div class="kpi">
		<span class="icon blue" aria-hidden="true">
			<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.3 2.5 3.5 5.2" /></svg>
		</span>
		<div class="body">
			<span class="label">{t('leaveBalance.kpi.employees')}</span>
			<strong class="value">{t('leaveBalance.kpi.people', { value: summary.count })}</strong>
			<span class="hint">
				{t('leaveBalance.kpi.okCount', { count: summary.okCount })}
				<span class="sep">|</span>
				{t('leaveBalance.kpi.attentionCount', { count: summary.attentionCount })}
			</span>
		</div>
	</div>

	<div class="kpi">
		<span class="icon purple" aria-hidden="true">
			<svg viewBox="0 0 24 24"><path d="M21 12A9 9 0 1 1 12 3v9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></svg>
		</span>
		<div class="body">
			<span class="label">{t('leaveBalance.kpi.usage')}</span>
			<strong class="value">
				{summary.usageRatio === null ? '—' : `${formatDays(summary.usageRatio * 100, 0)}%`}
			</strong>
			<span class="hint">
				{t('leaveBalance.kpi.usageHint', { taken: formatDays(summary.taken), total: formatDays(summary.totalDays) })}
			</span>
		</div>
	</div>

	<div class="kpi">
		<span class="icon amber" aria-hidden="true">
			<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
		</span>
		<div class="body">
			<span class="label">{t('leaveBalance.kpi.average')}</span>
			<strong class="value">
				{summary.averageRemaining === null
					? '—'
					: t('leaveBalance.kpi.days', { value: formatDays(summary.averageRemaining) })}
			</strong>
			{#if summary.averagePlanned !== null}
				<span class="hint" title={t('leaveBalance.kpi.averageInfo')}>
					{t('leaveBalance.kpi.averageTarget', { days: formatDays(summary.averagePlanned) })}
					<span class="info" aria-label={t('leaveBalance.kpi.averageInfo')}>ⓘ</span>
				</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.kpis {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
		container-type: inline-size;
	}

	@media (max-width: 1100px) {
		.kpis {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 560px) {
		.kpis {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.kpi {
		display: flex;
		gap: 0.875rem;
		align-items: flex-start;
		padding: 1rem 1.125rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
		min-width: 0;
	}

	.icon {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
	}

	.icon svg {
		width: 1.25rem;
		height: 1.25rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.green {
		color: #16a34a;
		background: rgb(22 163 74 / 0.12);
	}

	.blue {
		color: #2563eb;
		background: rgb(37 99 235 / 0.12);
	}

	.purple {
		color: #7c3aed;
		background: rgb(124 58 237 / 0.12);
	}

	.amber {
		color: #d97706;
		background: rgb(217 119 6 / 0.12);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.label {
		font-size: 0.8125rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.value {
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.2;
		white-space: nowrap;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.hint.down {
		color: #16a34a;
	}

	.hint.up {
		color: #d97706;
	}

	.sep {
		margin: 0 0.25rem;
		opacity: 0.5;
	}

	.info {
		cursor: help;
	}

	:global(.dark) .kpi {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}
</style>
