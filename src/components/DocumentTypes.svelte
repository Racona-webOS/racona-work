<svelte:options customElement={{ tag: 'racona-work-document-types', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_DocumentTypes = function () {
			return { tagName: 'racona-work-document-types' };
		};
	}
</script>

<script lang="ts">
	/**
	 * Beállítások — Dokumentumtípusok (specs/employee-documents.md, K1).
	 *
	 * A szervezet dokumentumtípusai: fájlkezelés (kötelező / opcionális / nincs),
	 * lejárat és emlékeztetők, kötelező-e, látja-e a dolgozó. A dokumentummal
	 * rendelkező típus nem törölhető, csak archiválható.
	 */
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import type { DocumentFileMode, DocumentType, Organization } from '../../server/functions.js';
	import { getOrganizationStore, createOrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import AccessDenied from './AccessDenied.svelte';
	import Checkbox from './ui/Checkbox.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);

	let types = $state<DocumentType[]>([]);
	let includeArchived = $state(false);
	let loading = $state(false);

	type Draft = {
		id?: number;
		name: string;
		description: string;
		fileMode: DocumentFileMode;
		hasExpiry: boolean;
		defaultValidityMonths: string;
		reminderDays: string;
		isRequired: boolean;
		visibleToEmployee: boolean;
		employeeCanUpload: boolean;
	};
	/** Szervezeti beállítás (D4): a dolgozók is feltölthetnek, HR-jóváhagyással */
	let employeeUploadEnabled = $state(false);
	let settingsSaving = $state(false);
	let draft = $state<Draft | null>(null);
	let saving = $state(false);

	const FILE_MODES: DocumentFileMode[] = ['required', 'optional', 'none'];

	function cleanError(err: any, fallback: string): string {
		return err?.message?.replace(/^\[DevMode\] Remote call failed: \w+ — /, '').replace(/^[A-Z_]+:\s*/, '') ?? fallback;
	}

	async function load() {
		if (!currentOrganization) return;
		loading = true;
		try {
			const [typeList, settings] = await Promise.all([
				sdk.remote.call('listDocumentTypes', { organizationId: currentOrganization.id, includeArchived }),
				sdk.remote.call('getDocumentSettings', { organizationId: currentOrganization.id })
			]);
			types = typeList;
			employeeUploadEnabled = settings?.employeeUploadEnabled === true;
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.loadFailed')), 'error');
		} finally {
			loading = false;
		}
	}

	function openNew() {
		draft = {
			name: '',
			description: '',
			fileMode: 'optional',
			hasExpiry: false,
			defaultValidityMonths: '',
			reminderDays: '30, 7',
			isRequired: false,
			visibleToEmployee: true,
			employeeCanUpload: false
		};
	}

	function openEdit(type: DocumentType) {
		draft = {
			id: type.id,
			name: type.name,
			description: type.description ?? '',
			fileMode: type.fileMode,
			hasExpiry: type.hasExpiry,
			defaultValidityMonths: type.defaultValidityMonths ? String(type.defaultValidityMonths) : '',
			reminderDays: type.reminderDays.length > 0 ? type.reminderDays.join(', ') : '30, 7',
			isRequired: type.isRequired,
			visibleToEmployee: type.visibleToEmployee,
			employeeCanUpload: type.employeeCanUpload
		};
	}

	/** „30, 7” → [30, 7]; a hibás elemeket a szerver utasítja el érthető üzenettel. */
	function parseReminders(text: string): number[] {
		return text
			.split(/[,;\s]+/)
			.map((part) => part.trim())
			.filter(Boolean)
			.map(Number);
	}

	async function save() {
		if (!draft || !currentOrganization) return;
		if (!draft.name.trim()) {
			sdk?.ui?.toast(t('documentTypes.nameRequired'), 'warning');
			return;
		}
		saving = true;
		try {
			await sdk.remote.call('saveDocumentType', {
				id: draft.id,
				organizationId: currentOrganization.id,
				name: draft.name,
				description: draft.description || null,
				fileMode: draft.fileMode,
				hasExpiry: draft.hasExpiry,
				defaultValidityMonths: draft.hasExpiry && draft.defaultValidityMonths ? Number(draft.defaultValidityMonths) : null,
				reminderDays: draft.hasExpiry ? parseReminders(draft.reminderDays) : [],
				isRequired: draft.isRequired,
				visibleToEmployee: draft.visibleToEmployee,
				employeeCanUpload: draft.visibleToEmployee && draft.fileMode !== 'none' && draft.employeeCanUpload
			});
			sdk?.ui?.toast(t('documentTypes.saved'), 'success');
			draft = null;
			await load();
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.saveFailed')), 'error');
		} finally {
			saving = false;
		}
	}

	async function setEmployeeUpload(enabled: boolean) {
		if (!currentOrganization) return;
		settingsSaving = true;
		try {
			const settings = await sdk.remote.call('saveDocumentSettings', {
				organizationId: currentOrganization.id,
				employeeUploadEnabled: enabled
			});
			employeeUploadEnabled = settings?.employeeUploadEnabled === true;
			sdk?.ui?.toast(t('documentTypes.settingsSaved'), 'success');
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.saveFailed')), 'error');
		} finally {
			settingsSaving = false;
		}
	}

	async function setArchived(type: DocumentType, archived: boolean) {
		try {
			await sdk.remote.call('archiveDocumentType', { id: type.id, archived });
			await load();
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.saveFailed')), 'error');
		}
	}

	async function remove(type: DocumentType) {
		const result = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('documentTypes.deleteTitle'),
			message: t('documentTypes.deleteMessage', { name: type.name }),
			confirmLabel: t('documentTypes.delete'),
			confirmVariant: 'destructive'
		});
		if (result?.action !== 'confirm') return;
		try {
			await sdk.remote.call('deleteDocumentType', { id: type.id });
			await load();
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.deleteFailed')), 'error');
		}
	}

	function expiryText(type: DocumentType): string {
		if (!type.hasExpiry) return t('documentTypes.expiry.none');
		const validity = type.defaultValidityMonths
			? t('documentTypes.expiry.months', { months: type.defaultValidityMonths })
			: t('documentTypes.expiry.yes');
		return type.reminderDays.length > 0
			? `${validity} · ${t('documentTypes.expiry.reminders', { days: type.reminderDays.join(', ') })}`
			: validity;
	}

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
		untrack(() => {
			if (currentOrganization && sdk?.remote) load();
		});
	});
</script>

<div class="rw">
<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<div class="page-header-title">
				<h2>{t('documentTypes.title')}</h2>
				<p class="subtitle">{t('documentTypes.subtitle')}</p>
			</div>
			<button class="btn-primary" onclick={openNew}>+ {t('documentTypes.new')}</button>
		</div>

		<label class="setting-row" class:enabled={employeeUploadEnabled}>
			<Checkbox checked={employeeUploadEnabled} disabled={settingsSaving} onCheckedChange={setEmployeeUpload} />
			<span class="setting-text">
				<span class="setting-label">{t('documentTypes.employeeUpload')}</span>
				<span class="setting-hint">{t('documentTypes.employeeUploadHint')}</span>
			</span>
		</label>

		<label class="inline-check">
			<input type="checkbox" bind:checked={includeArchived} onchange={load} />
			<span>{t('documentTypes.showArchived')}</span>
		</label>

		{#if loading && types.length === 0}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if types.length === 0}
			<p class="empty-state">{t('documentTypes.empty')}</p>
		{:else}
			<div class="type-list">
				{#each types as type (type.id)}
					<article class="type-row" class:archived={type.archived}>
						<div class="type-main">
							<div class="type-name">
								<strong>{type.name}</strong>
								{#if type.isRequired}<span class="tag">{t('documentTypes.required')}</span>{/if}
								{#if type.archived}<span class="tag muted-tag">{t('documentTypes.archived')}</span>{/if}
							</div>
							{#if type.description}<p class="muted">{type.description}</p>{/if}
							<div class="type-facts">
								<span>{t(`documentTypes.fileMode.${type.fileMode}`)}</span>
								<span>{expiryText(type)}</span>
								<span>{type.visibleToEmployee ? t('documentTypes.visible') : t('documentTypes.hidden')}</span>
								{#if type.employeeCanUpload}<span>{t('documentTypes.employeeCanUploadFact')}</span>{/if}
								<span>{t('documentTypes.documentCount', { count: type.documentCount })}</span>
							</div>
						</div>
						<div class="type-actions">
							{#if !type.archived}
								<button class="btn-secondary btn-sm" onclick={() => openEdit(type)}>{t('documentTypes.edit')}</button>
								<button class="btn-secondary btn-sm" onclick={() => setArchived(type, true)}>{t('documentTypes.archive')}</button>
							{:else}
								<button class="btn-secondary btn-sm" onclick={() => setArchived(type, false)}>{t('documentTypes.restore')}</button>
							{/if}
							{#if type.documentCount === 0}
								<button class="btn-secondary btn-sm" onclick={() => remove(type)}>{t('documentTypes.delete')}</button>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		{/if}
	{/if}
</section>
</div>

{#if draft}
	<div class="modal-overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (draft = null)}>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="doc-type-title">
			<div class="modal-header">
				<h3 id="doc-type-title">{draft.id ? t('documentTypes.editTitle') : t('documentTypes.newTitle')}</h3>
				<button class="modal-close" onclick={() => (draft = null)} aria-label={t('form.cancel')}>×</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('documentTypes.field.name')}</span>
					<input class="input" type="text" maxlength="100" bind:value={draft.name} />
				</label>
				<label>
					<span>{t('documentTypes.field.description')}</span>
					<textarea class="input textarea" maxlength="1000" rows="2" bind:value={draft.description}></textarea>
				</label>
				<label>
					<span>{t('documentTypes.field.fileMode')}</span>
					<select class="input" bind:value={draft.fileMode}>
						{#each FILE_MODES as mode (mode)}
							<option value={mode}>{t(`documentTypes.fileMode.${mode}`)}</option>
						{/each}
					</select>
				</label>
				{#if draft.fileMode === 'none'}
					<p class="hint">{t('documentTypes.fileModeNoneHint')}</p>
				{/if}

				<label class="check-row">
					<Checkbox checked={draft.hasExpiry} onCheckedChange={(checked) => draft && (draft.hasExpiry = checked)} />
					<span>{t('documentTypes.field.hasExpiry')}</span>
				</label>
				{#if draft.hasExpiry}
					<div class="grid-2">
						<label>
							<span>{t('documentTypes.field.defaultValidity')}</span>
							<input class="input" type="number" min="1" max="240" step="1" bind:value={draft.defaultValidityMonths} />
						</label>
						<label>
							<span>{t('documentTypes.field.reminders')}</span>
							<input class="input" type="text" maxlength="40" placeholder="30, 7" bind:value={draft.reminderDays} />
						</label>
					</div>
					<p class="hint">{t('documentTypes.remindersHint')}</p>
				{/if}

				<label class="check-row">
					<Checkbox checked={draft.isRequired} onCheckedChange={(checked) => draft && (draft.isRequired = checked)} />
					<span>{t('documentTypes.field.required')}</span>
				</label>
				<label class="check-row">
					<Checkbox checked={draft.visibleToEmployee} onCheckedChange={(checked) => draft && (draft.visibleToEmployee = checked)} />
					<span>{t('documentTypes.field.visibleToEmployee')}</span>
				</label>
				{#if draft.visibleToEmployee && draft.fileMode !== 'none'}
					<label class="check-row">
						<Checkbox checked={draft.employeeCanUpload} onCheckedChange={(checked) => draft && (draft.employeeCanUpload = checked)} />
						<span>{t('documentTypes.field.employeeCanUpload')}</span>
					</label>
					{#if draft.employeeCanUpload && !employeeUploadEnabled}
						<p class="hint">{t('documentTypes.employeeUploadOffHint')}</p>
					{/if}
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (draft = null)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={save} disabled={saving}>{saving ? t('loading') : t('form.save')}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../styles/shared.css';

	.setting-row {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #fff);
		max-width: 900px;
		cursor: pointer;
	}

	.setting-row.enabled {
		background: var(--color-accent, #f1f5f9);
	}

	.setting-row :global(.wk-checkbox) {
		margin-top: 0.125rem;
	}

	.setting-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.setting-label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.setting-hint {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--color-muted-foreground, #64748b);
	}

	.inline-check {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		align-self: flex-start;
	}

	.type-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 900px;
	}

	.type-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #fff);
	}

	.type-row.archived {
		opacity: 0.65;
	}

	.type-main {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.type-name {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.type-facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.type-actions {
		display: flex;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.muted {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.tag {
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--color-primary-subtle, #eef2ff);
		color: var(--color-primary, #3730a3);
	}

	.muted-tag {
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
	}

	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.check-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		cursor: pointer;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}
</style>
