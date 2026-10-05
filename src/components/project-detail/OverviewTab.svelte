<!--
	ProjectDetail — Áttekintés fül

	Két állapota van: adatlap (info-grid) és szerkesztő űrlap. A szerkesztő
	mód a szülőből kapott `editMode` (bindable), mert a "Szerkesztés" gomb a
	ProjectDetail fejlécében van. Mentés után a szülő tölti újra a projektet
	(`onSaved`).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { ProjectRow } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { formatDate as formatAppDate } from '../../utils/format.js';

	let {
		pluginId = 'racona-work',
		project,
		editMode = $bindable(false),
		onSaved
	}: {
		pluginId?: string;
		project: ProjectRow;
		editMode?: boolean;
		onSaved: () => void | Promise<void>;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let editName = $state('');
	let editDescription = $state('');
	let editStatus = $state<'active' | 'paused' | 'completed' | 'archived'>('active');
	let editStart = $state('');
	let editEnd = $state('');
	let saving = $state(false);

	function hydrate(p: ProjectRow) {
		editName = p.name;
		editDescription = p.description ?? '';
		editStatus = p.status as any;
		editStart = p.startDate ?? '';
		editEnd = p.endDate ?? '';
	}

	// Szerkesztő mód belépésekor — és a projekt újratöltésekor — a friss
	// szerver-értékekkel töltjük fel az űrlapot.
	$effect(() => {
		const p = project;
		if (!editMode) return;
		untrack(() => hydrate(p));
	});

	async function handleSave() {
		if (!editName.trim()) {
			sdk?.ui?.toast?.(t('projects.create.name') + ': ' + t('form.required'), 'error');
			return;
		}
		saving = true;
		try {
			await sdk.remote.call('updateProject', {
				id: project.id,
				name: editName.trim(),
				description: editDescription.trim() || null,
				status: editStatus,
				startDate: editStart || null,
				endDate: editEnd || null
			});
			sdk?.ui?.toast?.(t('projects.detail.saveSuccess'), 'success');
			editMode = false;
			await onSaved();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	function formatDate(raw: string | null): string {
		if (!raw) return t('projects.detail.dates.empty');
		return formatAppDate(raw);
	}
</script>

{#if editMode}
	<div class="form">
		<label class="full">
			<span>{t('projects.create.name')} *</span>
			<input class="input" type="text" bind:value={editName} />
		</label>
		<label class="full">
			<span>{t('projects.create.description')}</span>
			<textarea class="input textarea" rows="3" bind:value={editDescription}></textarea>
		</label>
		<label>
			<span>{t('projects.create.status')}</span>
			<select class="input" bind:value={editStatus}>
				<option value="active">{t('projects.status.active')}</option>
				<option value="paused">{t('projects.status.paused')}</option>
				<option value="completed">{t('projects.status.completed')}</option>
				<option value="archived">{t('projects.status.archived')}</option>
			</select>
		</label>
		<div></div>
		<label>
			<span>{t('projects.create.startDate')}</span>
			<input class="input" type="date" bind:value={editStart} />
		</label>
		<label>
			<span>{t('projects.create.endDate')}</span>
			<input class="input" type="date" bind:value={editEnd} />
		</label>
		<div class="form-actions full">
			<button class="btn-secondary" onclick={() => (editMode = false)}>
				{t('form.cancel')}
			</button>
			<button class="btn-primary" onclick={handleSave} disabled={saving}>
				{saving ? t('loading') : t('projects.detail.save')}
			</button>
		</div>
	</div>
{:else}
	<div class="info-grid">
		<div class="info-item full">
			<span class="label">{t('projects.create.description')}</span>
			<span class="value">{project.description || t('projects.detail.description.empty')}</span>
		</div>
		<div class="info-item">
			<span class="label">{t('projects.create.startDate')}</span>
			<span class="value">{formatDate(project.startDate)}</span>
		</div>
		<div class="info-item">
			<span class="label">{t('projects.create.endDate')}</span>
			<span class="value">{formatDate(project.endDate)}</span>
		</div>
		<div class="info-item">
			<span class="label">{t('projects.detail.createdBy')}</span>
			<span class="value">{project.createdByName ?? '—'}</span>
		</div>
		<div class="info-item">
			<span class="label">{t('projects.detail.createdAt')}</span>
			<span class="value">{formatDate(project.createdAt)}</span>
		</div>
		<div class="info-item">
			<span class="label">{t('projects.detail.updatedAt')}</span>
			<span class="value">{formatDate(project.updatedAt)}</span>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	.info-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.info-item.full {
		grid-column: 1 / -1;
	}

	.info-item .label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground, #64748b);
		font-weight: 600;
	}

	.info-item .value {
		font-size: 0.9rem;
		color: var(--color-foreground, #0f172a);
		white-space: pre-wrap;
	}

	.form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.full {
		grid-column: 1 / -1;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
