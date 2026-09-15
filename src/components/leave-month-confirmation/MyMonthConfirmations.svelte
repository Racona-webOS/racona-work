<!--
	Havi szabadság-ellenőrzés a dolgozó irányítópultján (specs/leave-month-confirmation.md, K5–K6).

	Hónaponként egy kártya a HR által kiküldött összesítővel: a szakaszok, az
	összesen, a függő kérelmek és a HR megjegyzése. A dolgozó elfogadja, vagy
	tételesen eltérést jelez (nem volt szabadságon, más a típusa, hiányzó nap,
	megjegyzés). Ha a HR a kiküldés óta módosított, nincs gomb: frissített
	összesítő jön. Ha nincs nyitott tétel, semmit nem jelenít meg.
-->
<script lang="ts">
	import type { DisputeItem, MonthConfirmation } from '../../../server/functions.js';
	import { LEAVE_TYPES, isLeaveType } from '../../../server/leave-types.js';
	import type { LeaveType } from '../../../server/leave-types.js';
	import { summarizeSnapshot } from '../../../server/leave-month-confirmation-utils.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		organizationId,
		refreshKey = 0
	}: {
		pluginId?: string;
		organizationId: number;
		refreshKey?: number;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let items = $state<MonthConfirmation[]>([]);

	async function load() {
		try {
			items = await sdk.remote.call('getMyMonthConfirmations', { organizationId });
		} catch {
			items = [];
		}
	}

	$effect(() => {
		organizationId;
		refreshKey;
		if (sdk?.remote && organizationId) load();
	});

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	function periodOf(conf: MonthConfirmation): string {
		const name = t(`workCalendar.month.${conf.month - 1}`);
		return t('leaveSummary.period.month', { year: conf.year, month: name, monthLower: name.toLocaleLowerCase('hu') });
	}

	function formatDate(value: string | null): string {
		return value ? new Date(value).toLocaleDateString() : '—';
	}

	function formatDay(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			weekday: 'short'
		});
	}

	function formatRange(start: string, end: string): string {
		return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
	}

	function typeLabel(type: string | undefined): string {
		if (!type) return '—';
		return (LEAVE_TYPES as readonly string[]).includes(type) ? t(`leaveRequests.type.${type}`) : type;
	}

	// --- Válasz --------------------------------------------------------------

	let busyId = $state<number | null>(null);

	async function accept(conf: MonthConfirmation) {
		if (busyId !== null) return;
		busyId = conf.id;
		try {
			await sdk.remote.call('respondMonthConfirmation', { id: conf.id, decision: 'accept' });
			sdk?.ui?.toast(t('monthConfirmation.my.accepted', { period: periodOf(conf) }), 'success');
			await load();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
			await load();
		} finally {
			busyId = null;
		}
	}

	// --- Eltérés-űrlap (K6) --------------------------------------------------

	type DayChoice = 'ok' | 'not_on_leave' | 'wrong_type';

	let formId = $state<number | null>(null);
	/** Rögzített nap → választás és a helyes típus. */
	let choices = $state<Record<string, { choice: DayChoice; leaveType: LeaveType }>>({});
	let missing = $state<{ day: string; leaveType: LeaveType }[]>([]);
	let newMissingDay = $state('');
	let newMissingType = $state<LeaveType>('annual');
	let note = $state('');

	function openForm(conf: MonthConfirmation) {
		formId = conf.id;
		choices = Object.fromEntries(
			conf.snapshot.days.map((d) => [
				d.day,
				{ choice: 'ok' as DayChoice, leaveType: (d.leaveType === 'sick' ? 'annual' : 'sick') as LeaveType }
			])
		);
		missing = [];
		newMissingDay = '';
		newMissingType = 'annual';
		note = '';
	}

	function closeForm() {
		formId = null;
	}

	/** A hónap rögzítetlen munkanapjai, amik még nincsenek a hiányzók között. */
	function freeWorkingDays(conf: MonthConfirmation): string[] {
		const taken = new Set([...conf.snapshot.days.map((d) => d.day), ...missing.map((m) => m.day)]);
		return conf.snapshot.workingDays.filter((d) => !taken.has(d));
	}

	function addMissing() {
		if (!newMissingDay) return;
		missing = [...missing, { day: newMissingDay, leaveType: newMissingType }].sort((a, b) =>
			a.day.localeCompare(b.day)
		);
		newMissingDay = '';
	}

	function removeMissing(day: string) {
		missing = missing.filter((m) => m.day !== day);
	}

	function buildItems(conf: MonthConfirmation): DisputeItem[] {
		const result: DisputeItem[] = [];
		for (const d of conf.snapshot.days) {
			const c = choices[d.day];
			if (!c || c.choice === 'ok') continue;
			if (c.choice === 'not_on_leave') result.push({ kind: 'not_on_leave', day: d.day });
			else result.push({ kind: 'wrong_type', day: d.day, leaveType: c.leaveType });
		}
		for (const m of missing) result.push({ kind: 'missing', day: m.day, leaveType: m.leaveType });
		return result;
	}

	async function submitDispute(conf: MonthConfirmation) {
		if (busyId !== null) return;
		const disputeItems = buildItems(conf);
		if (disputeItems.length === 0 && !note.trim()) {
			sdk?.ui?.toast(t('monthConfirmation.form.empty'), 'warning');
			return;
		}
		busyId = conf.id;
		try {
			await sdk.remote.call('respondMonthConfirmation', {
				id: conf.id,
				decision: 'dispute',
				items: disputeItems,
				note: note.trim() || null
			});
			sdk?.ui?.toast(t('monthConfirmation.my.disputeSent'), 'success');
			formId = null;
			await load();
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			busyId = null;
		}
	}

	function disputeLine(conf: MonthConfirmation, item: DisputeItem): string {
		return t(`monthConfirmation.item.${item.kind}`, {
			day: formatDay(item.day),
			type: typeLabel(conf.snapshot.days.find((d) => d.day === item.day)?.leaveType),
			correct: typeLabel(item.leaveType)
		});
	}
</script>

{#each items as conf (conf.id)}
	{@const summary = summarizeSnapshot(conf.snapshot)}
	<div class="mmc" class:is-disputed={conf.status === 'disputed'}>
		<div class="mmc-head">
			<h3>{t('monthConfirmation.my.title', { period: periodOf(conf) })}</h3>
			<p class="meta">
				{t('monthConfirmation.my.subtitle')}
				{t('monthConfirmation.my.sentBy', { name: conf.sentByName ?? 'HR', date: formatDate(conf.sentAt) })}
			</p>
		</div>

		{#if conf.hrNote}
			<p class="note-block"><strong>{t('monthConfirmation.my.hrNote')}:</strong> {conf.hrNote}</p>
		{/if}

		{#if summary.dayCount === 0}
			<p class="empty">{t('monthConfirmation.my.noLeave')}</p>
		{:else}
			<ul class="periods">
				{#each summary.periods as p (p.startDate + p.leaveType)}
					<li>
						<span class="range">{formatRange(p.startDate, p.endDate)}</span>
						<span class="chip type-{isLeaveType(p.leaveType) ? p.leaveType : 'unknown'}">{typeLabel(p.leaveType)}</span>
						<span class="days">{t('monthConfirmation.my.days', { days: p.days })}</span>
					</li>
				{/each}
			</ul>
			<p class="total">
				{t('monthConfirmation.my.total', { days: summary.dayCount })}:
				{summary.byType.map((b) => `${typeLabel(b.leaveType)} ${b.days}`).join(', ')}
			</p>
		{/if}

		{#if summary.pendingDayCount > 0}
			<p class="meta">{t('monthConfirmation.my.pending', { days: summary.pendingDayCount })}</p>
		{/if}

		{#if conf.status === 'disputed'}
			<div class="disputed">
				<p>{t('monthConfirmation.my.disputed', { date: formatDate(conf.respondedAt) })}</p>
				{#if conf.disputeItems.length > 0}
					<ul>
						{#each conf.disputeItems as item (item.day)}
							<li>{disputeLine(conf, item)}</li>
						{/each}
					</ul>
				{/if}
				{#if conf.employeeNote}
					<p class="meta">{t('monthConfirmation.my.yourNote')}: „{conf.employeeNote}”</p>
				{/if}
			</div>
		{:else if conf.stale}
			<p class="stale">{t('monthConfirmation.my.stale')}</p>
		{:else if formId === conf.id}
			<div class="form">
				<h4>{t('monthConfirmation.form.title')}</h4>

				{#if conf.snapshot.days.length > 0}
					<span class="label">{t('monthConfirmation.form.recorded')}</span>
					<ul class="day-rows">
						{#each conf.snapshot.days as d (d.day)}
							{@const c = choices[d.day]}
							<li class:is-marked={c && c.choice !== 'ok'}>
								<span class="range">{formatDay(d.day)}</span>
								<span class="type">{typeLabel(d.leaveType)}</span>
								{#if c}
									<select class="select" bind:value={c.choice} aria-label={formatDay(d.day)}>
										<option value="ok">{t('monthConfirmation.form.ok')}</option>
										<option value="not_on_leave">{t('monthConfirmation.form.notOnLeave')}</option>
										<option value="wrong_type">{t('monthConfirmation.form.wrongType')}</option>
									</select>
									{#if c.choice === 'wrong_type'}
										<select class="select" bind:value={c.leaveType} aria-label={t('monthConfirmation.form.wrongType')}>
											{#each LEAVE_TYPES.filter((type) => type !== d.leaveType) as type (type)}
												<option value={type}>{typeLabel(type)}</option>
											{/each}
										</select>
									{/if}
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<span class="label">{t('monthConfirmation.form.missing')}</span>
				<p class="meta">{t('monthConfirmation.form.missingHint')}</p>
				{#if missing.length > 0}
					<ul class="day-rows">
						{#each missing as m (m.day)}
							<li class="is-marked">
								<span class="range">{formatDay(m.day)}</span>
								<span class="type">{typeLabel(m.leaveType)}</span>
								<button class="link-btn" onclick={() => removeMissing(m.day)}>{t('monthConfirmation.form.remove')}</button>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="add-row">
					<select class="select" bind:value={newMissingDay} aria-label={t('monthConfirmation.form.missing')}>
						<option value="">{t('monthConfirmation.form.selectDay')}</option>
						{#each freeWorkingDays(conf) as day (day)}
							<option value={day}>{formatDay(day)}</option>
						{/each}
					</select>
					<select class="select" bind:value={newMissingType} aria-label={t('leaveCalendar.addType')}>
						{#each LEAVE_TYPES as type (type)}
							<option value={type}>{typeLabel(type)}</option>
						{/each}
					</select>
					<button class="btn-secondary btn-sm" onclick={addMissing} disabled={!newMissingDay}>
						{t('monthConfirmation.form.add')}
					</button>
				</div>

				<textarea
					class="textarea"
					rows="2"
					maxlength="1000"
					bind:value={note}
					placeholder={t('monthConfirmation.form.note')}
					aria-label={t('monthConfirmation.form.note')}
				></textarea>

				<div class="actions">
					<button class="btn-secondary btn-sm" onclick={closeForm} disabled={busyId !== null}>
						{t('monthConfirmation.form.cancel')}
					</button>
					<button class="btn-primary btn-sm" onclick={() => submitDispute(conf)} disabled={busyId !== null}>
						{busyId === conf.id ? t('loading') : t('monthConfirmation.form.submit')}
					</button>
				</div>
			</div>
		{:else}
			<div class="actions">
				<button class="btn-secondary" onclick={() => openForm(conf)} disabled={busyId !== null}>
					{t('monthConfirmation.my.dispute')}
				</button>
				<button class="btn-primary" onclick={() => accept(conf)} disabled={busyId !== null}>
					{busyId === conf.id ? t('loading') : t('monthConfirmation.my.accept')}
				</button>
			</div>
		{/if}
	</div>
{/each}

<style>
	@import '../../styles/shared.css';

	.mmc {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-top: 5px solid #3b82f6;
		border-radius: 0.75rem;
		background: var(--color-card, #ffffff);
	}

	.mmc.is-disputed {
		border-top-color: #f97316;
	}

	h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	h4 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.meta {
		margin: 0.1rem 0 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.note-block,
	.empty,
	.total,
	.stale {
		margin: 0;
		font-size: 0.85rem;
	}

	.stale {
		color: #1e40af;
	}

	.periods,
	.day-rows,
	.disputed ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.periods li,
	.day-rows li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.day-rows li {
		padding: 0.3rem 0.5rem;
		border-radius: 0.375rem;
		background: var(--color-accent, #f8fafc);
	}

	.day-rows li.is-marked {
		background: #fff7ed;
	}

	.range {
		min-width: 9rem;
		font-weight: 500;
	}

	.type {
		min-width: 9rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.days {
		color: var(--color-muted-foreground, #64748b);
	}

	.chip.type-annual {
		background: #dbeafe;
		color: #1e40af;
	}

	.chip.type-company_mandatory {
		background: #e0e7ff;
		color: #3730a3;
	}

	.chip.type-sick {
		background: #fee2e2;
		color: #991b1b;
	}

	.chip.type-paternity,
	.chip.type-parental {
		background: #dcfce7;
		color: #166534;
	}

	.chip.type-unpaid,
	.chip.type-other,
	.chip.type-unknown {
		background: #f1f5f9;
		color: #334155;
	}

	.disputed {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.6rem 0.8rem;
		border-radius: 0.5rem;
		background: #fff7ed;
		font-size: 0.85rem;
	}

	.disputed p {
		margin: 0;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.75rem 0.9rem;
		border-radius: 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
	}

	.label {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted-foreground, #64748b);
	}

	.select {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.8rem;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
	}

	.add-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.link-btn {
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		font-size: 0.8rem;
		color: #dc2626;
		margin-left: auto;
	}

	:global(.dark) .mmc {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		border-top-color: #3b82f6;
	}

	:global(.dark) .mmc.is-disputed {
		border-top-color: #f97316;
	}

	:global(.dark) .day-rows li.is-marked,
	:global(.dark) .disputed {
		background: rgba(249, 115, 22, 0.12);
	}
</style>
