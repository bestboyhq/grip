<!-- The hero: the eyebrow, the headline with its quiet second sentence, and the clip on its lit plate. The landing page
     adds its lede, buttons, and fine print under the headline and a caption under the clip. As a card it is the Open
     Graph image's source (`/og`): settled, the clip's dark still as `scripts/og.ts` renders it dark, tighter around the
     headline. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Arrow from './Arrow.svelte';
	import GitHubIcon from './GitHubIcon.svelte';
	import Glow, { type Layer } from './Glow.svelte';
	import Media, { clip } from './Media.svelte';
	import { GITHUB_URL } from './links.ts';

	type Props = { card?: boolean; children?: Snippet; caption?: Snippet };

	let { card = false, children, caption }: Props = $props();

	const HORIZON: readonly Layer[] = [{ box: [0, -0.46, 1, 0.9], peak: [0.42, 0.86], start: 0.18 }];
	const hero = clip('hero');
	let lit = $state(false);
</script>

<section class={['hero', { card }]} aria-labelledby="hero-title" data-place="hero">
	<div class="wrap intro">
		<a class="eyebrow" href={GITHUB_URL}>
			<GitHubIcon size={14} />
			<span>Free and open source macOS app</span>
			<Arrow class="ahead" />
		</a>
		<h1 id="hero-title">
			<span>Professional recordings</span>
			<span class="quiet">and screenshots within seconds.</span>
		</h1>
		{@render children?.()}
	</div>
	<div class="plate beat">
		<!-- The light's CSS version, gone once the WebGL one draws over it: blurred, masked, and growing, it would cost
		     every frame of the intro and of the clip in front of it for nothing. -->
		{#if !lit}
			<div class="horizon" aria-hidden="true"></div>
		{/if}
		<div class="gl" aria-hidden="true">
			<Glow layers={HORIZON} opacity={0.85} bind:lit />
		</div>
		<figure class="wrap window">
			<Media
				{...card ? { src: hero.dark.still } : { clip: hero }}
				width={2304}
				height={1440}
				r={21}
				eager
				alt="A deployments dashboard polished by Grip: the view zooms in as the cursor glides to Deploy, the click swells through the screen, and a glass loupe magnifies the new build's timer as it turns from Building to Ready."
			/>
			{#if caption}
				<figcaption>{@render caption()}</figcaption>
			{/if}
		</figure>
	</div>
</section>

<style>
	.intro {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding-top: 72px;
		padding-bottom: 64px;
	}

	.intro > :global(*),
	.window {
		animation:
			blur-in calc(var(--duration) * var(--pace)) var(--enter-ease) calc(var(--delay) * var(--pace))
				backwards,
			unblur calc(var(--duration) * var(--pace) * 0.705) var(--unblur-ease)
				calc(var(--delay) * var(--pace)) backwards;
	}

	.eyebrow {
		--rise: 3px;
		--blur: 8px;
		--duration: 1200ms;
		--delay: 250ms;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 11px 0 10px;
		white-space: nowrap;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		color: var(--fg-secondary);
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
	}

	.eyebrow :global(.ahead) {
		width: 11px;
		height: 11px;
		color: var(--fg-faint);
	}

	h1 {
		--rise: 4px;
		--blur: 12px;
		--duration: 1400ms;
		--delay: 0ms;
		margin-top: 24px;
		font-size: clamp(38px, 5.2vw, 68px);
		font-weight: 550;
		line-height: 1.02;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	h1 span {
		display: block;
	}

	.quiet {
		color: var(--fg-faint);
	}

	.plate {
		--seam: linear-gradient(
			90deg,
			transparent 4%,
			#1957fa 18%,
			#6365cd 32%,
			#9e6594 44%,
			#d35351 58%,
			#ed3e11 70%,
			#fb8400 82%,
			transparent 96%
		);
		--delay: 350ms;
		isolation: isolate;
		padding: 64px 0;
		background: linear-gradient(var(--panel) 0 0) 50% 0 / var(--col) 100% no-repeat;
	}

	@property --grow {
		syntax: '<number>';
		inherits: true;
		initial-value: 1;
	}

	.horizon,
	.gl {
		position: absolute;
		z-index: -1;
		pointer-events: none;
	}

	.horizon {
		inset: -46% calc(50% - var(--col) / 2) auto;
		height: 90%;
		background: var(--painting);
		mask-image: radial-gradient(
			closest-side,
			light-dark(rgb(0 0 0 / 0.42), rgb(0 0 0 / 0.86)) 18%,
			transparent
		);
		filter: blur(48px);
		opacity: 0.85;
		clip-path: inset(calc(100% * 46 / 90) 0 0 0);
		animation: swell calc(1600ms * var(--pace)) var(--enter-ease) calc(450ms * var(--pace))
			backwards;
	}

	.gl {
		inset: 0 calc(50% - var(--col) / 2);
		color: var(--panel);
		animation: grow calc(1600ms * var(--pace)) var(--enter-ease) calc(450ms * var(--pace)) backwards;
	}

	.window {
		--rise: 6px;
		--blur: 8px;
		--duration: 1400ms;
		--delay: 350ms;
		position: relative;
		container-type: inline-size;
	}

	figcaption {
		max-width: 560px;
		margin: 24px auto 0;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
		text-align: center;
		text-wrap: balance;
	}

	@keyframes grow {
		from {
			--grow: 0;
		}
	}

	@keyframes swell {
		from {
			opacity: 0;
			scale: 0.6;
		}
	}

	/* The card is the hero at rest in 1200x630: no entrance, the headline at its widest size, a tighter frame around
	   it, and the window cut off by the bottom edge. */
	.card .intro {
		padding-block: 32px 40px;
	}

	.card h1 {
		font-size: 68px;
	}

	.card .plate {
		padding-top: 48px;
	}

	.card .intro > *,
	.card .window,
	.card .horizon,
	.card .gl,
	.card .plate::before {
		animation: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.eyebrow:hover {
			box-shadow: inset 0 0 0 1px var(--border-default);
			color: var(--fg-default);
		}

		.eyebrow:hover :global(.ahead) {
			translate: 2px 0;
		}
	}

	@media (max-width: 1023px) {
		.intro {
			padding-top: 56px;
		}
	}

	@media (max-width: 639px) {
		.plate {
			padding: 40px 0;
		}

		.window {
			padding-inline: 12px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.intro > :global(*),
		.window {
			animation: fade-in 400ms ease backwards;
		}

		.horizon,
		.gl,
		.plate {
			animation: none;
		}
	}
</style>
