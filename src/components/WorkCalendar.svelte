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
	import type {
		CalendarDay,
		CalendarDayKind,
		MandatoryLeavePlan,
		MandatoryLeaveResult,
		MandatoryLeaveRow,
		OpenLeaveYearPreview,
		OpenLeaveYearResult
	} from '../../server/functions.js';
	import { daysToPeriods } from '../../server/leave-day-utils.js';
	import {
		getOrganizationStore,
		createOrganizationStore
	} from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import { isWeekend, monthGrid } from '../lib/calendar-grid.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived((window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS);

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<import('../../server/functions.js').Organization | null>(null);
	let hasAccess = $state(false);

	function t(key: string, vars?: Record<string, string | number>): string {
		let result: string = sdk?.i18n?.t(key) ?? key;
		if (vars) {
			for (const [k, v] of Object.entries(vars)) {
				result = result.replace(`{${k}}`, String(v));
			}
		}
		return result;
	}

	// --- Állapot -------------------------------------------------------------

	let year = $state(new Date().getFullYear());
	let days = $state<CalendarDay[]>([]);
	let loading = $state(true);
	let generating = $state(false);

	// --- Áthelyezett napok szinkronja --------------------------------------
	// Ahány szabadnapot máskor dolgoznak le, annyi áthelyezett munkanapnak kell
	// lennie az évben; ha eltér, valami hiányzik a naptárból.
	const relocatedWorkDays = $derived(days.filter((d) => d.kind === 'relocated_work_day').length);
	const relocatedRestDays = $derived(days.filter((d) => d.kind === 'relocated_rest_day').length);
	const relocatedOutOfSync = $derived(relocatedWorkDays !== relocatedRestDays);

	// --- Év lezárása és megnyitása ------------------------------------------
	// Szabadságot csak nyitott évre lehet rögzíteni: amit megnyitottak és nincs
	// lezárva. A HR (leave.balance.manage) nyitja meg, zárja le és nyitja újra
	// (specs/year-opening.md).
	let closedYear = $state<number | null>(null);
	let openedYear = $state<number | null>(null);
	let canClose = $state(false);
	let closing = $state(false);
	const currentYear = new Date().getFullYear();
	const yearClosed = $derived(closedYear !== null && year <= closedYear);
	const yearOpened = $derived(!yearClosed && openedYear !== null && year <= openedYear);
	/** A meg nem nyitott év megnyitható-e most: sorban, legfeljebb a jövő év (a szerver is ellenőrzi). */
	const yearOpenable = $derived(
		!yearClosed && !yearOpened && year <= currentYear + 1 && (openedYear === null || year === openedYear + 1)
	);

	async function loadClosedYear() {
		if (!currentOrganization) return;
		try {
			const r = await sdk?.remote?.call('getLeaveClosedYear', { organizationId: currentOrganization.id });
			closedYear = r?.closedYear ?? null;
			openedYear = r?.openedYear ?? null;
		} catch {
			closedYear = null;
			openedYear = null;
		}
	}

	// --- Évnyitás és kötelező szabadságok ------------------------------------
	// Mindkettő előnézettel indul; a gomb a szerveren újratervez és végrehajt.

	type YearDialogMode = 'open' | 'mandatory';
	let yearDialog = $state<YearDialogMode | null>(null);
	let yearPlan = $state<OpenLeaveYearPreview | MandatoryLeavePlan | null>(null);
	let yearPlanLoading = $state(false);
	let yearRunning = $state(false);

	const openPreview = $derived(yearDialog === 'open' ? (yearPlan as OpenLeaveYearPreview | null) : null);
	/** Van-e mit végrehajtani: évnyitásnál ha nyitható, ellenőrzésnél ha van kiírandó nap. */
	const yearCanRun = $derived(
		!!yearPlan && (yearDialog === 'open' ? openPreview?.canOpen === true : yearPlan.daysToAssign > 0)
	);

	async function openYearDialog(mode: YearDialogMode) {
		if (!currentOrganization) return;
		yearDialog = mode;
		yearPlan = null;
		yearPlanLoading = true;
		try {
			yearPlan = await sdk?.remote?.call(mode === 'open' ? 'previewOpenLeaveYear' : 'previewMandatoryLeave', {
				organizationId: currentOrganization.id,
				year
			});
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.loadFailed'), 'error');
			yearDialog = null;
		} finally {
			yearPlanLoading = false;
		}
	}

	function closeYearDialog() {
		if (yearRunning) return;
		yearDialog = null;
		yearPlan = null;
	}

	async function runYearDialog() {
		if (!currentOrganization || !yearDialog || !yearCanRun) return;
		yearRunning = true;
		try {
			if (yearDialog === 'open') {
				const r: OpenLeaveYearResult = await sdk?.remote?.call('openLeaveYear', {
					organizationId: currentOrganization.id,
					year
				});
				sdk?.ui?.toast(
					t('workCalendar.opening.done', {
						year: r.year,
						balances: r.createdBalances,
						days: r.days,
						employees: r.employees
					}),
					'success'
				);
			} else {
				const r: MandatoryLeaveResult = await sdk?.remote?.call('applyMandatoryLeave', {
					organizationId: currentOrganization.id,
					year
				});
				sdk?.ui?.toast(t('workCalendar.mandatory.done', { days: r.days, employees: r.employees }), 'success');
			}
			yearRunning = false;
			closeYearDialog();
			await loadClosedYear();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			yearRunning = false;
		}
	}

	/** Rövid dátum: „dec. 28.”; az év a címben van. */
	function shortDay(iso: string): string {
		return new Date(`${iso}T00:00:00Z`).toLocaleDateString('hu-HU', { timeZone: 'UTC', month: 'short', day: 'numeric' });
	}

	function formatRange(from: string, to: string): string {
		return from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`;
	}

	/** Az év kötelező napjai összefüggő naptári tartományokként. */
	const mandatoryRanges = $derived(
		yearPlan ? daysToPeriods(yearPlan.mandatoryDays).map((p) => formatRange(p.from, p.to)).join(', ') : ''
	);

	/** A sor teendője egy mondatban. */
	function rowAction(row: MandatoryLeaveRow): string {
		if (row.applicableDays === 0) {
			return yearPlan && yearPlan.mandatoryDays.length > 0 ? t('workCalendar.mandatory.notApplicable') : '—';
		}
		if (row.assignDays.length > 0) {
			return t('workCalendar.mandatory.assign', {
				days: row.assignDays.length,
				periods: row.periods.map((p) => formatRange(p.startDate, p.endDate)).join(', ')
			});
		}
		if (row.pendingDays.length === 0 && row.shortDays.length === 0) return t('workCalendar.mandatory.allSet');
		return t('workCalendar.mandatory.noneAssigned');
	}

	/** A sor figyelmeztetései: kevés vagy nincs keret, függő kérelem. */
	function rowWarnings(row: MandatoryLeaveRow): string[] {
		const warnings: string[] = [];
		if (row.shortDays.length > 0) {
			warnings.push(
				row.hasBalance
					? t('workCalendar.mandatory.short', { days: row.shortDays.length, remaining: Math.max(0, row.remainingBefore) })
					: t('workCalendar.mandatory.noBalance', { days: row.shortDays.length })
			);
		}
		if (row.pendingDays.length > 0) {
			warnings.push(t('workCalendar.mandatory.pending', { days: row.pendingDays.map(shortDay).join(', ') }));
		}
		return warnings;
	}

	async function closeYear() {
		if (!currentOrganization || !window.confirm(t('workCalendar.closing.confirm', { year }))) return;
		closing = true;
		try {
			const r = await sdk?.remote?.call('setLeaveClosedYear', { organizationId: currentOrganization.id, year });
			closedYear = r?.closedYear ?? null;
			sdk?.ui?.toast(t('settings.saveSuccess'), 'success');
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			closing = false;
		}
	}

	async function reopenYear() {
		if (!currentOrganization || !window.confirm(t('workCalendar.closing.reopenConfirm', { year }))) return;
		closing = true;
		try {
			// Az újranyitás az előző évig húzza vissza a lezárást
			const r = await sdk?.remote?.call('setLeaveClosedYear', {
				organizationId: currentOrganization.id,
				year: year - 1 >= 1970 ? year - 1 : null
			});
			closedYear = r?.closedYear ?? null;
			sdk?.ui?.toast(t('settings.saveSuccess'), 'success');
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			closing = false;
		}
	}

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
		company_day: false,
		// Kötelező szabadság: munkanap, amire szabadságot kell kivenni
		mandatory_leave: true
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
		'company_day',
		'mandatory_leave'
	];

	const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

	// --- Naptár rács (src/lib/calendar-grid.ts) ------------------------------

	/**
	 * Egy cella állapot-osztálya a színezéshez.
	 *
	 * @param iso - A nap YYYY-MM-DD formában.
	 * @returns CSS osztálynév.
	 */
	function cellClass(iso: string): string {
		const entry = dayMap.get(iso);
		if (entry) {
			// A kötelező szabadság munkanap, de saját színe van, nem az áthelyezett munkanapé
			if (entry.kind === 'mandatory_leave') return 'is-mandatory-leave';
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
		if (orgStore) canClose = orgStore.can('leave.balance.manage');
		if (sdk?.remote && currentOrganization) {
			loadData();
			loadClosedYear();
		}
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
				<div class="toolbar-actions">
					{#if yearClosed}
						<span class="chip is-closed">{t('workCalendar.closing.closed')}</span>
						{#if canClose && year === closedYear}
							<button class="btn-secondary" onclick={reopenYear} disabled={closing}>
								{t('workCalendar.closing.reopenButton', { year })}
							</button>
						{/if}
					{:else if yearOpened}
						{#if canClose && year <= currentYear}
							<button class="btn-secondary" onclick={closeYear} disabled={closing}>
								{t('workCalendar.closing.closeButton', { year })}
							</button>
						{/if}
						{#if canClose}
							<button class="btn-secondary" onclick={() => openYearDialog('mandatory')}>
								{t('workCalendar.mandatory.button')}
							</button>
						{/if}
					{:else}
						<span class="chip is-closed">{t('workCalendar.opening.notOpened')}</span>
						{#if canClose && yearOpenable}
							<button class="btn-secondary" onclick={() => openYearDialog('open')}>
								{t('workCalendar.opening.button', { year })}
							</button>
						{/if}
					{/if}
					<button class="btn-primary" onclick={generateHolidays} disabled={generating || loading}>
						{generating ? t('loading') : t('workCalendar.generate')}
					</button>
				</div>
			</div>

			{#if yearClosed}
				<p class="notice">{t('workCalendar.closing.hint', { year })}</p>
			{:else if !yearOpened}
				<p class="notice">
					{t('workCalendar.opening.hint', { year })}
					{#if !yearOpenable && openedYear !== null && year > openedYear + 1}
						{t('workCalendar.opening.hintSequence', { year: openedYear + 1 })}
					{/if}
				</p>
			{/if}

			{#if !loading && relocatedOutOfSync}
				<p class="notice is-warning">
					{t('workCalendar.syncWarning', { work: relocatedWorkDays, rest: relocatedRestDays })}
				</p>
			{/if}

			<div class="legend">
				<span class="chip is-public-holiday">{t('workCalendar.kind.public_holiday')}</span>
				<span class="chip is-relocated-rest-day">{t('workCalendar.kind.relocated_rest_day')}</span>
				<span class="chip is-workday">{t('workCalendar.kind.relocated_work_day')}</span>
				<span class="chip is-company-day">{t('workCalendar.kind.company_day')}</span>
				<span class="chip is-mandatory-leave">{t('workCalendar.kind.mandatory_leave')}</span>
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

{#if yearDialog}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal modal-wide">
			<h3>
				{yearDialog === 'open'
					? t('workCalendar.opening.title', { year })
					: t('workCalendar.mandatory.title', { year })}
			</h3>
			<p class="modal-description">
				{yearDialog === 'open' ? t('workCalendar.opening.description') : t('workCalendar.mandatory.description')}
			</p>

			{#if yearPlanLoading}
				<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
			{:else if yearPlan}
				{#if openPreview && !openPreview.canOpen}
					<p class="notice is-warning">{openPreview.blockedReason}</p>
				{/if}
				<p class="plan-days">
					{yearPlan.mandatoryDays.length > 0
						? t('workCalendar.mandatory.days', { days: mandatoryRanges })
						: t('workCalendar.mandatory.noDays')}
				</p>
				{#if yearDialog === 'mandatory' && yearPlan.daysToAssign === 0}
					<p class="notice">{t('workCalendar.mandatory.nothingToDo')}</p>
				{/if}

				<div class="plan-scroll">
					<table class="plan-table">
						<thead>
							<tr>
								<th>{t('workCalendar.mandatory.columnEmployee')}</th>
								{#if yearDialog === 'open'}
									<th>{t('workCalendar.opening.columnBalance')}</th>
								{/if}
								<th>{t('workCalendar.mandatory.columnAction')}</th>
							</tr>
						</thead>
						<tbody>
							{#each yearPlan.rows as row (row.employeeId)}
								{@const warnings = rowWarnings(row)}
								<tr class:has-action={row.assignDays.length > 0}>
									<td class="plan-name">{row.employeeName}</td>
									{#if yearDialog === 'open'}
										<td class="plan-balance">
											{row.newBalance !== null
												? t('workCalendar.opening.newBalance', { days: row.newBalance })
												: t('workCalendar.opening.existingBalance', { days: row.existingBalance ?? 0 })}
										</td>
									{/if}
									<td>
										<span>{rowAction(row)}</span>
										{#each warnings as warning (warning)}
											<span class="plan-warning">{warning}</span>
										{/each}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<div class="modal-footer">
				<button class="btn-secondary" onclick={closeYearDialog} disabled={yearRunning}>
					{yearCanRun ? t('form.cancel') : t('workCalendar.mandatory.close')}
				</button>
				{#if yearCanRun && yearPlan}
					<button class="btn-primary" onclick={runYearDialog} disabled={yearRunning}>
						{yearRunning
							? t('loading')
							: yearDialog === 'open'
								? t('workCalendar.opening.run')
								: t('workCalendar.mandatory.run', {
										employees: yearPlan.employeesToAssign,
										days: yearPlan.daysToAssign
									})}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

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
					: editorKind === 'mandatory_leave'
						? t('workCalendar.editor.mandatoryLeave')
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

	/* A shared.css .modal szabályában nincs padding és nincs gap, a tartalmi
	   osztályokat (.form-label, .form-input, .modal-description) pedig egyáltalán
	   nem definiálja — a plugin komponensei sajátban hozzák. A LeaveRequests
	   konvencióját követjük, hogy a két modal egyformán nézzen ki. */

	.modal {
		padding: 1.5rem;
		gap: 0.25rem;
	}

	.modal h3 {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0;
	}

	.modal-description {
		font-size: 0.875rem;
		line-height: 1.45;
		color: var(--color-muted-foreground, #64748b);
		margin: 0.35rem 0 0.5rem;
	}

	.modal-footer {
		margin-top: 1.25rem;
		padding-top: 1rem;
		gap: 0.5rem;
	}

	/* Évnyitás és kötelező szabadságok: dolgozónként egy sor */
	.modal-wide {
		max-width: 760px;
	}

	.plan-days {
		margin: 0.25rem 0 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.plan-scroll {
		overflow: auto;
		min-height: 0;
		flex: 1 1 auto;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
	}

	.plan-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.plan-table th {
		position: sticky;
		top: 0;
		text-align: left;
		font-weight: 600;
		font-size: 0.8rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-muted, #f8fafc);
		color: var(--color-muted-foreground, #64748b);
	}

	.plan-table td {
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
		vertical-align: top;
	}

	.plan-table td span {
		display: block;
	}

	.plan-name,
	.plan-balance {
		white-space: nowrap;
	}

	.plan-table tr.has-action .plan-name {
		font-weight: 600;
	}

	.plan-warning {
		margin-top: 0.2rem;
		color: #b45309;
		font-size: 0.8rem;
	}

	:global(.dark) .plan-table th {
		background: var(--color-muted, oklch(0.269 0 0));
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .plan-scroll,
	:global(.dark) .plan-table td {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .plan-warning {
		color: #fcd34d;
	}

	.form-label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.875rem;
		font-weight: 500;
		margin: 0.5rem 0 0;
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

	/* A natív select megjelenése rendszerenként eltér és kilóg a többi mező
	   közül — saját nyilat rajzolunk, a doboz a .form-input stílusát követi. */
	select.form-input {
		appearance: none;
		-webkit-appearance: none;
		padding-right: 2rem;
		cursor: pointer;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.6rem center;
		line-height: 1.4;
	}

	select.form-input:hover {
		border-color: var(--color-primary, #3730a3);
	}

	:global(.dark) select.form-input {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
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

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.chip.is-closed {
		background: #e4e4e7;
		color: #3f3f46;
	}

	.notice {
		margin: 0 0 1rem;
		padding: 0.6rem 0.9rem;
		border-radius: 0.375rem;
		background: var(--muted, #f4f4f5);
		font-size: 0.875rem;
	}

	.notice.is-warning {
		background: #fef3c7;
		color: #92400e;
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

	.is-mandatory-leave {
		background: #ccfbf1;
		color: #115e59;
	}

	.is-workday {
		background: #dcfce7;
		color: #166534;
	}

	.hint {
		font-size: 0.8rem;
		line-height: 1.4;
		color: var(--color-muted-foreground, #64748b);
		margin: 0.35rem 0 0.25rem;
	}
</style>
