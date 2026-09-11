<svelte:options customElement={{ tag: 'racona-work-leave-requests', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_LeaveRequests = function () {
			return { tagName: 'racona-work-leave-requests' };
		};
	}
</script>

<script lang="ts">
	import { onMount, untrack, createRawSnippet } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		LeaveRequestRow,
		LeaveBalance,
		EmployeeRow,
		PaginatedResult,
		LeaveAllowances,
		ChildLeaveStatus
	} from '../../server/functions.js';
	import { CHILD_LEAVE_TYPES, LEAVE_TYPES } from '../../server/leave-types.js';
	import type { LeaveType } from '../../server/leave-types.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import LeaveCalendar from './leave-calendar/LeaveCalendar.svelte';

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

	// --- Naptár: növelve újratölt, ha egy kérelem státusza változott ---
	let calendarRefresh = $state(0);

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
	let newReqType = $state<LeaveType>('annual');
	let newReqStartDate = $state('');
	let newReqEndDate = $state('');
	let newReqChildId = $state<number | null>(null);

	// Betegszabadság-, apasági és szülői keret a kiválasztott dolgozóra — csak
	// tájékoztat és a gyerekválasztót tölti; a szabályokat a szerver ellenőrzi.
	let allowances = $state<LeaveAllowances | null>(null);
	const allowanceYear = $derived(
		newReqStartDate ? Number(newReqStartDate.slice(0, 4)) : new Date().getFullYear()
	);
	const childOptions = $derived<ChildLeaveStatus[]>(
		newReqType === 'paternity'
			? (allowances?.paternity.filter((c) => c.active) ?? [])
			: newReqType === 'parental'
				? (allowances?.parental ?? [])
				: []
	);
	const selectedChild = $derived(childOptions.find((c) => c.childId === newReqChildId) ?? null);
	/** Ennyi nap lépné túl a betegszabadság keretét — az már táppénzes keresőképtelenség. */
	const sickOverflow = $derived(
		allowances && previewDays !== null
			? Math.max(
					0,
					allowances.sick.usedDays + allowances.sick.pendingDays + previewDays - allowances.sick.totalDays
				)
			: 0
	);

	$effect(() => {
		const employeeId = newReqEmployeeId;
		const type = newReqType;
		const year = allowanceYear;
		if (!showNewRequestModal || !employeeId || (type !== 'sick' && !CHILD_LEAVE_TYPES.has(type))) {
			allowances = null;
			return;
		}
		sdk?.remote
			?.call('getLeaveAllowances', { employeeId, year })
			.then((result: LeaveAllowances) => {
				if (newReqEmployeeId === employeeId && allowanceYear === year) allowances = result;
			})
			.catch(() => (allowances = null));
	});

	// Típus- vagy dolgozóváltáskor a gyerekválasztás nem örökölhető
	$effect(() => {
		newReqType;
		newReqEmployeeId;
		newReqChildId = null;
	});

	function childLabel(child: ChildLeaveStatus): string {
		return child.label || formatDate(child.birthDate);
	}

	// Élő munkanap-számláló: a szerver számol, hogy a kiírt és a ténylegesen
	// levont napok ne csúszhassanak el (ugyanaz a munkanaptár, ugyanaz a logika).
	let previewDays = $state<number | null>(null);
	let previewLoading = $state(false);
	let previewTimer: ReturnType<typeof setTimeout> | null = null;
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
			// Az érintett dolgozó értesítését a szerver küldi (8.7)
			await sdk?.remote?.call('approveLeaveRequest', { id: row.id });
			calendarRefresh += 1;
			sdk?.ui?.toast(t('leaveRequests.approveSuccess'), 'success');
			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		}
	}

	// --- Elutasítás ---
	async function rejectRequest(row: LeaveRequestRow) {
		try {
			// Az érintett dolgozó értesítését a szerver küldi (8.7)
			await sdk?.remote?.call('rejectLeaveRequest', { id: row.id });
			calendarRefresh += 1;
			sdk?.ui?.toast(t('leaveRequests.rejectSuccess'), 'success');
			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		}
	}

	// --- Új kérelem ---
	async function openNewRequestModal() {
		showNewRequestModal = true;
		newReqType = 'annual';
		newReqChildId = null;
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

	/**
	 * A kiválasztott időszak munkanapjainak lekérése, 300 ms késleltetéssel.
	 * A dátumválasztó gyors kattintgatása így nem indít hívást minden lépésre.
	 */
	function schedulePreview() {
		if (previewTimer) clearTimeout(previewTimer);

		if (!newReqStartDate || !newReqEndDate || !currentOrganization) {
			previewDays = null;
			previewLoading = false;
			return;
		}
		if (newReqStartDate > newReqEndDate) {
			previewDays = null;
			previewLoading = false;
			return;
		}

		previewLoading = true;
		previewTimer = setTimeout(async () => {
			try {
				const result = await sdk?.remote?.call('previewLeaveDays', {
					organizationId: currentOrganization!.id,
					startDate: newReqStartDate,
					endDate: newReqEndDate
				});
				previewDays = result?.days ?? null;
			} catch {
				// A számláló csak tájékoztat — hiba esetén elrejtjük, a beadást nem blokkolja
				previewDays = null;
			} finally {
				previewLoading = false;
			}
		}, 300);
	}

	$effect(() => {
		newReqStartDate;
		newReqEndDate;
		schedulePreview();
	});

	async function submitNewRequest() {
		if (!newReqEmployeeId || !newReqStartDate || !newReqEndDate) {
			newReqError = t('form.required');
			return;
		}
		if (CHILD_LEAVE_TYPES.has(newReqType) && !newReqChildId) {
			newReqError = t('leaveRequests.form.childRequired');
			return;
		}
		if (!currentOrganization) {
			newReqError = 'Nincs kiválasztott szervezet';
			return;
		}
		newReqLoading = true;
		newReqError = null;
		try {
			// Az értesítendőknek (8.8) a szerver küld értesítést és emailt
			await sdk?.remote?.call('createLeaveRequest', {
				employeeId: newReqEmployeeId,
				organizationId: currentOrganization.id,
				leaveType: newReqType,
				startDate: newReqStartDate,
				endDate: newReqEndDate,
				reason: newReqReason || undefined,
				childId: CHILD_LEAVE_TYPES.has(newReqType) ? newReqChildId : undefined
			});

			sdk?.ui?.toast(t('leaveRequests.newRequest') + ' ✓', 'success');
			calendarRefresh += 1;
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
			// Az érintett dolgozó értesítését a szerver küldi
			await sdk?.remote?.call('deleteLeaveRequest', { id: row.id });
			calendarRefresh += 1;
			sdk?.ui?.toast('Szabadság törölve', 'success');
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

	/** A rögzítés időpontja: dátum és perc, mert egy napon több kérelem is jöhet. */
	function formatDateTime(value: string | null): string {
		if (!value) return '—';
		return new Date(value).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' });
	}

	function leaveTypeLabel(type: string): string {
		return (LEAVE_TYPES as readonly string[]).includes(type) ? t(`leaveRequests.type.${type}`) : type;
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
		if (!DataTableColumnHeader || !renderComponent || !renderSnippet || !createActionsColumn) {
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
			{
				accessorKey: 'createdAt',
				enableHiding: true,
				meta: { title: t('leaveRequests.columns.createdAt') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('leaveRequests.columns.createdAt'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const val = formatDateTime(row.original.createdAt);
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm">${val}</span>` }));
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

		buildColumns();
		if (sdk?.remote && currentOrganization) loadData();
	});
</script>

<div class="rw">
<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<div class="page-header-title">
				<h2>{t('leaveRequests.title')}</h2>
				<p class="subtitle">
					{canApprove
						? t('leaveRequests.subtitle.manager')
						: t('leaveRequests.subtitle.self')}
				</p>
			</div>
			<button class="btn-primary" onclick={openNewRequestModal}>
				+ {t('leaveRequests.newRequest')}
			</button>
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

		<h3 class="section-title">{t('leaveRequests.section.requests')}</h3>

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

		{#if currentOrganization}
			<h3 class="section-title">{t('leaveRequests.section.calendar')}</h3>
			<LeaveCalendar
				{pluginId}
				organizationId={currentOrganization.id}
				canManage={canApprove}
				employeeId={viewMode === 'mine' ? (myEmployee?.id ?? null) : null}
				lockEmployee={viewMode === 'mine'}
				refreshKey={calendarRefresh}
				onSaved={() => loadData()}
			/>
		{/if}
	{/if}
</section>
</div>

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
					{#each LEAVE_TYPES as type (type)}
						<option value={type}>{t(`leaveRequests.type.${type}`)}</option>
					{/each}
				</select>
			</label>

			{#if CHILD_LEAVE_TYPES.has(newReqType)}
				<label class="form-label">
					{t('leaveRequests.form.child')} *
					{#if childOptions.length === 0}
						<span class="form-hint">
							{newReqType === 'paternity'
								? t('leaveRequests.form.noPaternityChild')
								: t('leaveRequests.form.noParentalChild')}
						</span>
					{:else}
						<select class="form-input" bind:value={newReqChildId}>
							<option value={null}>{t('leaveRequests.form.selectChild')}</option>
							{#each childOptions as child (child.childId)}
								<option value={child.childId}>
									{childLabel(child)} — {t('leaveRequests.form.childRemaining', { days: child.remainingDays })}
								</option>
							{/each}
						</select>
					{/if}
					{#if selectedChild}
						<span class="form-hint">
							{t('leaveRequests.form.childDeadline', { deadline: formatDate(selectedChild.deadline) })}
							{#if selectedChild.eligibleFrom}
								· {t('leaveRequests.form.parentalEligibleFrom', { date: formatDate(selectedChild.eligibleFrom) })}
							{/if}
						</span>
					{/if}
				</label>
			{/if}

			<div class="form-row">
				<label class="form-label">
					{t('leaveRequests.form.startDate')} *
					{#if DatePickerComponent}
						<DatePickerComponent bind:value={newReqStartDate} locale="hu-HU" placeholder="Kezdő dátum..." />
					{:else}
						<input class="form-input" type="date" bind:value={newReqStartDate} />
					{/if}
				</label>
				<label class="form-label">
					{t('leaveRequests.form.endDate')} *
					{#if DatePickerComponent}
						<DatePickerComponent bind:value={newReqEndDate} locale="hu-HU" placeholder="Záró dátum..." />
					{:else}
						<input class="form-input" type="date" bind:value={newReqEndDate} />
					{/if}
				</label>
			</div>

			{#if previewLoading}
				<p class="day-preview is-loading">{t('leaveRequests.form.daysCalculating')}</p>
			{:else if previewDays !== null}
				<p class="day-preview">
					{previewDays === 0
						? t('leaveRequests.form.daysZero')
						: `${t('leaveRequests.form.daysPrefix')} ${previewDays} ${t('leaveRequests.form.daysSuffix')}`}
				</p>
			{/if}

			{#if newReqType === 'sick' && allowances}
				<p class="form-hint">
					{t('leaveRequests.form.sickStatus', {
						year: allowances.sick.year,
						used: allowances.sick.usedDays + allowances.sick.pendingDays,
						total: allowances.sick.totalDays
					})}
				</p>
				{#if sickOverflow > 0}
					<p class="form-hint warn">{t('leaveRequests.form.sickOverflow', { days: sickOverflow })}</p>
				{/if}
			{/if}

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
	@import '../styles/shared.css';

	.day-preview {
		margin: 0.25rem 0 0.75rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--primary, #2563eb);
	}

	.form-hint {
		display: block;
		margin: 0;
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--color-muted-foreground, #64748b);
	}

	.form-hint.warn {
		margin-top: 0.25rem;
		color: #b45309;
	}

	.day-preview.is-loading {
		color: var(--muted-foreground, #71717a);
		font-weight: 400;
	}

	.page {
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.section-title {
		font-size: 1.05rem;
		font-weight: 600;
		margin: 0 0 -0.75rem;
	}

	.loading-inline {
		display: flex;
		align-items: center;
		padding: 0.4rem 0;
	}

	.spinner-sm {
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--color-border, #e2e8f0);
		border-top-color: var(--color-primary, #3730a3);
		border-radius: 50%;
		animation: rw-spin 0.7s linear infinite;
	}

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
</style>
