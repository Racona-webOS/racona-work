<svelte:options customElement={{ tag: 'racona-work-employee-list', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_EmployeeList = function () {
			return { tagName: 'racona-work-employee-list' };
		};
	}
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		EmployeeRow,
		PaginatedResult,
		UnlinkedUser
	} from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';

	let { pluginId = 'racona-work' }: {
		pluginId?: string;
	} = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	// Organization store - inicializálás
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<import('../../server/functions.js').Organization | null>(null);
	let hasAccess = $state(false);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- SDK DataTable komponensek ---
	const DataTable = $derived(sdk?.components?.DataTable);
	const DataTableColumnHeader = $derived(sdk?.components?.DataTableColumnHeader);
	const renderComponent = $derived(sdk?.components?.renderComponent);
	const renderSnippet = $derived(sdk?.components?.renderSnippet);
	const createActionsColumn = $derived(sdk?.components?.createActionsColumn);
	const Input = $derived(sdk?.components?.Input);
	const Button = $derived(sdk?.components?.Button);
	let createRawSnippet: any = $state(null);

	// --- Táblázat állapot ---
	let data = $state<EmployeeRow[]>([]);
	let loading = $state(false);
	let searchInput = $state('');
	let debouncedSearch = $state('');
	let paginationInfo = $state({ page: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
	let tableState = $state({ page: 1, pageSize: 20, sortBy: 'userName', sortOrder: 'asc' as 'asc' | 'desc' });
	let columns = $state<any[]>([]);
	let debounceTimer: ReturnType<typeof setTimeout>;

	// --- Modal állapot ---
	type ModalMode = 'none' | 'choose' | 'link' | 'create' | 'addMember' | 'changeRole';
	let modalMode = $state<ModalMode>('none');
	let unlinkedUsers = $state<UnlinkedUser[]>([]);
	let unlinkedLoading = $state(false);
	let selectedUserId = $state<number | null>(null);
	let newName = $state('');
	let newEmail = $state('');
	let newPosition = $state('');
	let newDepartment = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	// --- Szerepkör módosítás állapot ---
	let employeeToChangeRole = $state<EmployeeRow | null>(null);
	let newRole = $state<'member' | 'admin'>('member');

	// --- Tag hozzáadás modal állapot ---
	let availableEmployees = $state<EmployeeRow[]>([]);
	let availableEmployeesLoading = $state(false);
	let selectedEmployeeId = $state<number | null>(null);
	let memberSearchInput = $state('');

	// --- Tag eltávolítás állapot ---
	let employeeToRemove = $state<EmployeeRow | null>(null);
	let showRemoveConfirmation = $state(false);

	// --- Adatok betöltése ---
	async function loadData() {
		if (!currentOrganization) {
			data = [];
			return;
		}

		loading = true;
		try {
			const result: PaginatedResult<EmployeeRow> = await sdk?.remote?.call('getEmployees', {
				organizationId: currentOrganization.id,
				page: tableState.page,
				pageSize: tableState.pageSize,
				sortBy: tableState.sortBy,
				sortOrder: tableState.sortOrder,
				search: debouncedSearch || undefined
			});
			data = result?.data ?? [];
			paginationInfo = result?.pagination ?? { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 };
		} catch (err: any) {
			// Követelmény 15.1, 15.2: Részletes hibaüzenet
			const errorMessage = err?.message ?? t('error.loadFailed');
			const formattedError = formatErrorMessage(errorMessage, t('error.loadFailed'));
			sdk?.ui?.toast(formattedError, 'error');
			data = [];
			console.error('[EmployeeList] Hiba a dolgozók betöltésekor:', err);
		} finally {
			loading = false;
		}
	}

	/**
	 * Hibaüzenet formázása felhasználóbarát módon
	 * Követelmény: 15.1, 15.2
	 */
	function formatErrorMessage(errorMessage: string, defaultMessage: string): string {
		// Hálózati hiba
		if (errorMessage.toLowerCase().includes('network') ||
		    errorMessage.toLowerCase().includes('fetch') ||
		    errorMessage.toLowerCase().includes('connection')) {
			return 'Hálózati hiba. Kérlek, ellenőrizd az internetkapcsolatot.';
		}

		// Jogosultsági hiba
		if (errorMessage.toLowerCase().includes('unauthorized') ||
		    errorMessage.toLowerCase().includes('forbidden') ||
		    errorMessage.toLowerCase().includes('permission')) {
			return 'Nincs jogosultságod ehhez az adathoz. Kérj hozzáférést egy rendszergazdától.';
		}

		// Használjuk az eredeti üzenetet, ha értelmes
		if (errorMessage && errorMessage !== defaultMessage) {
			return errorMessage;
		}

		return defaultMessage;
	}

	function handleStateChange(state: any) {
		tableState = state;
	}

	function handleSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		searchInput = value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debouncedSearch = value;
			tableState = { ...tableState, page: 1 };
		}, 300);
	}

	// Táblázat állapot vagy keresés változásakor újratölt
	$effect(() => {
		tableState; debouncedSearch;
		untrack(() => {
			if (columns.length > 0 && sdk?.remote && currentOrganization) loadData();
		});
	});

	// Szervezet váltáskor újratölt (currentOrganization $state változásakor)
	$effect(() => {
		currentOrganization;
		untrack(() => {
			if (currentOrganization && columns.length > 0 && sdk?.remote) loadData();
		});
	});

	// organization-changed event: frissíti a currentOrganization $state-et
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

	// --- Oszlopok ---
	function buildColumns() {
		if (!DataTableColumnHeader || !renderComponent || !renderSnippet || !createRawSnippet || !createActionsColumn) {
			columns = [];
			return;
		}

		const handleSort = (columnId: string, descending: boolean) => {
			tableState = { ...tableState, sortBy: columnId, sortOrder: descending ? 'desc' : 'asc', page: 1 };
		};

		const actionsColumn = createActionsColumn((row: EmployeeRow) => [
			{
				label: t('employeeDetail.title'),
				onClick: (row: EmployeeRow) => navigateToDetail(row.id),
				primary: true
			},
			{
				label: row.organizationRole === 'admin' ? 'Taggá tétel' : 'Adminná tétel',
				onClick: (row: EmployeeRow) => handleChangeRoleClick(row)
			},
			{
				label: 'Tag eltávolítása',
				onClick: (row: EmployeeRow) => handleRemoveMemberClick(row),
				variant: 'destructive'
			}
		]);

		columns = [
			{
				accessorKey: 'userImage',
				enableHiding: false,
				enableSorting: false,
				meta: { title: '' },
				header: () => null,
				cell: ({ row }: any) => {
					const img = row.original.userImage;
					const name = row.original.userName ?? '';
					const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
					const snippet = createRawSnippet(() => ({
						render: () => img
							? `<img src="${img}" alt="${name}" class="avatar-img" />`
							: `<div class="avatar-placeholder">${initials}</div>`
					}));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'userName',
				enableHiding: true,
				meta: { title: t('employees.columns.name') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('employees.columns.name'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const name = row.original.userName ?? '—';
					const snippet = createRawSnippet(() => ({ render: () => `<span class="font-medium">${name}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'userEmail',
				enableHiding: true,
				meta: { title: t('employees.columns.email') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('employees.columns.email'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const email = row.original.userEmail ?? '—';
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm text-muted-foreground">${email}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'position',
				enableHiding: true,
				meta: { title: t('employees.columns.position') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('employees.columns.position'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const val = row.original.position ?? '—';
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm">${val}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'department',
				enableHiding: true,
				meta: { title: t('employees.columns.department') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('employees.columns.department'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const val = row.original.department ?? '—';
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm">${val}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'status',
				enableHiding: true,
				meta: { title: t('employees.columns.status') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('employees.columns.status'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const status = row.original.status;
					const labelMap: Record<string, string> = {
						active: t('employees.status.active'),
						inactive: t('employees.status.inactive'),
						onLeave: t('employees.status.onLeave')
					};
					const colorMap: Record<string, string> = {
						active: 'badge-active',
						inactive: 'badge-inactive',
						onLeave: 'badge-on-leave'
					};
					const label = labelMap[status] ?? status;
					const cls = colorMap[status] ?? 'badge-inactive';
					const snippet = createRawSnippet(() => ({
						render: () => `<span class="badge ${cls}">${label}</span>`
					}));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'organizationRole',
				enableHiding: true,
				meta: { title: 'Szerepkör' },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return 'Szerepkör'; },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const role = row.original.organizationRole ?? 'member';
					const labelMap: Record<string, string> = {
						admin: 'Adminisztrátor',
						member: 'Tag'
					};
					const colorMap: Record<string, string> = {
						admin: 'badge-admin',
						member: 'badge-member'
					};
					const label = labelMap[role] ?? role;
					const cls = colorMap[role] ?? 'badge-member';
					const snippet = createRawSnippet(() => ({
						render: () => `<span class="badge ${cls}">${label}</span>`
					}));
					return renderSnippet(snippet, {});
				}
			},
			{
				accessorKey: 'hireDate',
				enableHiding: true,
				meta: { title: t('employees.columns.hireDate') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('employees.columns.hireDate'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const val = row.original.hireDate ? new Date(row.original.hireDate).toLocaleDateString() : '—';
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm text-muted-foreground">${val}</span>` }));
					return renderSnippet(snippet, {});
				}
			},
			actionsColumn
		];
	}

	// --- Navigáció a dolgozó adatlapjára ---
	function navigateToDetail(employeeId: number) {
		sdk?.ui?.navigateTo('EmployeeDetail', { employeeId });
	}

	// --- Új dolgozó modal ---
	async function openLinkModal() {
		modalMode = 'link';
		unlinkedLoading = true;
		selectedUserId = null;
		formError = null;

		// Ellenőrizzük, hogy van-e kiválasztott szervezet
		if (!currentOrganization) {
			formError = 'Nincs kiválasztott szervezet. Kérlek, válassz egy szervezetet a folytatáshoz.';
			unlinkedLoading = false;
			return;
		}

		try {
			unlinkedUsers = await sdk?.remote?.call('getUnlinkedUsers', {
				organizationId: currentOrganization.id
			}) ?? [];
		} catch (err) {
			console.error('[EmployeeList.openLinkModal] getUnlinkedUsers hiba:', err);
			unlinkedUsers = [];
		} finally {
			unlinkedLoading = false;
		}
	}

	function openCreateModal() {
		modalMode = 'create';
		newName = '';
		newEmail = '';
		newPosition = '';
		newDepartment = '';
		formError = null;
	}

	// --- Tag hozzáadás modal ---
	async function openAddMemberModal() {
		modalMode = 'addMember';
		availableEmployeesLoading = true;
		selectedEmployeeId = null;
		memberSearchInput = '';
		formError = null;

		// Ellenőrizzük, hogy van-e kiválasztott szervezet
		if (!currentOrganization) {
			formError = 'Nincs kiválasztott szervezet. Kérlek, válassz egy szervezetet a folytatáshoz.';
			availableEmployeesLoading = false;
			return;
		}

		try {
			availableEmployees = await sdk?.remote?.call('getAvailableEmployeesForOrganization', {
				organizationId: currentOrganization.id
			}) ?? [];
		} catch (err: any) {
			formError = err?.message ?? 'Hiba történt a dolgozók betöltése során';
			availableEmployees = [];
		} finally {
			availableEmployeesLoading = false;
		}
	}

	function closeModal() {
		modalMode = 'none';
		formError = null;
	}

	async function submitLinkUser() {
		if (!selectedUserId) return;

		// Ellenőrizzük, hogy van-e kiválasztott szervezet
		if (!currentOrganization) {
			formError = 'Nincs kiválasztott szervezet. Kérlek, válassz egy szervezetet a folytatáshoz.';
			return;
		}

		formLoading = true;
		formError = null;
		try {
			console.log('[EmployeeList] submitLinkUser - organizationId:', currentOrganization.id);

			await sdk?.remote?.call('createEmployeeFromUser', {
				userId: selectedUserId,
				position: newPosition || undefined,
				department: newDepartment || undefined,
				organizationId: currentOrganization.id
			});
			sdk?.ui?.toast(t('employees.addEmployee') + ' ✓', 'success');
			closeModal();
			loadData();
		} catch (err: any) {
			formError = err?.message ?? t('error.saveFailed');
		} finally {
			formLoading = false;
		}
	}

	async function submitCreateUser() {
		if (!newName || !newEmail) {
			formError = t('form.required');
			return;
		}

		// Ellenőrizzük, hogy van-e kiválasztott szervezet
		if (!currentOrganization) {
			formError = 'Nincs kiválasztott szervezet. Kérlek, válassz egy szervezetet a folytatáshoz.';
			return;
		}

		formLoading = true;
		formError = null;
		try {
			await sdk?.remote?.call('createEmployeeWithUser', {
				name: newName,
				email: newEmail,
				position: newPosition || undefined,
				department: newDepartment || undefined,
				organizationId: currentOrganization.id
			});
			sdk?.ui?.toast(t('employees.addEmployee') + ' ✓', 'success');
			closeModal();
			loadData();
		} catch (err: any) {
			const msg = err?.message ?? '';
			if (msg.includes('email') || msg.includes('duplikált')) {
				formError = t('error.duplicateEmail');
			} else {
				formError = msg || t('error.saveFailed');
			}
		} finally {
			formLoading = false;
		}
	}

	// --- Tag hozzáadás ---
	async function submitAddMember() {
		if (!selectedEmployeeId) {
			formError = 'Kérlek, válassz egy dolgozót';
			return;
		}

		if (!currentOrganization) {
			formError = 'Nincs kiválasztott szervezet';
			return;
		}

		formLoading = true;
		formError = null;
		try {
			const result = await sdk?.remote?.call('addEmployeeToOrganization', {
				organizationId: currentOrganization.id,
				employeeId: selectedEmployeeId
			});

			// Értesítés küldése a hozzáadott dolgozónak
			if (result?.userId) {
				await sdk?.notifications?.send({
					userId: String(result.userId),
					title: 'Szervezethez adtak',
					message: `Hozzáadtak a(z) "${currentOrganization.name}" szervezethez`,
					type: 'info'
				});
			}

			sdk?.ui?.toast('Tag sikeresen hozzáadva ✓', 'success');
			closeModal();
			loadData();
		} catch (err: any) {
			formError = err?.message ?? 'Hiba történt a tag hozzáadása során';
		} finally {
			formLoading = false;
		}
	}

	// --- Tag eltávolítás ---
	function handleRemoveMemberClick(employee: EmployeeRow) {
		employeeToRemove = employee;
		showRemoveConfirmation = true;
	}

	function cancelRemoveMember() {
		employeeToRemove = null;
		showRemoveConfirmation = false;
	}

	async function confirmRemoveMember() {
		if (!employeeToRemove || !currentOrganization) return;

		formLoading = true;
		try {
			const result = await sdk?.remote?.call('removeEmployeeFromOrganization', {
				organizationId: currentOrganization.id,
				employeeId: employeeToRemove.id
			});

			// Értesítés küldése az eltávolított dolgozónak
			if (result?.userId) {
				await sdk?.notifications?.send({
					userId: String(result.userId),
					title: 'Szervezetből eltávolítottak',
					message: `Eltávolítottak a(z) "${currentOrganization.name}" szervezetből`,
					type: 'warning'
				});
			}

			sdk?.ui?.toast('Tag sikeresen eltávolítva ✓', 'success');
			cancelRemoveMember();
			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? 'Hiba történt a tag eltávolítása során', 'error');
		} finally {
			formLoading = false;
		}
	}

	// --- Szerepkör módosítás ---
	function handleChangeRoleClick(employee: EmployeeRow) {
		employeeToChangeRole = employee;
		newRole = (employee.organizationRole === 'admin' ? 'member' : 'admin') as 'member' | 'admin';
		modalMode = 'changeRole';
	}

	function cancelChangeRole() {
		employeeToChangeRole = null;
		modalMode = 'none';
		formError = null;
	}

	async function confirmChangeRole() {
		if (!employeeToChangeRole || !currentOrganization) return;

		formLoading = true;
		formError = null;
		try {
			await sdk?.remote?.call('updateOrganizationMemberRole', {
				organizationId: currentOrganization.id,
				employeeId: employeeToChangeRole.id,
				role: newRole
			});

			const roleLabel = newRole === 'admin' ? 'adminisztrátorrá' : 'taggá';
			sdk?.ui?.toast(`Szerepkör sikeresen módosítva ${roleLabel} ✓`, 'success');
			cancelChangeRole();
			loadData();
		} catch (err: any) {
			formError = err?.message ?? 'Hiba történt a szerepkör módosítása során';
		} finally {
			formLoading = false;
		}
	}

	onMount(async () => {
		// Store inicializálás
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				// Ha még nincs store, létrehozzuk
				orgStore = createOrganizationStore(pluginId, sdk);
			}

			currentOrganization = orgStore.currentOrganization;
			hasAccess = orgStore.hasAccess;

			// Ha még nincs betöltve, betöltjük
			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
			}

			// Betöltés utáni frissítés
			currentOrganization = orgStore.currentOrganization;
			hasAccess = orgStore.hasAccess;
		}

		try {
			const svelteModule = await import('svelte');
			createRawSnippet = svelteModule.createRawSnippet;
		} catch {}

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
				<h2>{t('employees.title')}</h2>
				<p class="subtitle">{t('employees.subtitle')}</p>
			</div>
			<button class="btn-primary" onclick={() => (modalMode = 'choose')}>
				+ {t('employees.addEmployee')}
			</button>
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
					onRowClick={(row: EmployeeRow) => navigateToDetail(row.id)}
				>
					{#snippet toolbar()}
						{#if Input}
							<!-- svelte-ignore svelte_component_deprecated -->
							<svelte:component
								this={Input}
								placeholder={t('employees.search')}
								value={searchInput}
								oninput={handleSearchInput}
								class="h-8 w-[200px] lg:w-[280px]"
							/>
						{/if}
					{/snippet}
				</svelte:component>
			{/key}
		{:else}
			<div class="loading-state">
				<div class="spinner"></div>
				<span>{t('loading')}</span>
			</div>
		{/if}
	{/if}
</section>
</div>

<!-- Modal: Választás -->
{#if modalMode === 'choose'}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal">
			<h3>{t('employees.addEmployee')}</h3>
			<div class="modal-choices">
				<button class="choice-btn" onclick={openLinkModal}>
					<span class="choice-icon">🔗</span>
					<span class="choice-label">{t('employees.linkExistingUser')}</span>
				</button>
				<button class="choice-btn" onclick={openCreateModal}>
					<span class="choice-icon">➕</span>
					<span class="choice-label">{t('employees.createNewUser')}</span>
				</button>
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={closeModal}>{t('form.cancel')}</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Meglévő felhasználó összekapcsolása -->
{#if modalMode === 'link'}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal">
			<h3>{t('employees.linkExistingUser')}</h3>
			{#if unlinkedLoading}
				<div class="loading-state"><div class="spinner"></div></div>
			{:else if unlinkedUsers.length === 0}
				<p class="empty-state">Nincs összekapcsolható felhasználó.</p>
			{:else}
				<div class="user-list">
					{#each unlinkedUsers as user (user.id)}
						<label class="user-item">
							<input type="radio" name="unlinked-user" value={user.id} bind:group={selectedUserId} />
							<span class="user-name">{user.name}</span>
							<span class="user-email">{user.email}</span>
						</label>
					{/each}
				</div>
			{/if}
			<div class="form-row">
				<label class="form-label">
					{t('employeeDetail.position')}
					<input class="form-input" type="text" bind:value={newPosition} placeholder="pl. Fejlesztő" />
				</label>
				<label class="form-label">
					{t('employeeDetail.department')}
					<input class="form-input" type="text" bind:value={newDepartment} placeholder="pl. IT" />
				</label>
			</div>
			{#if formError}
				<p class="form-error">{formError}</p>
			{/if}
			<div class="modal-footer">
				<button class="btn-secondary" onclick={closeModal}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submitLinkUser} disabled={!selectedUserId || formLoading}>
					{formLoading ? t('loading') : t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Új felhasználó létrehozása -->
{#if modalMode === 'create'}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal">
			<h3>{t('employees.createNewUser')}</h3>
			<div class="form-fields">
				<label class="form-label">
					Név *
					<input class="form-input" type="text" bind:value={newName} placeholder="Teljes név" />
				</label>
				<label class="form-label">
					Email *
					<input class="form-input" type="email" bind:value={newEmail} placeholder="email@ceg.hu" />
				</label>
				<label class="form-label">
					{t('employeeDetail.position')}
					<input class="form-input" type="text" bind:value={newPosition} placeholder="pl. Fejlesztő" />
				</label>
				<label class="form-label">
					{t('employeeDetail.department')}
					<input class="form-input" type="text" bind:value={newDepartment} placeholder="pl. IT" />
				</label>
			</div>
			{#if formError}
				<p class="form-error">{formError}</p>
			{/if}
			<div class="modal-footer">
				<button class="btn-secondary" onclick={closeModal}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submitCreateUser} disabled={formLoading}>
					{formLoading ? t('loading') : t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Tag hozzáadása -->
{#if modalMode === 'addMember'}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal">
			<h3>Tag hozzáadása a szervezethez</h3>
			<p class="modal-description">Válassz egy dolgozót, akit hozzá szeretnél adni a(z) "{currentOrganization?.name}" szervezethez.</p>

			{#if availableEmployeesLoading}
				<div class="loading-state"><div class="spinner"></div><span>Betöltés...</span></div>
			{:else if formError}
				<p class="form-error">{formError}</p>
			{:else if availableEmployees.length === 0}
				<p class="empty-state">Nincs hozzáadható dolgozó. Minden dolgozó már tagja ennek a szervezetnek.</p>
			{:else}
				<div class="member-search">
					<input
						class="form-input"
						type="text"
						bind:value={memberSearchInput}
						placeholder="Keresés név vagy email alapján..."
					/>
				</div>
				<div class="employee-list">
					{#each availableEmployees.filter(emp =>
						!memberSearchInput ||
						emp.userName.toLowerCase().includes(memberSearchInput.toLowerCase()) ||
						emp.userEmail.toLowerCase().includes(memberSearchInput.toLowerCase())
					) as employee (employee.id)}
						<label class="employee-item">
							<input type="radio" name="available-employee" value={employee.id} bind:group={selectedEmployeeId} />
							<div class="employee-info">
								{#if employee.userImage}
									<img src={employee.userImage} alt={employee.userName} class="employee-avatar" />
								{:else}
									<div class="employee-avatar-placeholder">
										{employee.userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
									</div>
								{/if}
								<div class="employee-details">
									<span class="employee-name">{employee.userName}</span>
									<span class="employee-email">{employee.userEmail}</span>
									{#if employee.position || employee.department}
										<span class="employee-meta">
											{[employee.position, employee.department].filter(Boolean).join(' • ')}
										</span>
									{/if}
								</div>
							</div>
						</label>
					{/each}
				</div>
			{/if}

			<div class="modal-footer">
				<button class="btn-secondary" onclick={closeModal}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submitAddMember} disabled={!selectedEmployeeId || formLoading}>
					{formLoading ? t('loading') : 'Hozzáadás'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Tag eltávolítás megerősítése -->
{#if showRemoveConfirmation && employeeToRemove}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal modal-confirm">
			<div class="confirm-icon">⚠️</div>
			<h3>Tag eltávolítása</h3>
			<p class="modal-description">
				Biztosan el szeretnéd távolítani <strong>{employeeToRemove.userName}</strong> dolgozót
				a(z) "{currentOrganization?.name}" szervezetből?
			</p>
			<p class="modal-description warning-text">
				A dolgozó értesítést fog kapni az eltávolításról.
			</p>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={cancelRemoveMember} disabled={formLoading}>
					{t('form.cancel')}
				</button>
				<button class="btn-danger" onclick={confirmRemoveMember} disabled={formLoading}>
					{formLoading ? t('loading') : 'Eltávolítás'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Szerepkör módosítása -->
{#if modalMode === 'changeRole' && employeeToChangeRole}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal modal-confirm">
			<div class="confirm-icon">👤</div>
			<h3>Szerepkör módosítása</h3>
			<p class="modal-description">
				Biztosan módosítani szeretnéd <strong>{employeeToChangeRole.userName}</strong> szerepkörét?
			</p>
			<div class="role-selection">
				<label class="role-option">
					<input type="radio" name="role" value="member" bind:group={newRole} />
					<div class="role-info">
						<span class="role-title">Tag</span>
						<span class="role-desc">Normál hozzáférés a szervezet adataihoz</span>
					</div>
				</label>
				<label class="role-option">
					<input type="radio" name="role" value="admin" bind:group={newRole} />
					<div class="role-info">
						<span class="role-title">Adminisztrátor</span>
						<span class="role-desc">Teljes hozzáférés, tagok kezelése</span>
					</div>
				</label>
			</div>
			{#if formError}
				<p class="form-error">{formError}</p>
			{/if}
			<div class="modal-footer">
				<button class="btn-secondary" onclick={cancelChangeRole} disabled={formLoading}>
					{t('form.cancel')}
				</button>
				<button class="btn-primary" onclick={confirmChangeRole} disabled={formLoading}>
					{formLoading ? t('loading') : 'Módosítás'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../styles/shared.css';

	.page {
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
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

	:global(.badge-active) { background: #dcfce7; color: #166534; }
	:global(.badge-inactive) { background: #f1f5f9; color: #475569; }
	:global(.badge-on-leave) { background: #dbeafe; color: #1e40af; }
	:global(.badge-admin) { background: #fef3c7; color: #92400e; }
	:global(.badge-member) { background: #e0e7ff; color: #3730a3; }

	/* Avatar */
	:global(.avatar-img) {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		object-fit: cover;
	}

	:global(.avatar-placeholder) {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--color-primary-subtle, #e0e7ff);
		color: var(--color-primary, #3730a3);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 700;
	}

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
	}

	.modal h3 {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0;
	}

	.modal-choices {
		display: flex;
		gap: 0.75rem;
	}

	.choice-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem;
		border: 2px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: transparent;
		cursor: pointer;
		transition: all 0.15s;
	}

	.choice-btn:hover {
		border-color: var(--color-primary, #3730a3);
		background: var(--color-primary-subtle, #e0e7ff);
	}

	.choice-icon { font-size: 1.5rem; }
	.choice-label { font-size: 0.8rem; font-weight: 500; text-align: center; }

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
	}

	/* Felhasználó lista */
	.user-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 200px;
		overflow-y: auto;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.25rem;
	}

	.user-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.user-item:hover { background: var(--color-accent, #f1f5f9); }

	.user-name { font-weight: 500; font-size: 0.875rem; }
	.user-email { font-size: 0.8rem; color: var(--color-muted-foreground, #64748b); margin-left: auto; }

	/* Űrlap */
	.form-fields, .form-row {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.form-row { flex-direction: row; }
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

	.form-error {
		color: #dc2626;
		font-size: 0.8rem;
		margin: 0;
	}

	.modal-description {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.875rem;
		margin: 0;
		line-height: 1.5;
	}

	.member-search {
		margin-bottom: 0.75rem;
	}

	.employee-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 300px;
		overflow-y: auto;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.5rem;
	}

	.employee-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.employee-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.employee-info {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		flex: 1;
	}

	.employee-avatar {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.employee-avatar-placeholder {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		background: var(--color-primary-subtle, #e0e7ff);
		color: var(--color-primary, #3730a3);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.employee-details {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}

	.employee-name {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--color-foreground, #0f172a);
	}

	.employee-email {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.employee-meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	/* Confirmation modal */
	.modal-confirm {
		text-align: center;
	}

	.confirm-icon {
		font-size: 3rem;
		margin-bottom: 0.5rem;
	}

	.warning-text {
		color: #dc2626;
		font-weight: 500;
	}

	/* Role selection */
	.role-selection {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 1rem 0;
	}

	.role-option {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		border: 2px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.role-option:hover {
		border-color: var(--color-primary, #3730a3);
		background: var(--color-primary-subtle, #e0e7ff);
	}

	.role-option:has(input:checked) {
		border-color: var(--color-primary, #3730a3);
		background: var(--color-primary-subtle, #e0e7ff);
	}

	.role-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}

	.role-title {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--color-foreground, #0f172a);
	}

	.role-desc {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
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

	:global(.dark) .choice-btn {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .choice-btn:hover {
		border-color: var(--color-primary, #3730a3);
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}

	:global(.dark) .user-list {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .user-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .user-name {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .user-email {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .form-input {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) :global(.avatar-placeholder) {
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}

	:global(.dark) .no-access-message h2 {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .no-access-message p {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .modal-description {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .employee-list {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .employee-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .employee-name {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .employee-email {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .employee-meta {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .employee-avatar-placeholder {
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}

	:global(.dark) .role-option {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .role-option:hover {
		border-color: var(--color-primary, #3730a3);
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}

	:global(.dark) .role-option:has(input:checked) {
		border-color: var(--color-primary, #3730a3);
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}

	:global(.dark) .role-title {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .role-desc {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}
</style>
