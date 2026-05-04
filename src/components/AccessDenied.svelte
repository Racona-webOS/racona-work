<!--
	AccessDenied - Hozzáférés megtagadva komponens
	Követelmények: 13.1, 13.2, 13.3, 13.4, 13.5
-->
<script lang="ts">
	let {
		title = 'Nincs hozzáférésed ehhez az alkalmazáshoz',
		message = 'Jelenleg nem vagy tagja egyetlen szervezetnek sem.',
		instruction = 'Kérj hozzáférést egy rendszergazdától.',
		icon = '🔒'
	}: {
		title?: string;
		message?: string;
		instruction?: string;
		icon?: string;
	} = $props();
</script>

<div class="access-denied">
	<div class="access-denied-icon">{icon}</div>
	<h2 class="access-denied-title">{title}</h2>
	<p class="access-denied-message">{message}</p>
	<p class="access-denied-instruction">{instruction}</p>
</div>

<style>
	.access-denied {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 4rem 2rem;
		gap: 1rem;
		min-height: 300px;
	}

	.access-denied-icon {
		font-size: 4rem;
		opacity: 0.5;
		margin-bottom: 0.5rem;
	}

	.access-denied-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-foreground, #0f172a);
		margin: 0;
		line-height: 1.3;
	}

	.access-denied-message {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.875rem;
		margin: 0;
		max-width: 400px;
		line-height: 1.5;
	}

	.access-denied-instruction {
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.875rem;
		font-weight: 500;
		margin: 0;
		max-width: 400px;
		padding: 0.75rem 1.25rem;
		background: var(--color-accent, #f1f5f9);
		border-radius: 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
	}

	/* Sötét mód */
	:global(.dark) .access-denied-title {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .access-denied-message {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
	}

	:global(.dark) .access-denied-instruction {
		color: var(--color-muted-foreground, oklch(0.708 0 0));
		background: var(--color-accent, oklch(0.269 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}
</style>
