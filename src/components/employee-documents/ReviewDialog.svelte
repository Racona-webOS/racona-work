<script lang="ts">
	/**
	 * A dolgozó beküldésének elbírálása (specs/employee-documents.md, K8).
	 * Elfogadáskor a dátumok javíthatók, és alapból a típus korábbi aktív
	 * dokumentuma archivált lesz; elutasításkor az indoklás kötelező, a fájlok törlődnek.
	 */
	import { untrack } from 'svelte';
	import type { EmployeeDocument, EmployeeDocumentFile } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { appLocale, formatDate } from '../../utils/format.js';
	import Checkbox from '../ui/Checkbox.svelte';
	import { formatSize, openDocumentFile } from './files.js';

	let {
		pluginId = 'racona-work',
		document: doc,
		currentActive,
		onClose,
		onDecided
	}: {
		pluginId?: string;
		document: EmployeeDocument;
		/** A típus jelenleg aktív dokumentuma, ha van (ezt cseréli le az elfogadás) */
		currentActive: EmployeeDocument | null;
		onClose: () => void;
		onDecided: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);
	const DatePickerComponent = $derived((sdk as any)?.components?.DatePicker ?? null);
	const dateLocale = $derived(appLocale());

	const initial = untrack(() => doc);
	let title = $state(initial.title);
	let issuedOn = $state(initial.issuedOn ?? '');
	let validUntil = $state(initial.validUntil ?? '');
	let note = $state('');
	let replaceExisting = $state(true);
	let busy = $state(false);

	function cleanError(err: any): string {
		return err?.message?.replace(/^\[DevMode\] Remote call failed: \w+ — /, '').replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	async function open(file: EmployeeDocumentFile) {
		try {
			await openDocumentFile(sdk, file, 'open');
		} catch (err) {
			sdk?.ui?.toast(cleanError(err), 'error');
		}
	}

	async function decide(decision: 'approve' | 'reject') {
		if (decision === 'reject' && !note.trim()) {
			sdk?.ui?.toast(t('documents.review.noteRequired'), 'warning');
			return;
		}
		busy = true;
		try {
			await sdk.remote.call('reviewEmployeeDocument', {
				id: doc.id,
				decision,
				note: note.trim() || null,
				...(decision === 'approve'
					? {
							title: title.trim() || undefined,
							issuedOn: issuedOn || null,
							validUntil: doc.hasExpiry ? validUntil || null : null,
							replaceExisting
						}
					: {})
			});
			sdk?.ui?.toast(decision === 'approve' ? t('documents.review.approved') : t('documents.review.rejected'), 'success');
			onDecided();
			onClose();
		} catch (err) {
			sdk?.ui?.toast(cleanError(err), 'error');
		} finally {
			busy = false;
		}
	}
</script>

<div class="modal-overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && onClose()}>
	<div class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
		<div class="modal-header">
			<h3 id="review-title">{t('documents.review.title')}</h3>
			<button class="modal-close" onclick={onClose} disabled={busy} aria-label={t('form.cancel')}>×</button>
		</div>
		<div class="modal-body">
			<p class="meta">
				{doc.typeName} · {t('documents.review.submittedBy', { name: doc.createdByName ?? '—', date: formatDate(doc.createdAt) })}
			</p>
			{#if doc.note}<p class="sub-note">{doc.note}</p>{/if}

			{#if doc.files.length > 0}
				<ul class="files">
					{#each doc.files as file (file.id)}
						<li>
							<button class="file-link" onclick={() => open(file)}>{file.originalName}</button>
							<span class="file-size">{formatSize(file.sizeBytes)}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="warn">{t('documents.review.noFiles')}</p>
			{/if}

			<label>
				<span>{t('documents.field.title')}</span>
				<input class="input" type="text" maxlength="200" bind:value={title} disabled={busy} />
			</label>
			<div class="grid-2">
				<div class="input-group">
					<span>{t('documents.field.issuedOn')}</span>
					{#if DatePickerComponent}
						<DatePickerComponent bind:value={issuedOn} locale={dateLocale} placeholder={t('filter.datePlaceholder')} />
					{:else}
						<input class="input" type="date" bind:value={issuedOn} disabled={busy} />
					{/if}
				</div>
				{#if doc.hasExpiry}
					<div class="input-group">
						<span>{t('documents.field.validUntil')}</span>
						{#if DatePickerComponent}
							<DatePickerComponent bind:value={validUntil} locale={dateLocale} placeholder={t('filter.datePlaceholder')} />
						{:else}
							<input class="input" type="date" bind:value={validUntil} disabled={busy} />
						{/if}
					</div>
				{/if}
			</div>

			{#if currentActive}
				<label class="check-row">
					<Checkbox checked={replaceExisting} onCheckedChange={(checked) => (replaceExisting = checked)} />
					<span>{t('documents.review.replace', { title: currentActive.title })}</span>
				</label>
			{/if}

			<label>
				<span>{t('documents.review.note')}</span>
				<textarea class="input textarea" maxlength="2000" rows="2" bind:value={note} disabled={busy}
					placeholder={t('documents.review.notePlaceholder')}></textarea>
			</label>
		</div>
		<div class="modal-footer">
			<button class="btn-secondary" onclick={onClose} disabled={busy}>{t('form.cancel')}</button>
			<button class="btn-danger" onclick={() => decide('reject')} disabled={busy}>{t('documents.review.reject')}</button>
			<button class="btn-primary" onclick={() => decide('approve')} disabled={busy}>{t('documents.review.approve')}</button>
		</div>
	</div>
</div>

<style>
	@import '../../styles/shared.css';

	.review-modal {
		max-width: 560px;
	}

	.meta {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.sub-note {
		margin: 0;
		font-size: 0.875rem;
		white-space: pre-line;
	}

	.warn {
		margin: 0;
		font-size: 0.85rem;
		color: #92400e;
	}

	.files {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.files li {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.875rem;
	}

	.file-link {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--color-primary, #3730a3);
		text-decoration: underline;
		text-underline-offset: 2px;
		font-size: inherit;
	}

	.file-size {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.78rem;
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
		gap: 0.5rem;
		font-size: 0.875rem;
		cursor: pointer;
	}
</style>
