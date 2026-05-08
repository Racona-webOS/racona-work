<svelte:options customElement={{ tag: 'racona-work-project-create', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_ProjectCreate = function () {
			return { tagName: 'racona-work-project-create' };
		};
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type {} from '@racona/sdk/types';
	import {
		getOrganizationStore,
		createOrganizationStore
	} from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import type { Organization, ProjectRow } from '../../server/functions.js';
	import AccessDenied from './AccessDenied.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(
		(window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS
	);

	function t(key: string): string {
		return sdk?.i18n?.t(key) ?? key;
	}

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let canCreate = $state(false);

	// Form
	let name = $state('');
	let description = $state('');
	let status = $state<'active' | 'paused' | 'completed' | 'archived'>('active');
	let startDate = $state('');
	let endDate = $state('');
	let saving = $state(false);
	let errorMsg = $state<string | null>(null);

	async function handleSubmit(e?: Event) {
		e?.preventDefault();
		if (!currentOrganization) return;
		if (!name.trim()) {
			errorMsg = t('projects.create.name') + ': ' + t('form.required');
			return;
		}

		saving = true;
		errorMsg = null;
		try {
			const created = (await sdk.remote.call('createProject', {
				organizationId: currentOrganization.id,
				name: name.trim(),
				description: description.trim() || undefined,
				status,
				startDate: startDate || null,
				endDate: endDate || null
			})) as ProjectRow;
			sdk?.ui?.toast?.(t('projects.create.success'), 'success');
			sdk?.ui?.navigateTo?.('ProjectDetail', { projectId: created.id });
		} catch (err: any) {
			errorMsg = err?.message ?? t('error.saveFailed');
			sdk?.ui?.toast?.(errorMsg, 'error');
		} finally {
			saving = false;
		}
	}

	function handleCancel() {
		sdk?.ui?.navigateTo?.('ProjectList', {});
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
			canCreate = orgStore.can('project.create');

			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
				currentOrganization = orgStore.currentOrganization;
				hasAccess = orgStore.hasAccess;
				canCreate = orgStore.can('project.create');
			}
		}
	});

	$effect(() => {
		const handleOrgChange = () => {
			const store = (window as any).__racona_work_org_store__ as OrganizationStore | undefined;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
				canCreate = store.can('project.create');
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});
</script>

<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else if !canCreate}
		<div class="no-access">
			<p>{t('projects.create.noAccess')}</p>
		</div>
	{:else}
		<div class="page-header">
			<h2>{t('projects.create.title')}</h2>
		</div>

		<form class="form" onsubmit={handleSubmit}>
			<label class="full">
				<span>{t('projects.create.name')} *</span>
				<input class="input" type="text" bind:value={name} required />
			</label>

			<label class="full">
				<span>{t('projects.create.description')}</span>
				<textarea class="input textarea" rows="3" bind:value={description}></textarea>
			</label>

			<label>
				<span>{t('projects.create.status')}</span>
				<select class="input" bind:value={status}>
					<option value="active">{t('projects.status.active')}</option>
					<option value="paused">{t('projects.status.paused')}</option>
					<option value="completed">{t('projects.status.completed')}</option>
					<option value="archived">{t('projects.status.archived')}</option>
				</select>
			</label>

			<div></div>

			<label>
				<span>{t('projects.create.startDate')}</span>
				<input class="input" type="date" bind:value={startDate} />
			</label>

			<label>
				<span>{t('projects.create.endDate')}</span>
				<input class="input" type="date" bind:value={endDate} />
			</label>

			{#if errorMsg}
				<div class="error-banner full">{errorMsg}</div>
			{/if}

			<div class="actions full">
				<button type="button" class="btn-secondary" onclick={handleCancel}>
					{t('form.cancel')}
				</button>
				<button type="submit" class="btn-primary" disabled={saving}>
					{saving ? t('loading') : t('projects.create.submit')}
				</button>
			</div>
		</form>
	{/if}
</section>

<style>
	.page {
		padding: 1.5rem;
		max-width: 720px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
	}

	.no-access {
		padding: 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		padding: 1.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #fff);
	}

	.full {
		grid-column: 1 / -1;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
	}

	label span {
		font-weight: 500;
		color: var(--color-foreground, #0f172a);
	}

	.input {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
	}

	.input:focus {
		outline: none;
		border-color: var(--color-primary, #3730a3);
		box-shadow: 0 0 0 3px var(--color-primary-subtle, #eef2ff);
	}

	.textarea {
		resize: vertical;
		font-family: inherit;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
	}

	.btn-primary {
		background: var(--color-primary, #3730a3);
		color: #fff;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.btn-primary:hover { opacity: 0.9; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		color: var(--color-foreground, #0f172a);
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.btn-secondary:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.error-banner {
		padding: 0.75rem 1rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.5rem;
		color: #dc2626;
		font-size: 0.875rem;
	}

	:global(.dark) .form {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .btn-secondary:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}
</style>
