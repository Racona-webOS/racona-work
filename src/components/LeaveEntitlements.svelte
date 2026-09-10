<svelte:options customElement={{ tag: 'racona-work-leave-entitlements', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_LeaveEntitlements = function () {
			return { tagName: 'racona-work-leave-entitlements' };
		};
	}
</script>

<!--
	Éves szabadságkeretek — a HR itt hozza létre egy év kereteit egyben.

	A táblázatban azok az aktív dolgozók szerepelnek, akiknek még nincs keretük
	az évre. Soronként látszik a számított keret és az előző évi maradék; a HR
	megadhatja az áthozatalt és a korrekciót, majd egy gombbal elmenti. A
	számítást a szerver mentéskor a mostani adatokból újra elvégzi.
	Szabályok: specs/leave-entitlement.md
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		BulkEntitlementPreview,
		BulkEntitlementRow,
		Organization
	} from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import { translate } from '../utils/sdk.js';
	import AccessDenied from './AccessDenied.svelte';
	import Checkbox from './ui/Checkbox.svelte';
	import EntitlementBreakdown from './leave-entitlement/EntitlementBreakdown.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived((window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS);
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const thisYear = new Date().getFullYear();
	const YEAR_OPTIONS = [thisYear - 1, thisYear, thisYear + 1];

	// --- Store ---
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let canManage = $state(false);

	function syncFromStore() {
		const store = orgStore ?? (window as any).__racona_work_org_store__;
		if (!store) return;
		currentOrganization = store.currentOrganization;
		hasAccess = store.hasAccess;
		canManage = store.can('leave.balance.manage');
	}

	// --- Állapot ---
	let year = $state(defaultYear());
	let preview = $state<BulkEntitlementPreview | null>(null);
	let loading = $state(false);
	let saving = $state(false);
	let filter = $state<'all' | 'warnings'>('all');
	let expandedId = $state<number | null>(null);

	type RowEdit = { selected: boolean; carryOver: number; adjustment: number; note: string };
	let edits = $state<Record<number, RowEdit>>({});

	/** Év vége felé már a jövő évi kereteket készíti elő a HR. */
	function defaultYear(): number {
		return new Date().getMonth() >= 10 ? thisYear + 1 : thisYear;
	}

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.loadFailed');
	}

	/** A dolgozó adataiból adódó figyelmeztetések, az ellenőrizetlen belépéssel együtt. */
	function rowWarnings(row: BulkEntitlementRow): string[] {
		const texts = row.calculation.warnings.map((w) => t(`leaveEntitlement.warning.${w.code}`, w.params));
		if (!row.hireDateConfirmed) texts.unshift(t('leaveEntitlement.bulk.hireDateUnconfirmed'));
		return texts;
	}

	/** Akiknek az évben nincs munkaviszonya, azokat alapból nem jelöljük ki. */
	function selectedByDefault(row: BulkEntitlementRow): boolean {
		return !row.calculation.warnings.some(
			(w) => w.code === 'not_employed_in_year' || w.code === 'end_before_hire'
		);
	}

	async function load() {
		if (!currentOrganization || !canManage) return;
		loading = true;
		expandedId = null;
		try {
			const result: BulkEntitlementPreview = await sdk.remote.call('previewBulkEntitlements', {
				organizationId: currentOrganization.id,
				year
			});
			preview = result;
			edits = Object.fromEntries(
				result.rows.map((row) => [
					row.employeeId,
					{
						selected: selectedByDefault(row),
						carryOver: row.suggestedCarryOver,
						adjustment: 0,
						note: ''
					}
				])
			);
		} catch (err) {
			preview = null;
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			loading = false;
		}
	}

	const visibleRows = $derived(
		(preview?.rows ?? []).filter((row) => filter === 'all' || rowWarnings(row).length > 0)
	);
	const warningCount = $derived((preview?.rows ?? []).filter((row) => rowWarnings(row).length > 0).length);
	const selectedRows = $derived((preview?.rows ?? []).filter((row) => edits[row.employeeId]?.selected));
	const missingNotes = $derived(
		selectedRows.filter((row) => {
			const e = edits[row.employeeId];
			return (e.adjustment || 0) !== 0 && !e.note.trim();
		}).length
	);
	const allVisibleSelected = $derived(
		visibleRows.length > 0 && visibleRows.every((row) => edits[row.employeeId]?.selected)
	);

	function toggleAllVisible(value: boolean) {
		for (const row of visibleRows) edits[row.employeeId].selected = value;
	}

	function rowTotal(row: BulkEntitlementRow): number {
		const e = edits[row.employeeId];
		return row.calculation.totalDays + (e?.adjustment || 0) + (e?.carryOver || 0);
	}

	async function save() {
		if (!currentOrganization || selectedRows.length === 0 || missingNotes > 0) return;
		saving = true;
		try {
			const result: { created: number; skippedEmployeeIds: number[] } = await sdk.remote.call(
				'applyLeaveEntitlements',
				{
					organizationId: currentOrganization.id,
					year,
					rows: selectedRows.map((row) => {
						const e = edits[row.employeeId];
						return {
							employeeId: row.employeeId,
							carriedOverDays: e.carryOver || 0,
							adjustmentDays: e.adjustment || 0,
							adjustmentNote: e.note
						};
					})
				}
			);
			sdk?.ui?.toast(t('leaveEntitlement.bulk.created', { count: result.created }), 'success');
			if (result.skippedEmployeeIds.length > 0) {
				sdk?.ui?.toast(
					t('leaveEntitlement.bulk.skipped', { count: result.skippedEmployeeIds.length }),
					'warning'
				);
			}
			await load();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			saving = false;
		}
	}

	function openEmployee(employeeId: number) {
		sdk?.ui?.navigateTo?.('EmployeeDetail', { employeeId });
	}

	// --- Inicializálás ---
	onMount(async () => {
		if (!sdk?.remote) return;
		try {
			orgStore = getOrganizationStore();
		} catch {
			orgStore = createOrganizationStore(pluginId, sdk);
		}
		if (orgStore.availableOrganizations.length === 0) await orgStore.loadOrganizations();
		syncFromStore();
	});

	$effect(() => {
		const handleOrgChange = () => syncFromStore();
		const handleCapabilities = (e: Event) => {
			if ((e as CustomEvent).detail?.pluginId === pluginId) syncFromStore();
		};
		window.addEventListener('organization-changed', handleOrgChange);
		window.addEventListener('plugin-capabilities-changed', handleCapabilities);
		return () => {
			window.removeEventListener('organization-changed', handleOrgChange);
			window.removeEventListener('plugin-capabilities-changed', handleCapabilities);
		};
	});

	$effect(() => {
		currentOrganization;
		canManage;
		year;
		untrack(() => {
			if (currentOrganization && canManage && sdk?.remote) load();
		});
	});
</script>

<div class="rw">
	<section class="page">
		{#if !hasAccess || (orgStore && !canManage)}
			<AccessDenied />
		{:else}
			<div class="page-header">
				<div class="page-header-title">
					<h2>{t('leaveEntitlement.bulk.title')}</h2>
					<p class="subtitle">{t('leaveEntitlement.bulk.subtitle')}</p>
				</div>
				<label class="year-select">
					<span>{t('leaveEntitlement.balance.year')}</span>
					<select class="input" bind:value={year}>
						{#each YEAR_OPTIONS as y (y)}
							<option value={y}>{y}</option>
						{/each}
					</select>
				</label>
			</div>

			{#if loading && !preview}
				<div class="loading-state">
					<div class="spinner"></div>
					<span>{t('loading')}</span>
				</div>
			{:else if preview}
				{#if preview.rows.length > 0}
					<div class="toolbar">
						<p class="summary">
							{t('leaveEntitlement.bulk.summary', {
								pending: preview.rows.length,
								existing: preview.existingCount
							})}
						</p>
						<div class="view-toggle">
							<button class="chip" class:active={filter === 'all'} onclick={() => (filter = 'all')}>
								{t('leaveEntitlement.bulk.filterAll')} ({preview.rows.length})
							</button>
							<button
								class="chip"
								class:active={filter === 'warnings'}
								onclick={() => (filter = 'warnings')}
							>
								{t('leaveEntitlement.bulk.filterWarnings')} ({warningCount})
							</button>
						</div>
					</div>
				{/if}

				{#if preview.rows.length === 0}
					<p class="empty-state">
						{preview.existingCount > 0
							? t('leaveEntitlement.bulk.allDone')
							: t('leaveEntitlement.bulk.noEmployees')}
					</p>
				{:else}
					<div class="table-wrap">
						<table class="bulk-table">
							<thead>
								<tr>
									<th class="col-check">
										<Checkbox
											checked={allVisibleSelected}
											onCheckedChange={toggleAllVisible}
											ariaLabel={t('leaveEntitlement.bulk.selectAll')}
										/>
									</th>
									<th class="col-employee">{t('leaveEntitlement.bulk.col.employee')}</th>
									<th class="num">{t('leaveEntitlement.bulk.col.previous', { year: year - 1 })}</th>
									<th class="num">{t('leaveEntitlement.bulk.col.calculated')}</th>
									<th class="num">{t('leaveEntitlement.bulk.col.carryOver')}</th>
									<th class="num">{t('leaveEntitlement.bulk.col.adjustment')}</th>
									<th>{t('leaveEntitlement.bulk.col.note')}</th>
									<th class="num">{t('leaveEntitlement.bulk.col.total')}</th>
								</tr>
							</thead>
							<tbody>
								{#each visibleRows as row (row.employeeId)}
									{@const edit = edits[row.employeeId]}
									{@const warnings = rowWarnings(row)}
									{@const needsNote = (edit.adjustment || 0) !== 0 && !edit.note.trim()}
									<tr class:unselected={!edit.selected}>
										<td class="col-check">
											<Checkbox
												checked={edit.selected}
												onCheckedChange={(v) => (edit.selected = v)}
												ariaLabel={row.userName}
											/>
										</td>
										<td>
											<button class="name-link" onclick={() => openEmployee(row.employeeId)}>
												{row.userName}
											</button>
											{#if row.position || row.department}
												<span class="meta">{[row.position, row.department].filter(Boolean).join(' · ')}</span>
											{/if}
											{#each warnings as warning, i (i)}
												<span class="warning">⚠ {warning}</span>
											{/each}
										</td>
										<td class="num muted">
											{#if row.previousBalance}
												{row.previousBalance.totalDays}
												<span class="sub">
													{t('leaveEntitlement.bulk.remaining', { days: row.previousBalance.remainingDays })}
												</span>
											{:else}
												—
											{/if}
										</td>
										<td class="num">
											<button
												class="calc-link"
												onclick={() => (expandedId = expandedId === row.employeeId ? null : row.employeeId)}
												title={t('leaveEntitlement.balance.breakdown')}
											>
												{row.calculation.totalDays}
												<span class="caret">{expandedId === row.employeeId ? '▾' : '▸'}</span>
											</button>
										</td>
										<td class="num">
											<input
												class="input num-input"
												type="number"
												min="0"
												max="60"
												bind:value={edit.carryOver}
												aria-label={t('leaveEntitlement.bulk.col.carryOver')}
											/>
										</td>
										<td class="num">
											<input
												class="input num-input"
												type="number"
												min="-365"
												max="365"
												bind:value={edit.adjustment}
												aria-label={t('leaveEntitlement.bulk.col.adjustment')}
											/>
										</td>
										<td>
											<input
												class="input note-input"
												class:invalid={edit.selected && needsNote}
												type="text"
												bind:value={edit.note}
												disabled={(edit.adjustment || 0) === 0}
												placeholder={(edit.adjustment || 0) === 0 ? '' : t('leaveEntitlement.adjust.noteRequired')}
												aria-label={t('leaveEntitlement.bulk.col.note')}
											/>
										</td>
										<td class="num total">{rowTotal(row)}</td>
									</tr>
									{#if expandedId === row.employeeId}
										<tr class="breakdown-row">
											<td></td>
											<td colspan="7">
												<div class="breakdown-box">
													<EntitlementBreakdown
														{pluginId}
														result={row.calculation}
														adjustmentDays={edit.adjustment || 0}
														adjustmentNote={edit.note || null}
														carriedOverDays={edit.carryOver || 0}
														showWarnings={false}
													/>
												</div>
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>

					<div class="save-bar">
						<p class="hint">
							{#if missingNotes > 0}
								<span class="invalid-text">{t('leaveEntitlement.bulk.missingNotes', { count: missingNotes })}</span>
							{:else}
								{t('leaveEntitlement.bulk.carryOverHint')}
							{/if}
						</p>
						<button
							class="btn-primary"
							onclick={save}
							disabled={saving || selectedRows.length === 0 || missingNotes > 0}
						>
							{saving ? t('loading') : t('leaveEntitlement.bulk.submit', { count: selectedRows.length })}
						</button>
					</div>
				{/if}
			{/if}
		{/if}
	</section>
</div>

<style>
	@import '../styles/shared.css';

	.page {
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.page-header {
		align-items: flex-end;
		gap: 1rem;
		margin-bottom: 0;
	}

	.year-select {
		min-width: 8rem;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.summary {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
	}

	.bulk-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.bulk-table th,
	.bulk-table td {
		padding: 0.6rem 0.75rem;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.bulk-table th {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
		vertical-align: middle;
	}

	.bulk-table tbody tr:last-child td {
		border-bottom: none;
	}

	.bulk-table .num {
		text-align: right;
		white-space: nowrap;
	}

	.col-check {
		width: 2rem;
	}

	.col-employee {
		min-width: 14rem;
	}

	tr.unselected td:not(.col-check) {
		opacity: 0.5;
	}

	.name-link,
	.calc-link {
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		cursor: pointer;
		color: var(--color-foreground, #0f172a);
	}

	.name-link {
		font-weight: 600;
		text-align: left;
	}

	.name-link:hover,
	.calc-link:hover {
		color: var(--color-primary, #3730a3);
		text-decoration: underline;
	}

	.calc-link {
		font-weight: 600;
	}

	.caret {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.meta,
	.sub {
		display: block;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.warning {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.75rem;
		color: #b45309;
	}

	.muted {
		color: var(--color-muted-foreground, #64748b);
	}

	.num-input {
		width: 4.5rem;
		text-align: right;
		padding: 0.3rem 0.5rem;
	}

	.note-input {
		width: 100%;
		min-width: 10rem;
		padding: 0.3rem 0.5rem;
	}

	.note-input:disabled {
		opacity: 0.4;
	}

	.invalid {
		border-color: #dc2626;
	}

	.total {
		font-weight: 700;
		font-size: 0.95rem;
	}

	.breakdown-row td {
		background: var(--color-accent, #f8fafc);
	}

	.breakdown-box {
		max-width: 28rem;
	}

	.save-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.invalid-text {
		color: #dc2626;
	}

	:global(.dark) .table-wrap {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .bulk-table th,
	:global(.dark) .bulk-table td {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .name-link,
	:global(.dark) .calc-link {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .breakdown-row td {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .warning {
		color: #fcd34d;
	}
</style>
