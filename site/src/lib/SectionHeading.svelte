<script lang="ts">
	import type { Snippet } from 'svelte';
	import BeatLabel, { type Beat } from './BeatLabel.svelte';

	type Props = {
		id: string;
		beat: Beat;
		title: string;
		quiet?: string;
		description?: string;
		split?: boolean;
		children?: Snippet;
		after?: Snippet;
	};

	let { id, beat, title, quiet, description, split = false, children, after }: Props = $props();
</script>

<section {id} class={['beat', { flush: after }]} aria-labelledby="{id}-title">
	<div class="wrap">
		<BeatLabel {...beat} centered={!split} />
		<header class={split ? 'split' : 'center'}>
			<h2 id="{id}-title" class="rise">
				<span>{title}</span>
				{#if quiet}<span class="quiet">{quiet}</span>{/if}
			</h2>
			{#if description || children}
				<div class="aside rise">
					{#if description}<p>{description}</p>{/if}
					{@render children?.()}
				</div>
			{/if}
		</header>
		{@render after?.()}
	</div>
</section>

<style>
	.flush {
		padding-bottom: 0;
	}

	h2 {
		max-width: 960px;
		font-size: clamp(34px, 4.6vw, 52px);
		font-weight: 550;
		line-height: 1.06;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	h2 span {
		display: block;
	}

	.quiet {
		color: var(--fg-faint);
	}

	p {
		max-width: 560px;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.center {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.center h2 {
		max-width: 1040px;
	}

	.center .aside {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-top: 20px;
	}

	.center p {
		max-width: 620px;
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
		gap: 20px 80px;
		align-items: end;
	}

	@media (max-width: 859px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}

		p {
			font-size: 17px;
		}
	}
</style>
