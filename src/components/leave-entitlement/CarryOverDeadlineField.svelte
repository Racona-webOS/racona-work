<!--
	Az áthozott napok határideje (Mt. 123. §): március 31. (alapeset), az év
	vége (életkori pótszabadság, megállapodás alapján), vagy egyedi dátum
	(pl. a munkavállaló oldali akadály megszűnésétől 60 nap).
-->
<script lang="ts">
	import { resolveSdk, translate } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		year,
		value = $bindable<string | null>(null)
	}: {
		pluginId?: string;
		year: number;
		value?: string | null;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	type Mode = 'march' | 'year_end' | 'custom';
	const march = $derived(`${year}-03-31`);
	const yearEnd = $derived(`${year}-12-31`);

	function modeOf(v: string | null): Mode {
		if (!v || v === march) return 'march';
		if (v === yearEnd) return 'year_end';
		return 'custom';
	}

	let mode = $state<Mode>(modeOf(value));
	let customDate = $state(modeOf(value) === 'custom' ? (value ?? '') : '');

	$effect(() => {
		value = mode === 'march' ? march : mode === 'year_end' ? yearEnd : customDate || null;
	});
</script>

<label>
	<span>{t('carryOver.deadline.label')}</span>
	<select class="input" bind:value={mode}>
		<option value="march">{t('carryOver.deadline.march', { year })}</option>
		<option value="year_end">{t('carryOver.deadline.yearEnd', { year })}</option>
		<option value="custom">{t('carryOver.deadline.custom')}</option>
	</select>
</label>
{#if mode === 'custom'}
	<label>
		<span>{t('carryOver.deadline.date')}</span>
		<input class="input" type="date" bind:value={customDate} min={`${year}-01-01`} />
	</label>
{/if}
<small class="hint">{t(`carryOver.deadline.hint.${mode}`)}</small>

<style>
	@import '../../styles/shared.css';

	.hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
		margin-top: -0.5rem;
	}
</style>
