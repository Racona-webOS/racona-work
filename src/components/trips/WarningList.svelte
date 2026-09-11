<script lang="ts">
	/**
	 * A rendelvény hiányzó adatai (K15). A HR-nek közvetlen link a pótláshoz,
	 * a dolgozónak az, hogy kitől kérje. A NAV-ár és a fogyasztás hiánya
	 * blokkolja a jóváhagyást, ezért ezek pirosak.
	 */
	import type { SettlementWarning } from '../../../server/functions.js';
	import { blocksApproval } from '../../../server/trip-calc.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { warningText } from './format.js';

	let {
		pluginId = 'racona-work',
		warnings,
		employeeId = null,
		/** HR nézet: pótlási linkekkel. */
		manager = false,
		compact = false
	}: {
		pluginId?: string;
		warnings: SettlementWarning[];
		employeeId?: number | null;
		manager?: boolean;
		compact?: boolean;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);
	const locale = $derived(sdk?.i18n?.locale ?? 'hu');

	const blocking = $derived(warnings.filter(blocksApproval));
	const others = $derived(warnings.filter((w) => !blocksApproval(w)));
	const employeeHint = $derived(others.some((w) => w.kind === 'employee_field' || w.kind === 'organization_field'));

	function fix(w: SettlementWarning) {
		if (w.kind === 'employee_field' && employeeId) sdk?.ui?.navigateTo?.('EmployeeDetail', { employeeId });
		else if (w.kind === 'organization_field') sdk?.ui?.navigateTo?.('Organizations', {});
		else if (w.kind === 'missing_fuel_price') sdk?.ui?.navigateTo?.('TripSettings', {});
		else if (w.kind === 'missing_consumption') sdk?.ui?.navigateTo?.('TripVehicles', {});
	}

	const fixable = (w: SettlementWarning) => manager && w.kind !== 'missing_ordered_by';
</script>

{#if warnings.length > 0}
	<div class="warnings" class:compact>
		{#if blocking.length > 0}
			<ul class="blocking">
				{#each blocking as w, i (i)}
					<li>
						<span>{warningText(t, w, locale)}</span>
						{#if fixable(w)}<button type="button" class="fix" onclick={() => fix(w)}>{t('trips.warning.fix')}</button>{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if others.length > 0}
			<div class="missing">
				<strong>{t('trips.warning.title')}</strong>
				<ul>
					{#each others as w, i (i)}
						<li>
							<span>{warningText(t, w, locale)}</span>
							{#if fixable(w)}<button type="button" class="fix" onclick={() => fix(w)}>{t('trips.warning.fix')}</button>{/if}
						</li>
					{/each}
				</ul>
				{#if !manager && employeeHint}<p class="hint">{t('trips.warning.askHr')}</p>{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.warnings {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	ul {
		margin: 0;
		padding-left: 1.1rem;
	}

	li {
		margin: 0.1rem 0;
	}

	.blocking {
		list-style: none;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
	}

	.missing {
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: #fef3c7;
		color: #92400e;
	}

	.compact .missing ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1rem;
	}

	.hint {
		margin: 0.35rem 0 0;
		font-style: italic;
	}

	.fix {
		margin-left: 0.5rem;
		border: none;
		background: transparent;
		padding: 0;
		font-size: 0.75rem;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	:global(.dark) .missing {
		background: oklch(0.3 0.05 60);
		color: #fde68a;
	}

	:global(.dark) .blocking {
		background: rgba(220, 38, 38, 0.12);
		border-color: rgba(220, 38, 38, 0.3);
		color: #fca5a5;
	}
</style>
