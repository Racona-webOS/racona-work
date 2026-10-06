<!--
	A szabadságnaptár táblázatos összesítője (specs/leave-days.md, K18): a naptár
	alatt dolgozónként a jóváhagyott napok típusonként, összesen és a függő napok;
	éves nézetben a keret és a maradék. XLSX exporttal. Csak jóváhagyóknak.
-->
<script lang="ts">
	import type { LeaveCalendarDay, LeaveCalendarPendingDay } from '../../../server/functions.js';
	import { LEAVE_TYPES } from '../../../server/leave-types.js';
	import { summarizeLeave, visibleLeaveTypes } from '../../lib/leave-summary.js';
	import type { LeaveSummaryCounts } from '../../lib/leave-summary.js';
	import { buildXlsx } from '../../lib/xlsx-writer.js';
	import type { XlsxCell } from '../../lib/xlsx-writer.js';
	import { downloadBytes } from '../../utils/download.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		employees,
		days,
		pending,
		allowances,
		showBalance,
		period,
		fileName
	}: {
		pluginId?: string;
		employees: { id: number; name: string }[];
		days: LeaveCalendarDay[];
		pending: LeaveCalendarPendingDay[];
		/** Éves nézetben dolgozónként az éves keret; null, amíg nincs betöltve. */
		allowances: ReadonlyMap<number, number> | null;
		showBalance: boolean;
		/** Az időszak a címben és az exportban, pl. „2026. szeptember”. */
		period: string;
		/** Az export fájlneve kiterjesztés nélkül. */
		fileName: string;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const summary = $derived(summarizeLeave({ employees, days, pending, allowances: showBalance ? allowances : null }));
	const types = $derived(visibleLeaveTypes(summary));
	const showUnknown = $derived(summary.totals.unknown > 0);

	const typeLabel = (type: string) => t(`leaveRequests.type.${type}`);
	const days0 = (n: number) => (n === 0 ? '' : String(n));
	const nullable = (n: number | null) => (n === null ? '—' : String(n));

	let exporting = $state(false);

	function exportXlsx() {
		exporting = true;
		try {
			const header = [
				t('leaveSummary.columns.employee'),
				...LEAVE_TYPES.map(typeLabel),
				...(showUnknown ? [t('leaveSummary.columns.unknown')] : []),
				t('leaveSummary.columns.total'),
				t('leaveSummary.columns.pending'),
				...(showBalance ? [t('leaveSummary.columns.allowance'), t('leaveSummary.columns.remaining')] : [])
			];
			const cells = (c: LeaveSummaryCounts): XlsxCell[] => [
				...LEAVE_TYPES.map((type) => c.byType[type]),
				...(showUnknown ? [c.unknown] : []),
				c.total,
				c.pending,
				...(showBalance ? [c.allowance, c.remaining] : [])
			];
			const bytes = buildXlsx({
				name: t('leaveSummary.sheetName'),
				title: t('leaveSummary.exportTitle', { period }),
				header,
				rows: summary.rows.map((row) => [row.name, ...cells(row)]),
				footer: [t('leaveSummary.columns.totalRow'), ...cells(summary.totals)],
				columnWidths: [30, ...header.slice(1).map((h) => Math.max(10, Math.min(24, h.length + 2)))]
			});
			downloadBytes(bytes, `${fileName}.xlsx`);
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			exporting = false;
		}
	}
</script>

<section class="summary">
	<div class="summary-head">
		<div>
			<h3>{t('leaveSummary.title', { period })}</h3>
			<p class="hint">
				{showBalance ? t('leaveSummary.hintYear') : t('leaveSummary.hint')}
			</p>
		</div>
		<button class="btn-secondary btn-sm" onclick={exportXlsx} disabled={exporting || summary.rows.length === 0}>
			{t('leaveSummary.export')}
		</button>
	</div>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="col-name">{t('leaveSummary.columns.employee')}</th>
					{#each types as type (type)}
						<th class="num">{typeLabel(type)}</th>
					{/each}
					{#if showUnknown}
						<th class="num">{t('leaveSummary.columns.unknown')}</th>
					{/if}
					<th class="num strong">{t('leaveSummary.columns.total')}</th>
					<th class="num">{t('leaveSummary.columns.pending')}</th>
					{#if showBalance}
						<th class="num">{t('leaveSummary.columns.allowance')}</th>
						<th class="num">{t('leaveSummary.columns.remaining')}</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each summary.rows as row (row.employeeId)}
					<tr class:is-empty={row.total === 0 && row.pending === 0}>
						<td class="col-name">{row.name}</td>
						{#each types as type (type)}
							<td class="num">{days0(row.byType[type])}</td>
						{/each}
						{#if showUnknown}
							<td class="num">{days0(row.unknown)}</td>
						{/if}
						<td class="num strong">{row.total}</td>
						<td class="num muted">{days0(row.pending)}</td>
						{#if showBalance}
							<td class="num">{allowances ? nullable(row.allowance) : '…'}</td>
							<td class="num strong" class:negative={(row.remaining ?? 0) < 0}>
								{allowances ? nullable(row.remaining) : '…'}
							</td>
						{/if}
					</tr>
				{:else}
					<tr class="empty-row">
						<td colspan="99">{t('leaveSummary.empty')}</td>
					</tr>
				{/each}
			</tbody>
			{#if summary.rows.length > 1}
				<tfoot>
					<tr>
						<td class="col-name">{t('leaveSummary.columns.totalRow')}</td>
						{#each types as type (type)}
							<td class="num">{summary.totals.byType[type]}</td>
						{/each}
						{#if showUnknown}
							<td class="num">{summary.totals.unknown}</td>
						{/if}
						<td class="num">{summary.totals.total}</td>
						<td class="num">{summary.totals.pending}</td>
						{#if showBalance}
							<td class="num">{allowances ? nullable(summary.totals.allowance) : '…'}</td>
							<td class="num">{allowances ? nullable(summary.totals.remaining) : '…'}</td>
						{/if}
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>
</section>

<style>
	@import '../../styles/shared.css';

	.summary {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 0.5rem;
		min-width: 0;
	}

	.summary-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.hint {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	/* position: az esetleges abszolút elemek is a görgethető dobozon belül maradjanak */
	.table-wrap {
		position: relative;
		overflow-x: auto;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	th,
	td {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		text-align: left;
		white-space: nowrap;
	}

	th {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
		background: var(--color-muted, #f8fafc);
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.strong {
		font-weight: 600;
	}

	.muted {
		color: var(--color-muted-foreground, #64748b);
	}

	.negative {
		color: #b91c1c;
	}

	.col-name {
		position: sticky;
		left: 0;
		z-index: 1;
		min-width: 12rem;
		background: var(--color-card, #ffffff);
	}

	th.col-name,
	tfoot td.col-name {
		background: var(--color-muted, #f8fafc);
	}

	tr.is-empty td {
		color: var(--color-muted-foreground, #94a3b8);
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	tfoot td {
		font-weight: 600;
		border-top: 1px solid var(--color-border, #e2e8f0);
		border-bottom: none;
		background: var(--color-muted, #f8fafc);
	}

	.empty-row td {
		text-align: center;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .table-wrap,
	:global(.dark) th,
	:global(.dark) td {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .col-name {
		background: var(--color-card, oklch(0.205 0 0));
	}

	:global(.dark) th,
	:global(.dark) th.col-name,
	:global(.dark) tfoot td {
		background: var(--color-muted, oklch(0.269 0 0));
	}

	/* Sötét mód: a világos státuszszínek sötét párjai */
	:global(.dark) .negative {
		color: var(--rw-dark-danger-fg);
	}
</style>
