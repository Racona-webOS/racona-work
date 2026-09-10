<!--
	Dolgozó adatlapja — Szabadság-adatok kártya (csak leave.balance.manage joggal).

	A szabadságkeret számításához szükséges adatok: születési, belépési és
	kilépési dátum, gyerekek, egyéb pótszabadságok. Minden mentés után a szerver
	újraszámolja a nyitott kereteket; a változást itt jelezzük, a keret kártyát
	pedig a szülő tölti újra (onChanged).
-->
<script lang="ts">
	import type {
		EmployeeAbsence,
		EmployeeAbsenceKind,
		EmployeeChild,
		ExtraLeave,
		ExtraLeaveKind,
		LeaveProfile,
		RecalculatedBalance
	} from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import Checkbox from '../ui/Checkbox.svelte';

	let {
		pluginId = 'racona-work',
		employeeId,
		onChanged
	}: {
		pluginId?: string;
		employeeId: number;
		onChanged?: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	const thisYear = new Date().getFullYear();
	const EXTRA_KINDS: ExtraLeaveKind[] = ['health_impaired', 'underground_radiation', 'custom'];
	const ABSENCE_KINDS: EmployeeAbsenceKind[] = [
		'unpaid_leave',
		'childcare_unpaid_leave',
		'unexcused_absence',
		'other'
	];

	let profile = $state<LeaveProfile | null>(null);
	let loading = $state(false);

	function errorText(err: any): string {
		return err?.message?.replace(/^[A-Z_]+:\s*/, '') ?? t('error.saveFailed');
	}

	/** YYYY-MM-DD → helyi dátum, időzóna-csúszás nélkül. */
	function formatDay(day: string | null): string {
		if (!day) return '—';
		const [y, m, d] = day.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString();
	}

	async function load() {
		loading = true;
		try {
			profile = await sdk?.remote?.call('getLeaveProfile', { employeeId });
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (sdk?.remote && employeeId) load();
	});

	/** A mentés utáni újraszámolás eredménye üzenetben, majd a keret kártya frissítése. */
	function afterChange(recalculated: RecalculatedBalance[]) {
		if (recalculated.length > 0) {
			const text = recalculated
				.map((r) => t('leaveEntitlement.recalculated', { year: r.year, from: r.from, to: r.to }))
				.join(' ');
			sdk?.ui?.toast(text, 'info');
		} else {
			sdk?.ui?.toast(t('employeeDetail.saveSuccess'), 'success');
		}
		onChanged?.();
	}

	// --- Dátumok ---
	let editingDates = $state(false);
	let editBirthDate = $state('');
	let editHireDate = $state('');
	let editEndDate = $state('');
	let datesSaving = $state(false);

	function startEditDates() {
		if (!profile) return;
		editBirthDate = profile.birthDate ?? '';
		editHireDate = profile.hireDate ?? '';
		editEndDate = profile.employmentEndDate ?? '';
		editingDates = true;
	}

	async function saveDates() {
		if (!editHireDate) {
			sdk?.ui?.toast(t('leaveEntitlement.profile.hireDateRequired'), 'warning');
			return;
		}
		datesSaving = true;
		try {
			const r: { profile: LeaveProfile; recalculated: RecalculatedBalance[] } = await sdk.remote.call(
				'saveLeaveProfile',
				{
					employeeId,
					birthDate: editBirthDate || null,
					hireDate: editHireDate,
					employmentEndDate: editEndDate || null
				}
			);
			profile = r.profile;
			editingDates = false;
			afterChange(r.recalculated);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			datesSaving = false;
		}
	}

	// --- Gyerekek ---
	type ChildEdit = {
		id?: number;
		label: string;
		birthDate: string;
		isDisabled: boolean;
		paternityEligible: boolean;
	};
	let childEdit = $state<ChildEdit | null>(null);
	let childSaving = $state(false);

	function childCountsThisYear(child: EmployeeChild): 'counts' | 'tooOld' {
		return thisYear - Number(child.birthDate.slice(0, 4)) <= 16 ? 'counts' : 'tooOld';
	}

	async function saveChild() {
		if (!childEdit) return;
		if (!childEdit.birthDate) {
			sdk?.ui?.toast(t('form.required'), 'warning');
			return;
		}
		childSaving = true;
		try {
			const r: { child: EmployeeChild; recalculated: RecalculatedBalance[] } = await sdk.remote.call(
				'saveEmployeeChild',
				{ employeeId, ...childEdit }
			);
			childEdit = null;
			await load();
			afterChange(r.recalculated);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			childSaving = false;
		}
	}

	async function deleteChild(child: EmployeeChild) {
		try {
			const r: { recalculated: RecalculatedBalance[] } = await sdk.remote.call('deleteEmployeeChild', {
				id: child.id
			});
			await load();
			afterChange(r.recalculated);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		}
	}

	// --- Egyéb pótszabadság ---
	type ExtraEdit = {
		id?: number;
		kind: ExtraLeaveKind;
		days: number;
		validFrom: string;
		validTo: string;
		note: string;
	};
	let extraEdit = $state<ExtraEdit | null>(null);
	let extraSaving = $state(false);

	function startAddExtra() {
		extraEdit = { kind: 'health_impaired', days: 5, validFrom: '', validTo: '', note: '' };
	}

	function startEditExtra(extra: ExtraLeave) {
		extraEdit = {
			id: extra.id,
			kind: extra.kind,
			days: extra.days,
			validFrom: extra.validFrom ?? '',
			validTo: extra.validTo ?? '',
			note: extra.note ?? ''
		};
	}

	function extraLabel(extra: ExtraLeave): string {
		return extra.kind === 'custom' && extra.note
			? extra.note
			: t(`leaveEntitlement.extras.kind.${extra.kind}`);
	}

	function validityText(extra: ExtraLeave): string {
		if (!extra.validFrom && !extra.validTo) return t('leaveEntitlement.extras.openEnded');
		return `${extra.validFrom ? formatDay(extra.validFrom) : '…'} – ${extra.validTo ? formatDay(extra.validTo) : '…'}`;
	}

	async function saveExtra() {
		if (!extraEdit) return;
		if (extraEdit.kind === 'custom' && !extraEdit.note.trim()) {
			sdk?.ui?.toast(t('leaveEntitlement.extras.noteRequired'), 'warning');
			return;
		}
		extraSaving = true;
		try {
			const r: { extra: ExtraLeave; recalculated: RecalculatedBalance[] } = await sdk.remote.call(
				'saveExtraLeave',
				{
					employeeId,
					id: extraEdit.id,
					kind: extraEdit.kind,
					days: extraEdit.days,
					validFrom: extraEdit.validFrom || null,
					validTo: extraEdit.validTo || null,
					note: extraEdit.note
				}
			);
			extraEdit = null;
			await load();
			afterChange(r.recalculated);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			extraSaving = false;
		}
	}

	// --- Nem munkában töltött időszakok ---
	type AbsenceEdit = {
		id?: number;
		kind: EmployeeAbsenceKind;
		startDate: string;
		endDate: string;
		note: string;
	};
	let absenceEdit = $state<AbsenceEdit | null>(null);
	let absenceSaving = $state(false);

	function startEditAbsence(absence: EmployeeAbsence) {
		absenceEdit = {
			id: absence.id,
			kind: absence.kind,
			startDate: absence.startDate,
			endDate: absence.endDate,
			note: absence.note ?? ''
		};
	}

	async function saveAbsence() {
		if (!absenceEdit) return;
		if (!absenceEdit.startDate || !absenceEdit.endDate) {
			sdk?.ui?.toast(t('form.required'), 'warning');
			return;
		}
		absenceSaving = true;
		try {
			const r: { absence: EmployeeAbsence; recalculated: RecalculatedBalance[] } = await sdk.remote.call(
				'saveAbsencePeriod',
				{ employeeId, ...absenceEdit }
			);
			absenceEdit = null;
			await load();
			afterChange(r.recalculated);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		} finally {
			absenceSaving = false;
		}
	}

	async function deleteAbsence(absence: EmployeeAbsence) {
		try {
			const r: { recalculated: RecalculatedBalance[] } = await sdk.remote.call('deleteAbsencePeriod', {
				id: absence.id
			});
			await load();
			afterChange(r.recalculated);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		}
	}

	async function deleteExtra(extra: ExtraLeave) {
		try {
			const r: { recalculated: RecalculatedBalance[] } = await sdk.remote.call('deleteExtraLeave', {
				id: extra.id
			});
			await load();
			afterChange(r.recalculated);
		} catch (err) {
			sdk?.ui?.toast(errorText(err), 'error');
		}
	}
</script>

<div class="card accent-purple">
	<div class="card-header">
		<div>
			<h3>{t('leaveEntitlement.profile.title')}</h3>
			<p class="card-subtitle">{t('leaveEntitlement.profile.subtitle')}</p>
		</div>
		{#if profile && !editingDates}
			<button class="btn-ghost" onclick={startEditDates}>{t('employeeDetail.editDetail')}</button>
		{/if}
	</div>

	{#if loading && !profile}
		<div class="loading-state"><div class="spinner"></div></div>
	{:else if profile}
		{#if !profile.hireDateConfirmed}
			<p class="notice">{t('leaveEntitlement.profile.hireDateUnconfirmed')}</p>
		{/if}

		<!-- Dátumok -->
		{#if editingDates}
			<div class="edit-form">
				<label>
					<span>{t('leaveEntitlement.profile.birthDate')}</span>
					<input class="input" type="date" bind:value={editBirthDate} />
				</label>
				<label>
					<span>{t('leaveEntitlement.profile.hireDate')}</span>
					<input class="input" type="date" bind:value={editHireDate} />
				</label>
				<label>
					<span>{t('leaveEntitlement.profile.endDate')}</span>
					<input class="input" type="date" bind:value={editEndDate} />
					<small class="field-hint">{t('leaveEntitlement.profile.endDateHint')}</small>
				</label>
				<div class="form-actions">
					<button class="btn-secondary" onclick={() => (editingDates = false)}>{t('form.cancel')}</button>
					<button class="btn-primary" onclick={saveDates} disabled={datesSaving}>
						{datesSaving ? t('loading') : t('form.save')}
					</button>
				</div>
			</div>
		{:else}
			<div class="fields">
				<div class="field-row">
					<span class="field-label">{t('leaveEntitlement.profile.birthDate')}</span>
					<span class="field-value">{formatDay(profile.birthDate)}</span>
				</div>
				<div class="field-row">
					<span class="field-label">{t('leaveEntitlement.profile.hireDate')}</span>
					<span class="field-value">{formatDay(profile.hireDate)}</span>
				</div>
				<div class="field-row">
					<span class="field-label">{t('leaveEntitlement.profile.endDate')}</span>
					<span class="field-value">{formatDay(profile.employmentEndDate)}</span>
				</div>
			</div>
		{/if}

		<!-- Gyerekek -->
		<div class="section">
			<div class="section-head">
				<h4>{t('leaveEntitlement.children.title')}</h4>
				{#if !childEdit}
					<button
						class="btn-ghost"
						onclick={() =>
							(childEdit = { label: '', birthDate: '', isDisabled: false, paternityEligible: false })}
					>
						+ {t('leaveEntitlement.children.add')}
					</button>
				{/if}
			</div>

			{#if profile.children.length === 0 && !childEdit}
				<p class="empty-hint">{t('leaveEntitlement.children.empty')}</p>
			{:else}
				<ul class="item-list">
					{#each profile.children as child (child.id)}
						{@const status = childCountsThisYear(child)}
						<li class="item-row">
							<span class="item-main">
								<span class="item-title">{child.label || t('leaveEntitlement.children.unnamed')}</span>
								<span class="item-meta">{formatDay(child.birthDate)}</span>
							</span>
							<span class="badges">
								{#if child.isDisabled}
									<span class="badge badge-info">{t('leaveEntitlement.children.disabledBadge')}</span>
								{/if}
								{#if child.paternityEligible}
									<span class="badge badge-info">{t('leaveEntitlement.children.paternityBadge')}</span>
								{/if}
								<span class="badge {status === 'counts' ? 'badge-ok' : 'badge-muted'}">
									{t(`leaveEntitlement.children.${status}`)}
								</span>
							</span>
							<span class="item-actions">
								<button
									class="btn-ghost-sm"
									onclick={() =>
										(childEdit = {
											id: child.id,
											label: child.label ?? '',
											birthDate: child.birthDate,
											isDisabled: child.isDisabled,
											paternityEligible: child.paternityEligible
										})}
								>
									{t('employeeDetail.editDetail')}
								</button>
								<button class="btn-ghost-sm danger" onclick={() => deleteChild(child)}>
									{t('employeeDetail.deleteDetail')}
								</button>
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if childEdit}
				<div class="edit-form">
					<label>
						<span>{t('leaveEntitlement.children.label')}</span>
						<input class="input" type="text" bind:value={childEdit.label} maxlength="255" />
					</label>
					<label>
						<span>{t('leaveEntitlement.children.birthDate')}</span>
						<input class="input" type="date" bind:value={childEdit.birthDate} />
					</label>
					<label class="checkbox-row">
						<Checkbox
							checked={childEdit.isDisabled}
							onCheckedChange={(v) => childEdit && (childEdit.isDisabled = v)}
						/>
						<span>{t('leaveEntitlement.children.isDisabled')}</span>
					</label>
					<label class="checkbox-row">
						<Checkbox
							checked={childEdit.paternityEligible}
							onCheckedChange={(v) => childEdit && (childEdit.paternityEligible = v)}
						/>
						<span>{t('leaveEntitlement.children.paternityEligible')}</span>
					</label>
					<div class="form-actions">
						<button class="btn-secondary" onclick={() => (childEdit = null)}>{t('form.cancel')}</button>
						<button class="btn-primary" onclick={saveChild} disabled={childSaving}>
							{childSaving ? t('loading') : t('form.save')}
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Egyéb pótszabadság -->
		<div class="section">
			<div class="section-head">
				<h4>{t('leaveEntitlement.extras.title')}</h4>
				{#if !extraEdit}
					<button class="btn-ghost" onclick={startAddExtra}>+ {t('leaveEntitlement.extras.add')}</button>
				{/if}
			</div>

			{#if profile.extras.length === 0 && !extraEdit}
				<p class="empty-hint">{t('leaveEntitlement.extras.empty')}</p>
			{:else}
				<ul class="item-list">
					{#each profile.extras as extra (extra.id)}
						<li class="item-row">
							<span class="item-main">
								<span class="item-title">{extraLabel(extra)}</span>
								<span class="item-meta">{validityText(extra)}</span>
							</span>
							<span class="badges">
								<span class="badge badge-info">{t('leaveEntitlement.days', { days: `+${extra.days}` })}</span>
							</span>
							<span class="item-actions">
								<button class="btn-ghost-sm" onclick={() => startEditExtra(extra)}>
									{t('employeeDetail.editDetail')}
								</button>
								<button class="btn-ghost-sm danger" onclick={() => deleteExtra(extra)}>
									{t('employeeDetail.deleteDetail')}
								</button>
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if extraEdit}
				<div class="edit-form">
					<label>
						<span>{t('leaveEntitlement.extras.kindLabel')}</span>
						<select class="input" bind:value={extraEdit.kind}>
							{#each EXTRA_KINDS as kind (kind)}
								<option value={kind}>{t(`leaveEntitlement.extras.kind.${kind}`)}</option>
							{/each}
						</select>
					</label>

					{#if extraEdit.kind === 'custom'}
						<label>
							<span>{t('leaveEntitlement.extras.note')}</span>
							<input class="input" type="text" bind:value={extraEdit.note} />
						</label>
						<label>
							<span>{t('leaveEntitlement.extras.days')}</span>
							<input class="input" type="number" bind:value={extraEdit.days} min="1" max="60" />
						</label>
					{:else}
						<p class="field-hint">{t('leaveEntitlement.extras.statutoryDays')}</p>
						{#if extraEdit.kind === 'health_impaired'}
							<p class="notice">{t('leaveEntitlement.extras.privacyHint')}</p>
						{/if}
					{/if}

					<div class="date-pair">
						<label>
							<span>{t('leaveEntitlement.extras.validFrom')}</span>
							<input class="input" type="date" bind:value={extraEdit.validFrom} />
						</label>
						<label>
							<span>{t('leaveEntitlement.extras.validTo')}</span>
							<input class="input" type="date" bind:value={extraEdit.validTo} />
						</label>
					</div>

					<div class="form-actions">
						<button class="btn-secondary" onclick={() => (extraEdit = null)}>{t('form.cancel')}</button>
						<button class="btn-primary" onclick={saveExtra} disabled={extraSaving}>
							{extraSaving ? t('loading') : t('form.save')}
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Nem munkában töltött időszakok -->
		<div class="section">
			<div class="section-head">
				<h4>{t('leaveEntitlement.absences.title')}</h4>
				{#if !absenceEdit}
					<button
						class="btn-ghost"
						onclick={() => (absenceEdit = { kind: 'unpaid_leave', startDate: '', endDate: '', note: '' })}
					>
						+ {t('leaveEntitlement.absences.add')}
					</button>
				{/if}
			</div>
			<p class="field-hint">{t('leaveEntitlement.absences.hint')}</p>

			{#if profile.absences.length > 0}
				<ul class="item-list">
					{#each profile.absences as absence (absence.id)}
						<li class="item-row">
							<span class="item-main">
								<span class="item-title">{t(`leaveEntitlement.absences.kind.${absence.kind}`)}</span>
								<span class="item-meta">
									{formatDay(absence.startDate)} – {formatDay(absence.endDate)}{absence.note ? ` · ${absence.note}` : ''}
								</span>
							</span>
							<span class="item-actions">
								<button class="btn-ghost-sm" onclick={() => startEditAbsence(absence)}>
									{t('employeeDetail.editDetail')}
								</button>
								<button class="btn-ghost-sm danger" onclick={() => deleteAbsence(absence)}>
									{t('employeeDetail.deleteDetail')}
								</button>
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if absenceEdit}
				<div class="edit-form">
					<label>
						<span>{t('leaveEntitlement.absences.kindLabel')}</span>
						<select class="input" bind:value={absenceEdit.kind}>
							{#each ABSENCE_KINDS as kind (kind)}
								<option value={kind}>{t(`leaveEntitlement.absences.kind.${kind}`)}</option>
							{/each}
						</select>
					</label>
					{#if absenceEdit.kind === 'childcare_unpaid_leave'}
						<p class="field-hint">{t('leaveEntitlement.absences.childcareHint')}</p>
					{/if}
					<div class="date-pair">
						<label>
							<span>{t('leaveEntitlement.absences.startDate')}</span>
							<input class="input" type="date" bind:value={absenceEdit.startDate} />
						</label>
						<label>
							<span>{t('leaveEntitlement.absences.endDate')}</span>
							<input class="input" type="date" bind:value={absenceEdit.endDate} />
						</label>
					</div>
					<label>
						<span>{t('leaveEntitlement.absences.note')}</span>
						<input class="input" type="text" bind:value={absenceEdit.note} />
					</label>
					<div class="form-actions">
						<button class="btn-secondary" onclick={() => (absenceEdit = null)}>{t('form.cancel')}</button>
						<button class="btn-primary" onclick={saveAbsence} disabled={absenceSaving}>
							{absenceSaving ? t('loading') : t('form.save')}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	@import '../../styles/shared.css';

	.card {
		--card-accent: #a855f7;
		border: 1px solid var(--color-border, #e2e8f0);
		border-top: 5px solid var(--card-accent);
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.card-header h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
	}

	.card-subtitle {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.notice {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: #fef3c7;
		color: #92400e;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.fields {
		display: flex;
		flex-direction: column;
	}

	.field-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-border, #f1f5f9);
	}

	.field-row:last-child { border-bottom: none; }

	.field-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		min-width: 140px;
		font-weight: 500;
	}

	.field-value {
		font-size: 0.875rem;
	}

	.field-hint {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-top: 1px solid var(--color-border, #e2e8f0);
		padding-top: 0.9rem;
	}

	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-head h4 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.item-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.item-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.45rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-accent, #f8fafc);
		font-size: 0.85rem;
	}

	.item-main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-weight: 500;
	}

	.item-meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.badges {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.7rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.badge-ok { background: #dcfce7; color: #166534; }
	.badge-muted { background: #f1f5f9; color: #64748b; }
	.badge-info { background: #ede9fe; color: #5b21b6; }

	.item-actions {
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.item-row:hover .item-actions,
	.item-row:focus-within .item-actions {
		opacity: 1;
	}

	.empty-hint {
		color: var(--color-muted-foreground, #94a3b8);
		font-size: 0.85rem;
		margin: 0;
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-accent, #f8fafc);
		border-radius: 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
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

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.btn-ghost {
		border: none;
		background: transparent;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
		white-space: nowrap;
	}

	.btn-ghost:hover { background: var(--color-primary-subtle, #e0e7ff); }

	.btn-ghost-sm {
		border: none;
		background: transparent;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.btn-ghost-sm:hover { background: var(--color-card, #fff); }
	.btn-ghost-sm.danger:hover { background: #fee2e2; color: #dc2626; }

	:global(.dark) .card {
		background: var(--color-card, oklch(0.205 0 0));
		border: none;
		border-top: 3px solid var(--card-accent);
	}

	:global(.dark) .item-row,
	:global(.dark) .edit-form {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .section,
	:global(.dark) .edit-form,
	:global(.dark) .field-row {
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .notice {
		background: oklch(0.3 0.05 60);
		color: #fde68a;
	}

	:global(.dark) .badge-ok { background: oklch(0.25 0.05 145); color: #86efac; }
	:global(.dark) .badge-muted { background: oklch(0.3 0 0); color: #cbd5e1; }
	:global(.dark) .badge-info { background: oklch(0.3 0.06 300); color: #ddd6fe; }
</style>
