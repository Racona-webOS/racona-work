<!--
	Szűrő a Szabadság egyenleg oldalon (specs/leave-balance-overview.md, K12):
	mindenki, projekt nélkül, egy futó projekt tagjai; a lezárt projektek kapcsolóval.
	Az érték: 'all' | 'no_project' | 'project:<id>'.
-->
<script lang="ts">
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import type { BalanceOverviewProject } from '../../../server/functions.js';
	import { RUNNING_PROJECT_STATUSES } from '../../../server/leave-balance-utils.js';
	import Checkbox from '../ui/Checkbox.svelte';

	let {
		pluginId = 'racona-work',
		projects,
		value,
		showClosed,
		onChange,
		onToggleClosed
	}: {
		pluginId?: string;
		projects: BalanceOverviewProject[];
		value: string;
		showClosed: boolean;
		onChange: (value: string) => void;
		onToggleClosed: (value: boolean) => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const running = $derived(projects.filter((p) => RUNNING_PROJECT_STATUSES.includes(p.status)));
	const closed = $derived(
		projects.filter(
			(p) => !RUNNING_PROJECT_STATUSES.includes(p.status) && (showClosed || value === `project:${p.id}`)
		)
	);
</script>

<div class="project-filter">
	<label>
		<span>{t('leaveBalance.filter.label')}</span>
		<select
			class="input"
			{value}
			title={value.startsWith('project:') ? t('leaveBalance.filter.projectHint') : ''}
			onchange={(e) => onChange(e.currentTarget.value)}
		>
			<option value="all">{t('leaveBalance.filter.all')}</option>
			<option value="no_project">{t('leaveBalance.filter.noProject')}</option>
			{#if running.length > 0}
				<optgroup label={t('leaveBalance.filter.projects')}>
					{#each running as project (project.id)}
						<option value="project:{project.id}">{project.name} ({project.memberCount})</option>
					{/each}
				</optgroup>
			{/if}
			{#if closed.length > 0}
				<optgroup label={t('leaveBalance.filter.closedProjects')}>
					{#each closed as project (project.id)}
						<option value="project:{project.id}">{project.name} ({project.memberCount})</option>
					{/each}
				</optgroup>
			{/if}
		</select>
	</label>
	<label class="closed-toggle">
		<Checkbox checked={showClosed} onCheckedChange={onToggleClosed} ariaLabel={t('leaveBalance.filter.showClosed')} />
		<span>{t('leaveBalance.filter.showClosed')}</span>
	</label>
</div>

<style>
	@import '../../styles/shared.css';

	.project-filter {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 13rem;
	}

	.closed-toggle {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}

	.closed-toggle span {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-muted-foreground, #64748b);
	}
</style>
