<script lang="ts">
	/**
	 * Dokumentum felvétele, szerkesztése, vagy új verzió egy meglévő helyére
	 * (specs/employee-documents.md, K4, K6). Mentéskor előbb a dokumentum jön
	 * létre, utána a kiválasztott fájlok egyenként töltődnek fel; ha egy fájl
	 * nem sikerül, a dokumentum megmarad, és a fájl később is csatolható.
	 */
	import { untrack } from 'svelte';
	import type { DocumentType, EmployeeDocument } from '../../../server/functions.js';
	import type { DocumentDialogMode } from './files.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { appLocale } from '../../utils/format.js';
	import {
		addMonths,
		checkDocumentFile,
		DOCUMENT_FILE_ACCEPT,
		formatSize,
		uploadDocumentFile,
		type DocumentFileLimits
	} from './files.js';

	let {
		pluginId = 'racona-work',
		employeeId,
		types,
		limits,
		mode,
		onClose,
		onSaved
	}: {
		pluginId?: string;
		employeeId: number;
		types: DocumentType[];
		limits: DocumentFileLimits;
		mode: DocumentDialogMode;
		onClose: () => void;
		onSaved: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);
	const DatePickerComponent = $derived((sdk as any)?.components?.DatePicker ?? null);
	const dateLocale = $derived(appLocale());

	// Az ablak minden megnyitáskor új példány: a kezdőértékek egyszer, a megnyitáskori módból jönnek
	const initial = untrack(() => mode);
	const source = initial.kind === 'new' || initial.kind === 'submit' ? null : initial.document;
	const editing = initial.kind === 'edit' ? initial.document : null;

	let typeId = $state<number | null>(
		initial.kind === 'new' || initial.kind === 'submit'
			? (initial.typeId ?? untrack(() => types.find((ty) => !ty.archived)?.id) ?? null)
			: initial.document.typeId
	);
	let title = $state(editing?.title ?? '');
	let issuedOn = $state(editing?.issuedOn ?? '');
	let validUntil = $state(editing?.validUntil ?? '');
	let note = $state(editing?.note ?? '');
	/** Az utoljára előtöltött érvényesség; ha a felhasználó átírta, nem írjuk felül. */
	let lastAutoValidUntil = '';

	/** `error`: előzetes ellenőrzés (ki kell venni); `uploadError`: a feltöltés bukott el (újrapróbálható) */
	type PendingFile = { file: File; error: string | null; uploadError: string | null; progress: number | null };
	let pending = $state<PendingFile[]>([]);
	let saving = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	const type = $derived(types.find((ty) => ty.id === typeId) ?? null);
	const existingFileCount = editing?.files.length ?? 0;
	const freeSlots = $derived(limits.maxFilesPerDocument - existingFileCount);

	/** A típus választható: új dokumentumnál az aktívak, szerkesztésnél a jelenlegi is. */
	const selectableTypes = $derived(types.filter((ty) => !ty.archived || ty.id === source?.typeId));

	// Az érvényesség vége a kiállítás napjából és a típus alapértelmezett érvényességéből,
	// amíg üres, vagy még az előző előtöltött érték van benne
	$effect(() => {
		if (!type?.hasExpiry || !type.defaultValidityMonths || !issuedOn) return;
		const auto = addMonths(issuedOn, type.defaultValidityMonths);
		if (validUntil === '' || validUntil === lastAutoValidUntil) validUntil = auto;
		lastAutoValidUntil = auto;
	});

	const heading = $derived(
		mode.kind === 'edit'
			? t('documents.dialog.editTitle')
			: mode.kind === 'version'
				? t('documents.dialog.versionTitle', { title: mode.document.title })
				: mode.kind === 'submit'
					? t('documents.dialog.submitTitle')
					: t('documents.dialog.newTitle')
	);

	function addFiles(list: FileList | null) {
		if (!list) return;
		const room = freeSlots - pending.length;
		const incoming = Array.from(list);
		if (incoming.length > room) {
			sdk?.ui?.toast(t('documents.files.error.tooMany', { max: limits.maxFilesPerDocument }), 'warning');
		}
		for (const file of incoming.slice(0, Math.max(room, 0))) {
			pending.push({ file, error: checkDocumentFile(file, limits, t), uploadError: null, progress: null });
		}
		if (fileInput) fileInput.value = '';
	}

	function removePending(index: number) {
		pending.splice(index, 1);
	}

	/** A dolgozó saját beküldése (K8): ellenőrzésre vár, a fájl kötelező. */
	const isSubmit = initial.kind === 'submit';
	/**
	 * Az első sikeres mentés után a dokumentum már létezik: újrapróbáláskor
	 * (pl. egy fájl feltöltése elbukott) nem jön létre még egy.
	 */
	let savedDocumentId = $state<number | null>(null);

	function cleanError(err: any): string {
		return err?.message?.replace(/^\[DevMode\] Remote call failed: \w+ — /, '').replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	async function save() {
		if (!typeId || !type) {
			sdk?.ui?.toast(t('documents.dialog.typeRequired'), 'warning');
			return;
		}
		if (pending.some((p) => p.error)) {
			sdk?.ui?.toast(t('documents.files.error.fixList'), 'warning');
			return;
		}
		if (isSubmit && pending.length === 0) {
			sdk?.ui?.toast(t('documents.dialog.submitFileRequired'), 'warning');
			return;
		}
		saving = true;
		let documentId: number;
		try {
			if (isSubmit) {
				if (savedDocumentId === null) {
					const saved: EmployeeDocument = await sdk.remote.call('submitMyDocument', {
						employeeId,
						typeId,
						title: title.trim() || undefined,
						issuedOn: issuedOn || null,
						validUntil: type.hasExpiry ? validUntil || null : null,
						note: note.trim() || null
					});
					savedDocumentId = saved.id;
				}
				documentId = savedDocumentId;
			} else {
				const saved: EmployeeDocument = await sdk.remote.call('saveEmployeeDocument', {
					id: mode.kind === 'edit' ? mode.document.id : (savedDocumentId ?? undefined),
					employeeId,
					typeId,
					title: title.trim() || undefined,
					issuedOn: issuedOn || null,
					validUntil: type.hasExpiry ? validUntil || null : null,
					note: note.trim() || null,
					replacesId: mode.kind === 'version' && savedDocumentId === null ? mode.document.id : undefined
				});
				savedDocumentId = saved.id;
				documentId = saved.id;
			}
		} catch (err: any) {
			sdk?.ui?.toast(cleanError(err), 'error');
			saving = false;
			return;
		}

		const failures: string[] = [];
		if (type.fileMode !== 'none') {
			for (const item of pending) {
				item.progress = 0;
				item.uploadError = null;
				try {
					await uploadDocumentFile(sdk, documentId, item.file, t, (p) => (item.progress = p));
					item.progress = 100;
				} catch (err: any) {
					item.uploadError = err?.message ?? t('error.saveFailed');
					item.progress = null;
					failures.push(item.uploadError!);
				}
			}
		}

		if (failures.length > 0) {
			saving = false;
			sdk?.ui?.toast(t('documents.dialog.savedWithErrors', { count: failures.length }), 'warning');
			// A sikeresek kikerülnek a listából; a hibásak maradnak, a dokumentum már létezik
			pending = pending.filter((p) => p.uploadError);
			onSaved();
			return;
		}

		if (isSubmit) {
			try {
				await sdk.remote.call('confirmMyDocumentSubmission', { documentId });
			} catch (err: any) {
				saving = false;
				sdk?.ui?.toast(cleanError(err), 'error');
				onSaved();
				return;
			}
		}
		saving = false;
		sdk?.ui?.toast(isSubmit ? t('documents.dialog.submitted') : t('documents.dialog.saved'), 'success');
		onSaved();
		onClose();
	}
</script>

<div class="modal-overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && !saving && onClose()}>
	<div class="modal doc-modal" role="dialog" aria-modal="true" aria-labelledby="doc-dialog-title">
		<div class="modal-header">
			<h3 id="doc-dialog-title">{heading}</h3>
			<button class="modal-close" onclick={onClose} disabled={saving} aria-label={t('form.cancel')}>×</button>
		</div>
		<div class="modal-body">
			<label>
				<span>{t('documents.field.type')}</span>
				<select class="input" bind:value={typeId} disabled={mode.kind === 'version' || saving || savedDocumentId !== null}>
					{#each selectableTypes as ty (ty.id)}
						<option value={ty.id}>{ty.name}</option>
					{/each}
				</select>
			</label>
			{#if type?.description}
				<p class="hint">{type.description}</p>
			{/if}

			<label>
				<span>{t('documents.field.title')}</span>
				<input class="input" type="text" maxlength="200" placeholder={type?.name ?? ''} bind:value={title} disabled={saving} />
			</label>

			<div class="grid-2">
				<div class="input-group">
					<span>{type?.fileMode === 'none' ? t('documents.field.presentedOn') : t('documents.field.issuedOn')}</span>
					{#if DatePickerComponent}
						<DatePickerComponent bind:value={issuedOn} locale={dateLocale} placeholder={t('filter.datePlaceholder')} />
					{:else}
						<input class="input" type="date" bind:value={issuedOn} disabled={saving} />
					{/if}
				</div>
				{#if type?.hasExpiry}
					<div class="input-group">
						<span>{t('documents.field.validUntil')}</span>
						{#if DatePickerComponent}
							<DatePickerComponent bind:value={validUntil} locale={dateLocale} placeholder={t('filter.datePlaceholder')} />
						{:else}
							<input class="input" type="date" bind:value={validUntil} disabled={saving} />
						{/if}
					</div>
				{/if}
			</div>
			{#if type?.hasExpiry && type.defaultValidityMonths}
				<p class="hint">{t('documents.dialog.validityHint', { months: type.defaultValidityMonths })}</p>
			{/if}

			<label>
				<span>{t('documents.field.note')}</span>
				<textarea class="input textarea" maxlength="2000" rows="2" bind:value={note} disabled={saving}></textarea>
			</label>

			{#if type?.fileMode === 'none'}
				<p class="hint">{t('documents.dialog.noFileHint')}</p>
			{:else if type}
				<div class="input-group">
					<span>
						{t('documents.field.files')}
						{#if type.fileMode === 'required' || isSubmit}<em class="req">{t('documents.dialog.fileRequired')}</em>{/if}
					</span>
					{#if pending.length > 0}
						<ul class="pending">
							{#each pending as item, i (item.file)}
								<li class:has-error={!!item.error || !!item.uploadError}>
									<span class="pf-name">{item.file.name}</span>
									<span class="pf-size">{formatSize(item.file.size)}</span>
									{#if item.progress !== null}
										<progress max="100" value={item.progress}></progress>
									{:else if !saving}
										<button class="btn-ghost-sm" onclick={() => removePending(i)} aria-label={t('documents.files.remove')}>×</button>
									{/if}
									{#if item.error || item.uploadError}<span class="pf-error">{item.error ?? item.uploadError}</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if pending.length < freeSlots}
						<button class="btn-secondary btn-sm pick" onclick={() => fileInput?.click()} disabled={saving}>
							+ {t('documents.files.pick')}
						</button>
					{/if}
					<input
						bind:this={fileInput}
						class="file-input"
						type="file"
						multiple
						accept={DOCUMENT_FILE_ACCEPT}
						onchange={(e) => addFiles((e.currentTarget as HTMLInputElement).files)}
					/>
					<p class="hint">{t('documents.files.limits', { max: formatSize(limits.maxFileBytes), count: limits.maxFilesPerDocument })}</p>
				</div>
			{/if}
		</div>
		<div class="modal-footer">
			<button class="btn-secondary" onclick={onClose} disabled={saving}>{t('form.cancel')}</button>
			<button class="btn-primary" onclick={save} disabled={saving || !type}>
				{saving ? t('documents.dialog.saving') : t('form.save')}
			</button>
		</div>
	</div>
</div>

<style>
	@import '../../styles/shared.css';

	.doc-modal {
		max-width: 560px;
	}

	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.req {
		font-style: normal;
		font-weight: 400;
		color: var(--color-muted-foreground, #64748b);
		margin-left: 0.25rem;
	}

	.file-input {
		display: none;
	}

	.pick {
		align-self: flex-start;
	}

	.pending {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.pending li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		font-size: 0.85rem;
	}

	.pending li.has-error {
		border-color: #fca5a5;
		background: #fef2f2;
	}

	:global(.dark) .pending li.has-error {
		border-color: rgba(248, 113, 113, 0.5);
		background: rgba(127, 29, 29, 0.25);
	}

	.pf-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pf-size {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.8rem;
	}

	.pf-error {
		flex-basis: 100%;
		color: #b91c1c;
		font-size: 0.8rem;
	}

	:global(.dark) .pf-error {
		color: #fca5a5;
	}

	progress {
		width: 6rem;
		height: 0.4rem;
	}

	.btn-ghost-sm {
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		color: var(--color-muted-foreground, #64748b);
		padding: 0 0.25rem;
	}
</style>
