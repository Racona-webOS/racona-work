<script lang="ts">
	/**
	 * Egy havi rendelvény részletei (K10–K12): a nyomtatvány képernyős változata,
	 * a hiányzó adatok, és az állapottól és jogtól függő műveletek. A jóváhagyó az
	 * elrendelőt soronként vagy minden sorra felülbírálhatja (D14, D21).
	 */
	import { onMount } from 'svelte';
	import type { SettlementDocument, SettlementKey } from '../../../server/functions.js';
	import { blocksApproval } from '../../../server/trip-calc.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import WarningList from './WarningList.svelte';
	import { errorMessage, formatDateTime, formatDay, formatDecimal, formatHuf, formatKm, statusLabel } from './format.js';
	import { printSettlement } from './settlement-print.js';
	import { downloadSettlementXlsx } from './settlement-xlsx.js';

	let {
		pluginId = 'racona-work',
		settlementId = null,
		settlementKey = null,
		canApprove = false,
		canManage = false,
		isOwner = false,
		orderers = [],
		onChanged,
		onClose
	}: {
		pluginId?: string;
		settlementId?: number | null;
		settlementKey?: SettlementKey | null;
		canApprove?: boolean;
		canManage?: boolean;
		/** A hívó a rendelvény dolgozója (visszavonás, beküldés). */
		isOwner?: boolean;
		orderers?: { userId: number; name: string }[];
		onChanged?: () => void;
		onClose: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let doc = $state<SettlementDocument | null>(null);
	let loading = $state(true);
	let busy = $state(false);
	let paidAt = $state(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date()));

	const status = $derived(doc?.status ?? null);
	const editableOrderer = $derived(canApprove && (status === null || status === 'draft' || status === 'submitted'));
	const blocked = $derived((doc?.warnings ?? []).some(blocksApproval));
	const canSubmit = $derived((isOwner || canManage) && (status === null || status === 'draft') && (doc?.rows.length ?? 0) > 0);

	onMount(load);

	async function load() {
		loading = true;
		try {
			doc = await sdk.remote.call('getSettlementDocument', settlementId ? { id: settlementId } : settlementKey);
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.loadFailed')), 'error');
			onClose();
		} finally {
			loading = false;
		}
	}

	async function run(fn: string, params: Record<string, unknown>, successKey: string) {
		busy = true;
		try {
			doc = await sdk.remote.call(fn, params);
			sdk?.ui?.toast(t(successKey), 'success');
			onChanged?.();
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			busy = false;
		}
	}

	async function askNote(titleKey: string, messageKey: string): Promise<string | null> {
		const result = await sdk?.ui?.dialog?.({
			type: 'prompt',
			title: t(titleKey),
			message: t(messageKey),
			confirmLabel: t(titleKey)
		});
		if (!result || result.action !== 'confirm') return null;
		const note = (result.value ?? '').trim();
		if (!note) {
			sdk?.ui?.toast(t('trips.settlement.noteRequired'), 'error');
			return null;
		}
		return note;
	}

	function submit() {
		if (!doc) return;
		run('submitSettlement', { employeeId: doc.employee.id, vehicleId: doc.vehicle.id, year: doc.year, month: doc.month }, 'trips.settlement.submitted');
	}

	async function withdraw() {
		if (doc?.settlementId) await run('withdrawSettlement', { id: doc.settlementId }, 'trips.settlement.withdrawn');
	}

	async function approve() {
		if (doc?.settlementId) await run('decideSettlement', { id: doc.settlementId, decision: 'approve' }, 'trips.settlement.approved');
	}

	async function returnToEmployee() {
		if (!doc?.settlementId) return;
		const note = await askNote('trips.settlement.return', 'trips.settlement.returnPrompt');
		if (note) await run('decideSettlement', { id: doc.settlementId, decision: 'return', note }, 'trips.settlement.returned');
	}

	async function markPaid() {
		if (doc?.settlementId) await run('markSettlementPaid', { id: doc.settlementId, paidAt }, 'trips.settlement.paid');
	}

	async function reopen() {
		if (!doc?.settlementId) return;
		const note = await askNote('trips.settlement.reopen', 'trips.settlement.reopenPrompt');
		if (note) await run('reopenSettlement', { id: doc.settlementId, note }, 'trips.settlement.reopened');
	}

	async function setOrderer(tripIds: number[], value: string) {
		busy = true;
		try {
			await sdk.remote.call('setTripOrderedBy', { tripIds, orderedByUserId: value ? Number(value) : null });
			await load();
			onChanged?.();
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			busy = false;
		}
	}

	let bulkOrderer = $state('');

	function print() {
		if (!doc) return;
		printSettlement(doc, { watermark: doc.status === 'approved' || doc.status === 'paid' ? undefined : t('trips.settlement.notSubmittedWatermark') });
	}

	async function xlsx() {
		if (!doc) return;
		try {
			await downloadSettlementXlsx(sdk, doc);
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('trips.settlement.xlsxFailed')), 'error');
		}
	}
</script>

<div class="modal-overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="modal settlement-modal" role="dialog" aria-modal="true" aria-labelledby="settlement-title">
		<div class="modal-header">
			<div>
				<h3 id="settlement-title">{t('trips.settlement.title')}{doc ? ` — ${doc.periodLabel}` : ''}</h3>
				{#if doc}
					<p class="sub">
						{doc.employee.name} · {doc.vehicle.plate} · <span class="status status-{status ?? 'none'}">{statusLabel(t, status)}</span>
						{#if doc.documentNumber}· {doc.documentNumber}{:else if status !== 'approved' && status !== 'paid'}· {t('trips.settlement.numberOnApproval')}{/if}
					</p>
				{/if}
			</div>
			<button class="modal-close" onclick={onClose} aria-label={t('form.cancel')}>×</button>
		</div>

		<div class="modal-body">
			{#if loading || !doc}
				<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
			{:else}
				{#if doc.note && (status === 'draft' || status === null)}
					<div class="note-box"><strong>{t('trips.settlement.noteLabel')}</strong> {doc.note}</div>
				{/if}

				<WarningList {pluginId} warnings={doc.warnings} employeeId={doc.employee.id} manager={canApprove || canManage} />

				<div class="doc-head">
					<div>
						<span class="muted">{t('trips.settlement.employer')}</span>
						<div>{doc.employer.name}</div>
						<div class="muted">{doc.employer.address ?? '—'} · {t('trips.field.org_tax_number')}: {doc.employer.taxNumber ?? '—'}</div>
					</div>
					<div>
						<span class="muted">{t('trips.settlement.employee')}</span>
						<div>{doc.employee.name}</div>
						<div class="muted">{doc.employee.address ?? '—'}</div>
					</div>
					<div>
						<span class="muted">{t('trips.settlement.vehicle')}</span>
						<div>{doc.vehicle.plate} · {doc.vehicle.model}</div>
						<div class="muted">
							{formatDecimal(doc.calc.consumption)} {doc.calc.unit}/100 km · {t('trips.settlement.rate')}:
							{doc.calc.ratePerKm !== null ? `${doc.calc.ratePerKm.toLocaleString('hu-HU', { maximumFractionDigits: 2 })} Ft/km` : '—'}
						</div>
					</div>
				</div>

				{#if editableOrderer && doc.rows.length > 1}
					<div class="bulk">
						<span>{t('trips.settlement.bulkOrderer')}</span>
						<select class="input" bind:value={bulkOrderer} disabled={busy}>
							<option value="">{t('trips.form.noOrderer')}</option>
							{#each orderers as o (o.userId)}<option value={String(o.userId)}>{o.name}</option>{/each}
						</select>
						<button class="btn-secondary btn-sm" disabled={busy} onclick={() => doc && setOrderer(doc.rows.map((r) => r.tripId), bulkOrderer)}>
							{t('trips.settlement.applyAll')}
						</button>
					</div>
				{/if}

				<div class="table-wrap">
					<table class="doc-table">
						<thead>
							<tr>
								<th>#</th>
								<th>{t('trips.table.when')}</th>
								<th>{t('trips.table.route')}</th>
								<th>{t('trips.form.orderedBy')}</th>
								<th class="r">km</th>
								<th class="r">{t('trips.table.amount')}</th>
							</tr>
						</thead>
						<tbody>
							{#each doc.rows as row (row.tripId)}
								<tr>
									<td>{row.index}</td>
									<td class="nowrap">{formatDateTime(row.startedAt)}<br /><span class="muted">{formatDateTime(row.endedAt)}</span></td>
									<td>
										{row.route}
										{#if row.purpose}<div class="muted">{row.purpose}</div>{/if}
										{#if row.distanceReason}
											<div class="deviation">
												{t('trips.table.deviation', { planned: row.routedKm !== null ? formatKm(row.routedKm) : t('trips.table.manual') })}: {row.distanceReason}
											</div>
										{/if}
									</td>
									<td>
										{#if editableOrderer}
											<select class="input input-sm" disabled={busy} value={row.orderedByUserId === null ? '' : String(row.orderedByUserId)} onchange={(e) => setOrderer([row.tripId], (e.currentTarget as HTMLSelectElement).value)}>
												<option value="">—</option>
												{#each orderers as o (o.userId)}<option value={String(o.userId)}>{o.name}</option>{/each}
											</select>
										{:else}
											{row.orderedByName ?? '—'}
										{/if}
										{#if row.orderedByOverridden}<span class="badge" title={t('trips.table.overriddenHint')}>{t('trips.table.overridden')}</span>{/if}
									</td>
									<td class="r" class:warn={!!row.distanceReason}>{row.km}</td>
									<td class="r">{formatHuf(row.amount, true)}</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr><td colspan="4" class="r">{t('trips.settlement.subtotal')}</td><td class="r">{doc.calc.totalKm}</td><td class="r">{formatHuf(doc.calc.subtotal, true)}</td></tr>
							<tr><td colspan="5" class="r">{t('trips.settlement.rounding')}</td><td class="r">{formatHuf(doc.calc.rounding, true)}</td></tr>
							<tr class="total"><td colspan="5" class="r">{t('trips.settlement.total')}</td><td class="r">{formatHuf(doc.calc.total)}</td></tr>
						</tfoot>
					</table>
				</div>

				<div class="trail muted">
					{t('trips.settlement.issued')}: {formatDay(doc.issuedOn)}
					{#if doc.approval}· {t('trips.settlement.approvedBy')}: {doc.approval.byName}, {formatDay(doc.approval.at)}{/if}
					{#if doc.payment}· {t('trips.settlement.paidBy')}: {doc.payment.byName}, {formatDay(doc.payment.at)}{/if}
				</div>
			{/if}
		</div>

		<div class="modal-footer">
			<div class="left">
				<button class="btn-secondary" onclick={print} disabled={!doc}>{t('trips.settlement.print')}</button>
				<button class="btn-secondary" onclick={xlsx} disabled={!doc}>{t('trips.settlement.xlsx')}</button>
			</div>
			<div class="right">
				{#if canSubmit}
					<button class="btn-primary" onclick={submit} disabled={busy}>{t('trips.settlement.submit')}</button>
				{/if}
				{#if status === 'submitted' && isOwner}
					<button class="btn-secondary" onclick={withdraw} disabled={busy}>{t('trips.settlement.withdraw')}</button>
				{/if}
				{#if status === 'submitted' && canApprove}
					<button class="btn-secondary" onclick={returnToEmployee} disabled={busy}>{t('trips.settlement.return')}</button>
					<button class="btn-primary" onclick={approve} disabled={busy || blocked} title={blocked ? t('trips.settlement.blockedHint') : ''}>
						{t('trips.settlement.approve')}
					</button>
				{/if}
				{#if status === 'approved' && canManage}
					<button class="btn-secondary" onclick={reopen} disabled={busy}>{t('trips.settlement.reopen')}</button>
					<input class="input input-sm" type="date" bind:value={paidAt} aria-label={t('trips.settlement.paidAt')} />
					<button class="btn-primary" onclick={markPaid} disabled={busy}>{t('trips.settlement.markPaid')}</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	@import '../../styles/shared.css';

	.settlement-modal {
		max-width: 900px;
	}

	.sub {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.doc-head {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		font-size: 0.85rem;
	}

	@media (max-width: 720px) {
		.doc-head {
			grid-template-columns: 1fr;
		}
	}

	.muted {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.8rem;
	}

	.bulk {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.doc-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}

	.doc-table th,
	.doc-table td {
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		text-align: left;
		vertical-align: top;
	}

	.doc-table th {
		font-weight: 500;
		color: var(--color-muted-foreground, #64748b);
	}

	.doc-table tfoot td {
		border-bottom: none;
	}

	.doc-table .total td {
		font-weight: 700;
	}

	.r {
		text-align: right !important;
		white-space: nowrap;
	}

	.nowrap {
		white-space: nowrap;
	}

	.warn {
		color: #b45309;
		font-weight: 600;
	}

	.deviation {
		font-size: 0.75rem;
		color: #b45309;
	}

	.badge {
		display: inline-block;
		margin-left: 0.25rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.7rem;
		background: #e0e7ff;
		color: #3730a3;
	}

	.input-sm {
		padding: 0.25rem 0.4rem;
		font-size: 0.8rem;
	}

	.note-box {
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: #eff6ff;
		color: #1e40af;
		font-size: 0.85rem;
	}

	.trail {
		font-size: 0.75rem;
	}

	.modal-footer {
		justify-content: space-between;
		flex-wrap: wrap;
	}

	.modal-footer .left,
	.modal-footer .right {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.status {
		font-weight: 600;
	}

	.status-submitted {
		color: #b45309;
	}

	.status-approved {
		color: #15803d;
	}

	.status-paid {
		color: #1d4ed8;
	}

	:global(.dark) .note-box {
		background: rgba(59, 130, 246, 0.15);
		color: #bfdbfe;
	}
</style>
