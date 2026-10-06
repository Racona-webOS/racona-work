<!--
	A munkatársak szabadság státusza (specs/leave-balance-overview.md, K15):
	keret, kivett, lefoglalt, fennmaradó, tervezett, eltérés, státusz, trend.
	A sorra kattintva a grafikon a dolgozóra vált.
-->
<script lang="ts">
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import type { BalanceEmployeeRow, BalanceOverviewProject, EmployeeFigures } from '../../../server/functions.js';
	import { RUNNING_PROJECT_STATUSES, STATUS_ORDER } from '../../../server/leave-balance-utils.js';
	import Sparkline from './Sparkline.svelte';
	import { formatDays, formatShortDay, formatSigned, initials } from './format.js';

	type TableRow = { row: BalanceEmployeeRow; figures: EmployeeFigures };
	type SortKey = 'status' | 'name' | 'remaining' | 'taken' | 'deviation';

	let {
		pluginId = 'racona-work',
		rows,
		projectsById,
		year,
		refDay,
		selectedEmployeeId,
		onSelect,
		onOpenEmployee,
		onOpenCalendar
	}: {
		pluginId?: string;
		rows: TableRow[];
		projectsById: Map<number, BalanceOverviewProject>;
		year: number;
		refDay: string;
		selectedEmployeeId: number | null;
		onSelect: (employeeId: number) => void;
		onOpenEmployee: (employeeId: number) => void;
		onOpenCalendar: (employeeId: number) => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let search = $state('');
	let sortKey = $state<SortKey>('status');
	let menuFor = $state<number | null>(null);

	const SORT_KEYS: SortKey[] = ['status', 'name', 'remaining', 'taken', 'deviation'];

	const visible = $derived.by(() => {
		const query = search.trim().toLocaleLowerCase('hu');
		const list = query ? rows.filter((r) => r.row.name.toLocaleLowerCase('hu').includes(query)) : [...rows];
		const byName = (a: TableRow, b: TableRow) => a.row.name.localeCompare(b.row.name, 'hu');
		const compare: Record<SortKey, (a: TableRow, b: TableRow) => number> = {
			status: (a, b) =>
				STATUS_ORDER.indexOf(a.figures.status) - STATUS_ORDER.indexOf(b.figures.status) ||
				Math.abs(b.figures.deviation) - Math.abs(a.figures.deviation),
			name: byName,
			remaining: (a, b) => b.figures.remaining - a.figures.remaining,
			taken: (a, b) => b.figures.taken - a.figures.taken,
			deviation: (a, b) => b.figures.deviation - a.figures.deviation
		};
		return list.sort((a, b) => compare[sortKey](a, b) || byName(a, b));
	});

	function runningProjects(row: BalanceEmployeeRow): BalanceOverviewProject[] {
		return row.projectIds
			.map((id) => projectsById.get(id))
			.filter((p): p is BalanceOverviewProject => !!p && RUNNING_PROJECT_STATUSES.includes(p.status));
	}

	function employmentTags(row: BalanceEmployeeRow): string[] {
		const tags: string[] = [];
		const prefix = `${year}-`;
		if (row.hireDate?.startsWith(prefix)) {
			tags.push(t('leaveBalance.table.hired', { date: formatShortDay(row.hireDate) }));
		}
		if (row.employmentEndDate?.startsWith(prefix)) {
			const key = row.employmentEndDate <= refDay ? 'leaveBalance.table.left' : 'leaveBalance.table.leaves';
			tags.push(t(key, { date: formatShortDay(row.employmentEndDate) }));
		}
		return tags;
	}

	function statusTooltip(f: EmployeeFigures): string {
		if (f.status === 'none') return t('leaveBalance.status.noneHint');
		return t('leaveBalance.table.statusTooltip', {
			remaining: formatDays(f.remaining),
			booked: formatDays(f.booked),
			free: formatDays(f.free),
			planned: formatDays(f.planned),
			tolerance: formatDays(f.toleranceDays),
			critical: formatDays(f.criticalDays)
		});
	}

	function toggleMenu(event: MouseEvent, employeeId: number) {
		event.stopPropagation();
		menuFor = menuFor === employeeId ? null : employeeId;
	}

	function runAction(event: MouseEvent, action: (id: number) => void, employeeId: number) {
		event.stopPropagation();
		menuFor = null;
		action(employeeId);
	}
</script>

<svelte:window
	onclick={() => (menuFor = null)}
	onkeydown={(e) => {
		if (e.key === 'Escape') menuFor = null;
	}}
/>

<div class="table-card">
	<div class="card-head">
		<h3>{t('leaveBalance.table.title')}</h3>
		<div class="controls">
			<input
				class="input search"
				type="search"
				placeholder={t('leaveBalance.table.search')}
				aria-label={t('leaveBalance.table.search')}
				bind:value={search}
			/>
			<select class="input" bind:value={sortKey} aria-label={t('leaveBalance.table.sort')}>
				{#each SORT_KEYS as key (key)}
					<option value={key}>{t('leaveBalance.table.sortBy', { key: t(`leaveBalance.table.sortKey.${key}`) })}</option>
				{/each}
			</select>
		</div>
	</div>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="col-name">{t('leaveBalance.table.employee')}</th>
					<th>{t('leaveBalance.table.projects')}</th>
					<th class="num">{t('leaveBalance.table.allowance')}</th>
					<th class="num">{t('leaveBalance.table.taken')}</th>
					<th class="num">{t('leaveBalance.table.booked')}</th>
					<th class="num">{t('leaveBalance.table.remaining')}</th>
					<th class="num">{t('leaveBalance.table.planned', { date: formatShortDay(refDay) })}</th>
					<th class="num">{t('leaveBalance.table.deviation')}</th>
					<th>{t('leaveBalance.table.status')}</th>
					<th>{t('leaveBalance.table.trend')}</th>
					<th class="col-actions"><span class="sr-only">{t('leaveBalance.table.actions')}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each visible as { row, figures }, index (row.employeeId)}
					{@const projects = runningProjects(row)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<tr class:selected={selectedEmployeeId === row.employeeId} onclick={() => onSelect(row.employeeId)}>
						<td class="col-name">
							<div class="person">
								{#if row.image}
									<img class="avatar-img" src={row.image} alt="" />
								{:else}
									<span class="avatar-initials">{initials(row.name)}</span>
								{/if}
								<div class="person-text">
									<button
										class="name-link"
										onclick={(e) => runAction(e, onOpenEmployee, row.employeeId)}
									>
										{row.name}
									</button>
									{#if row.position}
										<span class="meta">{row.position}</span>
									{/if}
									{#each employmentTags(row) as tag (tag)}
										<span class="tag">{tag}</span>
									{/each}
								</div>
							</div>
						</td>
						<td>
							<div class="chips" title={projects.map((p) => p.name).join(', ')}>
								{#each projects.slice(0, 2) as project (project.id)}
									<span class="chip-project">{project.name}</span>
								{/each}
								{#if projects.length > 2}
									<span class="chip-project more">+{projects.length - 2}</span>
								{/if}
							</div>
						</td>
						<td class="num">{formatDays(row.totalDays)}</td>
						<td class="num">{formatDays(figures.taken)}</td>
						<td class="num">
							{formatDays(figures.booked)}
							{#if row.pending > 0}
								<span class="pending" title={t('leaveBalance.table.pendingHint', { days: row.pending })}>
									+{row.pending}
								</span>
							{/if}
						</td>
						<td class="num strong">{formatDays(figures.remaining)}</td>
						<td class="num">{figures.status === 'none' ? '—' : formatDays(figures.planned)}</td>
						<td class="num deviation status-{figures.status}">
							{figures.status === 'none' ? '—' : formatSigned(figures.deviation)}
						</td>
						<td>
							<span class="status-badge status-{figures.status}" title={statusTooltip(figures)}>
								{t(`leaveBalance.status.${figures.status}`)}
							</span>
						</td>
						<td>
							{#if figures.status !== 'none'}
								<Sparkline values={figures.trend.map((p) => p.deviation)} status={figures.status} />
							{/if}
						</td>
						<td class="col-actions">
							<div class="menu-wrap">
								<button
									class="icon-btn"
									aria-label={t('leaveBalance.table.actions')}
									aria-expanded={menuFor === row.employeeId}
									onclick={(e) => toggleMenu(e, row.employeeId)}
								>
									⋮
								</button>
								{#if menuFor === row.employeeId}
									<!-- Az utolsó sornál felfelé: lefelé a görgethető doboz levágná -->
									<div class="menu" class:up={index === visible.length - 1} role="menu">
										<button role="menuitem" onclick={(e) => runAction(e, onOpenEmployee, row.employeeId)}>
											{t('leaveBalance.table.openEmployee')}
										</button>
										<button role="menuitem" onclick={(e) => runAction(e, onOpenCalendar, row.employeeId)}>
											{t('leaveBalance.table.openCalendar')}
										</button>
									</div>
								{/if}
							</div>
						</td>
					</tr>
				{:else}
					<tr class="empty-row">
						<td colspan="11">{search ? t('leaveBalance.table.noMatch') : t('leaveBalance.empty')}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	@import '../../styles/shared.css';

	.table-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
		min-width: 0;
	}

	.card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.search {
		min-width: 12rem;
	}

	/* position: a rejtett (sr-only) feliratok is a görgethető dobozon belül maradjanak */
	.table-wrap {
		position: relative;
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	th,
	td {
		padding: 0.625rem 0.75rem;
		text-align: left;
		vertical-align: middle;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	th {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
	}

	tbody tr {
		cursor: pointer;
	}

	tbody tr:hover td {
		background: var(--color-accent, #f8fafc);
	}

	tbody tr.selected td {
		background: var(--color-primary-subtle, #eef2ff);
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	.num {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.strong {
		font-weight: 600;
	}

	/* A név oszlop keskeny kijelzőn a helyén marad */
	.col-name {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--color-card, #ffffff);
		min-width: 13rem;
	}

	.person {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.avatar-img,
	.avatar-initials {
		flex-shrink: 0;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 999px;
	}

	.avatar-img {
		object-fit: cover;
	}

	.avatar-initials {
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
	}

	.person-text {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-width: 0;
	}

	.name-link {
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
		color: var(--color-foreground, #0f172a);
	}

	.name-link:hover {
		color: var(--color-primary, #3730a3);
		text-decoration: underline;
	}

	.meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.tag {
		margin-top: 0.125rem;
		font-size: 0.7rem;
		color: #b45309;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		max-width: 14rem;
	}

	.chip-project {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.72rem;
		white-space: nowrap;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-foreground, #334155);
	}

	.chip-project.more {
		color: var(--color-muted-foreground, #64748b);
	}

	.pending {
		margin-left: 0.25rem;
		font-size: 0.72rem;
		color: var(--color-muted-foreground, #64748b);
		cursor: help;
	}

	.status-badge {
		display: inline-block;
		padding: 0.2rem 0.625rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: help;
	}

	.status-badge.status-ok {
		background: rgb(22 163 74 / 0.12);
		color: #15803d;
	}

	.status-badge.status-slightly_high {
		background: rgb(217 119 6 / 0.14);
		color: #b45309;
	}

	.status-badge.status-too_high {
		background: rgb(220 38 38 / 0.12);
		color: #b91c1c;
	}

	.status-badge.status-fast {
		background: rgb(37 99 235 / 0.12);
		color: #1d4ed8;
	}

	.status-badge.status-none {
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
	}

	.deviation.status-ok {
		color: #15803d;
	}

	.deviation.status-slightly_high {
		color: #b45309;
	}

	.deviation.status-too_high {
		color: #b91c1c;
	}

	.deviation.status-fast {
		color: #1d4ed8;
	}

	.col-actions {
		width: 2.5rem;
		text-align: right;
	}

	.menu-wrap {
		position: relative;
		display: inline-block;
	}

	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 0.25rem);
		z-index: 5;
		display: flex;
		flex-direction: column;
		min-width: 11rem;
		padding: 0.25rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
		box-shadow: 0 6px 20px rgb(15 23 42 / 0.12);
	}

	.menu.up {
		top: auto;
		bottom: calc(100% + 0.25rem);
	}

	.menu button {
		border: none;
		background: transparent;
		padding: 0.5rem 0.625rem;
		border-radius: 0.375rem;
		font: inherit;
		font-size: 0.8125rem;
		text-align: left;
		cursor: pointer;
		color: var(--color-foreground, #0f172a);
		white-space: nowrap;
	}

	.menu button:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.empty-row td {
		text-align: center;
		color: var(--color-muted-foreground, #64748b);
		cursor: default;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	:global(.dark) .table-card,
	:global(.dark) .col-name,
	:global(.dark) .menu {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) th,
	:global(.dark) td {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) tbody tr.selected td {
		background: var(--color-primary-subtle, oklch(0.269 0 0));
	}

	/* Sötét mód: a világos státuszszínek sötét párjai */
	:global(.dark) .status-badge.status-too_high {
		color: var(--rw-dark-danger-fg);
	}

	:global(.dark) .deviation.status-too_high {
		color: var(--rw-dark-danger-fg);
	}
</style>
