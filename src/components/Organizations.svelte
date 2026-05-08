<svelte:options customElement={{ tag: 'racona-work-organizations', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_Organizations = function () {
			return { tagName: 'racona-work-organizations' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Organizations - Szervezetek kezelése (admin)
	 */

	import { onMount } from 'svelte';
	import type { Organization } from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	// Organization store - inicializálás
	let orgStore = $state<OrganizationStore | null>(null);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	// --- Állapot ---
	let organizations = $state<Organization[]>([]);
	let selectedOrg = $state<Organization | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// --- Űrlap állapotok ---
	let showCreateForm = $state(false);
	let showEditForm = $state(false);
	let showAddMemberForm = $state(false);
	let newOrgName = $state('');
	let newOrgAddress = $state('');
	let newOrgPhone = $state('');
	let newOrgEmail = $state('');
	let newOrgWebsite = $state('');
	let newOrgNotes = $state('');
	let editOrgId = $state<number | null>(null);
	let editOrgName = $state('');
	let editOrgAddress = $state('');
	let editOrgPhone = $state('');
	let editOrgEmail = $state('');
	let editOrgWebsite = $state('');
	let editOrgNotes = $state('');

	// --- Adatok betöltése ---
	async function loadOrganizations() {
		loading = true;
		error = null;
		try {
			const result = await sdk?.remote?.call('getOrganizations', {});
			organizations = result as Organization[];
			if (organizations.length > 0 && !selectedOrg) {
				selectedOrg = organizations[0];
			}
		} catch (err: any) {
			error = err?.message ?? t('error.loadFailed');
		} finally {
			loading = false;
		}
	}

	// --- Szervezet létrehozása ---
	async function handleCreateOrganization() {
		if (!newOrgName.trim()) {
			error = 'A szervezet neve kötelező';
			return;
		}

		loading = true;
		error = null;
		try {
			const result = await sdk?.remote?.call('createOrganization', {
				name: newOrgName,
				address: newOrgAddress || undefined,
				phone: newOrgPhone || undefined,
				email: newOrgEmail || undefined,
				website: newOrgWebsite || undefined,
				notes: newOrgNotes || undefined
			});
			const newOrg = result as Organization;

			// Hozzáadjuk a store-hoz is
			orgStore.availableOrganizations = [...orgStore.availableOrganizations, newOrg];
			// Automatikusan váltunk az új szervezetre a store-ban is
			await orgStore.switchOrganization(newOrg.id);

			organizations = [...organizations, newOrg];
			selectedOrg = newOrg;
			newOrgName = '';
			newOrgAddress = '';
			newOrgPhone = '';
			newOrgEmail = '';
			newOrgWebsite = '';
			newOrgNotes = '';
			showCreateForm = false;

			// Toast üzenet megjelenítése
			sdk?.ui?.toast(`${newOrg.name} létrehozva`, 'success');

			// Értesítjük a sidebar OrganizationSwitcher-t
			window.dispatchEvent(new CustomEvent('organization-created', { detail: { organization: newOrg } }));
		} catch (err: any) {
			error = err?.message ?? t('error.saveFailed');
		} finally {
			loading = false;
		}
	}

	// --- Szervezet szerkesztése ---
	function openEditForm(org: Organization) {
		editOrgId = org.id;
		editOrgName = org.name;
		editOrgAddress = org.address ?? '';
		editOrgPhone = org.phone ?? '';
		editOrgEmail = org.email ?? '';
		editOrgWebsite = org.website ?? '';
		editOrgNotes = org.notes ?? '';
		showEditForm = true;
	}

	async function handleUpdateOrganization() {
		if (!editOrgName.trim() || editOrgId === null) {
			error = 'A szervezet neve kötelező';
			return;
		}

		loading = true;
		error = null;
		try {
			const result = await sdk?.remote?.call('updateOrganization', {
				id: editOrgId,
				name: editOrgName,
				address: editOrgAddress || null,
				phone: editOrgPhone || null,
				email: editOrgEmail || null,
				website: editOrgWebsite || null,
				notes: editOrgNotes || null
			});
			const updatedOrg = result as Organization;

			// Frissítjük a store-ban is
			orgStore.updateOrganization(updatedOrg);

			// Frissítjük a listát
			organizations = organizations.map((org) => (org.id === updatedOrg.id ? updatedOrg : org));

			// Ha ez a kiválasztott szervezet, frissítjük
			if (selectedOrg?.id === updatedOrg.id) {
				selectedOrg = updatedOrg;
			}

			showEditForm = false;
			editOrgId = null;

			// Toast üzenet megjelenítése
			sdk?.ui?.toast(`${updatedOrg.name} adatai frissítve`, 'success');
		} catch (err: any) {
			error = err?.message ?? t('error.saveFailed');
		} finally {
			loading = false;
		}
	}

	// --- Szervezet törlése ---
	async function handleDeleteOrganization(org: Organization) {
		// Először lekérdezzük a tagok számát
		let memberCount = 0;
		try {
			const members = await sdk.remote.call('getOrganizationMembers', {
				organizationId: org.id
			});
			memberCount = members?.length ?? 0;
		} catch (err) {
			console.error('Hiba a tagok lekérdezésekor:', err);
		}

		// Részletes megerősítő dialógus
		const confirmed = await sdk?.ui?.dialog({
			type: 'confirm',
			title: 'Szervezet törlése',
			message: `Biztosan törölni szeretnéd a(z) "${org.name}" szervezetet?

Ez a művelet a következő hatásokkal jár:

• ${memberCount} tag eltávolítása a szervezetből
• A szervezet összes adata törlésre kerül
• Ez a művelet nem vonható vissza!

${memberCount > 0 ? '\nA dolgozók nem törlődnek, csak a szervezeti tagságuk szűnik meg.' : ''}`,
			confirmLabel: 'Törlés',
			confirmVariant: 'destructive'
		});

		if (!confirmed || confirmed.action !== 'confirm') {
			return;
		}

		loading = true;
		error = null;
		try {
			// Használjuk a store-t a törléshez
			const result = await orgStore.deleteOrganization(org.id);
			if (!result.success) {
				throw new Error(orgStore.error ?? 'Törlés sikertelen');
			}

			// Eltávolítjuk a listából
			organizations = organizations.filter((o) => o.id !== org.id);

			// Ha ez volt a kiválasztott szervezet, válasszuk ki az elsőt
			if (selectedOrg?.id === org.id) {
				selectedOrg = organizations.length > 0 ? organizations[0] : null;
			}

			// Toast üzenet megjelenítése a törölt tagok számával
			const deletedInfo =
				result.memberCount && result.memberCount > 0
					? ` (${result.memberCount} tag eltávolítva)`
					: '';
			sdk?.ui?.toast(`${org.name} sikeresen törölve${deletedInfo}`, 'success');
		} catch (err: any) {
			error = err?.message ?? t('error.deleteFailed');
			sdk?.ui?.toast(error, 'error');
		} finally {
			loading = false;
		}
	}

	// --- Szervezet váltás ---
	async function handleSelectOrganization(org: Organization) {
		selectedOrg = org;
	}

	// --- Inicializálás ---
	onMount(() => {
		// Store inicializálás
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				// Ha még nincs store, létrehozzuk
				orgStore = createOrganizationStore(pluginId, sdk);
			}

			// Szervezetek betöltése
			orgStore.loadOrganizations();

			// Admin komponens, ezért az összes szervezetet betöltjük
			loadOrganizations();
		}
	});
</script>

<section class="page">
	<div class="page-header">
        <div class="page-header_title">
		    <h2>{t('organizations.title')}</h2>
            <p class="subtitle">{t('dashboard.subtitle')}</p>
        </div>
		<button class="btn-primary" onclick={() => (showCreateForm = true)}>
			{t('organizations.create')}
		</button>
	</div>

	{#if error}
		<div class="error-banner">
			<p>{error}</p>
			<button onclick={() => (error = null)}>✕</button>
		</div>
	{/if}

	<div class="content-grid">
		<!-- Szervezetek listája -->
		<div class="org-list-panel">
			<h3>Szervezetek</h3>
			{#if loading && organizations.length === 0}
				<div class="loading-state">
					<div class="spinner"></div>
					<span>{t('loading')}</span>
				</div>
			{:else if organizations.length === 0}
				<p class="empty-state">Még nincs szervezet létrehozva</p>
			{:else}
				<div class="org-list">
					{#each organizations as org (org.id)}
						<div class="org-card-wrapper">
							<button
								class="org-card"
								class:active={selectedOrg?.id === org.id}
								onclick={() => handleSelectOrganization(org)}
							>
								<div class="org-card-icon">🏢</div>
								<div class="org-card-details">
									<span class="org-card-name">{org.name}</span>
									<span class="org-card-slug">{org.slug}</span>
								</div>
							</button>
							<button
								class="org-edit-btn"
								onclick={(e) => {
									e.stopPropagation();
									openEditForm(org);
								}}
								title="Szerkesztés"
							>
								✏️
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Szervezet részletek -->
		{#if selectedOrg}
			<div class="details-panel">
				<div class="panel-header">
					<h3>{selectedOrg.name}</h3>
				</div>

				<div class="details-grid">
					<div class="detail-item">
						<span class="detail-label">Slug</span>
						<span class="detail-value">{selectedOrg.slug}</span>
					</div>
					{#if selectedOrg.address}
						<div class="detail-item">
							<span class="detail-label">Cím</span>
							<span class="detail-value">{selectedOrg.address}</span>
						</div>
					{/if}
					{#if selectedOrg.phone}
						<div class="detail-item">
							<span class="detail-label">Telefon</span>
							<span class="detail-value">{selectedOrg.phone}</span>
						</div>
					{/if}
					{#if selectedOrg.email}
						<div class="detail-item">
							<span class="detail-label">Email</span>
							<span class="detail-value">{selectedOrg.email}</span>
						</div>
					{/if}
					{#if selectedOrg.website}
						<div class="detail-item">
							<span class="detail-label">Weboldal</span>
							<span class="detail-value">
								<a href={selectedOrg.website} target="_blank" rel="noopener noreferrer">
									{selectedOrg.website}
								</a>
							</span>
						</div>
					{/if}
					{#if selectedOrg.notes}
						<div class="detail-item">
							<span class="detail-label">Megjegyzés</span>
							<span class="detail-value">{selectedOrg.notes}</span>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Új szervezet létrehozása modal -->
	{#if showCreateForm}
		<div class="modal-overlay" onclick={() => (showCreateForm = false)}>
			<div class="modal" onclick={(e) => e.stopPropagation()}>
				<div class="modal-header">
					<h3>{t('organizations.create')}</h3>
					<button class="modal-close" onclick={() => (showCreateForm = false)}>✕</button>
				</div>
				<div class="modal-body">
					<label>
						<span>{t('organizations.name')} *</span>
						<input
							type="text"
							bind:value={newOrgName}
							placeholder="pl. Acme Kft."
							class="input"
						/>
					</label>
					<label>
						<span>Cím</span>
						<input
							type="text"
							bind:value={newOrgAddress}
							placeholder="pl. 1234 Budapest, Fő utca 1."
							class="input"
						/>
					</label>
					<label>
						<span>Telefon</span>
						<input
							type="tel"
							bind:value={newOrgPhone}
							placeholder="pl. +36 1 234 5678"
							class="input"
						/>
					</label>
					<label>
						<span>Email</span>
						<input
							type="email"
							bind:value={newOrgEmail}
							placeholder="pl. info@acme.hu"
							class="input"
						/>
					</label>
					<label>
						<span>Weboldal</span>
						<input
							type="url"
							bind:value={newOrgWebsite}
							placeholder="pl. https://acme.hu"
							class="input"
						/>
					</label>
					<label>
						<span>Megjegyzés</span>
						<textarea
							bind:value={newOrgNotes}
							placeholder="Opcionális megjegyzések..."
							class="input textarea"
							rows="3"
						></textarea>
					</label>
				</div>
				<div class="modal-footer">
					<button class="btn-secondary" onclick={() => (showCreateForm = false)}>
						{t('form.cancel')}
					</button>
					<button class="btn-primary" onclick={handleCreateOrganization} disabled={loading}>
						{t('form.save')}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Szervezet szerkesztése modal -->
	{#if showEditForm}
		<div class="modal-overlay" onclick={() => (showEditForm = false)}>
			<div class="modal" onclick={(e) => e.stopPropagation()}>
				<div class="modal-header">
					<h3>Szervezet szerkesztése</h3>
					<button class="modal-close" onclick={() => (showEditForm = false)}>✕</button>
				</div>
				<div class="modal-body">
					<label>
						<span>Név *</span>
						<input
							type="text"
							bind:value={editOrgName}
							placeholder="pl. Acme Kft."
							class="input"
						/>
					</label>
					<label>
						<span>Cím</span>
						<input
							type="text"
							bind:value={editOrgAddress}
							placeholder="pl. 1234 Budapest, Fő utca 1."
							class="input"
						/>
					</label>
					<label>
						<span>Telefon</span>
						<input
							type="tel"
							bind:value={editOrgPhone}
							placeholder="pl. +36 1 234 5678"
							class="input"
						/>
					</label>
					<label>
						<span>Email</span>
						<input
							type="email"
							bind:value={editOrgEmail}
							placeholder="pl. info@acme.hu"
							class="input"
						/>
					</label>
					<label>
						<span>Weboldal</span>
						<input
							type="url"
							bind:value={editOrgWebsite}
							placeholder="pl. https://acme.hu"
							class="input"
						/>
					</label>
					<label>
						<span>Megjegyzés</span>
						<textarea
							bind:value={editOrgNotes}
							placeholder="Opcionális megjegyzések..."
							class="input textarea"
							rows="3"
						></textarea>
					</label>
				</div>
				<div class="modal-footer">
					<button
						class="btn-danger"
						onclick={() => {
							const orgToDelete = organizations.find((o) => o.id === editOrgId);
							if (orgToDelete) {
								showEditForm = false;
								handleDeleteOrganization(orgToDelete);
							}
						}}
						disabled={loading}
					>
						Törlés
					</button>
					<div style="flex: 1;"></div>
					<button class="btn-secondary" onclick={() => (showEditForm = false)}>
						Mégse
					</button>
					<button class="btn-primary" onclick={handleUpdateOrganization} disabled={loading}>
						Mentés
					</button>
				</div>
			</div>
		</div>
	{/if}
</section>

<style>
	.page {
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
        margin-bottom: 1rem;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
	}

    .page-header_title {
		display: flex;
        flex-direction: column;
	}

    .subtitle {
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
		font-size: 0.875rem;
	}

	.content-grid {
		display: grid;
		grid-template-columns: 300px 1fr;
		gap: 1.5rem;
	}

	/* Szervezetek lista */
	.org-list-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.org-list-panel h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
	}

	.org-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.org-card-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.org-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: left;
		flex: 1;
	}

	.org-edit-btn {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.5rem;
		cursor: pointer;
		font-size: 1rem;
		transition: all 0.15s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
	}

	.org-edit-btn:hover {
		background: var(--color-accent, #f8fafc);
		border-color: var(--color-primary, #3730a3);
	}

	.org-card:hover {
		background: var(--color-accent, #f8fafc);
		border-color: var(--color-primary, #3730a3);
	}

	.org-card.active {
		background: var(--color-primary-subtle, #eef2ff);
		border-color: var(--color-primary, #3730a3);
	}

	.org-card-icon {
		font-size: 1.5rem;
	}

	.org-card-details {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
	}

	.org-card-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-foreground, #0f172a);
	}

	.org-card.active .org-card-name {
		color: var(--color-primary, #3730a3);
	}

	.org-card-slug {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
		font-family: 'Courier New', monospace;
	}

	/* Details panel */
	.details-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.panel-header h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
	}

	.details-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.detail-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.detail-value {
		font-size: 0.875rem;
		color: var(--color-foreground, #0f172a);
	}

	.detail-value a {
		color: var(--color-primary, #3730a3);
		text-decoration: none;
	}

	.detail-value a:hover {
		text-decoration: underline;
	}

	/* Tagok panel - REMOVED */
	/* Tagok panel - REMOVED */

	/* Gombok */
	.btn-primary {
		background: var(--color-primary, #3730a3);
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		transition: opacity 0.15s ease;
	}

	.btn-primary:hover {
		opacity: 0.9;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: transparent;
		color: var(--color-foreground, #0f172a);
		border: 1px solid var(--color-border, #e2e8f0);
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		transition: background 0.15s ease;
	}

	.btn-secondary:hover {
		background: var(--color-accent, #f1f5f9);
	}

	/* Removed btn-danger-sm - not needed anymore */

	.btn-danger {
		background: #dc2626;
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		transition: opacity 0.15s ease;
	}

	.btn-danger:hover {
		opacity: 0.9;
	}

	.btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: var(--color-card, #ffffff);
		border-radius: 0.75rem;
		width: 90%;
		max-width: 500px;
		box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.5rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.modal-header h3 {
		font-size: 1.125rem;
		font-weight: 600;
		margin: 0;
	}

	.modal-close {
		background: transparent;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: var(--color-muted-foreground, #64748b);
		padding: 0;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		transition: background 0.15s ease;
	}

	.modal-close:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.modal-body {
		padding: 1.5rem;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1.5rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	label span {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-foreground, #0f172a);
	}

	.input {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		background: var(--color-background, #ffffff);
		color: var(--color-foreground, #0f172a);
	}

	.input:focus {
		outline: none;
		border-color: var(--color-primary, #3730a3);
		box-shadow: 0 0 0 3px var(--color-primary-subtle, #eef2ff);
	}

	/* Állapotok */
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
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-state {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.875rem;
		padding: 1rem 0;
	}

	.error-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.5rem;
		color: #dc2626;
		font-size: 0.875rem;
	}

	.error-banner button {
		background: transparent;
		border: none;
		color: #dc2626;
		cursor: pointer;
		font-size: 1.25rem;
		padding: 0;
		width: 1.5rem;
		height: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		transition: background 0.15s ease;
	}

	.error-banner button:hover {
		background: rgba(220, 38, 38, 0.1);
	}

	.textarea {
		resize: vertical;
		font-family: inherit;
		min-height: 4rem;
	}

	.modal-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 70vh;
		overflow-y: auto;
	}
</style>
