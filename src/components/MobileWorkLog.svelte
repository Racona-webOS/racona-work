<svelte:options customElement={{ tag: 'racona-work-mobile-work-log', shadow: 'none' }} />

<!--
	Mobil bejegyzés: napi munka rögzítése telefonon (specs/mobile.md).

	Egy nap saját bejegyzései az összes projektből, napok között lapozva, a napi
	összóraszámmal; „+ Munka rögzítése” és koppintásra szerkesztés vagy törlés.
	Ha a hiányzó munkanapló értesítéséből nyílik (paraméter: days), a legkorábbi
	hiányzó nappal indul.
-->
<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_MobileWorkLog = function () {
			return { tagName: 'racona-work-mobile-work-log' };
		};
	}
</script>

<script lang="ts">
	import MobileScreen from './mobile/MobileScreen.svelte';
	import MobileWorkDay from './mobile/MobileWorkDay.svelte';
	import MobileWorkEntryForm from './mobile/MobileWorkEntryForm.svelte';
	import type { WorkEntryRow } from '../../server/functions.js';
	import { resolveSdk } from '../utils/sdk.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const DAY = /^\d{4}-\d{2}-\d{2}$/;

	function todayIso(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	}

	/** A hiányzó munkanapló értesítése a napokat is átadja: a legkorábbival indulunk */
	function initialDay(): string {
		const days = resolveSdk(pluginId)?.context?.params?.days;
		if (Array.isArray(days)) {
			const valid = days.filter((d): d is string => typeof d === 'string' && DAY.test(d)).sort();
			if (valid.length > 0) return valid[0];
		}
		return todayIso();
	}

	let day = $state(initialDay());
	/** null: napi lista; különben az űrlap (új bejegyzés vagy szerkesztés) */
	let form = $state<{ entry: WorkEntryRow | null } | null>(null);
</script>

<div class="rw">
	<MobileScreen {pluginId} capability="work.log" allowExternal>
		{#snippet children(ctx)}
			{#key ctx.organization.id}
				{#if form}
					<MobileWorkEntryForm
						{ctx}
						{day}
						entry={form.entry}
						onDone={(savedDay) => {
							if (savedDay) day = savedDay;
							form = null;
						}}
					/>
				{:else}
					<MobileWorkDay
						{ctx}
						bind:day
						onNew={() => (form = { entry: null })}
						onEdit={(entry) => (form = { entry })}
					/>
				{/if}
			{/key}
		{/snippet}
	</MobileScreen>
</div>

<style>
	@import '../styles/shared.css';
	@import '../styles/mobile.css';
</style>
