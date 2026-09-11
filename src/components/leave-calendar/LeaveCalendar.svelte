<!--
	Szabadságnaptár — havi rács, amiben napokra látszik, ki van szabadságon.

	Szűrő nélkül minden cellában a távol lévők neve; kiválasztott dolgozóval
	csak az ő napjai, típusonként színezve (a típust csak a leave.approve jog
	mutatja). A függő kérelmek halványan jelennek meg. Csak olvasásra; a
	szerkesztés a 3. fázis (specs/leave-days.md).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		EmployeeRow,
		LeaveCalendar,
		LeaveCalendarDay,
		LeaveCalendarPendingDay,
		PaginatedResult
	} from '../../../server/functions.js';
	import { LEAVE_TYPES } from '../../../server/leave-types.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { isWeekend, monthGrid, monthRange } from '../../lib/calendar-grid.js';

	let {
		pluginId = 'racona-work',
		organizationId,
		canManage = false,
		employeeId = null,
		lockEmployee = false,
		refreshKey = 0
	}: {
		pluginId?: string;
		organizationId: number;
		/** leave.approve: a típus látszik (a szerver dönt, ez csak a felirat). */
		canManage?: boolean;
		/** Rögzített dolgozószűrő (saját nézet). */
		employeeId?: number | null;
		/** Igaz, ha a dolgozószűrő nem váltható (saját nézet). */
		lockEmployee?: boolean;
		/** Növelve újratölt (kérelem jóváhagyása, törlése után). */
		refreshKey?: number;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	// --- Állapot -------------------------------------------------------------

	const now = new Date();
	let year = $state(now.getFullYear());
	let month = $state(now.getMonth());
	let data = $state<LeaveCalendar | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	let employees = $state<EmployeeRow[]>([]);
	let selectedEmployeeId = $state<number | null>(null);

	/** A tényleges szűrő: rögzítve a saját dolgozó, egyébként a választott. */
	const filterEmployeeId = $derived(lockEmployee ? employeeId : selectedEmployeeId);

	const today = $derived(
		`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
	);

	const cells = $derived(monthGrid(year, month));

	/** Nap → jóváhagyott napok. */
	const dayMap = $derived.by(() => {
		const map = new Map<string, LeaveCalendarDay[]>();
		for (const d of data?.days ?? []) {
			if (!map.has(d.day)) map.set(d.day, []);
			map.get(d.day)!.push(d);
		}
		return map;
	});

	/** Nap → függő napok. */
	const pendingMap = $derived.by(() => {
		const map = new Map<string, LeaveCalendarPendingDay[]>();
		for (const d of data?.pending ?? []) {
			if (!map.has(d.day)) map.set(d.day, []);
			map.get(d.day)!.push(d);
		}
		return map;
	});

	/** A munkanaptár kivételei: nap → munkanap-e. */
	const overrides = $derived(new Map((data?.calendar ?? []).map((c) => [c.day, c.isWorkingDay])));

	function isWorkingDay(iso: string): boolean {
		const override = overrides.get(iso);
		if (override !== undefined) return override;
		return !isWeekend(iso);
	}

	const hasAnyLeave = $derived((data?.days.length ?? 0) + (data?.pending.length ?? 0) > 0);

	// --- Adatok --------------------------------------------------------------

	async function loadCalendar() {
		if (!sdk?.remote || !organizationId) return;
		loading = true;
		error = null;
		const range = monthRange(year, month);
		try {
			data = await sdk.remote.call('getLeaveCalendar', {
				organizationId,
				from: range.from,
				to: range.to,
				employeeId: filterEmployeeId ?? undefined
			});
		} catch (err: any) {
			error = err?.message ?? t('error.loadFailed');
			data = null;
		} finally {
			loading = false;
		}
	}

	async function loadEmployees() {
		if (!sdk?.remote || !organizationId || lockEmployee) return;
		try {
			const result: PaginatedResult<EmployeeRow> = await sdk.remote.call('getEmployees', {
				organizationId,
				pageSize: 200,
				status: 'active',
				sortBy: 'userName'
			});
			employees = result?.data ?? [];
		} catch {
			employees = [];
		}
	}

	$effect(() => {
		organizationId;
		lockEmployee;
		untrack(() => loadEmployees());
	});

	$effect(() => {
		organizationId;
		year;
		month;
		filterEmployeeId;
		refreshKey;
		untrack(() => loadCalendar());
	});

	// --- Navigáció -----------------------------------------------------------

	function prevMonth() {
		if (month === 0) {
			month = 11;
			year -= 1;
		} else {
			month -= 1;
		}
	}

	function nextMonth() {
		if (month === 11) {
			month = 0;
			year += 1;
		} else {
			month += 1;
		}
	}

	function goToday() {
		year = now.getFullYear();
		month = now.getMonth();
	}

	// --- Megjelenítés --------------------------------------------------------

	const MAX_NAMES = 3;

	function typeLabel(type: string | null): string {
		if (!type) return t('leaveCalendar.leave');
		return (LEAVE_TYPES as readonly string[]).includes(type) ? t(`leaveRequests.type.${type}`) : type;
	}

	function typeClass(type: string | null): string {
		return type && (LEAVE_TYPES as readonly string[]).includes(type) ? `type-${type}` : 'type-unknown';
	}

	/** A cella tooltipje: mindenki, aki távol van, a típussal (ha látható). */
	function cellTitle(iso: string): string {
		const lines: string[] = [];
		for (const d of dayMap.get(iso) ?? []) {
			lines.push(canManage ? `${d.employeeName} – ${typeLabel(d.leaveType)}` : d.employeeName);
		}
		for (const d of pendingMap.get(iso) ?? []) {
			lines.push(
				`${d.employeeName} – ${canManage ? typeLabel(d.leaveType) + ', ' : ''}${t('leaveCalendar.pending')}`
			);
		}
		return lines.join('\n');
	}
</script>

<div class="leave-calendar">
	<div class="toolbar">
		<div class="month-nav">
			<button class="btn-secondary" onclick={prevMonth} aria-label={t('leaveCalendar.prev')}>‹</button>
			<span class="month-label">{year}. {t(`workCalendar.month.${month}`)}</span>
			<button class="btn-secondary" onclick={nextMonth} aria-label={t('leaveCalendar.next')}>›</button>
			<button class="btn-secondary" onclick={goToday}>{t('leaveCalendar.today')}</button>
		</div>

		{#if !lockEmployee}
			<label class="filter">
				<span>{t('leaveCalendar.filter.label')}</span>
				<select class="form-input" bind:value={selectedEmployeeId}>
					<option value={null}>{t('leaveCalendar.filter.all')}</option>
					{#each employees as emp (emp.id)}
						<option value={emp.id}>{emp.userName}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>

	<div class="legend">
		{#if canManage && filterEmployeeId}
			{#each LEAVE_TYPES as type (type)}
				<span class="chip type-{type}">{t(`leaveRequests.type.${type}`)}</span>
			{/each}
		{:else}
			<span class="chip type-unknown">{t('leaveCalendar.legend.approved')}</span>
		{/if}
		<span class="chip is-pending">{t('leaveCalendar.legend.pending')}</span>
		<span class="chip is-off">{t('leaveCalendar.legend.nonWorking')}</span>
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	<div class="calendar" class:is-loading={loading}>
		<div class="weekdays">
			{#each [0, 1, 2, 3, 4, 5, 6] as wd (wd)}
				<span>{t(`workCalendar.weekdayShort.${wd}`)}</span>
			{/each}
		</div>
		<div class="grid">
			{#each cells as iso, i (i)}
				{#if iso === null}
					<div class="cell empty"></div>
				{:else}
					{@const approved = dayMap.get(iso) ?? []}
					{@const pending = pendingMap.get(iso) ?? []}
					{@const shown = approved.slice(0, MAX_NAMES)}
					{@const extra = approved.length - shown.length}
					<div
						class="cell"
						class:is-off={!isWorkingDay(iso)}
						class:is-today={iso === today}
						title={cellTitle(iso)}
					>
						<span class="day-number">{Number(iso.slice(8, 10))}</span>
						{#if filterEmployeeId}
							{#each approved as d (d.leaveRequestId + ':' + d.day)}
								<span class="mark {typeClass(d.leaveType)}">{typeLabel(d.leaveType)}</span>
							{/each}
							{#each pending as d (d.leaveRequestId + ':' + d.day)}
								<span class="mark is-pending">{t('leaveCalendar.pending')}</span>
							{/each}
						{:else}
							{#each shown as d (d.leaveRequestId + ':' + d.day)}
								<span class="mark {typeClass(d.leaveType)}">{d.employeeName}</span>
							{/each}
							{#if extra > 0}
								<span class="mark more">+{extra}</span>
							{/if}
							{#if pending.length > 0}
								<span class="mark is-pending">
									{pending.length === 1 ? pending[0].employeeName : `${pending.length} ${t('leaveCalendar.pending')}`}
								</span>
							{/if}
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</div>

	{#if !loading && data && !hasAnyLeave}
		<p class="empty-state">{t('leaveCalendar.empty')}</p>
	{/if}
</div>

<style>
	.leave-calendar {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.month-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.month-label {
		font-size: 1.05rem;
		font-weight: 600;
		min-width: 11rem;
		text-align: center;
	}

	.btn-secondary {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		background: var(--color-background, #fff);
		color: inherit;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.btn-secondary:hover {
		border-color: var(--color-primary, #3730a3);
	}

	.filter {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.form-input {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.35rem 2rem 0.35rem 0.75rem;
		font-size: 0.875rem;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
		min-width: 14rem;
		appearance: none;
		-webkit-appearance: none;
		cursor: pointer;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.6rem center;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip {
		font-size: 0.72rem;
		padding: 0.12rem 0.5rem;
		border-radius: 999px;
		border: 1px solid transparent;
	}

	.calendar {
		transition: opacity 0.15s;
	}

	.calendar.is-loading {
		opacity: 0.5;
	}

	.weekdays,
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 3px;
	}

	.weekdays span {
		text-align: center;
		font-size: 0.72rem;
		color: var(--muted-foreground, #71717a);
		padding-bottom: 0.25rem;
	}

	.cell {
		min-height: 5.5rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.3rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 6px;
		background: var(--color-background, #fff);
		font-size: 0.75rem;
		overflow: hidden;
	}

	.cell.empty {
		border-color: transparent;
		background: transparent;
	}

	.cell.is-off {
		background: var(--muted, #f4f4f5);
		color: var(--muted-foreground, #71717a);
	}

	.cell.is-today .day-number {
		background: var(--color-primary, #3730a3);
		color: #fff;
	}

	.day-number {
		align-self: flex-start;
		font-weight: 600;
		font-size: 0.75rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
	}

	.mark {
		display: block;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.7rem;
		line-height: 1.3;
	}

	.mark.more {
		color: var(--muted-foreground, #71717a);
		font-weight: 500;
	}

	.type-annual { background: #dcfce7; color: #166534; }
	.type-sick { background: #fee2e2; color: #991b1b; }
	.type-paternity,
	.type-parental { background: #ede9fe; color: #5b21b6; }
	.type-unpaid { background: #ffedd5; color: #9a3412; }
	.type-other { background: #e4e4e7; color: #3f3f46; }
	.type-unknown { background: #dbeafe; color: #1e40af; }

	.is-pending {
		background: transparent;
		border: 1px dashed var(--muted-foreground, #a1a1aa);
		color: var(--muted-foreground, #71717a);
	}

	.chip.is-off {
		background: var(--muted, #f4f4f5);
		color: var(--muted-foreground, #71717a);
	}

	.empty-state {
		font-size: 0.875rem;
		color: var(--muted-foreground, #71717a);
		margin: 0;
	}

	.error-banner {
		padding: 0.6rem 0.9rem;
		border-radius: 0.375rem;
		background: #fee2e2;
		color: #991b1b;
		font-size: 0.875rem;
	}

	:global(.dark) .cell,
	:global(.dark) .btn-secondary,
	:global(.dark) .form-input {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .cell.is-off {
		background: oklch(1 0 0 / 6%);
	}
</style>
