<!--
	A számított szabadságkeret tételes bontása: tételek, arányosítás, korrekció,
	végösszeg és a számítás figyelmeztetései. A dolgozó adatlapja, a keret
	létrehozása és a saját irányítópult is ezt használja.
-->
<script lang="ts">
	import type { EntitlementItem, EntitlementResult } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { balanceTotal } from '../../../server/leave-entitlement.js';
	import { formatDate } from '../../utils/format.js';

	let {
		pluginId = 'racona-work',
		result,
		adjustmentDays = 0,
		adjustmentNote = null,
		carriedOverDays = 0,
		carryOverDeadline = null,
		showWarnings = true
	}: {
		pluginId?: string;
		result: EntitlementResult;
		adjustmentDays?: number;
		adjustmentNote?: string | null;
		carriedOverDays?: number;
		/** Az áthozott napok határideje (Mt. 123. §). */
		carryOverDeadline?: string | null;
		showWarnings?: boolean;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const proration = $derived(result.totalDays - result.fullYearDays);
	/** A régebbi (hu-mt@1) pillanatképekben nincs ilyen mező. */
	const nonCounting = $derived(result.nonCountingDays ?? 0);
	const total = $derived(balanceTotal(result.totalDays, adjustmentDays, carriedOverDays));
	/** A korrekció többet vonna le, mint amennyi jár: a keret 0, nem negatív. */
	const floored = $derived(result.totalDays + adjustmentDays + carriedOverDays < 0);

	function itemLabel(item: EntitlementItem): string {
		if (item.code === 'custom') {
			return String(item.params?.note || t('leaveEntitlement.item.customDefault'));
		}
		if (item.code === 'policy') {
			return String(item.params?.label || t('leaveEntitlement.item.policyDefault'));
		}
		return t(`leaveEntitlement.item.${item.code}`, item.params);
	}

	/** YYYY-MM-DD → helyi dátum, időzóna-csúszás nélkül. */
	function formatDay(day: string): string {
		return formatDate(day);
	}

	/** Előjeles szám, valódi mínuszjellel. */
	function signed(n: number): string {
		if (n > 0) return `+${n}`;
		if (n < 0) return `−${Math.abs(n)}`;
		return '0';
	}
</script>

<dl class="breakdown">
	{#each result.items as item, i (i)}
		<div class="row">
			<dt>
				{itemLabel(item)}
				{#if item.legalRef}<span class="ref">{item.legalRef}</span>{/if}
			</dt>
			<dd>{i === 0 ? item.days : signed(item.days)}</dd>
		</div>
	{/each}

	{#if proration !== 0 || result.employedDays !== result.daysInYear || nonCounting > 0}
		<div class="row">
			<dt>
				{nonCounting > 0
					? t('leaveEntitlement.breakdown.prorationWithAbsences', {
							employed: result.employedDays,
							yearDays: result.daysInYear,
							nonCounting
						})
					: t('leaveEntitlement.breakdown.proration', {
							employed: result.employedDays,
							yearDays: result.daysInYear
						})}
				<span class="ref">{nonCounting > 0 ? 'Mt. 115., 121. §' : 'Mt. 121. §'}</span>
			</dt>
			<dd>{signed(proration)}</dd>
		</div>
	{/if}

	<div class="row subtotal">
		<dt>{t('leaveEntitlement.breakdown.calculated')}</dt>
		<dd>{result.totalDays}</dd>
	</div>

	{#if adjustmentDays !== 0}
		<div class="row">
			<dt>
				{t('leaveEntitlement.breakdown.adjustment')}
				{#if adjustmentNote}<span class="note">{adjustmentNote}</span>{/if}
			</dt>
			<dd>{signed(adjustmentDays)}</dd>
		</div>
	{/if}
	{#if carriedOverDays !== 0}
		<div class="row">
			<dt>
				{t('leaveEntitlement.breakdown.carriedOver')}
				{#if carryOverDeadline}
					<span class="note">{t('carryOver.deadline.until', { date: formatDay(carryOverDeadline) })}</span>
				{/if}
				<span class="ref">Mt. 123. §</span>
			</dt>
			<dd>{signed(carriedOverDays)}</dd>
		</div>
	{/if}
	{#if adjustmentDays !== 0 || carriedOverDays !== 0}
		<div class="row total">
			<dt>
				{t('leaveEntitlement.breakdown.total')}
				{#if floored}<span class="note">{t('leaveEntitlement.breakdown.floored')}</span>{/if}
			</dt>
			<dd>{total}</dd>
		</div>
	{/if}
</dl>

{#if showWarnings && result.warnings.length > 0}
	<ul class="warnings">
		{#each result.warnings as warning (warning.code)}
			<li>{t(`leaveEntitlement.warning.${warning.code}`, warning.params)}</li>
		{/each}
	</ul>
{/if}

<style>
	.breakdown {
		margin: 0;
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
	}

	.row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		padding: 0.3rem 0;
	}

	dt {
		color: var(--color-foreground, #0f172a);
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
	}

	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		font-weight: 500;
		white-space: nowrap;
	}

	.ref {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.note {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		font-style: italic;
	}

	.subtotal,
	.total {
		border-top: 1px solid var(--color-border, #e2e8f0);
		margin-top: 0.25rem;
		padding-top: 0.45rem;
		font-weight: 600;
	}

	.subtotal dd,
	.total dd {
		font-weight: 700;
	}

	.warnings {
		margin: 0.5rem 0 0;
		padding: 0.5rem 0.75rem 0.5rem 1.75rem;
		border-radius: 0.375rem;
		background: #fef3c7;
		color: #92400e;
		font-size: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	:global(.dark) .subtotal,
	:global(.dark) .total {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) dt {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .warnings {
		background: oklch(0.3 0.05 60);
		color: #fde68a;
	}
</style>
