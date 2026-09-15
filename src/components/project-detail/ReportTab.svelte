<!--
	ProjectDetail — Riport fül

	Lezárt projektnél nincs idővonal, és az utolsó 30 nap grafikonja is csak
	dátumszűrővel látszik; a teljes időszak grafikonja mindig megjelenik.

	Önálló, csak akkor mountol, amikor a fül aktív (a szülő így rendereli),
	tehát a betöltést a mount és a dátumszűrők vezérlik. Tartalmazza a
	CSV exportot is (a nyers bejegyzéseket kéri le, nem az aggregált riportot).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		ProjectRow,
		ProjectReport,
		WorkEntryListResult
	} from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		projectId,
		project
	}: {
		pluginId?: string;
		projectId: number;
		project: ProjectRow;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	/** A core által megosztott DatePicker; ha nincs, natív date inputra esünk vissza. */
	const DatePickerComponent = $derived((sdk as any)?.components?.DatePicker ?? null);

	let report = $state<ProjectReport | null>(null);
	let reportLoading = $state(false);
	let reportError = $state<string | null>(null);
	let reportFrom = $state('');
	let reportTo = $state('');

	// Szekció collapse állapotok
	let sectionCollapsed = $state<Record<string, boolean>>({
		byEmployee: false,
		byCategory: false,
		inactive: false,
		recent: false
	});

	function toggleSection(key: string) {
		sectionCollapsed[key] = !sectionCollapsed[key];
	}

	// Dolgozónkénti kategória-bontás expand állapot
	let expandedEmployees = $state<Set<number>>(new Set());

	function toggleEmployeeExpand(employeeId: number) {
		const next = new Set(expandedEmployees);
		if (next.has(employeeId)) {
			next.delete(employeeId);
		} else {
			next.add(employeeId);
		}
		expandedEmployees = next;
	}

	// Kategória max (riport bar skálázáshoz)
	let reportCatMax = $derived(
		report?.byCategory?.length ? Math.max(1, ...report.byCategory.map((c) => c.totalHours)) : 1
	);

	async function loadReport() {
		if (!projectId || !sdk?.remote) return;
		reportLoading = true;
		reportError = null;
		try {
			const result = (await sdk.remote.call('getProjectReport', {
				projectId,
				...(reportFrom ? { from: reportFrom } : {}),
				...(reportTo ? { to: reportTo } : {})
			})) as ProjectReport;
			report = result ?? null;
		} catch (err: any) {
			reportError = err?.message ?? t('error.loadFailed');
			report = null;
		} finally {
			reportLoading = false;
		}
	}

	// Mountkor és a dátumszűrők változásakor újratöltés.
	$effect(() => {
		projectId;
		reportFrom;
		reportTo;
		untrack(() => loadReport());
	});

	// --- CSV export ----------------------------------------------------------
	let exportLoading = $state(false);

	async function exportReportCsv() {
		if (exportLoading) return;
		exportLoading = true;
		try {
			// Összes bejegyzés lekérése (max 10 000 sor)
			const result = (await sdk.remote.call('listWorkEntries', {
				projectId,
				scope: 'all',
				pageSize: 10000,
				sortBy: 'work_date',
				sortOrder: 'asc',
				...(reportFrom ? { from: reportFrom } : {}),
				...(reportTo ? { to: reportTo } : {})
			})) as WorkEntryListResult;

			const entries = result?.data ?? [];

			// Fejléc
			const headers = [
				t('work.columns.date') || 'Dátum',
				t('work.columns.employee') || 'Dolgozó',
				'E-mail',
				t('work.form.category') || 'Kategória',
				t('work.columns.title') || 'Megnevezés',
				t('work.form.description') || 'Leírás',
				t('work.columns.hours') || 'Óra'
			];

			const escapeCell = (val: string | number | null | undefined): string => {
				if (val === null || val === undefined) return '';
				const s = String(val);
				// Ha tartalmaz vesszőt, idézőjelet vagy sortörést, idézőjelbe tesszük
				if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
					return '"' + s.replace(/"/g, '""') + '"';
				}
				return s;
			};

			const formatDateOnly = (raw: string | null | undefined): string => {
				if (!raw) return '';
				// YYYY-MM-DD alakú stringből csak a dátumot vesszük
				return String(raw).slice(0, 10);
			};

			const rows = entries.map((e) => [
				escapeCell(formatDateOnly(e.workDate)),
				escapeCell(e.employeeName),
				escapeCell(e.employeeEmail),
				escapeCell(e.categoryName ?? ''),
				escapeCell(e.title),
				escapeCell(e.description ?? ''),
				escapeCell(e.hours)
			]);

			const csvContent =
				'\uFEFF' + // BOM az Excel kompatibilitáshoz
				[headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			const projectSlug = project.name
				.replace(/[^a-zA-Z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g, '_')
				.toLowerCase();
			const dateStr = new Date().toISOString().slice(0, 10);
			a.href = url;
			a.download = `${projectSlug}_feladatok_${dateStr}.csv`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			sdk?.ui?.toast?.(t('report.export.success') || 'CSV exportálva', 'success');
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? (t('error.saveFailed') || 'Export sikertelen'), 'error');
		} finally {
			exportLoading = false;
		}
	}
</script>

<!-- Intervallum szűrő -->
<div class="date-filter-bar">
	{#if DatePickerComponent}
		<DatePickerComponent bind:value={reportFrom} locale="hu-HU" placeholder="éééé. hh. nn." />
	{:else}
		<input class="input input-sm" type="date" bind:value={reportFrom} />
	{/if}
	<span class="date-filter-label">{t('filter.from')}</span>
	{#if DatePickerComponent}
		<DatePickerComponent bind:value={reportTo} locale="hu-HU" placeholder="éééé. hh. nn." />
	{:else}
		<input class="input input-sm" type="date" bind:value={reportTo} />
	{/if}
	<span class="date-filter-label">{t('filter.to')}</span>
	{#if reportFrom || reportTo}
		<button
			class="btn-ghost-sm"
			onclick={() => { reportFrom = ''; reportTo = ''; }}
			title={t('filter.clear')}
		>
			✕ {t('filter.clear')}
		</button>
	{/if}
</div>

{#if reportLoading}
	<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
{:else if reportError}
	<div class="error-banner">{reportError}</div>
{:else if report}
	<!-- Összegző kártyák -->
	<div class="kpi-block">
		<div class="kpi-block-header">
			<span></span>
			<button
				class="btn-secondary btn-sm"
				onclick={exportReportCsv}
				disabled={exportLoading}
				title={t('report.export.tooltip') || 'Feladatok exportálása CSV-be'}
			>
				{exportLoading ? (t('loading') || '...') : ('⬇ CSV')}
			</button>
		</div>
		<div class="kpi-grid">
		<div class="kpi">
			<span class="kpi-label">{t('report.totalHours')}</span>
			<span class="kpi-value">{report.totals.totalHours.toFixed(1)} {t('work.columns.hours').toLowerCase()}</span>
		</div>
		<div class="kpi">
			<span class="kpi-label">{t('report.totalEntries')}</span>
			<span class="kpi-value">{report.totals.totalEntries}</span>
		</div>
		<div class="kpi">
			<span class="kpi-label">{t('report.activeMembers')}</span>
			<span class="kpi-value">
				{report.totals.activeMemberCount} / {report.totals.totalMemberCount}
			</span>
		</div>
		<div class="kpi">
			<span class="kpi-label">{t('report.avgHoursPerDay')}</span>
			<span class="kpi-value">{report.totals.avgHoursPerActiveDay.toFixed(1)} {t('work.columns.hours').toLowerCase()}</span>
		</div>
		<div class="kpi">
			<span class="kpi-label">{t('report.firstEntry')}</span>
			<span class="kpi-value small">
				{report.totals.firstEntryDate
					? new Date(report.totals.firstEntryDate).toLocaleDateString()
					: '—'}
			</span>
		</div>
		<div class="kpi">
			<span class="kpi-label">{t('report.lastEntry')}</span>
			<span class="kpi-value small">
				{report.totals.lastEntryDate
					? new Date(report.totals.lastEntryDate).toLocaleDateString()
					: '—'}
			</span>
		</div>
	</div>
	</div>

	<!-- Projekt idővonal -->
	{#if !project.closedAt && (report.project.startDate || report.project.endDate)}
	<div class="report-section">
		<div class="section-header">
			<h3>{t('report.progress')}</h3>
			{#if report.project.isOverdue}
				<span class="tag tag-danger">{t('report.overdue')}</span>
			{/if}
		</div>
		<div class="timeline">
			<div class="timeline-info">
				{#if report.project.daysSinceStart !== null}
					<div>
						<span class="t-label">{t('report.daysSinceStart')}:</span>
						<strong>{report.project.daysSinceStart}</strong>
					</div>
				{/if}
				{#if report.project.daysUntilEnd !== null}
					<div>
						<span class="t-label">{t('report.daysUntilEnd')}:</span>
						<strong
							class:t-danger={report.project.daysUntilEnd < 0}
							class:t-warn={report.project.daysUntilEnd >= 0 &&
								report.project.daysUntilEnd <= 7}
						>
							{report.project.daysUntilEnd}
						</strong>
					</div>
				{/if}
			</div>
			{#if report.project.progressPercent !== null}
				<div class="progress-bar">
					<div
						class="progress-fill"
						class:progress-danger={report.project.isOverdue}
						style="width: {report.project.progressPercent}%"
					></div>
				</div>
				<div class="progress-label">
					{report.project.progressPercent}%
				</div>
			{/if}
		</div>
	</div>
	{/if}

	<!-- Dolgozónkénti bontás -->
	<div class="report-section">
		<div class="section-collapse-header">
			<h3>{t('report.byEmployee')}</h3>
			<button
				class="collapse-btn"
				onclick={() => toggleSection('byEmployee')}
				title={sectionCollapsed.byEmployee ? t('report.section.expand') : t('report.section.collapse')}
				aria-expanded={!sectionCollapsed.byEmployee}
			>
				<svg class="collapse-icon" class:rotated={sectionCollapsed.byEmployee} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
			</button>
		</div>
		{#if !sectionCollapsed.byEmployee}
			{#if report.byEmployee.length === 0}
				<p class="empty-state">{t('report.byEmployee.empty')}</p>
			{:else}
				{@const maxHours = Math.max(
					1,
					...report.byEmployee.map((e) => e.totalHours)
				)}
				<div class="emp-list">
					{#each report.byEmployee as emp (emp.employeeId)}
						{@const isExpanded = expandedEmployees.has(emp.employeeId)}
						{@const hasCats = emp.byCategory && emp.byCategory.length > 0}
						<div class="emp-row" class:emp-row-expanded={isExpanded}>
							<div class="emp-row-main">
								<div class="avatar">
									{#if emp.userImage}
										<img src={emp.userImage} alt={emp.userName} />
									{:else}
										<div class="avatar-placeholder">
											{emp.userName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
										</div>
									{/if}
								</div>
								<div class="emp-main">
									<div class="emp-head">
										<span class="emp-name">{emp.userName}</span>
										<span class="emp-hours">
											{emp.totalHours.toFixed(1)} {t('report.byEmployee.hours')}
										</span>
									</div>
									<div class="emp-bar">
										<div
											class="emp-bar-fill"
											style="width: {(emp.totalHours / maxHours) * 100}%"
										></div>
									</div>
									<div class="emp-meta">
										<span>
											{emp.entryCount} {t('report.byEmployee.entries')}
										</span>
										<span>·</span>
										<span>
											{t('report.byEmployee.lastEntry')}:
											{emp.lastEntryDate
												? new Date(emp.lastEntryDate).toLocaleDateString()
												: t('report.byEmployee.never')}
										</span>
									</div>
								</div>
								{#if hasCats}
									<button
										class="emp-expand-btn"
										class:emp-expand-btn-open={isExpanded}
										onclick={() => toggleEmployeeExpand(emp.employeeId)}
										title={isExpanded ? 'Kategóriák elrejtése' : 'Kategóriák megjelenítése'}
										aria-expanded={isExpanded}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
									</button>
								{/if}
							</div>
							{#if isExpanded && hasCats}
								{@const empCatMax = Math.max(1, ...emp.byCategory.map((c) => c.totalHours))}
								<div class="emp-cat-breakdown">
									{#each emp.byCategory as cat (cat.categoryId ?? 'none')}
										<div class="emp-cat-row">
											<div class="emp-cat-info">
												<span class="emp-cat-dot"></span>
												<span class="emp-cat-name" title={cat.categoryName}>{cat.categoryName}</span>
											</div>
											<div class="emp-cat-bar-wrap">
												<div
													class="emp-cat-bar-fill"
													style="width: {Math.round((cat.totalHours / empCatMax) * 100)}%"
												></div>
											</div>
											<div class="emp-cat-stats">
												<span class="emp-cat-hours">{cat.totalHours.toFixed(1)} {t('work.columns.hours').toLowerCase()}</span>
												<span class="emp-cat-entries">{cat.entryCount} {t('report.byEmployee.entries')}</span>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Kategóriánkénti bontás -->
	<div class="report-section">
		<div class="section-collapse-header">
			<h3>{t('report.byCategory')}</h3>
			<button
				class="collapse-btn"
				onclick={() => toggleSection('byCategory')}
				title={sectionCollapsed.byCategory ? t('report.section.expand') : t('report.section.collapse')}
				aria-expanded={!sectionCollapsed.byCategory}
			>
				<svg class="collapse-icon" class:rotated={sectionCollapsed.byCategory} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
			</button>
		</div>
		{#if !sectionCollapsed.byCategory}
			{#if !report.byCategory || report.byCategory.length === 0}
				<p class="empty-state">{t('report.daily.empty')}</p>
			{:else}
				<div class="cat-list">
					{#each report.byCategory as cat (cat.categoryId ?? 'none')}
						<div class="cat-row">
							<div class="cat-info">
								<span class="cat-name">{cat.categoryName}</span>
								<span class="cat-meta">
									{cat.entryCount} {t('report.byEmployee.entries')} ·
									{cat.totalHours.toFixed(1)} {t('work.columns.hours').toLowerCase()}
								</span>
							</div>
							<div class="cat-bar-wrap">
								<div
									class="cat-bar-fill"
									style="width: {Math.round((cat.totalHours / reportCatMax) * 100)}%"
								></div>
							</div>
							<span class="cat-hours">
								{cat.totalHours.toFixed(1)} {t('work.columns.hours').toLowerCase()}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Utolsó 30 nap napi bontás (lezárt projektnél csak szűrt időszakra) -->
	{#if !project.closedAt || reportFrom || reportTo}
	<div class="report-section">
		<h3>
			{#if reportFrom || reportTo}
				{t('report.daily.title.filtered')}
			{:else}
				{t('report.daily.title')}
			{/if}
		</h3>
		{#if report.daily.length === 0}
			<p class="empty-state">{t('report.daily.empty')}</p>
		{:else}
			{@const dailyMax = Math.max(1, ...report.daily.map((d) => d.hours))}
			<div class="daily-chart">
				{#each report.daily as d (d.date)}
					<div class="daily-bar" title="{d.date}: {d.hours.toFixed(1)} {t('work.columns.hours').toLowerCase()}">
						<div
							class="daily-bar-fill"
							style="height: {(d.hours / dailyMax) * 100}%"
						></div>
					</div>
				{/each}
			</div>
			<div class="daily-range">
				<span>{new Date(report.daily[0].date).toLocaleDateString()}</span>
				<span>
					{new Date(
						report.daily[report.daily.length - 1].date
					).toLocaleDateString()}
				</span>
			</div>
		{/if}
	</div>
	{/if}

	<!-- Teljes időszak: az első és az utolsó bejegyzés között, a szűrőtől függetlenül -->
	<div class="report-section">
		<h3>{t('report.lifetime.title')}</h3>
		{#if report.lifetime.points.length === 0}
			<p class="empty-state">{t('report.lifetime.empty')}</p>
		{:else}
			{@const lifetimeMax = Math.max(1, ...report.lifetime.points.map((d) => d.hours))}
			{#if report.lifetime.bucketDays > 1}
				<p class="chart-hint">
					{t('report.lifetime.bucketHint', { days: report.lifetime.bucketDays })}
				</p>
			{/if}
			<div class="daily-chart">
				{#each report.lifetime.points as d (d.date)}
					<div
						class="daily-bar"
						title="{d.date === d.to ? d.date : `${d.date} – ${d.to}`}: {d.hours.toFixed(1)} {t('work.columns.hours').toLowerCase()}"
					>
						<div
							class="daily-bar-fill"
							style="height: {(d.hours / lifetimeMax) * 100}%"
						></div>
					</div>
				{/each}
			</div>
			<div class="daily-range">
				<span>{new Date(report.lifetime.points[0].date).toLocaleDateString()}</span>
				<span>
					{new Date(
						report.lifetime.points[report.lifetime.points.length - 1].to
					).toLocaleDateString()}
				</span>
			</div>
		{/if}
	</div>

	<!-- Inaktív tagok -->
	{#if report.inactiveMembers.length > 0}
		<div class="report-section">
			<div class="section-collapse-header">
				<div>
					<h3>{t('report.inactive.title')}</h3>
					{#if !sectionCollapsed.inactive}
						<p class="perm-hint">{t('report.inactive.description')}</p>
					{/if}
				</div>
				<button
					class="collapse-btn"
					onclick={() => toggleSection('inactive')}
					title={sectionCollapsed.inactive ? t('report.section.expand') : t('report.section.collapse')}
					aria-expanded={!sectionCollapsed.inactive}
				>
					<svg class="collapse-icon" class:rotated={sectionCollapsed.inactive} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
				</button>
			</div>
			{#if !sectionCollapsed.inactive}
				<div class="inactive-list">
					{#each report.inactiveMembers as emp (emp.employeeId)}
						<div class="inactive-row">
							<div class="avatar">
								{#if emp.userImage}
									<img src={emp.userImage} alt={emp.userName} />
								{:else}
									<div class="avatar-placeholder">
										{emp.userName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
									</div>
								{/if}
							</div>
							<div class="inactive-info">
								<span class="emp-name">{emp.userName}</span>
								<span class="emp-meta-sub">
									{emp.lastEntryDate
										? `${t('report.byEmployee.lastEntry')}: ${new Date(emp.lastEntryDate).toLocaleDateString()}`
										: t('report.byEmployee.never')}
								</span>
							</div>
							<span class="tag tag-warn">{t('report.byEmployee.inactive')}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Legutóbbi bejegyzések -->
	<div class="report-section">
		<div class="section-collapse-header">
			<h3>{t('report.recent.title')}</h3>
			<button
				class="collapse-btn"
				onclick={() => toggleSection('recent')}
				title={sectionCollapsed.recent ? t('report.section.expand') : t('report.section.collapse')}
				aria-expanded={!sectionCollapsed.recent}
			>
				<svg class="collapse-icon" class:rotated={sectionCollapsed.recent} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
			</button>
		</div>
		{#if !sectionCollapsed.recent}
			{#if report.recentEntries.length === 0}
				<p class="empty-state">{t('report.recent.empty')}</p>
			{:else}
				<div class="entries-list">
					{#each report.recentEntries as entry (entry.id)}
						<div class="entry-row">
							<div class="entry-date">
								{new Date(entry.workDate).toLocaleDateString()}
							</div>
							<div class="entry-main">
								<div class="entry-title">{entry.title}</div>
								{#if entry.description}
									<div class="entry-desc">{entry.description}</div>
								{/if}
								<div class="entry-meta">👤 {entry.employeeName}</div>
							</div>
							<div class="entry-hours">{entry.hours.toFixed(2)} {t('work.columns.hours').toLowerCase()}</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	/* ---------- Intervallum szűrő ---------- */
	.date-filter-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: nowrap;
		padding: 0.5rem 0.75rem;
		background: var(--color-muted, #f8fafc);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		overflow-x: auto;
	}

	.date-filter-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		font-weight: 500;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.input-sm {
		padding: 0.25rem 0.5rem;
		font-size: 0.8rem;
		height: auto;
	}

	.btn-ghost-sm {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		color: var(--color-muted-foreground, #64748b);
		padding: 0.25rem 0.625rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.75rem;
		margin-left: auto;
		white-space: nowrap;
		flex-shrink: 0;
		transition: background 0.15s, color 0.15s;
	}

	.btn-ghost-sm:hover {
		background: var(--color-accent, #f1f5f9);
		color: var(--color-foreground, #0f172a);
	}

	:global(.dark) .date-filter-bar {
		background: oklch(0.18 0 0);
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .btn-ghost-sm:hover {
		background: var(--color-accent, oklch(0.269 0 0));
		color: oklch(0.985 0 0);
	}

	/* ---------- Permissions fül ---------- */
	.perm-hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0.25rem 0 0;
		max-width: 520px;
	}

	.entries-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.entry-row {
		display: grid;
		grid-template-columns: 100px 1fr auto auto;
		gap: 0.75rem;
		align-items: start;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
	}

	.entry-date {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
	}

	.entry-main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.entry-title {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.entry-desc {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.entry-meta {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.entry-hours {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-primary, #3730a3);
		white-space: nowrap;
		align-self: center;
	}

	:global(.dark) .entry-row {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	/* ---------- Riport fül ---------- */
	.kpi-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.kpi-block-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.kpi-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
	}

	.kpi {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.625rem;
		background: var(--color-card, #ffffff);
	}

	.kpi-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground, #64748b);
		font-weight: 600;
	}

	.kpi-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-foreground, #0f172a);
	}

	.kpi-value.small {
		font-size: 1rem;
	}

	.report-section {
		padding: 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.625rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.report-section h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.section-collapse-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.section-collapse-header > div {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.collapse-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		background: transparent;
		color: var(--color-muted-foreground, #64748b);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
		margin-top: 0.05rem;
	}

	.collapse-btn:hover {
		background: var(--color-accent, #f1f5f9);
		color: var(--color-foreground, #0f172a);
	}

	.collapse-icon {
		transition: transform 0.2s ease;
	}

	.collapse-icon.rotated {
		transform: rotate(180deg);
	}

	:global(.dark) .collapse-btn:hover {
		background: var(--color-accent, oklch(0.269 0 0));
		color: oklch(0.985 0 0);
	}

	.tag {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.tag-danger {
		background: #fee2e2;
		color: #991b1b;
	}

	.tag-warn {
		background: #fef3c7;
		color: #92400e;
	}

	.timeline {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.timeline-info {
		display: flex;
		gap: 1.5rem;
		font-size: 0.85rem;
		color: var(--color-foreground, #0f172a);
	}

	.timeline-info .t-label {
		color: var(--color-muted-foreground, #64748b);
		margin-right: 0.25rem;
	}

	.t-warn {
		color: #d97706;
	}

	.t-danger {
		color: #dc2626;
	}

	.progress-bar {
		width: 100%;
		height: 8px;
		background: var(--color-muted, #f1f5f9);
		border-radius: 999px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #3730a3, #6366f1);
		transition: width 0.3s;
	}

	.progress-fill.progress-danger {
		background: linear-gradient(90deg, #dc2626, #f97316);
	}

	.progress-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		text-align: right;
	}

	.emp-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	/* Kategóriánkénti bontás */
	.cat-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.cat-row {
		display: grid;
		grid-template-columns: 1fr 120px 4rem;
		gap: 0.75rem;
		align-items: center;
	}

	.cat-info {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.cat-name {
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cat-meta {
		font-size: 0.72rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.cat-bar-wrap {
		width: 100%;
		height: 8px;
		background: var(--color-muted, #f1f5f9);
		border-radius: 999px;
		overflow: hidden;
	}

	.cat-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #0f766e, #14b8a6);
		border-radius: 999px;
		transition: width 0.3s;
	}

	.cat-hours {
		font-size: 0.8rem;
		font-weight: 600;
		color: #0f766e;
		text-align: right;
		white-space: nowrap;
	}

	:global(.dark) .cat-bar-wrap {
		background: oklch(0.3 0 0);
	}

	:global(.dark) .cat-hours {
		color: #2dd4bf;
	}

	.emp-row {
		display: flex;
		flex-direction: column;
		gap: 0;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.625rem;
		overflow: hidden;
		transition: border-color 0.15s;
	}

	.emp-row:hover {
		border-color: var(--color-primary, #3730a3);
	}

	.emp-row-expanded {
		border-color: var(--color-primary, #3730a3);
	}

	.emp-row-main {
		display: grid;
		grid-template-columns: 2.25rem 1fr auto;
		gap: 0.625rem;
		align-items: center;
		padding: 0.75rem;
	}

	.emp-main {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.emp-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: baseline;
	}

	.emp-name {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.emp-hours {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-primary, #3730a3);
	}

	.emp-bar {
		width: 100%;
		height: 6px;
		background: var(--color-muted, #f1f5f9);
		border-radius: 999px;
		overflow: hidden;
	}

	.emp-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #3730a3, #6366f1);
		transition: width 0.3s;
	}

	.emp-meta {
		font-size: 0.72rem;
		color: var(--color-muted-foreground, #64748b);
		display: flex;
		gap: 0.35rem;
	}

	.emp-expand-btn {
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border, #e2e8f0);
		background: transparent;
		color: var(--color-muted-foreground, #64748b);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
	}

	.emp-expand-btn:hover {
		background: var(--color-accent, #f1f5f9);
		color: var(--color-foreground, #0f172a);
		border-color: var(--color-primary, #3730a3);
	}

	.emp-expand-btn svg {
		transition: transform 0.2s ease;
	}

	.emp-expand-btn-open svg {
		transform: rotate(180deg);
	}

	.emp-cat-breakdown {
		border-top: 1px solid var(--color-border, #e2e8f0);
		background: var(--color-accent, #f8fafc);
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.emp-cat-row {
		display: grid;
		grid-template-columns: minmax(10rem, 18rem) 1fr 7rem;
		gap: 0.75rem;
		align-items: center;
		padding: 0.25rem 0.375rem;
		border-radius: 0.375rem;
		transition: background 0.15s ease;
	}

	.emp-cat-row:hover {
		background: rgba(99, 102, 241, 0.07);
	}

	.emp-cat-info {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.emp-cat-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-primary, #3730a3);
		flex-shrink: 0;
		opacity: 0.6;
	}

	.emp-cat-name {
		font-size: 0.78rem;
		color: var(--color-foreground, #0f172a);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.emp-cat-bar-wrap {
		width: 100%;
		height: 5px;
		background: var(--color-border, #e2e8f0);
		border-radius: 999px;
		overflow: hidden;
	}

	.emp-cat-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #6366f1, #a5b4fc);
		border-radius: 999px;
		transition: width 0.3s;
	}

	.emp-cat-stats {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
	}

	.emp-cat-hours {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-primary, #3730a3);
		white-space: nowrap;
	}

	.emp-cat-entries {
		font-size: 0.68rem;
		color: var(--color-muted-foreground, #94a3b8);
		white-space: nowrap;
	}

	:global(.dark) .emp-row {
		border-color: oklch(1 0 0 / 10%);
	}

	:global(.dark) .emp-row:hover,
	:global(.dark) .emp-row-expanded {
		border-color: oklch(0.66 0.12 264);
	}

	:global(.dark) .emp-expand-btn {
		border-color: oklch(1 0 0 / 10%);
		color: oklch(0.708 0 0);
	}

	:global(.dark) .emp-expand-btn:hover {
		background: oklch(0.269 0 0);
		color: oklch(0.985 0 0);
		border-color: oklch(0.66 0.12 264);
	}

	:global(.dark) .emp-cat-breakdown {
		background: oklch(0.18 0 0);
		border-top-color: oklch(1 0 0 / 8%);
	}

	:global(.dark) .emp-cat-row:hover {
		background: rgba(99, 102, 241, 0.12);
	}

	:global(.dark) .emp-cat-name {
		color: oklch(0.85 0 0);
	}

	:global(.dark) .emp-cat-bar-wrap {
		background: oklch(0.3 0 0);
	}

	:global(.dark) .emp-cat-hours {
		color: oklch(0.75 0.12 264);
	}

	.chart-hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0;
	}

	.daily-chart {
		display: flex;
		gap: 2px;
		align-items: flex-end;
		height: 120px;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.daily-bar {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
		cursor: help;
	}

	.daily-bar-fill {
		width: 100%;
		min-height: 2px;
		background: var(--color-primary, #3730a3);
		border-radius: 2px 2px 0 0;
		opacity: 0.8;
		transition: opacity 0.15s;
	}

	.daily-bar:hover .daily-bar-fill {
		opacity: 1;
	}

	.daily-range {
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #94a3b8);
		margin-top: 0.25rem;
	}

	.inactive-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.inactive-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: #fffbeb;
	}

	.inactive-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.emp-meta-sub {
		font-size: 0.72rem;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .kpi,
	:global(.dark) .report-section {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .kpi-value {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .progress-bar,
	:global(.dark) .emp-bar {
		background: oklch(0.3 0 0);
	}

	:global(.dark) .inactive-row {
		background: rgba(202, 138, 4, 0.12);
		border-color: rgba(202, 138, 4, 0.3);
	}

	:global(.dark) .tag-danger {
		background: rgba(220, 38, 38, 0.2);
		color: #fca5a5;
	}

	:global(.dark) .tag-warn {
		background: rgba(202, 138, 4, 0.2);
		color: #fde68a;
	}
</style>
