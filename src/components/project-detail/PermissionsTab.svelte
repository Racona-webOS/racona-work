<!--
	ProjectDetail — Jogosultságok fül

	Projekt-szintű szerep-felülbírálások mátrixa (szervezeti szerepek × user)
	és az "Új user" modal. A szerep- és felülbírálás-listát a szülő tölti be
	(a fejléc badge-e is azt használja), módosítás után `onChanged`-del kérünk
	újratöltést.
-->
<script lang="ts">
	import type { ProjectRow, EmployeeRow } from '../../../server/functions.js';
	import type { RoleRow, OverrideRow } from './types.js';
	import Checkbox from '../ui/Checkbox.svelte';
	import { resolveSdk, translate } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		project,
		orgRoles,
		overrides,
		overridesLoading = false,
		availableToOverride,
		onChanged
	}: {
		pluginId?: string;
		project: ProjectRow;
		orgRoles: RoleRow[];
		overrides: OverrideRow[];
		overridesLoading?: boolean;
		availableToOverride: EmployeeRow[];
		onChanged: () => void | Promise<void>;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let savingUserId = $state<number | null>(null);
	let showAddOverride = $state(false);
	let overrideUserId = $state<number | null>(null);
	let overrideRoleIds = $state<Set<number>>(new Set());
	let overrideSaving = $state(false);

	function initials(name: string | null | undefined): string {
		return (
			name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'
		);
	}

	function userHasOverrideRole(row: OverrideRow, roleId: number): boolean {
		return row.roles.some((r) => r.id === roleId);
	}

	async function toggleOverrideRoleForUser(userId: number, roleId: number) {
		const row = overrides.find((o) => o.userId === userId);
		const nextIds = new Set(row?.roles.map((r) => r.id) ?? []);
		if (nextIds.has(roleId)) nextIds.delete(roleId);
		else nextIds.add(roleId);

		savingUserId = userId;
		try {
			await sdk.remote.call('setProjectUserRoles', {
				projectId: project.id,
				userId,
				roleIds: [...nextIds]
			});
			await onChanged();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			savingUserId = null;
		}
	}

	async function handleRemoveOverride(userId: number) {
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('projects.permissions.removeConfirm'),
			message: t('projects.permissions.removeConfirm'),
			confirmLabel: t('projects.permissions.removeConfirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;

		try {
			await sdk.remote.call('setProjectUserRoles', {
				projectId: project.id,
				userId,
				roleIds: []
			});
			sdk?.ui?.toast?.(t('projects.permissions.removeSuccess'), 'success');
			await onChanged();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	function openOverrideDialog() {
		overrideUserId = null;
		overrideRoleIds = new Set();
		showAddOverride = true;
	}

	function toggleOverrideAddRole(roleId: number) {
		const next = new Set(overrideRoleIds);
		if (next.has(roleId)) next.delete(roleId);
		else next.add(roleId);
		overrideRoleIds = next;
	}

	async function handleAddOverride() {
		if (!overrideUserId) return;
		if (overrideRoleIds.size === 0) {
			sdk?.ui?.toast?.(t('projects.permissions.roles') + ': ' + t('form.required'), 'error');
			return;
		}
		overrideSaving = true;
		try {
			await sdk.remote.call('setProjectUserRoles', {
				projectId: project.id,
				userId: overrideUserId,
				roleIds: [...overrideRoleIds]
			});
			sdk?.ui?.toast?.(t('projects.permissions.saveSuccess'), 'success');
			showAddOverride = false;
			await onChanged();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			overrideSaving = false;
		}
	}
</script>

<div class="section-header">
	<div>
		<h3>{t('projects.permissions.overridesTitle')}</h3>
		<p class="perm-hint">{t('projects.permissions.overridesHint')}</p>
	</div>
	{#if orgRoles.length > 0 && availableToOverride.length > 0}
		<button class="btn-primary" onclick={openOverrideDialog}>
			+ {t('projects.permissions.addUser')}
		</button>
	{/if}
</div>

{#if orgRoles.length === 0}
	<p class="empty-state">{t('projects.permissions.noOrgRoles')}</p>
{:else if overridesLoading}
	<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
{:else if overrides.length === 0}
	<p class="empty-state">{t('projects.permissions.empty')}</p>
{:else}
	<div class="matrix-wrapper">
		<table class="matrix">
			<thead>
				<tr>
					<th class="user-col">User</th>
					{#each orgRoles as r (r.id)}
						<th class="role-col" title={r.description ?? ''}>
							{r.name}
							{#if r.isSystem}
								<span class="mini-badge">{t('permissions.roles.systemBadge')}</span>
							{/if}
						</th>
					{/each}
					<th class="action-col"></th>
				</tr>
			</thead>
			<tbody>
				{#each overrides as row (row.userId)}
					<tr>
						<td class="user-col">
							<div class="user-cell">
								<div class="avatar">
									{#if row.userImage}
										<img src={row.userImage} alt={row.userName} />
									{:else}
										<div class="avatar-placeholder">{initials(row.userName)}</div>
									{/if}
								</div>
								<div class="user-info">
									<span class="name">{row.userName}</span>
									<span class="email">{row.userEmail}</span>
								</div>
							</div>
						</td>
						{#each orgRoles as r (r.id)}
							<td class="role-col">
								<Checkbox
									checked={userHasOverrideRole(row, r.id)}
									disabled={savingUserId === row.userId}
									onCheckedChange={() => toggleOverrideRoleForUser(row.userId, r.id)}
								/>
							</td>
						{/each}
						<td class="action-col">
							<button
								class="remove-btn"
								title={t('projects.permissions.removeConfirm')}
								onclick={() => handleRemoveOverride(row.userId)}
							>
								✕
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<!-- Új user felülbírálás modal -->
{#if showAddOverride}
	<div class="modal-overlay" onclick={() => (showAddOverride = false)} role="presentation">
		<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
			<div class="modal-header">
				<h3>{t('projects.permissions.addUser')}</h3>
				<button class="icon-btn" onclick={() => (showAddOverride = false)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('projects.permissions.selectUser')}</span>
					<select class="input" bind:value={overrideUserId}>
						<option value={null}>{t('projects.permissions.selectUser')}</option>
						{#each availableToOverride as emp (emp.userId)}
							<option value={emp.userId}>{emp.userName} — {emp.userEmail}</option>
						{/each}
					</select>
				</label>

				<div class="roles-section">
					<h4>{t('projects.permissions.roles')}</h4>
					{#if orgRoles.length === 0}
						<p class="empty-state">{t('projects.permissions.noOrgRoles')}</p>
					{:else}
						<div class="role-options">
							{#each orgRoles as r (r.id)}
								<label class="role-option">
									<Checkbox
										checked={overrideRoleIds.has(r.id)}
										onCheckedChange={() => toggleOverrideAddRole(r.id)}
									/>
									<span class="role-option-name">
										{r.name}
										{#if r.isSystem}
											<span class="mini-badge">{t('permissions.roles.systemBadge')}</span>
										{/if}
									</span>
									{#if r.description}
										<span class="role-option-desc">{r.description}</span>
									{/if}
								</label>
							{/each}
						</div>
					{/if}
				</div>
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (showAddOverride = false)}>
					{t('form.cancel')}
				</button>
				<button
					class="btn-primary"
					onclick={handleAddOverride}
					disabled={!overrideUserId || overrideRoleIds.size === 0 || overrideSaving}
				>
					{overrideSaving ? t('loading') : t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	/* ---------- Permissions fül ---------- */
	.perm-hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0.25rem 0 0;
		max-width: 520px;
	}

	.matrix-wrapper {
		overflow-x: auto;
	}

	.matrix {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.matrix th,
	.matrix td {
		padding: 0.5rem 0.5rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		text-align: left;
		vertical-align: middle;
	}

	.matrix thead th {
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.user-col {
		min-width: 200px;
	}

	.role-col {
		text-align: center;
		min-width: 120px;
	}

	.action-col {
		width: 32px;
		text-align: right;
	}

	.user-cell {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.user-info .name {
		font-size: 0.85rem;
		font-weight: 500;
	}

	.user-info .email {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.mini-badge {
		font-size: 0.6rem;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
		margin-left: 0.25rem;
	}

	.roles-section h4 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.role-options {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.role-option {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		cursor: pointer;
		align-items: start;
	}

	.role-option:hover {
		background: var(--color-accent, #f8fafc);
	}

	.role-option input {
		margin-top: 0.1rem;
	}

	.role-option-name {
		font-size: 0.85rem;
		font-weight: 500;
		display: flex;
		gap: 0.25rem;
		align-items: center;
		grid-column: 2;
	}

	.role-option-desc {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		grid-column: 2;
	}

	:global(.dark) .role-option:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .mini-badge {
		background: oklch(0.269 0 0);
		color: oklch(0.708 0 0);
	}
</style>
