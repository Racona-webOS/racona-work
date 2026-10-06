<svelte:options customElement={{ tag: 'racona-work-mobile-month-confirmation', shadow: 'none' }} />

<!--
	Mobil bejegyzés: a dolgozó havi szabadság-összesítője (elfogadás vagy eltérés
	jelzése). Ugyanaz a kártya, mint az asztali irányítópulton, telefonra igazítva.
-->
<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_MobileMonthConfirmation = function () {
			return { tagName: 'racona-work-mobile-month-confirmation' };
		};
	}
</script>

<script lang="ts">
	import MobileScreen from './mobile/MobileScreen.svelte';
	import MyMonthConfirmations from './leave-month-confirmation/MyMonthConfirmations.svelte';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	let count = $state<number | null>(null);
</script>

<div class="rw">
	<MobileScreen {pluginId} capability="leave.request">
		{#snippet children(ctx)}
			<div class="m-screen">
				<p class="m-muted">{ctx.t('mobile.month.intro')}</p>
				{#key ctx.organization.id}
					<div class="m-list">
						<MyMonthConfirmations {pluginId} organizationId={ctx.organization.id} bind:count />
					</div>
				{/key}
				{#if count === 0}
					<p class="m-empty">{ctx.t('mobile.month.empty')}</p>
				{/if}
			</div>
		{/snippet}
	</MobileScreen>
</div>

<style>
	@import '../styles/shared.css';
	@import '../styles/mobile.css';
</style>
