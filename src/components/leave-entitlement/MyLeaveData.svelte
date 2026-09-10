<!--
	Saját irányítópult — a dolgozó szabadságkeretét érintő adatai és a
	bejelentései. Az adatokat itt csak látja; változást bejelenteni tud
	(születési dátum, gyerekek, egyéb pótszabadság), amit a HR hagy jóvá.
-->
<script lang="ts">
	import type {
		ChildData,
		EmployeeChild,
		LeaveDataRequest,
		LeaveDataRequestKind,
		LeaveProfile,
		ReportableExtraKind
	} from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import Checkbox from '../ui/Checkbox.svelte';
	import { describeDataRequest, formatDay } from './dataRequests.js';
	import { checkFile, FILE_ACCEPT, formatSize, MAX_FILES_PER_REQUEST, openFile, uploadFiles } from './files.js';

	let { pluginId = 'racona-work', employeeId }: { pluginId?: string; employeeId: number } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let profile = $state<LeaveProfile | null>(null);
	let requests = $state<LeaveDataRequest[]>([]);

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	async function load() {
		try {
			const [p, r] = await Promise.all([
				sdk.remote.call('getLeaveProfile', { employeeId }),
				sdk.remote.call('getLeaveDataRequests', { employeeId, status: 'all' })
			]);
			profile = p;
			requests = (r as LeaveDataRequest[]).slice(0, 10);
		} catch {
			profile = null;
		}
	}

	$effect(() => {
		if (sdk?.remote && employeeId) load();
	});

	// --- Bejelentő ablak ---
	type Draft = {
		kind: LeaveDataRequestKind;
		childId: number | null;
		birthDate: string;
		child: {
			label: string;
			birthDate: string;
			isDisabled: boolean;
			paternityEligible: boolean;
			adoptionDate: string;
		};
		extra: { kind: ReportableExtraKind; validFrom: string; validTo: string };
		note: string;
	};
	let draft = $state<Draft | null>(null);
	let draftFiles = $state<File[]>([]);
	let submitting = $state(false);

	/** A kiválasztott fájlok ellenőrzése; a hibásakat kihagyjuk és jelezzük. */
	function pickFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const picked = [...(input.files ?? [])];
		input.value = '';
		for (const file of picked) {
			const problem = checkFile(file, t);
			if (problem) {
				sdk?.ui?.toast(problem, 'warning');
			} else if (draftFiles.length >= MAX_FILES_PER_REQUEST) {
				sdk?.ui?.toast(t('files.error.tooMany', { max: MAX_FILES_PER_REQUEST }), 'warning');
				break;
			} else {
				draftFiles = [...draftFiles, file];
			}
		}
	}

	/** Igazolás utólagos csatolása egy függő bejelentéshez. */
	async function attachTo(request: LeaveDataRequest, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const picked = [...(input.files ?? [])];
		input.value = '';
		if (picked.length === 0) return;
		const errors = await uploadFiles(sdk, request.id, picked, t);
		errors.forEach((e) => sdk?.ui?.toast(e, 'error'));
		if (errors.length < picked.length) sdk?.ui?.toast(t('files.uploaded'), 'success');
		await load();
	}

	async function removeFile(fileId: number) {
		try {
			await sdk.remote.call('deleteLeaveDataRequestFile', { fileId });
			await load();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		}
	}

	async function openAttachment(fileId: number) {
		try {
			await openFile(sdk, fileId);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		}
	}

	const KINDS: LeaveDataRequestKind[] = ['birth_date', 'child_add', 'child_update', 'child_remove', 'extra_add'];

	function openDraft(kind: LeaveDataRequestKind = 'child_add', child?: EmployeeChild) {
		draftFiles = [];
		draft = {
			kind,
			childId: child?.id ?? null,
			birthDate: profile?.birthDate ?? '',
			child: {
				label: child?.label ?? '',
				birthDate: child?.birthDate ?? '',
				isDisabled: child?.isDisabled ?? false,
				paternityEligible: child?.paternityEligible ?? false,
				adoptionDate: child?.adoptionDate ?? ''
			},
			extra: { kind: 'health_impaired', validFrom: '', validTo: '' },
			note: ''
		};
	}

	/** Módosításnál a kiválasztott gyerek adataival töltjük ki az űrlapot. */
	function selectChild(childId: number | null) {
		if (!draft) return;
		draft.childId = childId;
		const child = profile?.children.find((c) => c.id === childId);
		if (child) {
			draft.child = {
				label: child.label ?? '',
				birthDate: child.birthDate,
				isDisabled: child.isDisabled,
				paternityEligible: child.paternityEligible,
				adoptionDate: child.adoptionDate ?? ''
			};
		}
	}

	async function submit() {
		if (!draft) return;
		submitting = true;
		try {
			const child: ChildData = {
				label: draft.child.label || null,
				birthDate: draft.child.birthDate,
				isDisabled: draft.child.isDisabled,
				paternityEligible: draft.child.paternityEligible,
				adoptionDate: draft.child.adoptionDate || null
			};
			const created: LeaveDataRequest = await sdk.remote.call('submitLeaveDataRequest', {
				employeeId,
				kind: draft.kind,
				childId: draft.childId,
				birthDate: draft.birthDate,
				child,
				extra: {
					kind: draft.extra.kind,
					validFrom: draft.extra.validFrom || null,
					validTo: draft.extra.validTo || null
				},
				note: draft.note
			});
			// A fájlok egyenként mennek fel; ha valamelyik nem sikerül, a bejelentés akkor is él
			const errors = await uploadFiles(sdk, created.id, draftFiles, t);
			draft = null;
			draftFiles = [];
			errors.forEach((e) => sdk?.ui?.toast(e, 'error'));
			sdk?.ui?.toast(t('dataRequest.submitted'), 'success');
			await load();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			submitting = false;
		}
	}

	async function cancel(request: LeaveDataRequest) {
		try {
			await sdk.remote.call('cancelLeaveDataRequest', { id: request.id });
			await load();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		}
	}

	const hasChildren = $derived((profile?.children.length ?? 0) > 0);
	const needsChild = $derived(draft?.kind === 'child_update' || draft?.kind === 'child_remove');
</script>

{#if profile}
	<div class="my-data">
		<div class="header">
			<div>
				<h3>{t('dataRequest.my.title')}</h3>
				<p class="subtitle">{t('dataRequest.my.subtitle')}</p>
			</div>
			<button class="btn-secondary btn-sm" onclick={() => openDraft()}>{t('dataRequest.my.report')}</button>
		</div>

		<div class="facts">
			<div class="fact">
				<span class="label">{t('leaveEntitlement.profile.birthDate')}</span>
				<span>{formatDay(profile.birthDate)}</span>
			</div>
			<div class="fact">
				<span class="label">{t('leaveEntitlement.children.title')}</span>
				<span>
					{#if profile.children.length === 0}
						—
					{:else}
						{profile.children
							.map((c) => `${c.label || t('leaveEntitlement.children.unnamed')} (${formatDay(c.birthDate)})`)
							.join(', ')}
					{/if}
				</span>
			</div>
			{#if profile.extras.length > 0}
				<div class="fact">
					<span class="label">{t('leaveEntitlement.extras.title')}</span>
					<span>
						{profile.extras
							.map((e) => (e.kind === 'custom' && e.note ? e.note : t(`leaveEntitlement.extras.kind.${e.kind}`)))
							.join(', ')}
					</span>
				</div>
			{/if}
		</div>

		{#if requests.length > 0}
			<ul class="requests">
				{#each requests as request (request.id)}
					{@const description = describeDataRequest(request, t)}
					<li class="request">
						<div class="request-main">
							<span class="title">{description.title}</span>
							{#each description.details as detail, i (i)}
								<span class="detail">{detail}</span>
							{/each}
							{#if request.status === 'rejected' && request.decisionNote}
								<span class="decision">{t('dataRequest.my.decisionNote', { note: request.decisionNote })}</span>
							{/if}
							{#if request.files.length > 0}
								<span class="files">
									{#each request.files as file (file.id)}
										<span class="file-chip">
											<button class="link" onclick={() => openAttachment(file.id)}>📎 {file.fileName}</button>
											{#if request.status === 'pending'}
												<button
													class="chip-remove"
													onclick={() => removeFile(file.id)}
													aria-label={t('files.remove')}>✕</button
												>
											{/if}
										</span>
									{/each}
								</span>
							{/if}
						</div>
						<div class="request-side">
							<span class="badge badge-{request.status}">{t(`dataRequest.status.${request.status}`)}</span>
							{#if request.status === 'pending'}
								{#if request.files.length < MAX_FILES_PER_REQUEST}
									<label class="link attach">
										{t('files.attachLater')}
										<input type="file" accept={FILE_ACCEPT} multiple hidden onchange={(e) => attachTo(request, e)} />
									</label>
								{/if}
								<button class="link" onclick={() => cancel(request)}>{t('dataRequest.my.cancel')}</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

{#if draft}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (draft = null)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{t('dataRequest.my.report')}</h3>
				<button class="icon-btn" onclick={() => (draft = null)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('dataRequest.form.kind')}</span>
					<select class="input" bind:value={draft.kind}>
						{#each KINDS as kind (kind)}
							{#if hasChildren || (kind !== 'child_update' && kind !== 'child_remove')}
								<option value={kind}>{t(`dataRequest.kind.${kind}`)}</option>
							{/if}
						{/each}
					</select>
				</label>

				{#if draft.kind === 'birth_date'}
					<label>
						<span>{t('leaveEntitlement.profile.birthDate')}</span>
						<input class="input" type="date" bind:value={draft.birthDate} />
					</label>
				{/if}

				{#if needsChild}
					<label>
						<span>{t('leaveRequests.form.child')}</span>
						<select
							class="input"
							value={draft.childId}
							onchange={(e) => selectChild(Number((e.currentTarget as HTMLSelectElement).value) || null)}
						>
							<option value={null}>{t('leaveRequests.form.selectChild')}</option>
							{#each profile?.children ?? [] as child (child.id)}
								<option value={child.id}>
									{child.label || t('leaveEntitlement.children.unnamed')} ({formatDay(child.birthDate)})
								</option>
							{/each}
						</select>
					</label>
				{/if}

				{#if draft.kind === 'child_add' || (draft.kind === 'child_update' && draft.childId)}
					<label>
						<span>{t('leaveEntitlement.children.label')}</span>
						<input class="input" type="text" bind:value={draft.child.label} maxlength="255" />
					</label>
					<label>
						<span>{t('leaveEntitlement.children.birthDate')}</span>
						<input class="input" type="date" bind:value={draft.child.birthDate} />
					</label>
					<label class="checkbox-row">
						<Checkbox
							checked={draft.child.isDisabled}
							onCheckedChange={(v) => draft && (draft.child.isDisabled = v)}
						/>
						<span>{t('leaveEntitlement.children.isDisabled')}</span>
					</label>
					<label class="checkbox-row">
						<Checkbox
							checked={draft.child.paternityEligible}
							onCheckedChange={(v) => draft && (draft.child.paternityEligible = v)}
						/>
						<span>{t('leaveEntitlement.children.paternityEligible')}</span>
					</label>
					<label>
						<span>{t('leaveEntitlement.children.adoptionDate')}</span>
						<input class="input" type="date" bind:value={draft.child.adoptionDate} />
						<small class="hint">{t('leaveEntitlement.children.adoptionHint')}</small>
					</label>
				{/if}

				{#if draft.kind === 'extra_add'}
					<label>
						<span>{t('leaveEntitlement.extras.kindLabel')}</span>
						<select class="input" bind:value={draft.extra.kind}>
							<option value="health_impaired">{t('leaveEntitlement.extras.kind.health_impaired')}</option>
							<option value="underground_radiation">{t('leaveEntitlement.extras.kind.underground_radiation')}</option>
						</select>
					</label>
					{#if draft.extra.kind === 'health_impaired'}
						<p class="hint warn">{t('dataRequest.form.healthHint')}</p>
					{/if}
					<div class="date-pair">
						<label>
							<span>{t('leaveEntitlement.extras.validFrom')}</span>
							<input class="input" type="date" bind:value={draft.extra.validFrom} />
						</label>
						<label>
							<span>{t('leaveEntitlement.extras.validTo')}</span>
							<input class="input" type="date" bind:value={draft.extra.validTo} />
						</label>
					</div>
				{/if}

				<label>
					<span>{t('dataRequest.form.note')}</span>
					<textarea class="input textarea" bind:value={draft.note} rows="2"></textarea>
				</label>
				<div class="files-field">
					<span class="field-title">{t('files.attach')}</span>
					{#if draftFiles.length < MAX_FILES_PER_REQUEST}
						<label class="btn-secondary btn-sm file-button">
							{t('files.choose')}
							<input type="file" accept={FILE_ACCEPT} multiple hidden onchange={pickFiles} />
						</label>
					{/if}
					{#each draftFiles as file, i (i)}
						<span class="file-chip">
							📎 {file.name} ({formatSize(file.size)})
							<button
								class="chip-remove"
								onclick={() => (draftFiles = draftFiles.filter((_, j) => j !== i))}
								aria-label={t('files.remove')}>✕</button
							>
						</span>
					{/each}
					<small class="hint">{t('files.hint')}</small>
				</div>
				<p class="hint">{t('dataRequest.form.hint')}</p>
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (draft = null)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submit} disabled={submitting || (needsChild && !draft.childId)}>
					{submitting ? t('loading') : t('dataRequest.form.submit')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	.my-data {
		padding: 1.25rem 1.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.header h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
	}

	.subtitle {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.facts {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
	}

	.fact {
		display: flex;
		gap: 1rem;
	}

	.label {
		min-width: 9rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.requests {
		list-style: none;
		margin: 0;
		padding: 0.75rem 0 0;
		border-top: 1px solid var(--color-border, #e2e8f0);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.request {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.85rem;
	}

	.request-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.title {
		font-weight: 500;
	}

	.detail {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.decision {
		font-size: 0.8rem;
		color: #b45309;
	}

	.request-side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		flex-shrink: 0;
	}

	.badge {
		display: inline-flex;
		padding: 0.1rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.7rem;
		font-weight: 500;
	}

	.badge-pending { background: #fef3c7; color: #92400e; }
	.badge-approved { background: #dcfce7; color: #166534; }
	.badge-rejected { background: #fee2e2; color: #991b1b; }
	.badge-cancelled { background: #f1f5f9; color: #64748b; }

	.link {
		border: none;
		background: transparent;
		padding: 0;
		font-size: 0.75rem;
		color: var(--color-primary, #3730a3);
		cursor: pointer;
	}

	.link:hover {
		text-decoration: underline;
	}

	.files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.2rem;
	}

	.file-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.1rem 0.5rem;
		border-radius: 0.375rem;
		background: var(--color-accent, #f1f5f9);
		font-size: 0.75rem;
	}

	.chip-remove {
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.chip-remove:hover {
		color: #dc2626;
	}

	.link.attach {
		display: inline;
		flex-direction: row;
	}

	.files-field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
	}

	.field-title {
		font-size: 0.875rem;
		font-weight: 500;
	}

	/* A shared.css globális label szabálya oszlopba rendezne */
	.file-button {
		flex-direction: row;
		cursor: pointer;
	}

	:global(.dark) .file-chip {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	.date-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	/* A shared.css globális label szabálya oszlopba rendezne */
	.checkbox-row {
		flex-direction: row;
		align-items: center;
		gap: 0.6rem;
		cursor: pointer;
	}

	.checkbox-row span {
		font-weight: 400;
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.hint.warn {
		color: #b45309;
	}

	:global(.dark) .my-data {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .requests {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .badge-pending { background: oklch(0.3 0.05 60); color: #fde68a; }
	:global(.dark) .badge-approved { background: oklch(0.25 0.05 145); color: #86efac; }
	:global(.dark) .badge-rejected { background: oklch(0.25 0.05 20); color: #fca5a5; }
	:global(.dark) .badge-cancelled { background: oklch(0.3 0 0); color: #cbd5e1; }
</style>
