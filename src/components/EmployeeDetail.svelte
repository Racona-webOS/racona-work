<svelte:options customElement={{ tag: 'racona-work-employee-detail', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_EmployeeDetail = function () {
			return { tagName: 'racona-work-employee-detail' };
		};
	}
</script>

<script lang="ts">
	import type {} from '@racona/sdk/types';
	import type { EmployeeDetailView, EmployeeDetail } from '../../server/functions.js';
	import LeaveBalanceCard from './leave-entitlement/LeaveBalanceCard.svelte';
	import Checkbox from './ui/Checkbox.svelte';
	import LeaveProfileCard from './leave-entitlement/LeaveProfileCard.svelte';
	import OtherAllowances from './leave-entitlement/OtherAllowances.svelte';
	import DataRequestReview from './leave-entitlement/DataRequestReview.svelte';
	import PersonalDataFields from './trips/PersonalDataFields.svelte';
	import EmployeeDocumentsTab from './employee-documents/EmployeeDocumentsTab.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { formatDate } from '../utils/format.js';

	let {
		pluginId = 'racona-work',
		employeeId = null,
		tab = null
	}: {
		pluginId?: string;
		employeeId?: number | null;
		/** Melyik fül nyíljon meg (pl. a Dokumentumok oldalról jövet: 'documents') */
		tab?: 'details' | 'documents' | null;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	// --- Állapot ---
	let view = $state<EmployeeDetailView | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// A szabadságkeret és a számítás adatai csak leave.balance.manage joggal
	// látszanak (a bontásból kiderül a gyerekek száma, az egészségkárosodás).
	let canManageBalance = $state(false);
	let canManageEmployee = $state(false);
	/** A Dokumentumok fül (specs/employee-documents.md): olvasási vagy kezelési joggal. */
	let canViewDocuments = $state(false);
	// svelte-ignore state_referenced_locally
	let activeTab = $state<'details' | 'documents'>(tab === 'documents' ? 'documents' : 'details');
	/** A születési dátumot a HR menti: employee.manage vagy leave.balance.manage. */
	const canEditPersonal = $derived(canManageEmployee || canManageBalance);

	function syncCapabilities() {
		const store = (window as any).__racona_work_org_store__;
		canManageBalance = store?.can?.('leave.balance.manage') ?? false;
		canManageEmployee = store?.can?.('employee.manage') ?? false;
		canViewDocuments =
			(store?.can?.('employee.documents.view') ?? false) || (store?.can?.('employee.documents.manage') ?? false);
	}

	$effect(() => {
		syncCapabilities();
		const handleCapabilities = (e: Event) => {
			if ((e as CustomEvent).detail?.pluginId !== pluginId) return;
			syncCapabilities();
		};
		window.addEventListener('plugin-capabilities-changed', handleCapabilities);
		window.addEventListener('organization-changed', syncCapabilities);
		return () => {
			window.removeEventListener('plugin-capabilities-changed', handleCapabilities);
			window.removeEventListener('organization-changed', syncCapabilities);
		};
	});

	/** Növeljük, ha a szabadság-adatok változtak, hogy a keret kártya újratöltsön. */
	let balanceRefreshKey = $state(0);

	function onLeaveProfileChanged() {
		balanceRefreshKey++;
		// A belépés dátuma az alapadatok között is látszik
		loadDetail();
	}

	// Alapadatok szerkesztése
	let editingBasic = $state(false);
	let editPosition = $state('');
	let editStatus = $state('');
	let editHireDate = $state('');
	let editEndDate = $state('');
	let editIsExternal = $state(false);
	let basicSaving = $state(false);

	// Születési dátum (Személyes adatok)
	let editingBirth = $state(false);
	let editBirthDate = $state('');
	let birthSaving = $state(false);

	/** YYYY-MM-DD → helyi dátum, időzóna-csúszás nélkül. */
	function formatDay(day: string | null | undefined): string {
		return formatDate(day);
	}

	/** A dátumváltozás utáni újraszámolás jelzése, és a keret kártyák frissítése. */
	function afterDatesChanged(recalculated: { year: number; from: number; to: number }[] | undefined) {
		const changes = (recalculated ?? [])
			.map((r) => t('leaveEntitlement.recalculated', { year: r.year, from: r.from, to: r.to }))
			.join(' ');
		sdk?.ui?.toast(changes || t('employeeDetail.saveSuccess'), changes ? 'info' : 'success');
		balanceRefreshKey++;
	}

	// Adatlap részlet szerkesztése
	type DetailEditState = { mode: 'add' | 'edit'; category: string; fieldKey: string; fieldValue: string; id?: number };
	let detailEdit = $state<DetailEditState | null>(null);
	let detailSaving = $state(false);

	const CATEGORIES = ['personal', 'work', 'contact', 'other'] as const;
	type Category = typeof CATEGORIES[number];

	function categoryLabel(cat: string): string {
		const map: Record<string, string> = {
			personal: t('employeeDetail.categories.personal'),
			work: t('employeeDetail.categories.work'),
			contact: t('employeeDetail.categories.contact'),
			other: t('employeeDetail.categories.other')
		};
		return map[cat] ?? cat;
	}

	function statusLabel(s: string): string {
		const map: Record<string, string> = {
			active: t('employees.status.active'),
			inactive: t('employees.status.inactive'),
			onLeave: t('employees.status.onLeave')
		};
		return map[s] ?? s;
	}

	// --- Adatok betöltése ---
	async function loadDetail() {
		if (!employeeId) return;
		loading = true;
		error = null;
		try {
			view = await sdk?.remote?.call('getEmployeeDetails', { employeeId });
		} catch (err: any) {
			error = err?.message ?? t('error.loadFailed');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (sdk?.remote && employeeId) {
			loadDetail();
		}
	});

	// --- Alapadatok szerkesztése ---
	function startEditBasic() {
		if (!view) return;
		editPosition = view.employee.position ?? '';
		editStatus = view.employee.status;
		editHireDate = view.employment.hireDate ?? '';
		editEndDate = view.employment.employmentEndDate ?? '';
		editIsExternal = view.employee.isExternal === true;
		editingBasic = true;
	}

	function cancelEditBasic() {
		editingBasic = false;
	}

	async function saveBasic() {
		if (!view) return;
		// A dátumokat csak változáskor küldjük: a belépés mentése ellenőrzöttnek jelöli a dátumot
		const hireChanged = !!editHireDate && editHireDate !== view.employment.hireDate;
		const endChanged = (editEndDate || null) !== view.employment.employmentEndDate;
		basicSaving = true;
		try {
			const updated = await sdk?.remote?.call('updateEmployee', {
				id: view.employee.id,
				position: editPosition || undefined,
				status: editStatus,
				hireDate: hireChanged ? editHireDate : undefined,
				employmentEndDate: endChanged ? editEndDate || null : undefined,
				isExternal: editIsExternal
			});
			editingBasic = false;
			if (hireChanged || endChanged) afterDatesChanged(updated?.recalculated);
			else sdk?.ui?.toast(t('employeeDetail.saveSuccess'), 'success');
			await loadDetail();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed'), 'error');
		} finally {
			basicSaving = false;
		}
	}

	/** A létrehozáskor beírt belépési dátum jóváhagyása változtatás nélkül. */
	async function confirmHireDate() {
		if (!view?.employment.hireDate) return;
		try {
			const updated = await sdk?.remote?.call('updateEmployee', {
				id: view.employee.id,
				hireDate: view.employment.hireDate
			});
			afterDatesChanged(updated?.recalculated);
			await loadDetail();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed'), 'error');
		}
	}

	async function saveBirthDate() {
		if (!view) return;
		birthSaving = true;
		try {
			const result = await sdk?.remote?.call('saveEmployeeBirthDate', {
				employeeId: view.employee.id,
				birthDate: editBirthDate || null
			});
			editingBirth = false;
			afterDatesChanged(result?.recalculated);
			await loadDetail();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed'), 'error');
		} finally {
			birthSaving = false;
		}
	}

	// --- Adatlap részlet kezelése ---
	function startAddDetail(category: Category) {
		detailEdit = { mode: 'add', category, fieldKey: '', fieldValue: '' };
	}

	function startEditDetail(detail: EmployeeDetail) {
		detailEdit = {
			mode: 'edit',
			category: detail.category,
			fieldKey: detail.fieldKey,
			fieldValue: detail.fieldValue,
			id: detail.id
		};
	}

	function cancelDetailEdit() {
		detailEdit = null;
	}

	async function saveDetail() {
		if (!detailEdit || !view) return;
		if (!detailEdit.fieldKey.trim() || !detailEdit.fieldValue.trim()) {
			sdk?.ui?.toast(t('form.required'), 'warning');
			return;
		}
		detailSaving = true;
		try {
			const saved: EmployeeDetail = await sdk?.remote?.call('saveEmployeeDetail', {
				employeeId: view.employee.id,
				category: detailEdit.category,
				fieldKey: detailEdit.fieldKey.trim(),
				fieldValue: detailEdit.fieldValue.trim()
			});

			// Frissítjük a helyi állapotot
			const existing = view.details.findIndex(
				(d) => d.category === saved.category && d.fieldKey === saved.fieldKey
			);
			if (existing >= 0) {
				view = {
					...view,
					details: view.details.map((d, i) => (i === existing ? saved : d))
				};
			} else {
				view = { ...view, details: [...view.details, saved] };
			}

			detailEdit = null;
			sdk?.ui?.toast(t('employeeDetail.saveSuccess'), 'success');
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			detailSaving = false;
		}
	}

	async function deleteDetail(detail: EmployeeDetail) {
		if (!view) return;
		try {
			await sdk?.remote?.call('deleteEmployeeDetail', { id: detail.id });
			view = { ...view, details: view.details.filter((d) => d.id !== detail.id) };
			sdk?.ui?.toast(t('employeeDetail.deleteSuccess'), 'success');
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	// Részletek kategória szerint csoportosítva
	const detailsByCategory = $derived(
		CATEGORIES.reduce(
			(acc, cat) => {
				acc[cat] = view?.details.filter((d) => d.category === cat) ?? [];
				return acc;
			},
			{} as Record<Category, EmployeeDetail[]>
		)
	);

</script>

<div class="rw">
<section class="page">
	<div class="page-header">
		<button class="btn-back" onclick={() => sdk?.ui?.navigateTo('EmployeeList')}>{t('employeeDetail.back')}</button>
		<h2>{t('employeeDetail.title')}</h2>
	</div>

	{#if loading}
		<div class="loading-state">
			<div class="spinner"></div>
			<span>{t('loading')}</span>
		</div>
	{:else if error}
		<div class="error-state">
			<p>{error}</p>
			<button class="btn-secondary" onclick={loadDetail}>{t('error.retry')}</button>
		</div>
	{:else if !employeeId}
		<p class="empty-state">{t('employeeDetail.noEmployee')}</p>
	{:else if view}
		{#if canViewDocuments}
			<div class="tabs" role="tablist">
				<button
					class="tab"
					class:active={activeTab === 'details'}
					role="tab"
					aria-selected={activeTab === 'details'}
					onclick={() => (activeTab = 'details')}
				>
					{t('employeeDetail.tabs.details')}
				</button>
				<button
					class="tab"
					class:active={activeTab === 'documents'}
					role="tab"
					aria-selected={activeTab === 'documents'}
					onclick={() => (activeTab = 'documents')}
				>
					{t('employeeDetail.tabs.documents')}
				</button>
			</div>
		{/if}

		{#if activeTab === 'documents' && canViewDocuments}
			<div class="tab-content">
				<EmployeeDocumentsTab {pluginId} employeeId={view.employee.id} />
			</div>
		{:else}
		<!-- Két hasábos elrendezés: bal = alapadatok + kategóriák, jobb = szabadságkeret -->
		<div class="two-col-grid">
			<div class="col-main">
				<!-- Alapadatok kártya -->
				<div class="card">
			<div class="card-header">
				<h3>{t('employeeDetail.basicInfo')}</h3>
				{#if !editingBasic && canManageEmployee}
					<button class="btn-ghost" onclick={startEditBasic}>{t('employeeDetail.editDetail')}</button>
				{/if}
			</div>

			<div class="profile-row">
				{#if view.employee.userImage}
					<img src={view.employee.userImage} alt={view.employee.userName} class="profile-img" />
				{:else}
					<div class="profile-placeholder">
						{view.employee.userName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
					</div>
				{/if}
				<div class="profile-info">
					<span class="profile-name">{view.employee.userName}</span>
					<span class="profile-email">{view.employee.userEmail}</span>
					{#if view.employee.isExternal}
						<span class="badge badge-external">{t('employees.external.badge')}</span>
					{/if}
				</div>
			</div>

			{#if editingBasic}
				<div class="basic-edit-form">
					<label class="form-label">
						{t('employeeDetail.position')}
						<input class="form-input" type="text" bind:value={editPosition} />
					</label>
					<label class="form-label">
						{t('employeeDetail.status')}
						<select class="form-input" bind:value={editStatus}>
							<option value="active">{t('employees.status.active')}</option>
							<option value="inactive">{t('employees.status.inactive')}</option>
							<option value="onLeave">{t('employees.status.onLeave')}</option>
						</select>
					</label>
					<label class="external-row" class:enabled={editIsExternal}>
						<Checkbox
							checked={editIsExternal}
							onCheckedChange={(checked) => (editIsExternal = checked)}
						/>
						<span class="external-text">
							<span class="external-label">{t('employeeDetail.external')}</span>
							<span class="external-hint">{t('employeeDetail.external.hint')}</span>
						</span>
					</label>
					<div class="date-pair">
						<label class="form-label">
							{t('employeeDetail.hireDate')}
							<input class="form-input" type="date" bind:value={editHireDate} />
						</label>
						<label class="form-label">
							{t('employeeDetail.employmentEndDate')}
							<input class="form-input" type="date" bind:value={editEndDate} />
						</label>
					</div>
					<p class="field-hint">{t('employeeDetail.datesHint')}</p>
					<div class="form-actions">
						<button class="btn-secondary" onclick={cancelEditBasic}>{t('form.cancel')}</button>
						<button class="btn-primary" onclick={saveBasic} disabled={basicSaving}>
							{basicSaving ? t('loading') : t('form.save')}
						</button>
					</div>
				</div>
			{:else}
				<div class="basic-fields">
					<div class="field-row">
						<span class="field-label">{t('employeeDetail.position')}</span>
						<span class="field-value">{view.employee.position ?? '—'}</span>
					</div>
					<div class="field-row">
						<span class="field-label">{t('employeeDetail.hireDate')}</span>
						<span class="field-value">{formatDay(view.employment.hireDate)}</span>
					</div>
					<div class="field-row">
						<span class="field-label">{t('employeeDetail.employmentEndDate')}</span>
						<span class="field-value">{formatDay(view.employment.employmentEndDate)}</span>
					</div>
					<div class="field-row">
						<span class="field-label">{t('employeeDetail.status')}</span>
						<span class="field-value">
							<span class="badge badge-{view.employee.status}">{statusLabel(view.employee.status)}</span>
						</span>
					</div>
				</div>
				{#if view.employee.isExternal}
					<div class="notice"><span>{t('employees.external.notice')}</span></div>
				{:else if !view.employment.hireDateConfirmed}
					<div class="notice">
						<span>{t('leaveEntitlement.profile.hireDateUnconfirmed')}</span>
						{#if canManageEmployee && view.employment.hireDate}
							<button class="btn-secondary btn-sm" onclick={confirmHireDate}>
								{t('employeeDetail.confirmHireDate')}
							</button>
						{/if}
					</div>
				{/if}
			{/if}
		</div>

				<!-- Kategóriák: az adatlapot csak a dolgozó maga és a HR kapja meg a szervertől -->
				{#if !view.detailsVisible}
					<div class="notice"><span>{t('employeeDetail.detailsRestricted')}</span></div>
				{:else}
				{#each CATEGORIES as cat (cat)}
			<div class="card">
				<div class="card-header">
					<h3>{categoryLabel(cat)}</h3>
					{#if canManageEmployee}
						<button class="btn-ghost" onclick={() => startAddDetail(cat)}>
							+ {t('employeeDetail.addDetail')}
						</button>
					{/if}
				</div>

				<!-- A születési dátum rögzített mező: csak a HR és maga a dolgozó látja -->
				{#if cat === 'personal' && view.personal}
					{#if editingBirth}
						<div class="birth-edit">
							<label class="form-label">
								{t('employeeDetail.birthDate')}
								<input class="form-input" type="date" bind:value={editBirthDate} />
							</label>
							<div class="form-actions">
								<button class="btn-secondary" onclick={() => (editingBirth = false)}>{t('form.cancel')}</button>
								<button class="btn-primary" onclick={saveBirthDate} disabled={birthSaving}>
									{birthSaving ? t('loading') : t('form.save')}
								</button>
							</div>
						</div>
					{:else}
						<div class="field-row fixed-row">
							<span class="field-label">{t('employeeDetail.birthDate')}</span>
							<span class="field-value">{formatDay(view.personal.birthDate)}</span>
							{#if canEditPersonal}
								<button
									class="btn-ghost-sm"
									onclick={() => {
										editBirthDate = view?.personal?.birthDate ?? '';
										editingBirth = true;
									}}
								>
									{t('employeeDetail.editDetail')}
								</button>
							{/if}
						</div>
					{/if}
					<!-- A kiküldetési rendelvény fix mezői (specs/business-trips.md, K17) -->
					<PersonalDataFields
						{pluginId}
						employeeId={view.employee.id}
						personal={view.personal}
						canEdit={canManageEmployee}
						onSaved={loadDetail}
					/>
				{/if}

				{#if detailsByCategory[cat].length === 0}
					{#if !(cat === 'personal' && view.personal)}
						<p class="empty-state">{t('employeeDetail.noDetails')}</p>
					{/if}
				{:else}
					<div class="details-list">
						{#each detailsByCategory[cat] as detail (detail.id)}
							<div class="detail-row">
								<span class="detail-key">{detail.fieldKey}</span>
								<span class="detail-value">{detail.fieldValue}</span>
								{#if canManageEmployee}
									<div class="detail-actions">
										<button class="btn-ghost-sm" onclick={() => startEditDetail(detail)}>
											{t('employeeDetail.editDetail')}
										</button>
										<button class="btn-ghost-sm danger" onclick={() => deleteDetail(detail)}>
											{t('employeeDetail.deleteDetail')}
										</button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<!-- Inline szerkesztő az adott kategóriához -->
				{#if detailEdit && detailEdit.category === cat}
					<div class="detail-edit-form">
						<label class="form-label">
							{t('employeeDetail.fieldKey')}
							<input
								class="form-input"
								type="text"
								bind:value={detailEdit.fieldKey}
								disabled={detailEdit.mode === 'edit'}
								placeholder={t('employeeDetail.fieldKeyPlaceholder')}
							/>
						</label>
						<label class="form-label">
							{t('employeeDetail.fieldValue')}
							<input
								class="form-input"
								type="text"
								bind:value={detailEdit.fieldValue}
								placeholder={t('employeeDetail.fieldValuePlaceholder')}
							/>
						</label>
						<div class="form-actions">
							<button class="btn-secondary" onclick={cancelDetailEdit}>{t('form.cancel')}</button>
							<button class="btn-primary" onclick={saveDetail} disabled={detailSaving}>
								{detailSaving ? t('loading') : t('form.save')}
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/each}
				{/if}
			</div><!-- /col-main -->

			<!-- Jobb hasáb: szabadságkeret és a számítás adatai -->
			{#if canManageBalance && !view.employee.isExternal}
				<div class="col-side">
					<DataRequestReview {pluginId} employeeId={view.employee.id} onDecided={onLeaveProfileChanged} />
					<LeaveBalanceCard {pluginId} employeeId={view.employee.id} refreshKey={balanceRefreshKey} />
					<OtherAllowances {pluginId} employeeId={view.employee.id} refreshKey={balanceRefreshKey} />
					<LeaveProfileCard
						{pluginId}
						employeeId={view.employee.id}
						refreshKey={balanceRefreshKey}
						onChanged={onLeaveProfileChanged}
					/>
				</div><!-- /col-side -->
			{/if}
		</div><!-- /two-col-grid -->
		{/if}
	{/if}
</section>
</div>

<style>
	@import '../styles/shared.css';

	.badge-external {
		align-self: flex-start;
		background: #ede9fe;
		color: #6d28d9;
	}

	:global(.dark) .badge-external {
		background: rgba(124, 58, 237, 0.2);
		color: #c4b5fd;
	}

	/* A külsős jelölés sora: mint az Értesítések beállítás sorai */
	.external-row {
		display: flex;
		/* Az adatlap label szabálya oszlopba tenné */
		flex-direction: row;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.5rem;
		cursor: pointer;
		transition: background 0.1s;
	}

	.external-row:hover,
	.external-row.enabled {
		background: var(--color-accent, #f1f5f9);
	}

	.external-row :global(.wk-checkbox) {
		margin-top: 0.125rem;
	}

	.external-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.external-label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.external-hint {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--color-muted-foreground, #64748b);
	}

	.page {
        --max-col-width: 600px;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		container-type: inline-size;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		max-width: calc(var(--max-col-width) * 2);
	}

	.tab {
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 0.5rem 0.75rem;
		margin-bottom: -1px;
		font-size: 0.875rem;
		cursor: pointer;
		color: var(--color-muted-foreground, #64748b);
	}

	.tab:hover {
		color: var(--color-foreground, #0f172a);
	}

	.tab.active {
		color: var(--color-primary, #3730a3);
		border-bottom-color: var(--color-primary, #3730a3);
		font-weight: 600;
	}

	.tab-content {
		max-width: calc(var(--max-col-width) * 2);
	}

	.two-col-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem;
		align-items: start;
        max-width: calc(var(--max-col-width) * 2);
	}

	@container (max-width: 1200px) {
		.two-col-grid {
			grid-template-columns: 1fr;
		}
	}

	.col-main {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
        max-width: var(--max-col-width);
	}

	.col-side {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		align-self: stretch;
        max-width: var(--max-col-width);
	}

	/* Kártya */
	.card {
		--card-accent: var(--color-card, #ffffff);
		border: 1px solid var(--color-border, #e2e8f0);
		border-top: 5px solid var(--card-accent);
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* Kártya kiemelő színek */
	.card.accent-blue   { --card-accent: #3b82f6; }
	.card.accent-green  { --card-accent: #22c55e; }
	.card.accent-yellow { --card-accent: #eab308; }
	.card.accent-red    { --card-accent: #ef4444; }
	.card.accent-purple { --card-accent: #a855f7; }
	.card.accent-orange { --card-accent: #f97316; }

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.card-header h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
	}

	/* Profil */
	.profile-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.profile-img {
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		object-fit: cover;
	}

	.profile-placeholder {
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		background: var(--color-primary-subtle, #e0e7ff);
		color: var(--color-primary, #3730a3);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.9rem;
		flex-shrink: 0;
	}

	.profile-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.profile-name {
		font-weight: 600;
		font-size: 1rem;
	}

	.profile-email {
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #64748b);
	}

	/* Alapadatok */
	.basic-fields {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-border, #f1f5f9);
	}

	.field-row:last-child { border-bottom: none; }

	.field-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		min-width: 140px;
		font-weight: 500;
	}

	.field-value {
		font-size: 0.875rem;
		color: var(--color-foreground, #0f172a);
	}

	.notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: #fef3c7;
		color: #92400e;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.date-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.field-hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.fixed-row .field-value {
		flex: 1;
	}

	.birth-edit {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	:global(.dark) .notice {
		background: oklch(0.3 0.05 60);
		color: #fde68a;
	}

	/* Adatlap részletek */
	.details-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.detail-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-accent, #f8fafc);
		font-size: 0.875rem;
	}

	.detail-key {
		font-weight: 500;
		min-width: 140px;
		color: var(--color-muted-foreground, #475569);
	}

	.detail-value {
		flex: 1;
		color: var(--color-foreground, #0f172a);
	}

	.detail-actions {
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.detail-row:hover .detail-actions { opacity: 1; }

	/* Szerkesztő form */
	.basic-edit-form, .detail-edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-accent, #f8fafc);
		border-radius: 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
	}

	.form-label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.form-input {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.875rem;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
	}

	.form-input:focus {
		outline: 2px solid var(--color-primary, #3730a3);
		outline-offset: 1px;
	}

	.form-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	/* Gombok */
	.btn-ghost {
		border: none;
		background: transparent;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
	}

	.btn-ghost:hover { background: var(--color-primary-subtle, #e0e7ff); }

	.btn-ghost-sm {
		border: none;
		background: transparent;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.btn-ghost-sm:hover { background: var(--color-accent, #f1f5f9); }
	.btn-ghost-sm.danger:hover { background: #fee2e2; color: #dc2626; }

	.btn-back {
		border: none;
		background: transparent;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.875rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.btn-back:hover { background: var(--color-accent, #f1f5f9); }

	/* Badge */
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.badge-active { background: #dcfce7; color: #166534; }
	.badge-inactive { background: #f1f5f9; color: #475569; }
	.badge-onLeave { background: #dbeafe; color: #1e40af; }

	/* Betöltés / hiba */
	.error-state {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		color: #dc2626;
		padding: 1rem 0;
	}

	/* Sötét mód fallback értékek (ha a CSS változók nem örökölnek) */
	:global(.dark) .page {
		--page-bg: oklch(0.205 0 0);
		--page-fg: oklch(0.985 0 0);
		--page-border: oklch(1 0 0 / 10%);
		--page-card: oklch(0.205 0 0);
		--page-muted: oklch(0.708 0 0);
		--page-accent: oklch(0.269 0 0);
		--page-input: oklch(0.269 0 0);
	}

	:global(.dark) .card {
		background: var(--color-card, oklch(0.205 0 0));
		border: none;
		border-top: 3px solid var(--card-accent, oklch(0.205 0 0));
	}

	:global(.dark) .card:not([class*="accent-"]) {
		--card-accent: var(--color-card, oklch(0.205 0 0));
	}

	:global(.dark) .card.accent-blue   { --card-accent: #3b82f6; }
	:global(.dark) .card.accent-green  { --card-accent: #22c55e; }
	:global(.dark) .card.accent-yellow { --card-accent: #eab308; }
	:global(.dark) .card.accent-red    { --card-accent: #ef4444; }
	:global(.dark) .card.accent-purple { --card-accent: #a855f7; }
	:global(.dark) .card.accent-orange { --card-accent: #f97316; }

	:global(.dark) .form-input {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}
</style>
