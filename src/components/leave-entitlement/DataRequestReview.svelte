<!--
	Függő dolgozói adatbejelentések elbírálása (leave.balance.manage).

	Két helyen használjuk: a vezetői irányítópulton a szervezet összes függő
	bejelentése (`organizationId`), a dolgozó adatlapján csak az övé
	(`employeeId`). Ha nincs függő bejelentés, semmit nem jelenít meg.
-->
<script lang="ts">
	import type { LeaveDataRequest, RecalculatedBalance } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { describeDataRequest } from './dataRequests.js';
	import { formatSize, openFile } from './files.js';
	import { formatDate } from '../../utils/format.js';
	import { isCoreAdminViewer } from '../../stores/organizationStore.svelte.js';

	let {
		pluginId = 'racona-work',
		organizationId = null,
		employeeId = null,
		refreshKey = 0,
		onDecided
	}: {
		pluginId?: string;
		organizationId?: number | null;
		employeeId?: number | null;
		/** Növelésével újratöltjük (pl. ha a HR-es a saját bejelentését küldte be). */
		refreshKey?: number;
		/** Döntés után: a szülő frissítheti a dolgozó adatait és kereteit. */
		onDecided?: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let requests = $state<LeaveDataRequest[]>([]);
	/** Adatlapon: a jóváhagyott bejelentések megőrzött igazolásai (a HR törölheti őket). */
	let keptFiles = $state<LeaveDataRequest[]>([]);
	let decidingId = $state<number | null>(null);
	let rejectingId = $state<number | null>(null);
	let rejectNote = $state('');

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	async function load() {
		try {
			if (employeeId) {
				const all: LeaveDataRequest[] = await sdk.remote.call('getLeaveDataRequests', {
					employeeId,
					status: 'all'
				});
				requests = all.filter((r) => r.status === 'pending');
				keptFiles = all.filter((r) => r.status === 'approved' && r.files.length > 0);
			} else {
				requests = await sdk.remote.call('getLeaveDataRequests', { organizationId });
			}
		} catch {
			requests = [];
			keptFiles = [];
		}
	}

	async function openAttachment(fileId: number) {
		try {
			await openFile(sdk, fileId);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		}
	}

	async function deleteKeptFile(fileId: number) {
		try {
			await sdk.remote.call('deleteLeaveDataRequestFile', { fileId });
			sdk?.ui?.toast(t('files.deleted'), 'success');
			await load();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		}
	}

	$effect(() => {
		organizationId;
		employeeId;
		refreshKey;
		if (sdk?.remote && (organizationId || employeeId)) load();
	});

	async function decide(request: LeaveDataRequest, decision: 'approve' | 'reject') {
		if (decidingId !== null) return;
		if (decision === 'reject' && !rejectNote.trim()) {
			sdk?.ui?.toast(t('dataRequest.rejectNoteRequired'), 'warning');
			return;
		}
		decidingId = request.id;
		try {
			const result: { request: LeaveDataRequest; recalculated: RecalculatedBalance[] } =
				await sdk.remote.call('decideLeaveDataRequest', {
					id: request.id,
					decision,
					decisionNote: decision === 'reject' ? rejectNote : null
				});
			const recalculated = result.recalculated
				.map((r) => t('leaveEntitlement.recalculated', { year: r.year, from: r.from, to: r.to }))
				.join(' ');
			sdk?.ui?.toast(
				[t(decision === 'approve' ? 'dataRequest.approved' : 'dataRequest.rejected'), recalculated]
					.filter(Boolean)
					.join(' '),
				'success'
			);
			rejectingId = null;
			rejectNote = '';
			await load();
			onDecided?.();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			decidingId = null;
		}
	}
</script>

{#if requests.length > 0}
	<div class="review">
		<div class="review-header">
			<h3>{t('dataRequest.review.title')}</h3>
			<span class="count">{requests.length}</span>
		</div>
		<ul class="request-list">
			{#each requests as request (request.id)}
				{@const description = describeDataRequest(request, t)}
				<li class="request">
					<div class="request-main">
						{#if !employeeId}
							<span class="employee">{request.employeeName}</span>
						{/if}
						<span class="title">{description.title}</span>
						{#each description.details as detail, i (i)}
							<span class="detail">{detail}</span>
						{/each}
						{#if request.employeeNote}
							<span class="note">„{request.employeeNote}”</span>
						{/if}
						{#if request.files.length > 0}
							<span class="files">
								{#each request.files as file (file.id)}
									<button class="file-link" onclick={() => openAttachment(file.id)}>
										📎 {file.fileName} ({formatSize(file.sizeBytes)})
									</button>
								{/each}
							</span>
						{:else}
							<span class="meta">{t('files.none')}</span>
						{/if}
						<span class="meta">{formatDate(request.createdAt)}</span>
					</div>
					{#if rejectingId === request.id}
						<div class="reject-form">
							<input
								class="input"
								type="text"
								bind:value={rejectNote}
								placeholder={t('dataRequest.rejectNotePlaceholder')}
								aria-label={t('dataRequest.rejectNotePlaceholder')}
							/>
							<div class="actions">
								<button class="btn-secondary btn-sm" onclick={() => (rejectingId = null)}>
									{t('form.cancel')}
								</button>
								<button
									class="btn-danger btn-sm"
									onclick={() => decide(request, 'reject')}
									disabled={decidingId !== null}
								>
									{t('dataRequest.reject')}
								</button>
							</div>
						</div>
					{:else if request.isOwn && !isCoreAdminViewer()}
						<p class="own-hint">{t('dataRequest.ownHint')}</p>
					{:else}
						<div class="actions">
							<button
								class="btn-secondary btn-sm"
								onclick={() => {
									rejectingId = request.id;
									rejectNote = '';
								}}
								disabled={decidingId !== null}
							>
								{t('dataRequest.reject')}
							</button>
							<button
								class="btn-primary btn-sm"
								onclick={() => decide(request, 'approve')}
								disabled={decidingId !== null}
							>
								{decidingId === request.id ? t('loading') : t('dataRequest.approve')}
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

{#if employeeId && keptFiles.length > 0}
	<div class="kept">
		<h4>{t('files.kept.title')}</h4>
		<p class="meta">{t('files.kept.subtitle')}</p>
		<ul class="kept-list">
			{#each keptFiles as request (request.id)}
				{@const description = describeDataRequest(request, t)}
				{#each request.files as file (file.id)}
					<li class="kept-item">
						<button class="file-link" onclick={() => openAttachment(file.id)}>📎 {file.fileName}</button>
						<span class="meta">
							{description.title} · {t('files.kept.approvedAt', {
								date: formatDate(request.decidedAt)
							})}
						</span>
						<button class="btn-ghost-danger" onclick={() => deleteKeptFile(file.id)}>
							{t('files.delete')}
						</button>
					</li>
				{/each}
			{/each}
		</ul>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	.review {
		border: 1px solid var(--color-border, #e2e8f0);
		border-top: 5px solid #f97316;
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.review-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.review-header h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
	}

	.count {
		min-width: 1.4rem;
		padding: 0.05rem 0.45rem;
		border-radius: 9999px;
		background: #ffedd5;
		color: #9a3412;
		font-size: 0.75rem;
		font-weight: 600;
		text-align: center;
	}

	.request-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.request {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.7rem 0.85rem;
		border-radius: 0.5rem;
		background: var(--color-accent, #f8fafc);
		font-size: 0.85rem;
		flex-wrap: wrap;
	}

	.request-main {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}

	.employee {
		font-weight: 600;
	}

	.title {
		font-weight: 500;
	}

	.detail,
	.meta {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.note {
		font-size: 0.8rem;
		font-style: italic;
	}

	.files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.15rem;
	}

	.file-link {
		border: none;
		background: var(--color-card, #ffffff);
		border-radius: 0.375rem;
		padding: 0.15rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
		color: var(--color-primary, #3730a3);
	}

	.file-link:hover {
		text-decoration: underline;
	}

	.kept {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		padding: 1rem 1.25rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.kept h4 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.kept-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.kept-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
	}

	.kept-item .meta {
		flex: 1;
	}

	.btn-ghost-danger {
		border: none;
		background: transparent;
		padding: 0.15rem 0.4rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.75rem;
		color: #dc2626;
	}

	.btn-ghost-danger:hover {
		background: #fee2e2;
	}

	:global(.dark) .kept {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .file-link {
		background: var(--color-card, oklch(0.205 0 0));
	}

	.own-hint {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.actions {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-shrink: 0;
	}

	.reject-form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 16rem;
	}

	.reject-form .actions {
		justify-content: flex-end;
	}

	:global(.dark) .review {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		border-top-color: #f97316;
	}

	:global(.dark) .request {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .count {
		background: oklch(0.3 0.06 50);
		color: #fed7aa;
	}
</style>
