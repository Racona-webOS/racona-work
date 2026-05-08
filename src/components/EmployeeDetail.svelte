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
	import type {
		EmployeeDetailView,
		EmployeeDetail,
		EmployeeRow,
		LeaveBalance
	} from '../../server/functions.js';

	let {
		pluginId = 'racona-work',
		employeeId = null
	}: {
		pluginId?: string;
		employeeId?: number | null;
	} = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- Állapot ---
	let view = $state<EmployeeDetailView | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

// Aktuális szervezet a window store-ból
function getCurrentOrganizationId(): number | null {
const store = (window as any).__racona_work_org_store__;
return store?.currentOrganization?.id ?? null;
}
	// Alapadatok szerkesztése
	let editingBasic = $state(false);
	let editPosition = $state('');
	let editDepartment = $state('');
	let editStatus = $state('');
	let basicSaving = $state(false);

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

	function formatDate(d: string | null): string {
		if (!d) return '—';
		return new Date(d).toLocaleDateString();
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
			loadBalances(employeeId);
		}
	});

	// --- Alapadatok szerkesztése ---
	function startEditBasic() {
		if (!view) return;
		editPosition = view.employee.position ?? '';
		editDepartment = view.employee.department ?? '';
		editStatus = view.employee.status;
		editingBasic = true;
	}

	function cancelEditBasic() {
		editingBasic = false;
	}

	async function saveBasic() {
		if (!view) return;
		basicSaving = true;
		try {
			const updated = await sdk?.remote?.call('updateEmployee', {
				id: view.employee.id,
				position: editPosition || undefined,
				department: editDepartment || undefined,
				status: editStatus
			});
			view = {
				...view,
				employee: { ...view.employee, ...updated }
			};
			editingBasic = false;
			sdk?.ui?.toast(t('employeeDetail.saveSuccess'), 'success');
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			basicSaving = false;
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

	// --- Szabadságkeret ---
	let balances = $state<LeaveBalance[]>([]);
	let balancesLoading = $state(false);
	let balanceYear = $state(new Date().getFullYear());
	let balanceTotalDays = $state(25);
	let balanceSaving = $state(false);
	let balanceError = $state<string | null>(null);

	async function loadBalances(empId: number) {
		balancesLoading = true;
		try {
			balances = await sdk?.remote?.call('getLeaveBalances', { employeeId: empId }) ?? [];
		} catch { balances = []; }
		finally { balancesLoading = false; }
	}

	async function saveBalance() {
		if (!view?.employee?.id) return;
		balanceSaving = true;
		balanceError = null;
		try {
			const organizationId = getCurrentOrganizationId();
			if (!organizationId) throw new Error('Nincs kiválasztott szervezet');
			const saved: any = await sdk?.remote?.call('setLeaveBalance', {
				employeeId: view.employee.id,
				organizationId,
				year: balanceYear,
				totalDays: balanceTotalDays
			});
			const idx = balances.findIndex((b) => b.year === saved.year);
			if (idx >= 0) balances = balances.map((b, i) => (i === idx ? saved : b));
			else balances = [saved, ...balances].sort((a, b) => b.year - a.year);
			sdk?.ui?.toast(t('employeeDetail.balanceSaved') || 'Keret mentve ✓', 'success');
		} catch (err: any) {
			balanceError = err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
		} finally {
			balanceSaving = false;
		}
	}
</script>

<section class="page">
	<!-- Fejléc -->
	<div class="page-header">
		<button class="btn-back" onclick={() => sdk?.ui?.navigateTo('EmployeeList')}>← Vissza</button>
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
			<button class="btn-secondary" onclick={loadDetail}>Újra</button>
		</div>
	{:else if !employeeId}
		<p class="empty-state">Nincs kiválasztott dolgozó.</p>
	{:else if view}
		<!-- Két hasábos elrendezés: bal = alapadatok + kategóriák, jobb = szabadságkeret -->
		<div class="two-col-grid">
			<div class="col-main">
				<!-- Alapadatok kártya -->
				<div class="card">
			<div class="card-header">
				<h3>{t('employeeDetail.basicInfo')}</h3>
				{#if !editingBasic}
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
				</div>
			</div>

			{#if editingBasic}
				<div class="basic-edit-form">
					<label class="form-label">
						{t('employeeDetail.position')}
						<input class="form-input" type="text" bind:value={editPosition} />
					</label>
					<label class="form-label">
						{t('employeeDetail.department')}
						<input class="form-input" type="text" bind:value={editDepartment} />
					</label>
					<label class="form-label">
						{t('employeeDetail.status')}
						<select class="form-input" bind:value={editStatus}>
							<option value="active">{t('employees.status.active')}</option>
							<option value="inactive">{t('employees.status.inactive')}</option>
							<option value="onLeave">{t('employees.status.onLeave')}</option>
						</select>
					</label>
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
						<span class="field-label">{t('employeeDetail.department')}</span>
						<span class="field-value">{view.employee.department ?? '—'}</span>
					</div>
					<div class="field-row">
						<span class="field-label">{t('employeeDetail.hireDate')}</span>
						<span class="field-value">{formatDate(view.employee.hireDate)}</span>
					</div>
					<div class="field-row">
						<span class="field-label">{t('employeeDetail.status')}</span>
						<span class="field-value">
							<span class="badge badge-{view.employee.status}">{statusLabel(view.employee.status)}</span>
						</span>
					</div>
				</div>
			{/if}
		</div>

				<!-- Kategóriák -->
				{#each CATEGORIES as cat (cat)}
			<div class="card">
				<div class="card-header">
					<h3>{categoryLabel(cat)}</h3>
					<button class="btn-ghost" onclick={() => startAddDetail(cat)}>
						+ {t('employeeDetail.addDetail')}
					</button>
				</div>

				{#if detailsByCategory[cat].length === 0}
					<p class="empty-state">{t('employeeDetail.noDetails')}</p>
				{:else}
					<div class="details-list">
						{#each detailsByCategory[cat] as detail (detail.id)}
							<div class="detail-row">
								<span class="detail-key">{detail.fieldKey}</span>
								<span class="detail-value">{detail.fieldValue}</span>
								<div class="detail-actions">
									<button class="btn-ghost-sm" onclick={() => startEditDetail(detail)}>
										{t('employeeDetail.editDetail')}
									</button>
									<button class="btn-ghost-sm danger" onclick={() => deleteDetail(detail)}>
										{t('employeeDetail.deleteDetail')}
									</button>
								</div>
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
								placeholder="pl. Telefonszám"
							/>
						</label>
						<label class="form-label">
							{t('employeeDetail.fieldValue')}
							<input
								class="form-input"
								type="text"
								bind:value={detailEdit.fieldValue}
								placeholder="pl. +36 30 123 4567"
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
			</div><!-- /col-main -->

			<!-- Jobb hasáb: szabadságkeret -->
			<div class="col-side">
				<div class="card accent-blue">
					<div class="card-header">
						<h3>Szabadságkeret</h3>
					</div>

					{#if balancesLoading}
						<div class="loading-state"><div class="spinner"></div></div>
					{:else if balances.length > 0}
						<table class="balance-table">
							<thead>
								<tr>
									<th>Év</th>
									<th>Összes nap</th>
									<th>Felhasznált</th>
									<th>Maradék</th>
								</tr>
							</thead>
							<tbody>
								{#each balances as b (b.year)}
									<tr>
										<td>{b.year}</td>
										<td>{b.totalDays}</td>
										<td>{b.usedDays}</td>
										<td class={b.remainingDays <= 0 ? 'text-danger' : 'text-success'}>{b.remainingDays}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}
						<p class="empty-hint">Még nincs beállított szabadságkeret.</p>
					{/if}

					<div class="balance-form">
						<h4>Keret beállítása / módosítása</h4>
						<div class="form-row">
							<label class="form-label">
								Év
								<input class="form-input" type="number" bind:value={balanceYear} min={2020} max={2099} />
							</label>
							<label class="form-label">
								Összes nap
								<input class="form-input" type="number" bind:value={balanceTotalDays} min={0} max={365} />
							</label>
							<button class="btn-primary" onclick={saveBalance} disabled={balanceSaving}>
								{balanceSaving ? t('loading') : t('form.save')}
							</button>
						</div>
						{#if balanceError}
							<p class="form-error">{balanceError}</p>
						{/if}
					</div>
				</div>
			</div><!-- /col-side -->
		</div><!-- /two-col-grid -->
	{/if}
</section>

<style>
	.page {
        --max-col-width: 600px;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		container-type: inline-size;
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

	.col-side .card {
		height: 100%;
	}

	.balance-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}

	.balance-table th, .balance-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.balance-table th {
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.75rem;
		text-transform: uppercase;
	}

	.balance-form {
		border-top: 1px solid var(--color-border, #e2e8f0);
		padding-top: 1rem;
	}

	.balance-form h4 {
		font-size: 0.875rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
	}

	.balance-form .form-row {
		display: flex;
		flex-direction: row;
		align-items: flex-end;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.balance-form .form-label {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
	}

	.text-danger { color: #dc2626; font-weight: 600; }
	.text-success { color: #16a34a; font-weight: 600; }
	.empty-hint { color: var(--color-muted-foreground, #94a3b8); font-size: 0.875rem; margin: 0; }

	.page-header {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
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
	.btn-primary {
		background: var(--color-primary, #3730a3);
		color: #fff;
		border: none;
		padding: 0.4rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.btn-primary:hover { opacity: 0.9; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-secondary {
		border: 1px solid var(--color-border, #e2e8f0);
		background: transparent;
		padding: 0.4rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.btn-secondary:hover { background: var(--color-accent, #f1f5f9); }

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
	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		padding: 2rem 0;
	}

	.spinner {
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid var(--color-border, #e2e8f0);
		border-top-color: var(--color-primary, #3730a3);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.error-state {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		color: #dc2626;
		padding: 1rem 0;
	}

	.empty-state {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.875rem;
		margin: 0;
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

	:global(.dark) .balance-table th,
	:global(.dark) .balance-table td {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}
</style>
