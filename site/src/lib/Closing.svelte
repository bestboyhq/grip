<!-- The page's last word in its own light: the headline and its line, then what to do now (`children`).

     The light is drawn by WebGL with grain over its CSS version (`.glow`) in the same geometry: three colors in the
     glow's box. The canvas reaches a fifth of that box past it on every side (`.gl`), so the light fades out before
     the canvas ends. Once it draws, the CSS version goes: Safari repaints its 48px blur in software as the page
     scrolls past, and drops frames doing it. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import BeatLabel, { type Beat } from './BeatLabel.svelte';
	import Glow, { within, type Box, type Layer } from './Glow.svelte';

	type Props = { beat: Beat; title: string; sub: string; children: Snippet };

	let { beat, title, sub, children }: Props = $props();

	const GLOW: Box = [1 / 7, 1 / 7, 5 / 7, 5 / 7];
	const CLOSING: readonly Layer[] = [
		{ box: within([0, 0.06, 0.55, 0.8], GLOW), color: '#1957fa', peak: [1, 1] },
		{ box: within([0.25, 0.18, 0.5, 0.7], GLOW), color: '#d94f46', peak: [1, 1] },
		{ box: within([0.55, 0.12, 0.45, 0.7], GLOW), color: '#fb8600', peak: [1, 1] },
	];
	let lit = $state(false);
</script>

<section id="start" class="beat closing" aria-labelledby="start-title" data-place="closing">
	<div class="wrap">
		<div class="close">
			{#if !lit}
				<div class="glow" aria-hidden="true"></div>
			{/if}
			<div class="gl" aria-hidden="true">
				<Glow layers={CLOSING} opacity={0.14} soft={0.25} weighted bind:lit />
			</div>
			<BeatLabel {...beat} />
			<div class="end">
				<div class="rise">
					<h2 id="start-title">{title}</h2>
					<p class="sub">{sub}</p>
				</div>
				{@render children()}
			</div>
		</div>
	</div>
</section>

<style>
	.close {
		position: relative;
		padding: 56px 64px 64px;
	}

	.glow {
		position: absolute;
		z-index: -1;
		inset: 10% 20% 0 10%;
		background:
			radial-gradient(closest-side, #1957fa, transparent) 0 30% / 55% 80% no-repeat,
			radial-gradient(closest-side, #d94f46, transparent) 50% 60% / 50% 70% no-repeat,
			radial-gradient(closest-side, #fb8600, transparent) 100% 40% / 45% 70% no-repeat;
		filter: blur(48px);
		opacity: 0.14;
		pointer-events: none;
	}

	/* The WebGL light over its CSS version. It paints its own background, the `color` here. */
	.gl {
		position: absolute;
		z-index: -1;
		inset: -8% 6% -18% -4%;
		color: var(--surface-root);
		pointer-events: none;
	}

	.end {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 32px 48px;
	}

	.end > div:first-child {
		flex: 1 1 520px;
		max-width: 780px;
	}

	h2 {
		font-size: clamp(30px, 3.4vw, 40px);
		font-weight: 550;
		line-height: 1.1;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.sub {
		max-width: 560px;
		margin-top: 20px;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	@media (max-width: 859px) {
		.sub {
			font-size: 17px;
		}

		.close {
			padding: 44px 28px 48px;
		}

		.end > div:first-child {
			flex-basis: auto;
		}
	}

	@media (max-width: 559px) {
		.close {
			margin-inline: -12px;
			padding: 40px 12px 44px;
		}
	}
</style>
