<!-- Quotes from people who use Grip, as color cards drifting across the column and under its rails. Hovering holds
     the drift, the button stops it, and under reduced motion the cards sit in a row you scroll by hand. -->
<script lang="ts" module>
	export type Quote = Readonly<{ quote: string; name: string; role: string }>;
</script>

<script lang="ts">
	let { quotes }: { quotes: readonly Quote[] } = $props();

	let paused = $state(false);

	const FILLS = ['painting', 'paper', 'blue', 'graphite'] as const;

	// Colors cycle; when the list would end on the color it starts with, the last card takes blue so no two cards
	// in a row match across the loop's seam.
	const fill = (index: number) =>
		FILLS[index === quotes.length - 1 && index % FILLS.length === 0 && index > 0 ? 2 : index % FILLS.length];
</script>

<div class="quotes rise">
	<div class={['lane', { paused }]}>
		<ul class="track" style:--count={quotes.length}>
			<!-- The list twice, so the drift loops without a seam; the copy is hidden from assistive tech. -->
			{#each [false, true] as copy (copy)}
				{#each quotes as item, index (item.quote)}
					<li class={index % 2 ? 'narrow' : 'wide'} aria-hidden={copy || undefined}>
						<figure class={fill(index)}>
							<blockquote><p>{item.quote}</p></blockquote>
							<figcaption><b>{item.name}</b><span>{item.role}</span></figcaption>
						</figure>
					</li>
				{/each}
			{/each}
		</ul>
	</div>
	<button
		class="pause"
		type="button"
		aria-label="Pause the quotes"
		aria-pressed={paused}
		onclick={() => (paused = !paused)}
	>
		<svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor" aria-hidden="true">
			{#if paused}
				<path
					d="M2.5 1.2v7.6a.5.5 0 0 0 .76.43l6.2-3.8a.5.5 0 0 0 0-.86l-6.2-3.8a.5.5 0 0 0-.76.43Z"
				/>
			{:else}
				<rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
				<rect x="6" y="1" width="2.5" height="8" rx="0.5" />
			{/if}
		</svg>
	</button>
</div>

<style>
	.quotes {
		margin-top: 72px;
		padding-bottom: 112px;
	}

	.lane {
		margin-inline: calc(-1 * max(var(--pad), env(safe-area-inset-left)));
		overflow: hidden;
	}

	.track {
		display: flex;
		gap: 12px;
		width: max-content;
		list-style: none;
		animation: drift calc(var(--count) * 15s) linear infinite;
	}

	.paused .track {
		animation-play-state: paused;
	}

	@keyframes drift {
		to {
			translate: calc(-50% - 6px) 0;
		}
	}

	li {
		display: flex;
		flex: none;
	}

	.wide {
		width: min(640px, 84vw);
	}

	.narrow {
		width: min(420px, 76vw);
	}

	figure {
		position: relative;
		isolation: isolate;
		display: flex;
		flex: 1;
		flex-direction: column;
		justify-content: space-between;
		gap: 40px;
		min-height: 420px;
		margin: 0;
		padding: 44px 48px 40px;
		border-radius: 20px;
		overflow: hidden;
	}

	figure::after {
		content: '“';
		position: absolute;
		z-index: -1;
		top: -0.18em;
		right: 28px;
		font-size: 360px;
		font-weight: 600;
		line-height: 1;
		opacity: 0.13;
		pointer-events: none;
	}

	.painting {
		background: var(--painting);
		color: #fff;
	}

	.paper {
		background: var(--surface-inverse);
		color: var(--surface-root);
	}

	.blue {
		background: #1957fa;
		color: #fff;
	}

	.graphite {
		background: light-dark(#ececea, #232322);
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		color: var(--fg-default);
	}

	.graphite::after {
		background: var(--painting);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		opacity: 0.85;
	}

	blockquote {
		margin: 0;
	}

	p {
		font-size: clamp(22px, 2.4vw, 32px);
		font-weight: 550;
		line-height: 1.18;
		letter-spacing: -0.03em;
		text-wrap: pretty;
	}

	figcaption {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 14px;
		line-height: 20px;
	}

	figcaption b {
		font-weight: 550;
	}

	figcaption span {
		opacity: 0.72;
	}

	.pause {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		margin: 20px 0 0 auto;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: none;
		box-shadow: inset 0 0 0 1px var(--border-default);
		color: var(--fg-secondary);
		cursor: pointer;
	}

	@media (hover: hover) and (pointer: fine) {
		.lane:hover .track {
			animation-play-state: paused;
		}

		.pause:hover {
			box-shadow: inset 0 0 0 1px var(--border-strong);
			color: var(--fg-default);
		}
	}

	@media (max-width: 1023px) {
		.quotes {
			margin-top: 48px;
		}
	}

	@media (max-width: 639px) {
		figure {
			gap: 32px;
			min-height: 340px;
			padding: 28px 28px 24px;
		}

		figure::after {
			right: 16px;
			font-size: 260px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.track {
			animation: none;
		}

		.lane {
			overflow-x: auto;
			padding-inline: max(var(--pad), env(safe-area-inset-left));
			scroll-padding-inline: max(var(--pad), env(safe-area-inset-left));
			scroll-snap-type: x mandatory;
			scrollbar-width: none;
		}

		li {
			scroll-snap-align: start;
		}

		[aria-hidden='true'],
		.pause {
			display: none;
		}
	}
</style>
