<svelte:options customElement={{ tag: 'racona-work-work-calendar', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_WorkCalendar = function () {
			return { tagName: 'racona-work-work-calendar' };
		};
	}
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { CalendarDay, CalendarDayKind } from '../../server/functions.js';
	import {
		getOrganizationStore,
		createOrganizationStore
	} from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived((window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS);

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<import('../../server/functions.js').Organization | null>(null);
	let hasAccess = $state(false);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- Állapot -------------------------------------------------------------

	let year = $state(new Date().getFullYear());
	let days = $state<CalendarDay[]>([]);
	let loading = $state(true);
	let generating = $state(false);

	// Szerkesztő modal
	let editorOpen = $state(false);
	let editorDay = $state('');
	let editorKind = $state<EditorKind>('none');
	let editorNote = $state('');
	let editorExisting = $state(false);
	let editorSaving = $state(false);

	/** Nap → bejegyzés, gyors kereséshez a rácsban. */
	const dayMap = $derived(new Map(days.map((d) => [d.day, d])));

	/** A típusból következik, hogy munkanap-e. */
	const KIND_IS_WORKING: Record<CalendarDayKind, boolean> = {
		public_holiday: false,
		relocated_rest_day: false,
		relocated_work_day: true,
		company_day: false
	};

	/**
	 * A legördülő értékei. A 'none' nem tárolt típus, hanem a "nincs kivétel"
	 * állapot: ilyenkor a napra az alapszabály érvényes (hétvége = szabad,
	 * hétköznap = munkanap). Mentéskor a meglévő bejegyzés törlésével jár.
	 */
	type EditorKind = CalendarDayKind | 'none';

	const KIND_OPTIONS: EditorKind[] = [
		'none',
		'public_holiday',
		'relocated_rest_day',
		'relocated_work_day',
		'company_day'
	];

	const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

	// --- Naptár rács ---------------------------------------------------------

	/**
	 * Egy hónap napjai hétfővel kezdődő rácsban, az elején üres helyekkel.
	 *
	 * @param y - Év.
	 * @param month - Hónap indexe (0-11).
	 * @returns A rács cellái; a null a hónap előtti üres hely.
	 */
	function monthGrid(y: number, month: number): Array<string | null> {
		const first = new Date(Date.UTC(y, month, 1));
		// getUTCDay: 0 = vasárnap → hétfő-kezdetű indexre alakítjuk
		const leading = (first.getUTCDay() + 6) % 7;
		const daysInMonth = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();

		const cells: Array<string | null> = Array(leading).fill(null);
		for (let d = 1; d <= daysInMonth; d++) {
			cells.push(
				`${y}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
			);
		}
		return cells;
	}

	/**
	 * Hétvége-e a nap (bejegyzés nélküli alapszabály).
	 *
	 * @param iso - A nap YYYY-MM-DD formában.
	 * @returns Igaz, ha szombat vagy vasárnap.
	 */
	function isWeekend(iso: string): boolean {
		const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
		return dow === 0 || dow === 6;
	}

	/**
	 * Egy cella állapot-osztálya a színezéshez.
	 *
	 * @param iso - A nap YYYY-MM-DD formában.
	 * @returns CSS osztálynév.
	 */
	function cellClass(iso: string): string {
		const entry = dayMap.get(iso);
		if (entry) {
			return entry.isWorkingDay ? 'is-workday' : `is-${entry.kind.replace(/_/g, '-')}`;
		}
		return isWeekend(iso) ? 'is-weekend' : '';
	}

	// --- Adatok --------------------------------------------------------------

	async function loadData() {
		if (!currentOrganization) return;
		loading = true;
		try {
			days =
				(await sdk?.remote?.call('listCalendarDays', {
					organizationId: currentOrganization.id,
					year
				})) ?? [];
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.loadFailed'), 'error');
			days = [];
		} finally {
			loading = false;
		}
	}

	async function generateHolidays() {
		if (!currentOrganization) return;
		generating = true;
		try {
			const result = await sdk?.remote?.call('generateHungarianHolidays', {
				organizationId: currentOrganization.id,
				year
			});
			sdk?.ui?.toast(
				`${t('workCalendar.generated')}: ${result?.created ?? 0} (${t('workCalendar.skipped')}: ${result?.skipped ?? 0})`,
				'success'
			);
			await loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			generating = false;
		}
	}

	// --- Szerkesztő ----------------------------------------------------------

	function openEditor(iso: string) {
		const entry = dayMap.get(iso);
		editorDay = iso;
		editorExisting = !!entry;
		// A legördülő a nap TÉNYLEGES állapotát mutatja. Bejegyzés nélküli napra
		// ez a "nincs kivétel" — nem javasolunk típust, mert az úgy nézne ki,
		// mintha a nap már be lenne állítva.
		editorKind = entry?.kind ?? 'none';
		editorNote = entry?.note ?? '';
		editorOpen = true;
	}

	function closeEditor() {
		editorOpen = false;
	}

	async function saveEditor() {
		if (!currentOrganization) return;

		// "Nincs kivétel": a meglévő bejegyzést töröljük, ha nem volt, nincs teendő
		if (editorKind === 'none') {
			if (editorExisting) {
				await deleteEditor();
			} else {
				closeEditor();
			}
			return;
		}

		editorSaving = true;
		try {
			await sdk?.remote?.call('upsertCalendarDay', {
				organizationId: currentOrganization.id,
				day: editorDay,
				isWorkingDay: KIND_IS_WORKING[editorKind],
				kind: editorKind,
				note: editorNote || undefined
			});
			sdk?.ui?.toast(t('settings.saveSuccess'), 'success');
			closeEditor();
			await loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			editorSaving = false;
		}
	}

	async function deleteEditor() {
		if (!currentOrganization) return;
		editorSaving = true;
		try {
			await sdk?.remote?.call('deleteCalendarDay', {
				organizationId: currentOrganization.id,
				day: editorDay
			});
			sdk?.ui?.toast(t('workCalendar.deleted'), 'success');
			closeEditor();
			await loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			editorSaving = false;
		}
	}

	// --- Életciklus ----------------------------------------------------------

	onMount(async () => {
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				orgStore = createOrganizationStore(pluginId, sdk);
			}
			currentOrganization = orgStore.currentOrganization;
			hasAccess = orgStore.hasAccess;

			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
				currentOrganization = orgStore.currentOrganization;
				hasAccess = orgStore.hasAccess;
			}
		}
		if (sdk?.remote && currentOrganization) loadData();
	});

	$effect(() => {
		const handleOrgChange = () => {
			const store = (window as any).__racona_work_org_store__;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	$effect(() => {
		currentOrganization;
		year;
		untrack(() => {
			if (currentOrganization && sdk?.remote) loadData();
		});
	});
</script>

<div class="rw">
	<section class="page">
		{#if !hasAccess}
			<AccessDenied />
		{:else}
			<div class="page-header">
				<h2>{t('workCalendar.title')}</h2>
				<p class="subtitle">{t('workCalendar.subtitle')}</p>
			</div>

			<div class="toolbar">
				<div class="year-nav">
					<button class="btn-secondary" onclick={() => (year -= 1)} aria-label="előző év">‹</button>
					<span class="year-label">{year}</span>
					<button class="btn-secondary" onclick={() => (year += 1)} aria-label="következő év">›</button>
				</div>
				<button class="btn-primary" onclick={generateHolidays} disabled={generating || loading}>
					{generating ? t('loading') : t('workCalendar.generate')}
				</button>
			</div>

			<div class="legend">
				<span class="chip is-public-holiday">{t('workCalendar.kind.public_holiday')}</span>
				<span class="chip is-relocated-rest-day">{t('workCalendar.kind.relocated_rest_day')}</span>
				<span class="chip is-workday">{t('workCalendar.kind.relocated_work_day')}</span>
				<span class="chip is-company-day">{t('workCalendar.kind.company_day')}</span>
				<span class="chip is-weekend">{t('workCalendar.weekend')}</span>
			</div>

			{#if loading}
				<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
			{:else}
				<div class="months">
					{#each MONTHS as month (month)}
						<div class="month">
							<h4>{t(`workCalendar.month.${month}`)}</h4>
							<div class="weekdays">
								{#each [0, 1, 2, 3, 4, 5, 6] as wd (wd)}
									<span>{t(`workCalendar.weekdayShort.${wd}`)}</span>
								{/each}
							</div>
							<div class="grid">
								{#each monthGrid(year, month) as iso, i (i)}
									{#if iso === null}
										<span class="cell empty"></span>
									{:else}
										<button
											class="cell {cellClass(iso)}"
											title={dayMap.get(iso)?.note ?? ''}
											onclick={() => openEditor(iso)}
										>
											{Number(iso.slice(8, 10))}
										</button>
									{/if}
								{/each}
							</div>
						</div>
					{/each}
				</div>

				{#if days.length === 0}
					<p class="empty-state">{t('workCalendar.empty')}</p>
				{/if}
			{/if}
		{/if}
	</section>
</div>

{#if editorOpen}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal">
			<h3>{editorDay}</h3>
			<p class="modal-description">{t('workCalendar.editor.description')}</p>

			<label class="form-label">
				{t('workCalendar.editor.kind')}
				<select class="form-input" bind:value={editorKind}>
					{#each KIND_OPTIONS as kind (kind)}
						<option value={kind}>{t(`workCalendar.kind.${kind}`)}</option>
					{/each}
				</select>
			</label>

			<p class="hint">
				{editorKind === 'none'
					? isWeekend(editorDay)
						? t('workCalendar.editor.defaultWeekend')
						: t('workCalendar.editor.defaultWeekday')
					: KIND_IS_WORKING[editorKind]
						? t('workCalendar.editor.countsAsWorkday')
						: t('workCalendar.editor.countsAsRestDay')}
			</p>

			<label class="form-label">
				{t('workCalendar.editor.note')}
				<input class="form-input" type="text" bind:value={editorNote} maxlength="255" />
			</label>

			<div class="modal-footer">
				{#if editorExisting}
					<button class="btn-danger" onclick={deleteEditor} disabled={editorSaving}>
						{t('workCalendar.editor.delete')}
					</button>
				{/if}
				<button class="btn-secondary" onclick={closeEditor} disabled={editorSaving}>
					{t('form.cancel')}
				</button>
				<button class="btn-primary" onclick={saveEditor} disabled={editorSaving}>
					{editorSaving ? t('loading') : t('settings.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../styles/shared.css';

	/* A shared.css nem definiálja a modal tartalmi osztályait — a plugin
	   komponensei sajátban hozzák. A LeaveRequests konvencióját követjük,
	   hogy a két modal egyformán nézzen ki. */

	.modal h3 {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0;
	}

	.modal-description {
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0.25rem 0 1rem;
	}

	.form-label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
		font-weight: 500;
		margin-bottom: 0.75rem;
	}

	.form-input {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.875rem;
		font-weight: 400;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
	}

	.form-input:focus {
		outline: 2px solid var(--color-primary, #3730a3);
		outline-offset: 1px;
	}

	:global(.dark) .modal h3 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .form-input {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.year-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.year-label {
		font-size: 1.25rem;
		font-weight: 600;
		min-width: 4rem;
		text-align: center;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.chip {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border, #d4d4d8);
	}

	.months {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 1rem;
	}

	.month h4 {
		margin: 0 0 0.5rem;
		font-size: 0.95rem;
	}

	.weekdays,
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.weekdays span {
		text-align: center;
		font-size: 0.7rem;
		color: var(--muted-foreground, #71717a);
		padding-bottom: 0.25rem;
	}

	.cell {
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		cursor: pointer;
		color: inherit;
	}

	.cell:hover:not(.empty) {
		border-color: var(--primary, #2563eb);
	}

	.cell.empty {
		cursor: default;
	}

	.is-weekend {
		background: var(--muted, #f4f4f5);
		color: var(--muted-foreground, #71717a);
	}

	.is-public-holiday {
		background: #fee2e2;
		color: #991b1b;
	}

	.is-relocated-rest-day {
		background: #ffedd5;
		color: #9a3412;
	}

	.is-company-day {
		background: #ede9fe;
		color: #5b21b6;
	}

	.is-workday {
		background: #dcfce7;
		color: #166534;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		margin: -0.5rem 0 0.75rem;
	}
</style>
