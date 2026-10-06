<script lang="ts">
	/**
	 * A dolgozói adatlap „Dokumentumok” füle (specs/employee-documents.md, K3–K6, K12).
	 *
	 * Típus szerint csoportosított lista: dátumok, lejárati állapot, csatolt
	 * fájlok. Fent a hiányzó kötelező típusok. Kezelési joggal: felvétel,
	 * szerkesztés, új verzió, törlés, fájlok törlése és a napló.
	 */
	import type {
		DocumentType,
		EmployeeDocument,
		EmployeeDocumentEvent,
		EmployeeDocumentFile,
		EmployeeDocumentsView
	} from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { formatDate, formatDateTime } from '../../utils/format.js';
	import DocumentDialog from './DocumentDialog.svelte';
	import ReviewDialog from './ReviewDialog.svelte';
	import { formatSize, openDocumentFile, type DocumentDialogMode } from './files.js';

	let { pluginId = 'racona-work', employeeId }: { pluginId?: string; employeeId: number } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let view = $state<EmployeeDocumentsView | null>(null);
	const types = $derived<DocumentType[]>(view?.types ?? []);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let showArchived = $state(false);
	let dialog = $state<DocumentDialogMode | null>(null);
	/** A HR által elbírálandó beküldés (K8) */
	let reviewing = $state<EmployeeDocument | null>(null);

	/** A dolgozó által feltölthető típusok (saját nézet, K8) */
	const uploadTypeIds = $derived(new Set((view?.selfService?.uploadTypes ?? []).map((u) => u.id)));
	const canSubmit = $derived(view?.selfService?.uploadEnabled === true);
	/** A beküldés ablakában csak a feltölthető típusok választhatók */
	const dialogTypes = $derived(dialog?.kind === 'submit' ? types.filter((ty) => uploadTypeIds.has(ty.id)) : types);

	/** A típus jelenleg aktív dokumentuma (ezt cseréli le egy elfogadott beküldés) */
	function activeOfType(doc: EmployeeDocument): EmployeeDocument | null {
		return view?.documents.find((d) => d.typeId === doc.typeId && d.status === 'active' && d.id !== doc.id) ?? null;
	}

	let events = $state<EmployeeDocumentEvent[] | null>(null);
	let eventsOpen = $state(false);

	function cleanError(err: any, fallback: string): string {
		return err?.message?.replace(/^\[DevMode\] Remote call failed: \w+ — /, '').replace(/^[A-Z_]+:\s*/, '') ?? fallback;
	}

	async function load() {
		loading = true;
		loadError = null;
		try {
			view = await sdk.remote.call('listEmployeeDocuments', { employeeId, includeArchived: showArchived });
			if (eventsOpen) await loadEvents();
		} catch (err) {
			loadError = cleanError(err, t('error.loadFailed'));
		} finally {
			loading = false;
		}
	}

	async function loadEvents() {
		try {
			events = await sdk.remote.call('getEmployeeDocumentEvents', { employeeId, limit: 100 });
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.loadFailed')), 'error');
		}
	}

	$effect(() => {
		if (sdk?.remote && employeeId) load();
	});

	/** Típusonként csoportosítva, a típusok sorrendjében (a szerver már így rendez). */
	const groups = $derived.by(() => {
		const result: Array<{ typeName: string; documents: EmployeeDocument[] }> = [];
		for (const doc of view?.documents ?? []) {
			const last = result.at(-1);
			if (last && last.typeName === doc.typeName) last.documents.push(doc);
			else result.push({ typeName: doc.typeName, documents: [doc] });
		}
		return result;
	});

	const activeTypes = $derived(types.filter((ty) => !ty.archived));

	async function open(file: EmployeeDocumentFile, mode: 'open' | 'download') {
		try {
			await openDocumentFile(sdk, file, mode);
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.loadFailed')), 'error');
		}
	}

	async function confirm(title: string, message: string, label: string): Promise<boolean> {
		const result = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title,
			message,
			confirmLabel: label,
			confirmVariant: 'destructive'
		});
		return result?.action === 'confirm';
	}

	async function removeDocument(doc: EmployeeDocument) {
		const withdraw = !view?.canManage && doc.status === 'pending';
		const message = withdraw
			? t('documents.withdrawMessage', { title: doc.title })
			: doc.files.length > 0
				? t('documents.delete.messageWithFiles', { title: doc.title, count: doc.files.length })
				: t('documents.delete.message', { title: doc.title });
		const confirmed = withdraw
			? await confirm(t('documents.withdrawTitle'), message, t('documents.withdraw'))
			: await confirm(t('documents.delete.title'), message, t('documents.delete.confirm'));
		if (!confirmed) return;
		try {
			await sdk.remote.call('deleteEmployeeDocument', { id: doc.id });
			sdk?.ui?.toast(t('documents.delete.done'), 'success');
			await load();
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.deleteFailed')), 'error');
		}
	}

	async function removeFile(doc: EmployeeDocument, file: EmployeeDocumentFile) {
		if (
			!(await confirm(
				t('documents.files.deleteTitle'),
				t('documents.files.deleteMessage', { name: file.originalName, title: doc.title }),
				t('documents.delete.confirm')
			))
		) {
			return;
		}
		try {
			await sdk.remote.call('deleteDocumentFile', { fileRowId: file.id });
			await load();
		} catch (err) {
			sdk?.ui?.toast(cleanError(err, t('error.deleteFailed')), 'error');
		}
	}

	function expiryLabel(doc: EmployeeDocument): string | null {
		if (doc.expiryStatus === 'expired') return t('documents.status.expired', { date: formatDate(doc.validUntil) });
		if (doc.expiryStatus === 'expiring') {
			return doc.daysLeft === 0
				? t('documents.status.expiresToday')
				: t('documents.status.expiresIn', { days: doc.daysLeft ?? 0 });
		}
		return null;
	}

	function eventLabel(e: EmployeeDocumentEvent): string {
		const d = (e.details ?? {}) as Record<string, string>;
		return t(`documents.events.${e.action}`, { title: d.title ?? '', file: d.fileName ?? '' });
	}

	function toggleEvents() {
		eventsOpen = !eventsOpen;
		if (eventsOpen && events === null) loadEvents();
	}
</script>

<div class="docs">
	<div class="docs-header">
		<h3>{t('documents.title')}</h3>
		<div class="docs-actions">
			{#if canSubmit}
				<button class="btn-primary btn-sm" onclick={() => (dialog = { kind: 'submit' })}>+ {t('documents.submit')}</button>
			{/if}
			{#if view?.canManage}
				<label class="inline-check">
					<input type="checkbox" bind:checked={showArchived} onchange={load} />
					<span>{t('documents.showArchived')}</span>
				</label>
				<button class="btn-primary btn-sm" onclick={() => (dialog = { kind: 'new' })} disabled={activeTypes.length === 0}>
					+ {t('documents.new')}
				</button>
			{/if}
		</div>
	</div>

	{#if loading && !view}
		<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
	{:else if loadError}
		<div class="error-banner">{loadError}</div>
	{:else if view}
		{#if view.missingRequiredTypes.length > 0}
			<div class="missing">
				<strong>{t('documents.missing.title')}</strong>
				<div class="missing-list">
					{#each view.missingRequiredTypes as mt (mt.id)}
						{#if view.canManage}
							<button class="chip-btn" onclick={() => (dialog = { kind: 'new', typeId: mt.id })}>
								{mt.name} <span aria-hidden="true">+</span>
							</button>
						{:else if canSubmit && uploadTypeIds.has(mt.id)}
							<button class="chip-btn" onclick={() => (dialog = { kind: 'submit', typeId: mt.id })}>
								{mt.name} <span aria-hidden="true">+</span>
							</button>
						{:else}
							<span class="chip-static">{mt.name}</span>
						{/if}
					{/each}
				</div>
			</div>
		{/if}

		{#if groups.length === 0}
			<p class="empty-state">{t('documents.empty')}</p>
		{:else}
			{#each groups as group (group.typeName)}
				<div class="doc-group">
					<h4>{group.typeName}</h4>
					{#each group.documents as doc (doc.id)}
						<article class="doc" class:archived={doc.status === 'archived'}>
							<div class="doc-head">
								<span class="doc-title">{doc.title}</span>
								{#if doc.status === 'archived'}
									<span class="badge muted">{t('documents.status.archived')}</span>
								{:else if doc.status === 'pending'}
									<span class="badge info">{t('documents.status.pending')}</span>
								{:else if doc.status === 'rejected'}
									<span class="badge danger">{t('documents.status.rejected')}</span>
								{/if}
								{#if expiryLabel(doc)}
									<span class="badge" class:danger={doc.expiryStatus === 'expired'} class:warn={doc.expiryStatus === 'expiring'}>
										{expiryLabel(doc)}
									</span>
								{/if}
								{#if doc.fileMissing}
									<span class="badge warn">{t('documents.status.fileMissing')}</span>
								{/if}
								{#if view.canManage}
									<div class="doc-actions">
										{#if doc.status === 'pending'}
											<button class="btn-ghost-sm strong" onclick={() => (reviewing = doc)}>{t('documents.review.open')}</button>
										{:else if doc.status === 'active'}
											<button class="btn-ghost-sm" onclick={() => (dialog = { kind: 'edit', document: doc })}>{t('documents.edit')}</button>
											<button class="btn-ghost-sm" onclick={() => (dialog = { kind: 'version', document: doc })}>{t('documents.newVersion')}</button>
										{/if}
										<button class="btn-ghost-sm danger" onclick={() => removeDocument(doc)}>{t('documents.delete.confirm')}</button>
									</div>
								{:else if doc.canWithdraw}
									<div class="doc-actions">
										<button class="btn-ghost-sm danger" onclick={() => removeDocument(doc)}>
											{doc.status === 'pending' ? t('documents.withdraw') : t('documents.delete.confirm')}
										</button>
									</div>
								{/if}
							</div>
							<div class="doc-meta">
								{#if doc.issuedOn}
									<span>{doc.fileMode === 'none' ? t('documents.field.presentedOn') : t('documents.field.issuedOn')}: {formatDate(doc.issuedOn)}</span>
								{/if}
								{#if doc.hasExpiry}
									<span>{t('documents.field.validUntil')}: {doc.validUntil ? formatDate(doc.validUntil) : t('documents.noExpiryDate')}</span>
								{/if}
								{#if doc.createdByName}
									<span>{t('documents.recordedBy', { name: doc.createdByName, date: formatDate(doc.createdAt) })}</span>
								{/if}
							</div>
							{#if doc.note}<p class="doc-note">{doc.note}</p>{/if}
							{#if doc.status === 'rejected' && doc.reviewNote}
								<p class="review-note">{t('documents.rejectedReason', { name: doc.reviewedByName ?? '—', note: doc.reviewNote })}</p>
							{/if}
							{#if doc.files.length > 0}
								<ul class="files">
									{#each doc.files as file (file.id)}
										<li>
											<button class="file-link" onclick={() => open(file, 'open')} title={t('documents.files.open')}>
												{file.originalName}
											</button>
											<span class="file-size">{formatSize(file.sizeBytes)}</span>
											<button class="btn-ghost-sm" onclick={() => open(file, 'download')}>{t('documents.files.download')}</button>
											{#if (view.canManage && doc.status !== 'archived' && doc.status !== 'rejected') || (doc.canWithdraw && doc.status === 'pending')}
												<button class="btn-ghost-sm danger" onclick={() => removeFile(doc, file)}>{t('documents.files.delete')}</button>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</article>
					{/each}
				</div>
			{/each}
		{/if}

		{#if view.canManage}
			<div class="events">
				<button class="btn-ghost-sm events-toggle" onclick={toggleEvents} aria-expanded={eventsOpen}>
					{eventsOpen ? '▾' : '▸'} {t('documents.events.title')}
				</button>
				{#if eventsOpen}
					{#if events === null}
						<div class="loading-state"><div class="spinner"></div></div>
					{:else if events.length === 0}
						<p class="empty-state">{t('documents.events.empty')}</p>
					{:else}
						<ul class="event-list">
							{#each events as e (e.id)}
								<li>
									<span class="ev-time">{formatDateTime(e.createdAt)}</span>
									<span class="ev-actor">{e.actorName ?? t('documents.events.system')}</span>
									<span>{eventLabel(e)}</span>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/if}
	{/if}
</div>

{#if reviewing}
	<ReviewDialog
		{pluginId}
		document={reviewing}
		currentActive={activeOfType(reviewing)}
		onClose={() => (reviewing = null)}
		onDecided={load}
	/>
{/if}

{#if dialog && view}
	<DocumentDialog
		{pluginId}
		{employeeId}
		types={dialogTypes}
		limits={view.limits}
		mode={dialog}
		onClose={() => (dialog = null)}
		onSaved={load}
	/>
{/if}

<style>
	@import '../../styles/shared.css';

	.docs {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.docs-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.docs-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.docs-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.inline-check {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.missing {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: #fffbeb;
		border: 1px solid #fde68a;
		font-size: 0.875rem;
	}

	:global(.dark) .missing {
		background: rgba(120, 53, 15, 0.25);
		border-color: rgba(251, 191, 36, 0.35);
	}

	.missing-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.chip-btn,
	.chip-static {
		font-size: 0.8rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #f59e0b;
		background: transparent;
		color: inherit;
	}

	.chip-btn {
		cursor: pointer;
	}

	.chip-btn:hover {
		background: rgba(245, 158, 11, 0.15);
	}

	.doc-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.doc-group h4 {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground, #64748b);
	}

	.doc {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #fff);
	}

	.doc.archived {
		opacity: 0.65;
	}

	.doc-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.doc-title {
		font-weight: 600;
		font-size: 0.925rem;
	}

	.doc-actions {
		margin-left: auto;
		display: flex;
		gap: 0.25rem;
	}

	.badge {
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
	}

	.badge.warn {
		background: #fef3c7;
		color: #92400e;
	}

	.badge.danger {
		background: #fee2e2;
		color: #b91c1c;
	}

	.badge.info {
		background: #dbeafe;
		color: #1e40af;
	}

	:global(.dark) .badge.info {
		background: rgba(59, 130, 246, 0.2);
		color: #93c5fd;
	}

	.review-note {
		margin: 0;
		font-size: 0.85rem;
		color: #b91c1c;
		white-space: pre-line;
	}

	:global(.dark) .review-note {
		color: #fca5a5;
	}

	.btn-ghost-sm.strong {
		color: var(--color-primary, #3730a3);
		font-weight: 600;
	}

	:global(.dark) .badge.warn {
		background: rgba(245, 158, 11, 0.2);
		color: #fcd34d;
	}

	:global(.dark) .badge.danger {
		background: rgba(239, 68, 68, 0.2);
		color: #fca5a5;
	}

	.doc-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.doc-note {
		margin: 0;
		font-size: 0.85rem;
		white-space: pre-line;
	}

	.files {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.files li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
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
		text-align: left;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-size {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.78rem;
	}

	.btn-ghost-sm {
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.btn-ghost-sm:hover {
		background: var(--color-accent, #f1f5f9);
		color: var(--color-foreground, #0f172a);
	}

	.btn-ghost-sm.danger:hover {
		color: #b91c1c;
	}

	.events {
		border-top: 1px solid var(--color-border, #e2e8f0);
		padding-top: 0.75rem;
	}

	.events-toggle {
		padding-left: 0;
	}

	.event-list {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
	}

	.event-list li {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.ev-time {
		color: var(--color-muted-foreground, #64748b);
		min-width: 9rem;
	}

	.ev-actor {
		font-weight: 500;
	}

	/* Sötét mód: a világos státuszszínek sötét párjai */
	:global(.dark) .btn-ghost-sm.danger:hover {
		color: var(--rw-dark-danger-fg);
	}
</style>
