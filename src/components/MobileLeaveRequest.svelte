<svelte:options customElement={{ tag: 'racona-work-mobile-leave-request', shadow: 'none' }} />

<!--
	Mobil bejegyzés: szabadság igénylése telefonon (specs/mobile.md).

	Áttekintés: az idei keret, a saját kérelmek (függőt vissza lehet vonni) és az
	„Új kérelem” gomb. Új kérelem: típus (gyerekes típusnál gyerek), napok a havi
	naptárban koppintással, indoklás, élő előnézet a szerverről, beküldés. Ugyanazt
	a kérelmet állítja össze, mint az asztali naptár kérelmező módja
	(previewLeaveRequestBatch / submitLeaveRequestBatch).
-->
<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_MobileLeaveRequest = function () {
			return { tagName: 'racona-work-mobile-leave-request' };
		};
	}
</script>

<script lang="ts">
	import MobileScreen from './mobile/MobileScreen.svelte';
	import MobileLeaveHome from './mobile/MobileLeaveHome.svelte';
	import MobileLeaveForm from './mobile/MobileLeaveForm.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	let view = $state<'overview' | 'new'>('overview');
</script>

<div class="rw">
	<MobileScreen {pluginId} capability="leave.request">
		{#snippet children(ctx)}
			{#key `${ctx.organization.id}:${ctx.employee.id}`}
				{#if view === 'new'}
					<MobileLeaveForm
						{ctx}
						onSubmitted={() => (view = 'overview')}
						onCancel={() => (view = 'overview')}
					/>
				{:else}
					<MobileLeaveHome {ctx} onNew={() => (view = 'new')} />
				{/if}
			{/key}
		{/snippet}
	</MobileScreen>
</div>

<style>
	@import '../styles/shared.css';
	@import '../styles/mobile.css';
</style>
