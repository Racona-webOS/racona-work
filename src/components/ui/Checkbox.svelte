<script lang="ts">
	/**
	 * Checkbox — shadcn-svelte vizuális másolata, natív DOM-mal.
	 *
	 * A core sdk.components.Checkbox (bits-ui alapú) dinamikus `<svelte:component>`
	 * + `bind:` kombináció alatt nem frissül helyesen szerep-váltáskor (belső
	 * state tartja a pipát). Ezért itt egy saját implementáció van, amely:
	 *  - Tailwind osztályokkal a core téma színeit használja (primary, border,
	 *    muted stb.), így vizuálisan megegyezik a shadcn checkbox-szal.
	 *  - Tiszta natív `<input type="checkbox">` az alap, egy span overlay-vel
	 *    a pipa ikonnak.
	 *  - A `checked` prop minden renderelésnél érvényesül; semmi belső state
	 *    nem ragad.
	 */

	interface Props {
		checked?: boolean;
		disabled?: boolean;
		onCheckedChange?: (checked: boolean) => void;
		ariaLabel?: string;
		class?: string;
	}

	let {
		checked = false,
		disabled = false,
		onCheckedChange,
		ariaLabel,
		class: className = ''
	}: Props = $props();

	function handleChange(e: Event) {
		const target = e.target as HTMLInputElement;
		onCheckedChange?.(target.checked);
	}
</script>

<label class="wk-checkbox {checked ? 'is-checked' : ''} {disabled ? 'is-disabled' : ''} {className}">
	<input
		type="checkbox"
		{checked}
		{disabled}
		onchange={handleChange}
		aria-label={ariaLabel}
	/>
	<span class="wk-checkbox-box" aria-hidden="true">
		{#if checked}
			<svg
				class="wk-checkbox-icon"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M3 8.5L6.5 12L13 4.5" />
			</svg>
		{/if}
	</span>
</label>

<style>
	.wk-checkbox {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		position: relative;
		vertical-align: middle;
	}

	.wk-checkbox input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
	}

	.wk-checkbox-box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border: 1px solid var(--color-border, #cbd5e1);
		border-radius: 0.25rem;
		background: var(--color-background, #ffffff);
		color: #ffffff;
		transition:
			background-color 0.12s ease,
			border-color 0.12s ease,
			box-shadow 0.12s ease;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
	}

	.wk-checkbox:hover .wk-checkbox-box {
		border-color: var(--color-primary, #3730a3);
	}

	.wk-checkbox.is-checked .wk-checkbox-box {
		background: var(--color-primary, #3730a3);
		border-color: var(--color-primary, #3730a3);
	}

	.wk-checkbox.is-disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.wk-checkbox.is-disabled .wk-checkbox-box {
		cursor: not-allowed;
	}

	.wk-checkbox input:focus-visible + .wk-checkbox-box {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-primary-subtle, rgba(99, 102, 241, 0.3));
	}

	.wk-checkbox-icon {
		width: 0.8rem;
		height: 0.8rem;
		color: currentColor;
	}

	:global(.dark) .wk-checkbox-box {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 20%));
	}

	:global(.dark) .wk-checkbox.is-checked .wk-checkbox-box {
		background: var(--color-primary, oklch(0.66 0.12 264));
		border-color: var(--color-primary, oklch(0.66 0.12 264));
	}
</style>
