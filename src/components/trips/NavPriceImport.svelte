<script lang="ts">
	/**
	 * NAV üzemanyagárak lekérése (K14, D7): előnézet és kitöltés.
	 *
	 * A HR ártípusonként kiválasztja, melyik NAV-oszlop tölti ki az árat, és melyik
	 * a tartalék, ha abban nincs ár (pl. védett ár, ha nincs, a piaci). Az előnézet
	 * hónaponként mutatja, mi változik. Az üres hónapok kitöltődnek; eltérő árat csak
	 * bejelölve írunk felül (a korábban is NAV-ból jött árak alapból be vannak jelölve).
	 */
	import { onMount } from 'svelte';
	import type { NavFuelApplyResult, NavFuelPreview, PriceType } from '../../../server/functions.js';
	import { cellId, columnQualifier, planNavImport } from '../../../server/nav-fuel.js';
	import type { NavImportCell, NavPriceMapping } from '../../../server/nav-fuel.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import Checkbox from '../ui/Checkbox.svelte';
	import { errorMessage, monthName, priceTypeLabel } from './format.js';

	let {
		pluginId = 'racona-work',
		organizationId,
		year,
		onDone,
		onClose
	}: {
		pluginId?: string;
		organizationId: number;
		year: number;
		onDone: (result: NavFuelApplyResult) => void;
		onClose: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);
	const locale = $derived(sdk?.i18n?.locale ?? 'hu');

	let preview = $state<NavFuelPreview | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let applying = $state(false);
	/** Ártípusonként: elsődleges és tartalék oszlop ('' = nincs). */
	let choice = $state<Record<string, { primary: string; fallback: string }>>({});
	/** A felülírás kézi be- és kikapcsolása; ami nincs benne, az az alapértelmezés szerint megy. */
	let overwriteToggles = $state<Record<string, boolean>>({});

	const priceFormat = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 2 });
	const fmt = (value: number | null) => (value === null ? '—' : priceFormat.format(value));

	const mapping = $derived.by<NavPriceMapping>(() => {
		const result: NavPriceMapping = {};
		for (const type of preview?.priceTypes ?? []) {
			const c = choice[type];
			result[type] = c?.primary ? [c.primary, c.fallback].filter((k, i, all) => k && all.indexOf(k) === i) : [];
		}
		return result;
	});

	const plan = $derived(
		preview ? planNavImport(preview.table, mapping, preview.priceTypes, preview.current, preview.locked) : []
	);
	const planById = $derived(new Map(plan.map((c) => [cellId(c.month, c.priceType), c])));
	const navMonths = $derived(new Set(preview?.table.rows.map((r) => r.month) ?? []));
	const labelByKey = $derived(new Map(preview?.table.columns.map((c) => [c.key, c.label]) ?? []));

	// Ha az elsődleges oszlop a tartalékkal egyezik, a tartalék üres lesz.
	$effect(() => {
		for (const c of Object.values(choice)) {
			if (c.fallback && c.fallback === c.primary) c.fallback = '';
		}
	});

	function isOverwrite(cell: NavImportCell): boolean {
		const id = cellId(cell.month, cell.priceType);
		return overwriteToggles[id] ?? cell.currentSource === 'nav';
	}

	const newCount = $derived(plan.filter((c) => c.status === 'new').length);
	const overwriteCount = $derived(plan.filter((c) => c.status === 'differs' && isOverwrite(c)).length);

	async function load(refresh: boolean) {
		loading = true;
		loadError = null;
		try {
			const result: NavFuelPreview = await sdk.remote.call('previewNavFuelPrices', { organizationId, year, refresh });
			const next: Record<string, { primary: string; fallback: string }> = {};
			for (const type of result.priceTypes) {
				const keys = result.mapping[type] ?? [];
				next[type] = { primary: keys[0] ?? '', fallback: keys[1] ?? '' };
			}
			choice = next;
			overwriteToggles = {};
			preview = result;
		} catch (err) {
			loadError = errorMessage(err, t('tripSettings.nav.loadFailed'));
		} finally {
			loading = false;
		}
	}

	async function apply() {
		if (!preview) return;
		applying = true;
		try {
			const overwrite = plan
				.filter((c) => c.status === 'differs' && isOverwrite(c))
				.map((c) => ({ month: c.month, priceType: c.priceType }));
			const result: NavFuelApplyResult = await sdk.remote.call('applyNavFuelPrices', {
				organizationId,
				year,
				version: preview.version,
				mapping,
				overwrite
			});
			onDone(result);
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			applying = false;
		}
	}

	function qualifier(cell: NavImportCell): string | null {
		if (!cell.columnKey || (mapping[cell.priceType]?.length ?? 0) < 2) return null;
		return columnQualifier(labelByKey.get(cell.columnKey) ?? '') ?? (cell.fallback ? t('tripSettings.nav.fallbackShort') : null);
	}

	function fetchedTime(iso: string): string {
		return new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', {
			timeZone: 'Europe/Budapest',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	onMount(() => load(true));
</script>

<div class="modal-overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && !applying && onClose()}>
	<div class="modal nav-modal" role="dialog" aria-modal="true" aria-labelledby="nav-import-title">
		<div class="modal-header">
			<h3 id="nav-import-title">{t('tripSettings.nav.title', { year })}</h3>
			<button class="modal-close" onclick={onClose} aria-label={t('form.cancel')}>×</button>
		</div>

		<div class="modal-body">
			{#if loading}
				<div class="loading-state"><div class="spinner"></div><span>{t('tripSettings.nav.loading')}</span></div>
			{:else if loadError || !preview}
				<div class="notice error">
					<p>{loadError}</p>
					<button class="btn-secondary btn-sm" onclick={() => load(true)}>{t('tripSettings.nav.retry')}</button>
				</div>
			{:else}
				<p class="source">
					{t('tripSettings.nav.source')}
					<a href={preview.sourceUrl} target="_blank" rel="noopener noreferrer">{preview.sourceUrl.replace(/^https:\/\//, '')}</a>
					· {t('tripSettings.nav.fetchedAt', { time: fetchedTime(preview.fetchedAt) })}
				</p>

				<section class="mapping">
					<h4>{t('tripSettings.nav.mappingTitle')}</h4>
					<p class="hint">{t('tripSettings.nav.mappingHint')}</p>
					{#if preview.mappingChanged}
						<div class="notice warn">{t('tripSettings.nav.mappingChanged')}</div>
					{/if}
					{#each preview.priceTypes as type (type)}
						<div class="map-row">
							<span class="map-type">{priceTypeLabel(type, locale)}</span>
							<label>
								<span>{t('tripSettings.nav.primary')}</span>
								<select class="input" bind:value={choice[type].primary}>
									<option value="">{t('tripSettings.nav.noColumn')}</option>
									{#each preview.table.columns as column (column.key)}
										<option value={column.key}>{column.label}</option>
									{/each}
								</select>
							</label>
							<label>
								<span>{t('tripSettings.nav.fallback')}</span>
								<select class="input" bind:value={choice[type].fallback} disabled={!choice[type].primary}>
									<option value="">{t('tripSettings.nav.noColumn')}</option>
									{#each preview.table.columns.filter((col) => col.key !== choice[type].primary) as column (column.key)}
										<option value={column.key}>{column.label}</option>
									{/each}
								</select>
							</label>
						</div>
					{/each}
				</section>

				<section>
					<h4>{t('tripSettings.nav.previewTitle')}</h4>
					<div class="table-wrap">
						<table class="preview-table">
							<thead>
								<tr>
									<th>{t('tripSettings.prices.month')}</th>
									{#each preview.priceTypes as type (type)}<th>{priceTypeLabel(type, locale)} (Ft/l)</th>{/each}
								</tr>
							</thead>
							<tbody>
								{#each Array.from({ length: 12 }, (_, i) => i + 1) as month (month)}
									<tr class:future={!navMonths.has(month)}>
										<td>{monthName(month, locale)}</td>
										{#each preview.priceTypes as type (type)}
											{@const cell = planById.get(cellId(month, type))}
											{@const q = cell ? qualifier(cell) : null}
											<td class="cell status-{cell?.status}">
												{#if !cell}
													—
												{:else if cell.status === 'new'}
													<span class="value">{fmt(cell.navPrice)}</span>
													<span class="pill new">{t('tripSettings.nav.status.new')}</span>
												{:else if cell.status === 'same'}
													<span class="value muted">{fmt(cell.navPrice)}</span>
													<span class="pill">{t('tripSettings.nav.status.same')}</span>
												{:else if cell.status === 'differs'}
													<label class="overwrite">
														<Checkbox
															checked={isOverwrite(cell)}
															onCheckedChange={(v) => (overwriteToggles[cellId(month, type)] = v)}
															ariaLabel={t('tripSettings.nav.overwrite')}
														/>
														<span class="old">{fmt(cell.current)}</span>
														<span class="arrow">→</span>
														<span class="value">{fmt(cell.navPrice)}</span>
													</label>
													{#if cell.currentSource === 'manual'}<span class="pill manual">{t('tripSettings.nav.status.manual')}</span>{/if}
												{:else if cell.status === 'locked'}
													<span class="value muted" title={t('tripSettings.nav.lockedHint', { price: fmt(cell.navPrice) })}>{fmt(cell.current)}</span>
													<span class="pill">{t('tripSettings.nav.status.locked')}</span>
												{:else if cell.status === 'invalid'}
													<span class="pill error">{t('tripSettings.nav.status.invalid')}</span>
												{:else}
													<span class="value muted">{fmt(cell.current)}</span>
													{#if navMonths.has(month)}<span class="pill">{t('tripSettings.nav.status.missing')}</span>{/if}
												{/if}
												{#if q && cell && cell.navPrice !== null}<div class="qualifier">{q}</div>{/if}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="hint">{t('tripSettings.nav.previewHint')}</p>
				</section>
			{/if}
		</div>

		<div class="modal-footer">
			{#if preview && !loading}
				<span class="summary">{t('tripSettings.nav.summary', { new: newCount, overwrite: overwriteCount })}</span>
			{/if}
			<button class="btn-secondary" onclick={onClose} disabled={applying}>{t('form.cancel')}</button>
			<button
				class="btn-primary"
				onclick={apply}
				disabled={!preview || loading || applying || newCount + overwriteCount === 0}
			>
				{applying ? t('loading') : t('tripSettings.nav.apply')}
			</button>
		</div>
	</div>
</div>

<style>
	@import '../../styles/shared.css';

	.nav-modal {
		max-width: 820px;
	}

	h4 {
		margin: 0 0 0.25rem;
		font-size: 0.9rem;
		font-weight: 600;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.source {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.source a {
		color: var(--color-primary, #3730a3);
	}

	.notice {
		padding: 0.625rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.notice p {
		margin: 0;
	}

	.notice.warn {
		background: color-mix(in oklab, #f59e0b 14%, transparent);
		color: var(--color-foreground, #78350f);
	}

	.notice.error {
		background: color-mix(in oklab, #ef4444 12%, transparent);
		color: var(--color-foreground, #7f1d1d);
	}

	.map-row {
		display: grid;
		grid-template-columns: 6rem minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.75rem;
		align-items: end;
	}

	@media (max-width: 640px) {
		.map-row {
			grid-template-columns: 1fr;
		}
	}

	.map-type {
		font-size: 0.875rem;
		font-weight: 600;
		padding-bottom: 0.55rem;
	}

	.map-row label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		min-width: 0;
	}

	.map-row select {
		width: 100%;
		text-overflow: ellipsis;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.preview-table {
		border-collapse: collapse;
		font-size: 0.85rem;
		width: 100%;
	}

	.preview-table th,
	.preview-table td {
		padding: 0.35rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		vertical-align: top;
	}

	.preview-table th {
		font-weight: 600;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.preview-table tr.future td {
		color: var(--color-muted-foreground, #94a3b8);
	}

	.cell {
		white-space: nowrap;
	}

	.value {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.value.muted,
	.old {
		font-weight: 400;
		color: var(--color-muted-foreground, #64748b);
	}

	.old {
		text-decoration: line-through;
	}

	.arrow {
		color: var(--color-muted-foreground, #94a3b8);
	}

	.overwrite {
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		white-space: nowrap;
		gap: 0.4rem;
		cursor: pointer;
	}

	.pill {
		display: inline-block;
		margin-left: 0.35rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.68rem;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
	}

	.pill.new {
		background: color-mix(in oklab, #22c55e 16%, transparent);
		color: #15803d;
	}

	.pill.manual {
		background: color-mix(in oklab, #f59e0b 16%, transparent);
		color: #b45309;
	}

	.pill.error {
		margin-left: 0;
		background: color-mix(in oklab, #ef4444 14%, transparent);
		color: #b91c1c;
	}

	.qualifier {
		font-size: 0.68rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.summary {
		margin-right: auto;
		align-self: center;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .pill.new {
		color: #86efac;
	}

	:global(.dark) .pill.manual {
		color: #fcd34d;
	}

	:global(.dark) .pill.error {
		color: #fca5a5;
	}
</style>
