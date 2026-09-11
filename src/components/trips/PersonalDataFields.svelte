<script lang="ts">
	/**
	 * A kiküldetési rendelvényhez szükséges fix személyes mezők a dolgozó
	 * adatlapján (K17): lakcím, születési hely, anyja neve, adóazonosító jel.
	 * Egyik sem kötelező; a rendelvény figyelmeztet, ha hiányzik. Szerkeszteni
	 * `employee.manage` joggal lehet.
	 */
	import type { EmployeePersonalData } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { errorMessage } from './format.js';

	let {
		pluginId = 'racona-work',
		employeeId,
		personal,
		canEdit = false,
		onSaved
	}: {
		pluginId?: string;
		employeeId: number;
		personal: EmployeePersonalData;
		canEdit?: boolean;
		onSaved?: () => void;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let editing = $state(false);
	let saving = $state(false);
	let form = $state({ homeAddress: '', birthPlace: '', motherName: '', taxId: '' });

	const rows = $derived([
		{ label: t('employeeDetail.homeAddress'), value: personal.homeAddress, extra: personal.homeAddress && !personal.homeLocation ? t('employeeDetail.homeNotOnMap') : null },
		{ label: t('employeeDetail.birthPlace'), value: personal.birthPlace, extra: null },
		{ label: t('employeeDetail.motherName'), value: personal.motherName, extra: null },
		{ label: t('employeeDetail.taxId'), value: personal.taxId, extra: null }
	]);

	function startEdit() {
		form = {
			homeAddress: personal.homeAddress ?? '',
			birthPlace: personal.birthPlace ?? '',
			motherName: personal.motherName ?? '',
			taxId: personal.taxId ?? ''
		};
		editing = true;
	}

	async function save() {
		saving = true;
		try {
			const result = await sdk.remote.call('saveEmployeePersonalData', { employeeId, ...form });
			editing = false;
			if (result.geocodeFailed) sdk?.ui?.toast(t('employeeDetail.homeGeocodeFailed'), 'warning');
			else if (result.geocodedAddress) sdk?.ui?.toast(t('employeeDetail.homeGeocoded', { address: result.geocodedAddress }), 'info');
			else sdk?.ui?.toast(t('employeeDetail.saveSuccess'), 'success');
			if (result.taxIdBirthDateMismatch) sdk?.ui?.toast(t('employeeDetail.taxIdBirthMismatch'), 'warning');
			onSaved?.();
		} catch (err) {
			sdk?.ui?.toast(errorMessage(err, t('error.saveFailed')), 'error');
		} finally {
			saving = false;
		}
	}
</script>

{#if editing}
	<div class="pd-edit">
		<label class="pd-label">
			{t('employeeDetail.homeAddress')}
			<input class="pd-input" type="text" maxlength="300" placeholder={t('employeeDetail.homeAddressPlaceholder')} bind:value={form.homeAddress} />
		</label>
		<div class="pd-grid">
			<label class="pd-label">
				{t('employeeDetail.birthPlace')}
				<input class="pd-input" type="text" maxlength="100" bind:value={form.birthPlace} />
			</label>
			<label class="pd-label">
				{t('employeeDetail.motherName')}
				<input class="pd-input" type="text" maxlength="150" bind:value={form.motherName} />
			</label>
			<label class="pd-label">
				{t('employeeDetail.taxId')}
				<input class="pd-input" type="text" inputmode="numeric" maxlength="12" placeholder="8xxxxxxxxx" bind:value={form.taxId} />
			</label>
		</div>
		<p class="pd-hint">{t('employeeDetail.tripFieldsHint')}</p>
		<div class="pd-actions">
			<button class="pd-secondary" onclick={() => (editing = false)}>{t('form.cancel')}</button>
			<button class="pd-primary" onclick={save} disabled={saving}>{saving ? t('loading') : t('form.save')}</button>
		</div>
	</div>
{:else}
	{#each rows as row, i (i)}
		<div class="pd-row">
			<span class="pd-row-label">{row.label}</span>
			<span class="pd-row-value" class:empty={!row.value}>
				{row.value ?? t('employeeDetail.notSet')}
				{#if row.extra}<span class="pd-extra">{row.extra}</span>{/if}
			</span>
			{#if canEdit && i === 0}
				<button class="pd-ghost" onclick={startEdit}>{t('employeeDetail.editDetail')}</button>
			{/if}
		</div>
	{/each}
{/if}

<style>
	.pd-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-border, #f1f5f9);
	}

	.pd-row-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		min-width: 140px;
		font-weight: 500;
	}

	.pd-row-value {
		flex: 1;
		font-size: 0.875rem;
		color: var(--color-foreground, #0f172a);
	}

	.pd-row-value.empty {
		color: var(--color-muted-foreground, #94a3b8);
		font-style: italic;
	}

	.pd-extra {
		display: block;
		font-size: 0.75rem;
		color: #b45309;
		font-style: normal;
	}

	.pd-edit {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-accent, #f8fafc);
		border-radius: 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		margin: 0.5rem 0;
	}

	.pd-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
	}

	@media (max-width: 640px) {
		.pd-grid {
			grid-template-columns: 1fr;
		}
	}

	.pd-label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.pd-input {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.875rem;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
	}

	.pd-hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.pd-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.pd-primary,
	.pd-secondary,
	.pd-ghost {
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.pd-primary {
		background: var(--color-primary, #3730a3);
		color: white;
		border: none;
		padding: 0.4rem 0.9rem;
	}

	.pd-primary:disabled {
		opacity: 0.5;
	}

	.pd-secondary {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		color: var(--color-foreground, #0f172a);
		padding: 0.4rem 0.9rem;
	}

	.pd-ghost {
		border: none;
		background: transparent;
		padding: 0.2rem 0.4rem;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.pd-ghost:hover {
		background: var(--color-accent, #f1f5f9);
	}

	:global(.dark) .pd-input {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}
</style>
