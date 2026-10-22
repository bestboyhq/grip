<script lang="ts">
	import { onMount } from 'svelte';

	type Theme = 'light' | 'system' | 'dark';

	const THEMES: readonly Readonly<{ value: Theme; tip: string }>[] = [
		{ value: 'light', tip: 'Light' },
		{ value: 'system', tip: 'System' },
		{ value: 'dark', tip: 'Dark' },
	];

	let theme = $state<Theme>('system');
	let settled = $state(false);
	let buttons = $state<(HTMLButtonElement | undefined)[]>([]);

	const index = $derived(
		Math.max(
			0,
			THEMES.findIndex((item) => item.value === theme),
		),
	);

	onMount(() => {
		const stored = document.documentElement.dataset.theme;
		theme = stored === 'light' || stored === 'dark' ? stored : 'system';
		requestAnimationFrame(() => (settled = true));
	});

	const STEPS: Readonly<Record<string, number>> = {
		ArrowRight: 1,
		ArrowDown: 1,
		ArrowLeft: -1,
		ArrowUp: -1,
	};

	function store(next: Theme): void {
		const root = document.documentElement;
		if (next === 'system') delete root.dataset.theme;
		else root.dataset.theme = next;
		try {
			if (next === 'system') localStorage.removeItem('theme');
			else localStorage.setItem('theme', next);
		} catch {
			return;
		}
	}

	function select(next: Theme): void {
		if (next === theme) return;
		theme = next;
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (still || !document.startViewTransition) store(next);
		else document.startViewTransition(() => store(next));
	}

	function onkeydown(event: KeyboardEvent): void {
		const step = STEPS[event.key];
		const target =
			step !== undefined
				? (index + step + THEMES.length) % THEMES.length
				: event.key === 'Home'
					? 0
					: event.key === 'End'
						? THEMES.length - 1
						: -1;
		const item = THEMES[target];
		if (!item) return;
		event.preventDefault();
		select(item.value);
		buttons[target]?.focus();
	}
</script>

<div
	class={['switch', { settled }]}
	role="radiogroup"
	aria-label="Theme"
	tabindex="-1"
	style:--at={index}
	{onkeydown}
>
	<span class="thumb" aria-hidden="true"></span>
	{#each THEMES as item, i (item.value)}
		<button
			bind:this={buttons[i]}
			type="button"
			role="radio"
			aria-checked={item.value === theme}
			aria-label="{item.tip} theme"
			data-tip={item.tip}
			tabindex={i === index ? 0 : -1}
			onclick={() => select(item.value)}
		>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				{#if item.value === 'light'}
					<path
						d="M12 2V4.22M12 19.78V22M22 12H19.78M4.22 12H2M19.07 19.07L17.5 17.5M6.5 6.5L4.93 4.93M4.93 19.07L6.5 17.5M17.5 6.5L19.07 4.93M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7C14.76 7 17 9.24 17 12Z"
					/>
				{:else if item.value === 'system'}
					<path
						d="M8.5 15.33C7.4 15.33 6.5 14.43 6.5 13.33V10.66C6.5 9.56 7.4 8.66 8.5 8.66C9.6 8.66 10.5 9.56 10.5 10.66V13.33C10.5 14.43 9.6 15.33 8.5 15.33Z"
					/>
					<path
						d="M17.5 10C17.5 9.26 16.9 8.67 16.17 8.67H15.21C14.27 8.67 13.51 9.43 13.51 10.37C13.51 10.94 13.88 11.45 14.42 11.64L16.6 12.37C17.14 12.55 17.51 13.06 17.51 13.63C17.51 14.57 16.75 15.34 15.81 15.34H14.85C14.11 15.34 13.52 14.74 13.52 14.01"
					/>
					<path
						d="M17 22H7C4.24 22 2 19.76 2 17V7C2 4.24 4.24 2 7 2H17C19.76 2 22 4.24 22 7V17C22 19.76 19.76 22 17 22Z"
					/>
				{:else}
					<path
						d="M12 12C14.37 9.57 14.95 5.91 13.46 2.87C13.37 2.65 13.41 2.39 13.57 2.21C13.73 2.03 13.98 1.96 14.21 2.03C15.99 2.49 17.62 3.42 18.92 4.71C22.95 8.63 23.03 15.08 19.11 19.11C15.08 23.03 8.64 22.95 4.72 18.92C3.42 17.62 2.49 16 2.03 14.21C1.96 13.98 2.03 13.73 2.21 13.57C2.39 13.41 2.65 13.37 2.87 13.46C5.92 14.95 9.57 14.37 12 12Z"
					/>
				{/if}
			</svg>
		</button>
	{/each}
</div>

<style>
	.switch {
		position: relative;
		isolation: isolate;
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border-radius: 9px;
		background: var(--control-track);
	}

	.thumb {
		position: absolute;
		z-index: -1;
		inset: 2px auto 2px 2px;
		width: 28px;
		border-radius: 7px;
		background: var(--control-raised);
		box-shadow:
			inset 0 0 0 0.5px var(--border-default),
			0 1px 2px rgb(0 0 0 / 0.08);
		translate: calc(var(--at) * 30px) 0;
	}

	.settled .thumb {
		transition: translate 250ms cubic-bezier(0.32, 0.72, 0, 1);
	}

	button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--fg-muted);
		cursor: pointer;
	}

	button[aria-checked='true'] {
		color: var(--fg-default);
	}

	button:active {
		color: var(--fg-secondary);
	}

	button:focus-visible {
		outline-offset: 1px;
	}

	svg {
		width: 14px;
		height: 14px;
	}

	@media (hover: hover) and (pointer: fine) {
		button:hover:not([aria-checked='true']) {
			color: var(--fg-secondary);
		}
	}

	@media (pointer: coarse) {
		button {
			position: relative;
		}

		button::after {
			content: '';
			position: absolute;
			inset: min(0px, 50% - 22px) -1px;
		}
	}
</style>
