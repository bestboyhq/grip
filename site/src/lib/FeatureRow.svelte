<script lang="ts">
	import type { Snippet } from 'svelte';
	import Arrow from './Arrow.svelte';
	import BeatLabel, { type Beat } from './BeatLabel.svelte';
	import StageLight from './StageLight.svelte';

	type Props = {
		id: string;
		beat: Beat;
		title: string;
		body: string;
		href: string;
		linkLabel: string;
		checks: string[];
		mirrored?: boolean;
		children: Snippet;
	};

	let {
		id,
		beat,
		title,
		body,
		href,
		linkLabel,
		checks,
		mirrored = false,
		children,
	}: Props = $props();

	let windowElement = $state<HTMLElement>();
	let lit = $state(false);
	// The stage light casts the shadow of the window's screenshot or clip.
	const caster = $derived(windowElement?.firstElementChild ?? undefined);
</script>

<section {id} class="beat feature" aria-labelledby="{id}-title">
	<div class={['row', { mirrored }]}>
		<div class="words">
			<BeatLabel {...beat} />
			<h3 id="{id}-title" class="rise">{title}</h3>
			<p class="rise">{body}</p>
			<a class="arrow-link rise" {href}>
				{linkLabel}
				<Arrow class="ahead" />
			</a>
			<ul class="checks rise">
				{#each checks as check (check)}
					<li>
						<svg class="tick" viewBox="0 0 16 16" aria-hidden="true">
							<path d="M3.5 8.4 6.6 11.4 12.5 4.8" />
						</svg>
						{check}
					</li>
				{/each}
			</ul>
		</div>
		<div class="stage">
			<StageLight side={mirrored ? 'right' : 'left'} {caster} bind:lit />
			<div class={['window', 'rise', { lit }]} bind:this={windowElement}>{@render children()}</div>
		</div>
	</div>
</section>

<style>
	.feature {
		padding: 0;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
		max-width: var(--col);
		margin: 0 auto;
	}

	.row.mirrored {
		grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
	}

	.words {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 80px var(--pad);
	}

	.mirrored .words {
		order: 2;
	}

	h3 {
		font-size: 24px;
		font-weight: 550;
		line-height: 30px;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}

	p {
		max-width: 440px;
		margin: 12px 0 24px;
		color: var(--fg-muted);
		font-size: 16px;
		line-height: 1.65;
		text-wrap: pretty;
	}

	.checks {
		display: grid;
		gap: 12px;
		margin-top: 32px;
		list-style: none;
	}

	.checks li {
		display: flex;
		gap: 12px;
		color: var(--fg-default);
		font-family: var(--mono);
		font-size: 13px;
		line-height: 20px;
	}

	.tick {
		flex: none;
		width: 16px;
		height: 16px;
		margin-top: 2px;
		fill: none;
		stroke: var(--success);
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.stage {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 64px 48px;
		border-left: 1px solid var(--frame);
	}

	.mirrored .stage {
		border-right: 1px solid var(--frame);
		border-left: 0;
	}

	.window {
		position: relative;
		width: 100%;
		max-width: 620px;
	}

	/* Lit, the stage draws the window's long shadow, which a CSS shadow draws in steps. */
	.window.lit > :global(*) {
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08);
	}

	@media (max-width: 1023px) {
		.row,
		.row.mirrored {
			grid-template-columns: minmax(0, 1fr);
		}

		.words,
		.mirrored .words {
			order: 0;
			padding: 80px var(--pad) 56px;
		}

		.stage,
		.mirrored .stage {
			padding: 40px var(--pad);
			border-top: 1px solid var(--frame);
			border-inline: 0;
		}
	}

	@media (max-width: 559px) {
		.stage,
		.mirrored .stage {
			padding: 32px 12px;
		}
	}
</style>
