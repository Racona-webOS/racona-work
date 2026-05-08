<svelte:options customElement={{ tag: 'racona-work-leave-requests', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_LeaveRequests = function () {
			return { tagName: 'racona-work-leave-requests' };
		};
	}
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		LeaveRequestRow,
		LeaveBalance,
		EmployeeRow,
		PaginatedResult
	} from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	// Organization store - inicializálás
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<import('../../server/functions.js').Organization | null>(null);
	let hasAccess = $state(false);

	// --- Képességek ---
	let canApprove = $state(false);
	let canManageBalance = $state(false);
	let isManagerView = $derived(canApprove);

	// --- Saját dolgozói rekord (self-service) ---
	let myEmployee = $state<import('../../server/functions.js').EmployeeRow | null>(null);

	// --- Nézet: 'mine' vagy 'all'. Ha nem vagyunk manager, mindig 'mine'. ---
	let viewMode = $state<'mine' | 'all'>('all');

	function t(key: string, vars?: Record<string, string | number>): string {
		let result = sdk?.i18n?.t(key) ?? key;
		if (vars) {
			for (const [k, v] of Object.entries(vars)) {
				result = result.replace(`{${k}}`, String(v));
			}
		}
		return result;
	}

	// --- SDK komponensek ---
	const DataTable = $derived(sdk?.components?.DataTable);
	const DataTableColumnHeader = $derived(sdk?.components?.DataTableColumnHeader);
	const renderComponent = $derived(sdk?.components?.renderComponent);
	const renderSnippet = $derived(sdk?.components?.renderSnippet);
	const createActionsColumn = $derived(sdk?.components?.createActionsColumn);
	const DatePickerComponent = $derived(sdk?.components?.DatePicker ?? null);
	let createRawSnippet: any = $state(null);

	// --- Táblázat állapot ---
	let data = $state<LeaveRequestRow[]>([]);
	let loading = $state(false);
	let paginationInfo = $state({ page: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
	let tableState = $state({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' as 'asc' | 'desc' });
	let columns = $state<any[]>([]);

	// --- Új kérelem modal ---
	let showNewRequestModal = $state(false);
	let employees = $state<EmployeeRow[]>([]);
	let employeesLoading = $state(false);
	let newReqEmployeeId = $state<number | null>(null);
	let newReqType = $state('annual');
	let newReqStartDate = $state('');
	let newReqEndDate = $state('');
	let newReqReason = $state('');
	let newReqLoading = $state(false);
	let newReqError = $state<string | null>(null);

	// --- Szabadságkeret modal ---
	let showBalanceModal = $state(false);
	let balanceEmployeeId = $state<number | null>(null);
	let balances = $state<LeaveBalance[]>([]);
	let balancesLoading = $state(false);
	let balanceYear = $state(new Date().getFullYear());
	let balanceTotalDays = $state(25);
	let balanceSaving = $state(false);

	// --- Adatok betöltése ---
	async function loadData() {
		if (!currentOrganization) return;

		loading = true;
		try {
			const useEmployeeFilter = viewMode === 'mine' ? myEmployee?.id : undefined;
			const result: PaginatedResult<LeaveRequestRow> = await sdk?.remote?.call('getLeaveRequests', {
				organizationId: currentOrganization.id,
				page: tableState.page,
				pageSize: tableState.pageSize,
				sortBy: tableState.sortBy,
				sortOrder: tableState.sortOrder,
				employeeId: useEmployeeFilter
			});
			data = result?.data ?? [];
			paginationInfo = result?.pagination ?? { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 };
		} catch (err: any) {
			// Szerver hibaüzenet megjelenítése (REMOTE_ERROR: prefix eltávolítása),
			// hogy a user lássa, miért nem sikerült (pl. nincs jogosultság).
			const msg = err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.loadFailed');
			sdk?.ui?.toast(msg, 'error');
			data = [];
		} finally {
			loading = false;
		}
	}

	function handleStateChange(state: any) {
		tableState = state;
	}

	$effect(() => {
		tableState;
		untrack(() => {
			if (columns.length > 0 && sdk?.remote && currentOrganization) loadData();
		});
	});

	$effect(() => {
		viewMode;
		untrack(() => {
			if (columns.length > 0 && sdk?.remote && currentOrganization) loadData();
		});
	});

	// Szervezet váltáskor újratölt
	$effect(() => {
		currentOrganization;
		untrack(() => {
			if (currentOrganization && columns.length > 0 && sdk?.remote) loadData();
		});
	});

	// organization-changed event: frissíti a currentOrganization $state-et
	$effect(() => {
		const handleOrgChange = async () => {
			const store = (window as any).__racona_work_org_store__;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
				canApprove = store.can('leave.approve');
				canManageBalance = store.can('leave.balance.manage');
				viewMode = canApprove ? 'all' : 'mine';
				// Új szervezet → új saját employee
				if (currentOrganization && sdk?.remote) {
					try {
						myEmployee = (await sdk.remote.call('getMyEmployee', {
							organizationId: currentOrganization.id
						})) as typeof myEmployee;
					} catch {
						myEmployee = null;
					}
				} else {
					myEmployee = null;
				}
				// Oszlopok frissítése, mert canApprove befolyásolja az action column-t
				buildColumns();
				if (columns.length > 0) loadData();
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	// --- Jóváhagyás ---
	async function approveRequest(row: LeaveRequestRow) {
		try {
			const result: any = await sdk?.remote?.call('approveLeaveRequest', { id: row.id });
			sdk?.ui?.toast(t('leaveRequests.approveSuccess'), 'success');

			// Értesítés küldése az érintett dolgozónak (8.7)
			if (result?._notifyEmployeeId) {
				sdk?.notifications?.send({
					userId: result._notifyEmployeeId,
					title: 'Szabadság igény elfogadva',
					message: `${row.employeeName}: ${formatDate(row.startDate)} – ${formatDate(row.endDate)}`
				});
			}

			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		}
	}

	// --- Elutasítás ---
	async function rejectRequest(row: LeaveRequestRow) {
		try {
			const result: any = await sdk?.remote?.call('rejectLeaveRequest', { id: row.id });
			sdk?.ui?.toast(t('leaveRequests.rejectSuccess'), 'success');

			// Értesítés küldése az érintett dolgozónak (8.7)
			if (result?._notifyEmployeeId) {
				sdk?.notifications?.send({
					userId: result._notifyEmployeeId,
					title: 'Szabadság igény elutasítva',
					message: `${row.employeeName}: ${formatDate(row.startDate)} – ${formatDate(row.endDate)}`
				});
			}

			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		}
	}

	// --- Új kérelem ---
	async function openNewRequestModal() {
		showNewRequestModal = true;
		newReqType = 'annual';
		newReqStartDate = '';
		newReqEndDate = '';
		newReqReason = '';
		newReqError = null;
		if (!currentOrganization) return;

		// Self-service: saját employee-t töltünk be, nem listát.
		if (!canApprove) {
			if (myEmployee) {
				newReqEmployeeId = myEmployee.id;
				employees = [];
			} else {
				newReqError = t('dashboard.self.noEmployee');
			}
			return;
		}

		// Manager: dolgozó-választóhoz lista kell.
		newReqEmployeeId = null;
		employeesLoading = true;
		try {
			const result: PaginatedResult<EmployeeRow> = await sdk?.remote?.call('getEmployees', {
				organizationId: currentOrganization.id,
				pageSize: 200,
				status: 'active'
			});
			employees = result?.data ?? [];
		} catch {
			employees = [];
		} finally {
			employeesLoading = false;
		}
	}

	async function submitNewRequest() {
		if (!newReqEmployeeId || !newReqStartDate || !newReqEndDate) {
			newReqError = t('form.required');
			return;
		}
		if (!currentOrganization) {
			newReqError = 'Nincs kiválasztott szervezet';
			return;
		}
		newReqLoading = true;
		newReqError = null;
		try {
			const result: any = await sdk?.remote?.call('createLeaveRequest', {
				employeeId: newReqEmployeeId,
				organizationId: currentOrganization.id,
				leaveType: newReqType,
				startDate: newReqStartDate,
				endDate: newReqEndDate,
				reason: newReqReason || undefined
			});

			// Értesítés küldése az értesítendőknek (8.8)
			if (result?._notifiers?.length > 0 && result?._notifierMessage) {
				const msg = result._notifierMessage;
				for (const userId of result._notifiers) {
					sdk?.notifications?.send({
						userId,
						title: t('leaveRequests.newRequest'),
						message: `${msg.employeeName}: ${formatDate(msg.startDate)} – ${formatDate(msg.endDate)} (${msg.days} nap)`
					});
				}
			}

			sdk?.ui?.toast(t('leaveRequests.newRequest') + ' ✓', 'success');
			showNewRequestModal = false;
			loadData();
		} catch (err: any) {
			const msg: string = err?.message ?? t('error.saveFailed');
			// REMOTE_ERROR: prefix eltávolítása
			newReqError = msg.replace(/^[A-Z_]+:\s*/, '');
		} finally {
			newReqLoading = false;
		}
	}

	// --- Törlés (jóváhagyott kérelem) ---
	async function deleteRequest(row: LeaveRequestRow) {
		const endDate = new Date(row.endDate);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const isPast = endDate < today;

		const confirmMsg = isPast
			? `Ez a szabadság már lejárt (${formatDate(row.endDate)}). Biztosan visszamenőlegesen törli?`
			: `Biztosan törli ${row.employeeName} szabadságát? (${formatDate(row.startDate)} – ${formatDate(row.endDate)})`;

		const confirmed = await sdk?.ui?.dialog({
			title: 'Szabadság törlése',
			message: confirmMsg,
			type: 'confirm',
			confirmLabel: 'Törlés',
			confirmVariant: 'destructive'
		});

		if (confirmed?.action !== 'confirm') return;

		try {
			const result: any = await sdk?.remote?.call('deleteLeaveRequest', { id: row.id });
			sdk?.ui?.toast('Szabadság törölve', 'success');

			if (result?._notifyUserId) {
				sdk?.notifications?.send({
					userId: result._notifyUserId,
					title: 'Szabadság igény törölve',
					message: `${result.employeeName}: ${formatDate(result.startDate)} – ${formatDate(result.endDate)}`
				});
			}

			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed'), 'error');
		}
	}

	// --- Szabadságkeret ---
	async function openBalanceModal(employeeId: number) {
		showBalanceModal = true;
		balanceEmployeeId = employeeId;
		balancesLoading = true;
		balanceYear = new Date().getFullYear();
		balanceTotalDays = 25;
		try {
			balances = await sdk?.remote?.call('getLeaveBalances', { employeeId }) ?? [];
		} catch {
			balances = [];
		} finally {
			balancesLoading = false;
		}
	}

	async function saveBalance() {
		if (!balanceEmployeeId) return;
		balanceSaving = true;
		try {
			await sdk?.remote?.call('setLeaveBalance', {
				employeeId: balanceEmployeeId,
				year: balanceYear,
				totalDays: balanceTotalDays
			});
			sdk?.ui?.toast(t('form.save') + ' ✓', 'success');
			balances = await sdk?.remote?.call('getLeaveBalances', { employeeId: balanceEmployeeId }) ?? [];
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			balanceSaving = false;
		}
	}

	// --- Segédfüggvények ---
	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '—';
		return new Date(dateStr).toLocaleDateString('hu-HU');
	}

	function leaveTypeLabel(type: string): string {
		const map: Record<string, string> = {
			annual: t('leaveRequests.type.annual'),
			sick: t('leaveRequests.type.sick'),
			unpaid: t('leaveRequests.type.unpaid'),
			other: t('leaveRequests.type.other')
		};
		return map[type] ?? type;
	}

	function statusLabel(status: string): string {
		const map: Record<string, string> = {
			pending: t('leaveRequests.status.pending'),
			approved: t('leaveRequests.status.approved'),
			rejected: t('leaveRequests.status.rejected')
		};
		return map[status] ?? status;
	}

	function statusClass(status: string): string {
		return { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected' }[status] ?? 'badge-pending';
	}

	// --- Oszlopok ---
	function buildColumns() {
		if (!DataTableColumnHeader || !renderComponent || !renderSnippet || !createRawSnippet || !createActionsColumn) {
			columns = [];
			return;
		}

		const handleSort = (columnId: string, descending: boolean) => {
			tableState = { ...tableState, sortBy: columnId, sortOrder: descending ? 'desc' : 'asc', page: 1 };
		};

		const actionsColumn = createActionsColumn((row: LeaveRequestRow) => {
			// Ha a user nem manager, nem ajánlunk fel semmilyen action-t.
			if (!canApprove) return [];

			if (row.status === 'pending') {
				return [
					{
						label: t('leaveRequests.approve'),
						onClick: () => approveRequest(row)
					},
					{
						label: t('leaveRequests.reject'),
						onClick: () => rejectRequest(row),
						variant: 'destructive' as const,
						separator: true
					}
				];
			}
			if (row.status === 'approved') {
				return [
					{
						label: 'Törlés',
						onClick: () => deleteRequest(row),
						variant: 'destructive' as const
					}
				];
			}
			// rejected — nincs akció
			return [];
		});

		columns = [
			{
				accessorKey: 'employeeName',
				enableHiding: true,
				meta: { title: t('leaveRequests.columns.employee') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('leaveRequests.columns.employee'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const name = row.original.employeeName ?? '—';
					const snippet = createRawSnippet(() => ({ render: () => `<span class="font-medium">${name}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'leaveType',
				enableHiding: true,
				meta: { title: t('leaveRequests.columns.type') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('leaveRequests.columns.type'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const label = leaveTypeLabel(row.original.leaveType);
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm">${label}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'startDate',
				enableHiding: true,
				meta: { title: t('leaveRequests.columns.startDate') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('leaveRequests.columns.startDate'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const val = formatDate(row.original.startDate);
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm text-muted-foreground">${val}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'endDate',
				enableHiding: true,
				meta: { title: t('leaveRequests.columns.endDate') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('leaveRequests.columns.endDate'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const val = formatDate(row.original.endDate);
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm text-muted-foreground">${val}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'days',
				enableHiding: true,
				meta: { title: t('leaveRequests.columns.days') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('leaveRequests.columns.days'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const val = row.original.days;
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm font-medium">${val}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'status',
				enableHiding: true,
				meta: { title: t('leaveRequests.columns.status') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('leaveRequests.columns.status'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const status = row.original.status;
					const label = statusLabel(status);
					const cls = statusClass(status);
					const snippet = createRawSnippet(() => ({
						render: () => `<span class="badge ${cls}">${label}</span>`
					}));
					return renderSnippet(snippet, {});
				}
			},
			actionsColumn
		];
	}

	onMount(async () => {
		// Store inicializálás
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

			canApprove = orgStore.can('leave.approve');
			canManageBalance = orgStore.can('leave.balance.manage');
			// Alap nézet: manager esetén 'all', dolgozó esetén 'mine'.
			viewMode = canApprove ? 'all' : 'mine';

			// Saját dolgozói rekord lekérése (self-service működéshez és szűréshez).
			if (currentOrganization) {
				try {
					myEmployee = (await sdk.remote.call('getMyEmployee', {
						organizationId: currentOrganization.id
					})) as typeof myEmployee;
				} catch {
					myEmployee = null;
				}
			}
		}

		try {
			const svelteModule = await import('svelte');
			createRawSnippet = svelteModule.createRawSnippet;
		} catch {}
		buildColumns();
		if (sdk?.remote && currentOrganization) loadData();

		return () => sdk?.ui?.clearActionBar();
	});

	// ActionBar kezelése - csak akkor jelenjen meg, ha van hozzáférés
	$effect(() => {
		if (hasAccess && sdk?.ui) {
			sdk.ui.setActionBar([
				{
					label: `+ ${t('leaveRequests.newRequest')}`,
					onClick: openNewRequestModal,
					variant: 'default'
				}
			]);
		} else if (sdk?.ui) {
			sdk.ui.clearActionBar();
		}
	});
</script>

<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="title-block">
			<div class="title-row">
				<div>
					<h2>{t('leaveRequests.title')}</h2>
					<p class="subtitle">
						{canApprove
							? t('leaveRequests.subtitle.manager')
							: t('leaveRequests.subtitle.self')}
					</p>
				</div>
				{#if canApprove}
					<div class="view-toggle">
						<button
							class="chip"
							class:active={viewMode === 'mine'}
							onclick={() => (viewMode = 'mine')}
						>
							{t('leaveRequests.viewToggle.mine')}
						</button>
						<button
							class="chip"
							class:active={viewMode === 'all'}
							onclick={() => (viewMode = 'all')}
						>
							{t('leaveRequests.viewToggle.all')}
						</button>
					</div>
				{/if}
			</div>
		</div>

		{#if DataTable && columns.length > 0}
			{#key data}
				<!-- svelte-ignore svelte_component_deprecated -->
				<svelte:component
					this={DataTable}
					{columns}
					{data}
					pagination={paginationInfo}
					{loading}
					onStateChange={handleStateChange}
				/>
			{/key}
		{:else}
			<div class="loading-state">
				<div class="spinner"></div>
				<span>{t('loading')}</span>
			</div>
		{/if}
	{/if}
</section>

<!-- Új kérelem modal -->
{#if showNewRequestModal}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal">
			<h3>{t('leaveRequests.newRequest')}</h3>

			{#if canApprove}
				<label class="form-label">
					{t('leaveRequests.form.employee')} *
					{#if employeesLoading}
						<div class="loading-inline"><div class="spinner-sm"></div></div>
					{:else}
						<select class="form-input" bind:value={newReqEmployeeId}>
							<option value={null}>{t('form.selectEmployee')}</option>
							{#each employees as emp (emp.id)}
								<option value={emp.id}>{emp.userName} ({emp.userEmail})</option>
							{/each}
						</select>
					{/if}
				</label>
			{/if}

			<label class="form-label">
				{t('leaveRequests.form.type')} *
				<select class="form-input" bind:value={newReqType}>
					<option value="annual">{t('leaveRequests.type.annual')}</option>
					<option value="sick">{t('leaveRequests.type.sick')}</option>
					<option value="unpaid">{t('leaveRequests.type.unpaid')}</option>
					<option value="other">{t('leaveRequests.type.other')}</option>
				</select>
			</label>

			<div class="form-row">
				<label class="form-label">
					{t('leaveRequests.form.startDate')} *
					{#if DatePickerComponent}
						<svelte:component this={DatePickerComponent} bind:value={newReqStartDate} locale="hu-HU" placeholder="Kezdő dátum..." />
					{:else}
						<input class="form-input" type="date" bind:value={newReqStartDate} />
					{/if}
				</label>
				<label class="form-label">
					{t('leaveRequests.form.endDate')} *
					{#if DatePickerComponent}
						<svelte:component this={DatePickerComponent} bind:value={newReqEndDate} locale="hu-HU" placeholder="Záró dátum..." />
					{:else}
						<input class="form-input" type="date" bind:value={newReqEndDate} />
					{/if}
				</label>
			</div>

			<label class="form-label">
				{t('leaveRequests.form.reason')}
				<textarea class="form-input form-textarea" bind:value={newReqReason} rows="3"></textarea>
			</label>

			{#if newReqError}
				<p class="form-error">{newReqError}</p>
			{/if}

			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (showNewRequestModal = false)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submitNewRequest} disabled={newReqLoading}>
					{newReqLoading ? t('loading') : t('leaveRequests.form.submit')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Szabadságkeret modal -->
{#if showBalanceModal}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal modal-wide">
			<h3>{t('leaveRequests.balance.title')}</h3>

			{#if balancesLoading}
				<div class="loading-state"><div class="spinner"></div></div>
			{:else}
				<!-- Meglévő keretek -->
				{#if balances.length > 0}
					<div class="balance-table">
						<div class="balance-header">
							<span>Év</span>
							<span>{t('leaveRequests.balance.total')}</span>
							<span>{t('leaveRequests.balance.used')}</span>
							<span>{t('leaveRequests.balance.remaining')}</span>
						</div>
						{#each balances as bal (bal.id)}
							<div class="balance-row">
								<span class="font-medium">{bal.year}</span>
								<span>{bal.totalDays}</span>
								<span>{bal.usedDays}</span>
								<span class="font-medium {bal.remainingDays < 5 ? 'text-warning' : 'text-success'}">{bal.remainingDays}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="empty-state">{t('noData')}</p>
				{/if}

				<!-- Új keret beállítása -->
				<div class="balance-form">
					<h4>Keret beállítása</h4>
					<div class="form-row">
						<label class="form-label">
							Év
							<input class="form-input" type="number" bind:value={balanceYear} min="2020" max="2099" />
						</label>
						<label class="form-label">
							{t('leaveRequests.balance.total')}
							<input class="form-input" type="number" bind:value={balanceTotalDays} min="0" max="365" />
						</label>
					</div>
					<button class="btn-primary" onclick={saveBalance} disabled={balanceSaving}>
						{balanceSaving ? t('loading') : t('form.save')}
					</button>
				</div>
			{/if}

			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (showBalanceModal = false)}>{t('form.cancel')}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.page {
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.view-toggle {
		display: flex;
		gap: 0.25rem;
	}

	.chip {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 999px;
		padding: 0.35rem 0.9rem;
		font-size: 0.8rem;
		cursor: pointer;
		color: var(--color-muted-foreground, #64748b);
	}

	.chip:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.chip.active {
		background: var(--color-primary-subtle, #eef2ff);
		border-color: var(--color-primary, #3730a3);
		color: var(--color-primary, #3730a3);
		font-weight: 600;
	}

	:global(.dark) .chip:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .chip.active {
		background: var(--color-accent, oklch(0.25 0.03 var(--primary-h, 264)));
	}


	.subtitle {
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
		font-size: 0.875rem;
	}

	/* Gombok */
	.btn-primary {
		background: var(--color-primary, #3730a3);
		color: #fff;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		flex-shrink: 0;
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

	/* Betöltés */
	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		padding: 2rem 0;
	}

	.loading-inline {
		display: flex;
		align-items: center;
		padding: 0.4rem 0;
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

	.spinner-sm {
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--color-border, #e2e8f0);
		border-top-color: var(--color-primary, #3730a3);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	/* Badge */
	:global(.badge) {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	:global(.badge-pending) { background: #fef3c7; color: #92400e; }
	:global(.badge-approved) { background: #dcfce7; color: #166534; }
	:global(.badge-rejected) { background: #fee2e2; color: #991b1b; }

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: var(--color-background, #fff);
		border-radius: 0.75rem;
		padding: 1.5rem;
		width: 100%;
		max-width: 480px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		box-shadow: 0 20px 60px rgba(0,0,0,0.15);
		max-height: 90vh;
		overflow-y: auto;
	}

	.modal-wide { max-width: 560px; }

	.modal h3 {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
	}

	/* Űrlap */
	.form-row {
		display: flex;
		gap: 0.75rem;
	}

	.form-row .form-label { flex: 1; }

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

	.form-textarea {
		resize: vertical;
		min-height: 4rem;
	}

	.form-error {
		color: #dc2626;
		font-size: 0.8rem;
		margin: 0;
	}

	.empty-state {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.875rem;
	}

	/* No access message */
	.no-access-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 4rem 2rem;
		gap: 1rem;
	}

	.no-access-icon {
		font-size: 4rem;
		opacity: 0.5;
	}

	.no-access-message h2 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-foreground, #0f172a);
		margin: 0;
	}

	.no-access-message p {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.875rem;
		margin: 0;
		max-width: 400px;
	}

	/* Szabadságkeret táblázat */
	.balance-table {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.balance-header,
	.balance-row {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr 1fr;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
	}

	.balance-header {
		background: var(--color-muted, #f8fafc);
		font-weight: 600;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.balance-row {
		border-top: 1px solid var(--color-border, #e2e8f0);
	}

	.balance-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-muted, #f8fafc);
		border-radius: 0.5rem;
	}

	.balance-form h4 {
		font-size: 0.875rem;
		font-weight: 600;
		margin: 0;
	}

	.text-warning { color: #d97706; }
	.text-success { color: #16a34a; }
	.font-medium { font-weight: 500; }

	/* Sötét mód */
	:global(.dark) .modal {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .modal h3 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .modal-footer {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .form-input {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .btn-secondary {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .btn-secondary:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .balance-table {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .balance-header {
		background: var(--color-muted, oklch(0.269 0 0));
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .balance-row {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .balance-form {
		background: var(--color-muted, oklch(0.269 0 0));
	}

	:global(.dark) .balance-form h4 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) :global(.badge-pending) { background: oklch(0.3 0.05 60); color: #fde68a; }
	:global(.dark) :global(.badge-approved) { background: oklch(0.25 0.05 145); color: #86efac; }
	:global(.dark) :global(.badge-rejected) { background: oklch(0.25 0.05 20); color: #fca5a5; }

	:global(.dark) .no-access-message h2 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .no-access-message p {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}
</style>
