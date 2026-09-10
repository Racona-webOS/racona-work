<!--
	ProjectDetail — Tagok fül

	A tagok listája és a "Tag hozzáadása" modal. A tag- és projektadatok
	betöltése a szülőben marad (a fejléc badge-e is azokat használja), ezért
	minden módosítás után `onChanged`-del kérünk újratöltést.
-->
<script lang="ts">
	import type { ProjectRow, ProjectMemberRow, EmployeeRow } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		project,
		members,
		membersLoading = false,
		availableToAdd,
		canManage = false,
		onChanged
	}: {
		pluginId?: string;
		project: ProjectRow;
		members: ProjectMemberRow[];
		membersLoading?: boolean;
		availableToAdd: EmployeeRow[];
		canManage?: boolean;
		onChanged: () => void | Promise<void>;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	type ProjectMemberRole =
		| 'member'
		| 'member_developer'
		| 'member_designer'
		| 'member_tester'
		| 'member_external'
		| 'member_consultant'
		| 'member_observer'
		| 'lead'
		| 'owner';

	let showAddMember = $state(false);
	let addMemberEmployeeId = $state<number | null>(null);
	let addMemberRole = $state<ProjectMemberRole>('member');
	let addMemberSaving = $state(false);

	function initials(name: string | null | undefined): string {
		return (
			name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'
		);
	}

	async function handleAddMember() {
		if (!addMemberEmployeeId) return;
		addMemberSaving = true;
		try {
			await sdk.remote.call('addProjectMember', {
				projectId: project.id,
				employeeId: addMemberEmployeeId,
				role: addMemberRole
			});
			sdk?.ui?.toast?.(t('projects.members.addSuccess'), 'success');
			showAddMember = false;
			addMemberEmployeeId = null;
			addMemberRole = 'member';
			await onChanged();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			addMemberSaving = false;
		}
	}

	async function handleRemoveMember(employeeId: number) {
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('projects.members.removeConfirm'),
			message: t('projects.members.removeConfirm'),
			confirmLabel: t('projects.members.removeConfirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('removeProjectMember', {
				projectId: project.id,
				employeeId
			});
			sdk?.ui?.toast?.(t('projects.members.removeSuccess'), 'success');
			await onChanged();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}
</script>

<div class="section-header">
	<h3>{t('projects.members.title')}</h3>
	{#if canManage && availableToAdd.length > 0}
		<button class="btn-primary" onclick={() => (showAddMember = true)}>
			+ {t('projects.members.add')}
		</button>
	{/if}
</div>

{#if membersLoading}
	<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
{:else if members.length === 0}
	<p class="empty-state">{t('projects.members.empty')}</p>
{:else}
	<ul class="member-list">
		{#each members as m (m.employeeId)}
			<li class="member-item">
				<div class="avatar">
					{#if m.userImage}
						<img src={m.userImage} alt={m.userName} />
					{:else}
						<div class="avatar-placeholder">{initials(m.userName)}</div>
					{/if}
				</div>
				<div class="member-info">
					<span class="name">{m.userName}</span>
					<span class="meta">
						{m.userEmail}
						{#if m.position}· {m.position}{/if}
					</span>
				</div>
				<span class="role-badge">
					{t(`projects.members.roleOptions.${m.role}`) || m.role}
				</span>
				{#if canManage}
					<button
						class="remove-btn"
						title={t('projects.members.removeConfirm')}
						onclick={() => handleRemoveMember(m.employeeId)}
					>
						✕
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<!-- Tag hozzáadása modal -->
{#if showAddMember}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (showAddMember = false)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{t('projects.members.add')}</h3>
				<button class="icon-btn" onclick={() => (showAddMember = false)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('projects.members.selectEmployee')}</span>
					<select class="input" bind:value={addMemberEmployeeId}>
						<option value={null}>{t('projects.members.selectEmployee')}</option>
						{#each availableToAdd as emp (emp.id)}
							<option value={emp.id}>{emp.userName} — {emp.userEmail}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>{t('projects.members.role')}</span>
					<select class="input" bind:value={addMemberRole}>
						<option value="member">{t('projects.members.roleOptions.member')}</option>
						<option value="member_developer">{t('projects.members.roleOptions.member_developer')}</option>
						<option value="member_designer">{t('projects.members.roleOptions.member_designer')}</option>
						<option value="member_tester">{t('projects.members.roleOptions.member_tester')}</option>
						<option value="member_external">{t('projects.members.roleOptions.member_external')}</option>
						<option value="member_consultant">{t('projects.members.roleOptions.member_consultant')}</option>
						<option value="member_observer">{t('projects.members.roleOptions.member_observer')}</option>
						<option value="lead">{t('projects.members.roleOptions.lead')}</option>
						<option value="owner">{t('projects.members.roleOptions.owner')}</option>
					</select>
				</label>
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (showAddMember = false)}>
					{t('form.cancel')}
				</button>
				<button
					class="btn-primary"
					onclick={handleAddMember}
					disabled={!addMemberEmployeeId || addMemberSaving}
				>
					{addMemberSaving ? t('loading') : t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	.member-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.member-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		border-radius: 0.375rem;
		border: 1px solid transparent;
	}

	.member-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.member-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.member-info .name {
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.member-info .meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.role-badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
		text-transform: capitalize;
	}

	:global(.dark) .member-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}
</style>
