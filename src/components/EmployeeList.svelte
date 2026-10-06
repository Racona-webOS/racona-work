<svelte:options customElement={{ tag: 'racona-work-employee-list', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_EmployeeList = function () {
			return { tagName: 'racona-work-employee-list' };
		};
	}
</script>

<script lang="ts">
	import { onMount, untrack, createRawSnippet } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type {
		EmployeeRow,
		PaginatedResult,
		UnlinkedUser
	} from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { formatDate } from '../utils/format.js';
	import { roleName } from '../utils/roles.js';
	import { escapeHtml, safeImageUrl } from '../utils/html.js';

	let { pluginId = 'racona-work' }: {
		pluginId?: string;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	// Organization store - inicializálás
	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<import('../../server/functions.js').Organization | null>(null);
	let hasAccess = $state(false);

	// --- SDK DataTable komponensek ---
	const DataTable = $derived(sdk?.components?.DataTable);
	const DataTableColumnHeader = $derived(sdk?.components?.DataTableColumnHeader);
	const renderComponent = $derived(sdk?.components?.renderComponent);
	const renderSnippet = $derived(sdk?.components?.renderSnippet);
	const createActionsColumn = $derived(sdk?.components?.createActionsColumn);
	const Input = $derived(sdk?.components?.Input);
	const Button = $derived(sdk?.components?.Button);

	// --- Táblázat állapot ---
	let data = $state<EmployeeRow[]>([]);
	let loading = $state(false);
	let searchInput = $state('');
	let debouncedSearch = $state('');
	let paginationInfo = $state({ page: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
	let tableState = $state({ page: 1, pageSize: 20, sortBy: 'userName', sortOrder: 'asc' as 'asc' | 'desc' });
	let columns = $state<any[]>([]);
	/** Dokumentum-jelvények és szűrő (specs/employee-documents.md, K11) — olvasási joggal. */
	let canViewDocuments = $state(false);
	let documentIssuesOnly = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout>;

	// --- Modal állapot ---
	type ModalMode = 'none' | 'choose' | 'link' | 'create';
	let modalMode = $state<ModalMode>('none');
	let unlinkedUsers = $state<UnlinkedUser[]>([]);
	let unlinkedLoading = $state(false);
	let selectedUserId = $state<number | null>(null);
	let newName = $state('');
	let newEmail = $state('');
	let newPosition = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

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
				search: debouncedSearch || undefined,
				includeExternal: true,
				withDocumentIssues: canViewDocuments,
				documentIssuesOnly: canViewDocuments && documentIssuesOnly
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
			return t('error.network');
		}

		// Jogosultsági hiba
		if (errorMessage.toLowerCase().includes('unauthorized') ||
		    errorMessage.toLowerCase().includes('forbidden') ||
		    errorMessage.toLowerCase().includes('permission')) {
			return t('error.forbidden');
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

	function syncDocumentCapability(): boolean {
		const store = (window as any).__racona_work_org_store__;
		const next =
			(store?.can?.('employee.documents.view') ?? false) || (store?.can?.('employee.documents.manage') ?? false);
		const changed = next !== canViewDocuments;
		canViewDocuments = next;
		if (!next) documentIssuesOnly = false;
		return changed;
	}

	$effect(() => {
		const onCapabilities = () => {
			if (syncDocumentCapability()) {
				buildColumns();
				if (sdk?.remote && currentOrganization) loadData();
			}
		};
		window.addEventListener('plugin-capabilities-changed', onCapabilities);
		window.addEventListener('organization-changed', onCapabilities);
		return () => {
			window.removeEventListener('plugin-capabilities-changed', onCapabilities);
			window.removeEventListener('organization-changed', onCapabilities);
		};
	});

	function toggleDocumentIssuesOnly(e: Event) {
		documentIssuesOnly = (e.currentTarget as HTMLInputElement).checked;
		tableState = { ...tableState, page: 1 };
	}

	/** A dolgozó dokumentumproblémái jelvényként (lejárt, lejáró, hiányzó, fájl nélküli). */
	function documentIssuesHtml(issues: EmployeeRow['documentIssues']): string {
		if (!issues) return '';
		const parts: string[] = [];
		if (issues.pending) parts.push(`<span class="badge badge-on-leave">${escapeHtml(t('employees.documents.pending', { count: issues.pending }))}</span>`);
		if (issues.expired) parts.push(`<span class="badge badge-doc-danger">${escapeHtml(t('employees.documents.expired', { count: issues.expired }))}</span>`);
		if (issues.expiring) parts.push(`<span class="badge badge-doc-warn">${escapeHtml(t('employees.documents.expiring', { count: issues.expiring }))}</span>`);
		const missing = issues.missing + issues.fileMissing;
		if (missing) parts.push(`<span class="badge badge-doc-warn">${escapeHtml(t('employees.documents.missing', { count: missing }))}</span>`);
		return parts.length
			? `<span class="role-badges">${parts.join('')}</span>`
			: `<span class="text-sm text-muted-foreground">${escapeHtml(t('employees.documents.ok'))}</span>`;
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

		const actionsColumn = createActionsColumn((row: EmployeeRow) => [
			{
				label: t('employeeDetail.title'),
				onClick: (row: EmployeeRow) => navigateToDetail(row.id),
				primary: true
			},
			{
				label: t('employees.remove.title'),
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
					// A név és a kép a core profilban szabadon átírható: minden érték escapelve
					const img = safeImageUrl(row.original.userImage);
					const name = row.original.userName ?? '';
					const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
					const snippet = createRawSnippet(() => ({
						render: () => img
							? `<img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" class="avatar-img" />`
							: `<div class="avatar-placeholder">${escapeHtml(initials)}</div>`
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
					const external = row.original.isExternal
						? ` <span style="margin-left:0.375rem;font-size:0.7rem;font-weight:600;padding:0.05rem 0.45rem;border-radius:999px;background:#ede9fe;color:#6d28d9">${escapeHtml(t('employees.external.badge'))}</span>`
						: '';
					const snippet = createRawSnippet(() => ({ render: () => `<span><span class="font-medium">${escapeHtml(name)}</span>${external}</span>` }));
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
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm text-muted-foreground">${escapeHtml(email)}</span>` }));
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
						render: () => `<span class="badge ${cls}">${escapeHtml(label)}</span>`
					}));
					return renderSnippet(snippet, {});
				}
			},
			...(canViewDocuments
				? [
						{
							accessorKey: 'documentIssues',
							enableHiding: true,
							enableSorting: false,
							meta: { title: t('employees.columns.documents') },
							header: () => t('employees.columns.documents'),
							cell: ({ row }: any) => {
								const html = documentIssuesHtml(row.original.documentIssues);
								const snippet = createRawSnippet(() => ({ render: () => html }));
								return renderSnippet(snippet, {});
							}
						}
					]
				: []),
			{
				accessorKey: 'roles',
				enableHiding: true,
				meta: { title: t('employees.columns.roles') },
				header: ({ column }: any) => renderComponent(DataTableColumnHeader, {
					get column() { return column; },
					get title() { return t('employees.columns.roles'); },
					onSort: handleSort
				}),
				cell: ({ row }: any) => {
					const roles: NonNullable<EmployeeRow['roles']> = row.original.roles ?? [];
					const html = roles.length
						? `<span class="role-badges">${roles
								.map((r) => `<span class="badge badge-member">${escapeHtml(roleName(t, r))}</span>`)
								.join('')}</span>`
						: `<span class="text-sm text-muted-foreground">—</span>`;
					const snippet = createRawSnippet(() => ({ render: () => html }));
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
					const val = formatDate(row.original.hireDate);
					const snippet = createRawSnippet(() => ({ render: () => `<span class="text-sm text-muted-foreground">${escapeHtml(val)}</span>` }));
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
			formError = t('error.noOrganization');
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
		formError = null;
	}

	function closeModal() {
		modalMode = 'none';
		formError = null;
	}

	async function submitLinkUser() {
		if (!selectedUserId) return;

		// Ellenőrizzük, hogy van-e kiválasztott szervezet
		if (!currentOrganization) {
			formError = t('error.noOrganization');
			return;
		}

		formLoading = true;
		formError = null;
		try {

			await sdk?.remote?.call('createEmployeeFromUser', {
				userId: selectedUserId,
				position: newPosition || undefined,
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
			formError = t('error.noOrganization');
			return;
		}

		formLoading = true;
		formError = null;
		try {
			await sdk?.remote?.call('createEmployeeWithUser', {
				name: newName,
				email: newEmail,
				position: newPosition || undefined,
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

	// --- Tag eltávolítás ---
	function handleRemoveMemberClick(employee: EmployeeRow) {
		employeeToRemove = employee;
		showRemoveConfirmation = true;
	}

	/** A megerősítő mondat a félkövér név előtt és után ({name} helyén vágva). */
	const removeConfirmParts = $derived(
		t('employees.remove.confirm', { organization: currentOrganization?.name ?? '' }).split('{name}')
	);

	function cancelRemoveMember() {
		employeeToRemove = null;
		showRemoveConfirmation = false;
	}

	async function confirmRemoveMember() {
		if (!employeeToRemove || !currentOrganization) return;

		formLoading = true;
		try {
			await sdk?.remote?.call('removeEmployeeFromOrganization', {
				organizationId: currentOrganization.id,
				employeeId: employeeToRemove.id
			});

			// Az eltávolított dolgozót a szerver értesíti (removeEmployeeFromOrganization)
			sdk?.ui?.toast(t('employees.remove.success'), 'success');
			cancelRemoveMember();
			loadData();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('employees.remove.failed'), 'error');
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

		syncDocumentCapability();
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
							<div class="search-box">
								<!-- svelte-ignore svelte_component_deprecated -->
								<svelte:component
									this={Input}
									placeholder={t('employees.search')}
									value={searchInput}
									oninput={handleSearchInput}
									class="h-8"
								/>
							</div>
						{/if}
						{#if canViewDocuments}
							<label class="doc-filter">
								<input type="checkbox" checked={documentIssuesOnly} onchange={toggleDocumentIssuesOnly} />
								<span>{t('employees.documents.filter')}</span>
							</label>
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
				<p class="empty-state">{t('employees.noUnlinkedUsers')}</p>
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
					<input class="form-input" type="text" bind:value={newPosition} placeholder={t('employees.form.positionPlaceholder')} />
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
					{t('employees.columns.name')} *
					<input class="form-input" type="text" bind:value={newName} placeholder={t('employees.form.namePlaceholder')} />
				</label>
				<label class="form-label">
					{t('employees.columns.email')} *
					<input class="form-input" type="email" bind:value={newEmail} placeholder={t('employees.form.emailPlaceholder')} />
				</label>
				<label class="form-label">
					{t('employeeDetail.position')}
					<input class="form-input" type="text" bind:value={newPosition} placeholder={t('employees.form.positionPlaceholder')} />
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

<!-- Modal: Tag eltávolítás megerősítése -->
{#if showRemoveConfirmation && employeeToRemove}
	<div class="modal-overlay" role="dialog" aria-modal="true">
		<div class="modal modal-confirm">
			<div class="confirm-icon">⚠️</div>
			<h3>{t('employees.remove.title')}</h3>
			<p class="modal-description">
				{removeConfirmParts[0]}<strong>{employeeToRemove.userName}</strong>{removeConfirmParts[1] ?? ''}
			</p>
			<p class="modal-description warning-text">
				{t('employees.remove.notice')}
			</p>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={cancelRemoveMember} disabled={formLoading}>
					{t('form.cancel')}
				</button>
				<button class="btn-danger" onclick={confirmRemoveMember} disabled={formLoading}>
					{formLoading ? t('loading') : t('employees.remove.confirmLabel')}
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

	/* Gyorskereső: a teljes placeholder férjen ki */
	.search-box {
		width: 20rem;
		max-width: 100%;
	}

	.search-box :global(input) {
		width: 100%;
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
	:global(.badge-member) { background: #e0e7ff; color: #3730a3; }
	:global(.badge-doc-danger) { background: #fee2e2; color: #b91c1c; }
	:global(.badge-doc-warn) { background: #fef3c7; color: #92400e; }

	.doc-filter {
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		white-space: nowrap;
		cursor: pointer;
	}

	:global(.role-badges) {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

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

	/* Gomb stílusok a modalokhoz (.rw scopeon kívül vannak, :global kell) */

	/* Label override-ok: a shared.css globálisan flex-direction:column-t állít be
	   minden label-re, ezeket a modal-specifikus label-eknél felül kell írni. */
	.user-item {
		flex-direction: row;
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
		flex-direction: row;
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

	:global(.dark) .modal-description {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}
</style>
