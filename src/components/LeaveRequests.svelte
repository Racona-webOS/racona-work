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
		EmployeeRow,
		PaginatedResult
	} from '../../server/functions.js';
	import { LEAVE_TYPES } from '../../server/leave-types.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import LeaveCalendar from './leave-calendar/LeaveCalendar.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { formatDate as formatAppDate, formatDateTime as formatAppDateTime } from '../utils/format.js';
	import { escapeHtml } from '../utils/html.js';

	let {
		pluginId = 'racona-work',
		employeeId = null
	}: {
		pluginId?: string;
		/** A Szabadság egyenleg oldalról: a naptár erre a dolgozóra szűr. */
		employeeId?: number | null;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	// Organization store - inicializálás
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<import('../../server/functions.js').Organization | null>(null);
	let hasAccess = $state(false);

	// --- Képességek ---
	let canApprove = $state(false);
	/** Saját kérelem beadása; a jóváhagyó és a HR enélkül is betölti az oldalt. */
	let canRequestLeave = $state(false);
	/** Külsős dolgozó: rá a szabadság nem vonatkozik. */
	let isExternal = $state(false);
	let isManagerView = $derived(canApprove);

	// --- Saját dolgozói rekord (self-service) ---
	let myEmployee = $state<import('../../server/functions.js').EmployeeRow | null>(null);

	// --- Nézet: 'mine' vagy 'all'. Ha nem vagyunk manager, mindig 'mine'. ---
	let viewMode = $state<'mine' | 'all'>('all');

	// --- SDK komponensek ---
	const DataTable = $derived(sdk?.components?.DataTable);
	const DataTableColumnHeader = $derived(sdk?.components?.DataTableColumnHeader);
	const renderComponent = $derived(sdk?.components?.renderComponent);
	const renderSnippet = $derived(sdk?.components?.renderSnippet);
	const createActionsColumn = $derived(sdk?.components?.createActionsColumn);

	// --- Naptár: növelve újratölt, ha egy kérelem státusza változott ---
	let calendarRefresh = $state(0);

	// --- Összecsukható blokkok (a böngészőben megjegyezve) ---
	type Section = 'requests' | 'calendar';
	const COLLAPSED_KEY = 'racona-work:leave-requests:collapsed';
	let collapsed = $state<Record<Section, boolean>>(loadCollapsed());

	function loadCollapsed(): Record<Section, boolean> {
		try {
			const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}');
			return { requests: saved.requests === true, calendar: saved.calendar === true };
		} catch {
			return { requests: false, calendar: false };
		}
	}

	function toggleSection(section: Section) {
		collapsed[section] = !collapsed[section];
		try {
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
		} catch {
			// Tárolás nélkül is működik, csak nem jegyzi meg
		}
	}

	// --- Táblázat állapot ---
	let data = $state<LeaveRequestRow[]>([]);
	let loading = $state(false);
	let paginationInfo = $state({ page: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
	let tableState = $state({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' as 'asc' | 'desc' });
	let columns = $state<any[]>([]);

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
				isExternal = store.isExternal;
				canApprove = store.can('leave.approve');
				canRequestLeave = store.can('leave.request');
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
	async function withdrawRequest(row: LeaveRequestRow) {
		if (!window.confirm(t('leaveRequests.withdrawConfirm'))) return;
		try {
			await sdk?.remote?.call('withdrawLeaveRequest', { id: row.id });
			calendarRefresh += 1;
			sdk?.ui?.toast(t('leaveRequests.withdrawn'), 'success');
			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		}
	}

	// --- Törlés (jóváhagyott kérelem) ---
	async function deleteRequest(row: LeaveRequestRow) {
		const endDate = new Date(row.endDate);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const isPast = endDate < today;

		const confirmMsg = isPast
			? t('leaveRequests.delete.confirmPast', { to: formatDate(row.endDate) })
			: t('leaveRequests.delete.confirm', {
					name: row.employeeName,
					from: formatDate(row.startDate),
					to: formatDate(row.endDate)
				});

		const confirmed = await sdk?.ui?.dialog({
			title: t('leaveRequests.delete.title'),
			message: confirmMsg,
			type: 'confirm',
			confirmLabel: t('leaveRequests.delete.action'),
			confirmVariant: 'destructive'
		});

		if (confirmed?.action !== 'confirm') return;

		try {
			// Az érintett dolgozó értesítését a szerver küldi
			await sdk?.remote?.call('deleteLeaveRequest', { id: row.id });
			calendarRefresh += 1;
			sdk?.ui?.toast(t('leaveRequests.delete.success'), 'success');
			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed'), 'error');
		}
	}

	// --- Segédfüggvények ---
	function formatDate(dateStr: string | null): string {
		return formatAppDate(dateStr);
	}

	/** A rögzítés időpontja: dátum és perc, mert egy napon több kérelem is jöhet. */
	function formatDateTime(value: string | null): string {
		return formatAppDateTime(value, { dateStyle: 'short', timeStyle: 'short' });
	}

	function leaveTypeLabel(type: string): string {
		return (LEAVE_TYPES as readonly string[]).includes(type) ? t(`leaveRequests.type.${type}`) : type;
	}

	function statusLabel(status: string): string {
		const map: Record<string, string> = {
			pending: t('leaveRequests.status.pending'),
			approved: t('leaveRequests.status.approved'),
			rejected: t('leaveRequests.status.rejected'),
			withdrawn: t('leaveRequests.status.withdrawn')
		};
		return map[status] ?? status;
	}

	function statusClass(status: string): string {
		return (
			{ pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected', withdrawn: 'badge-withdrawn' }[
				status
			] ?? 'badge-pending'
		);
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
			// A dolgozó a saját függő kérelmét visszavonhatja; a jóváhagyó is, ha a sajátja
			const isOwn = !!myEmployee && row.employeeId === myEmployee.id;
			const isOwnPending = row.status === 'pending' && isOwn;
			// Saját ügyben csak a rendszergazda dönthet (a szerver is elutasítaná)
			if (!canApprove || (isOwn && !orgStore?.isAdmin)) {
				return isOwnPending
					? [{ label: t('leaveRequests.withdraw'), onClick: () => withdrawRequest(row), variant: 'destructive' as const }]
					: [];
			}

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
					},
					...(isOwnPending
						? [{ label: t('leaveRequests.withdraw'), onClick: () => withdrawRequest(row), variant: 'destructive' as const }]
						: [])
				];
			}
			if (row.status === 'approved') {
				return [
					{
						label: t('leaveRequests.delete.action'),
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
					const snippet = createRawSnippet(() => ({ render: () => `<span class="font-medium">${escapeHtml(name)}</span>` }));
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
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm">${escapeHtml(label)}</span>` }));
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
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm text-muted-foreground">${escapeHtml(val)}</span>` }));
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
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm text-muted-foreground">${escapeHtml(val)}</span>` }));
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
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm font-medium">${escapeHtml(val)}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				// A kérelemhez ma tartozó napok: a naptárban törölt napok után
				// kevesebb, mint a kért. Csak jóváhagyott kérelemnél van értéke.
				accessorKey: 'effectiveDays',
				enableHiding: true,
				meta: { title: t('leaveRequests.columns.effectiveDays') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('leaveRequests.columns.effectiveDays'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const effective = row.original.effectiveDays;
					const requested = row.original.days;
					let html = '<span class="text-sm text-muted">—</span>';
					if (effective !== null && effective !== undefined) {
						if (effective === requested) {
							html = `<span class="text-sm">${effective}</span>`;
						} else if (effective < requested) {
							html = `<span class="badge badge-reduced" title="${escapeHtml(t('leaveRequests.effectiveDays.reduced', { removed: requested - effective }))}">${effective}</span>`;
						} else {
							// Több nap, mint a kért: a napok a jóváhagyás utáni munkanaptárral
							// készültek (pl. a visszatöltő migráció), a kért szám a beadáskori
							html = `<span class="badge badge-reduced" title="${escapeHtml(t('leaveRequests.effectiveDays.increased', { extra: effective - requested, requested }))}">${effective}</span>`;
						}
					}
					const snippet = createRawSnippet(() => ({ render: () => html }));
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
						render: () => `<span class="badge ${cls}">${escapeHtml(label)}</span>`
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
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm">${escapeHtml(val)}</span>` }));
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

			isExternal = orgStore.isExternal;
			canApprove = orgStore.can('leave.approve');
			canRequestLeave = orgStore.can('leave.request');
			// Alap nézet: manager esetén 'all', dolgozó esetén 'mine'.
			viewMode = canApprove ? 'all' : 'mine';

			// Saját dolgozói rekord lekérése (self-service működéshez és szűréshez).
			if (currentOrganization && !isExternal) {
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
		if (sdk?.remote && currentOrganization && !isExternal) loadData();
	});
</script>

{#snippet sectionHeader(section: Section, title: string)}
	<!-- A nyíl a cím előtt, és a címre kattintva is nyílik-csukódik -->
	<h3 class="section-title">
		<button
			class="section-toggle"
			onclick={() => toggleSection(section)}
			title={collapsed[section] ? t('report.section.expand') : t('report.section.collapse')}
			aria-expanded={!collapsed[section]}
		>
			<span class="collapse-btn">
				<svg class="collapse-icon" class:collapsed={collapsed[section]} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
			</span>
			{title}
		</button>
	</h3>
{/snippet}

<div class="rw">
<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else if isExternal}
		<p class="empty-state">{t('leaveRequests.external')}</p>
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

		<div class="page-block">
			{@render sectionHeader('requests', t('leaveRequests.section.requests'))}
			<div hidden={collapsed.requests}>
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
			</div>
		</div>

		{#if currentOrganization}
			<div class="page-block">
				{@render sectionHeader('calendar', t('leaveRequests.section.calendar'))}
				<!-- Elrejtve, nem kiszedve: a hónap és a jelölések megmaradnak -->
				<div hidden={collapsed.calendar}>
					<LeaveCalendar
						{pluginId}
						organizationId={currentOrganization.id}
						canManage={canApprove}
						{canRequestLeave}
						ownEmployeeId={myEmployee?.id ?? null}
						initialEmployeeId={employeeId}
						refreshKey={calendarRefresh}
						onSaved={() => loadData()}
					/>
				</div>
			</div>
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
		gap: 1.5rem;
	}

	.page-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.section-title {
		font-size: 1.05rem;
		font-weight: 600;
		margin: 0;
	}

	.section-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.collapse-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		background: transparent;
		color: var(--color-muted-foreground, #64748b);
		transition: background 0.15s, color 0.15s;
	}

	.section-toggle:hover .collapse-btn {
		background: var(--color-accent, #f1f5f9);
		color: var(--color-foreground, #0f172a);
	}

	.collapse-icon {
		transition: transform 0.2s ease;
	}

	/* Összecsukva jobbra mutat */
	.collapse-icon.collapsed {
		transform: rotate(-90deg);
	}

	:global(.dark) .section-toggle:hover .collapse-btn {
		background: var(--color-accent, oklch(0.269 0 0));
		color: oklch(0.985 0 0);
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
	:global(.badge-reduced) { background: #ffedd5; color: #9a3412; }
	:global(.text-muted) { color: var(--muted-foreground, #71717a); }
	:global(.badge-approved) { background: #dcfce7; color: #166534; }
	:global(.badge-rejected) { background: #fee2e2; color: #991b1b; }
	:global(.badge-withdrawn) { background: #e4e4e7; color: #3f3f46; }

	/* Sötét mód */
	:global(.dark) :global(.badge-pending) { background: oklch(0.3 0.05 60); color: #fde68a; }
	:global(.dark) :global(.badge-approved) { background: oklch(0.25 0.05 145); color: #86efac; }
	:global(.dark) :global(.badge-rejected) { background: oklch(0.25 0.05 20); color: #fca5a5; }
	:global(.dark) :global(.badge-withdrawn) { background: oklch(0.3 0 0); color: #d4d4d8; }

	/* Sötét mód: a világos státuszszínek sötét párjai */
	:global(.dark) :global(.badge-reduced) {
		background: var(--rw-dark-orange-bg);
		color: var(--rw-dark-orange-fg);
	}
</style>
