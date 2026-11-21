<!-- Every guide, the questions first (src/lib/questions.ts), then the licenses (src/lib/guides.ts): its title, one
     line, and an arrow to it. -->
<script lang="ts">
	import Arrow from '#lib/Arrow.svelte';
	import { RECORDERS } from '#lib/benchmark.ts';
	import Head from '#lib/Head.svelte';
	import { GUIDES } from '#lib/links.ts';
	import { READING } from '#lib/questions.ts';
</script>

<Head
	title="Mac screen recorder guides, with sources - Grip"
	description="Which Mac screen recorders are open source, free for work, or sold with no subscription, and what a one-time license gives you now, each fact sourced."
	path="/guides"
/>

<section class="wrap page-head">
	<p class="kicker">Guides</p>
	<h1>Guides to Mac screen recorders <span>One question each, answered with sources.</span></h1>
	<p class="lede">
		Which recorders are open source, which cost nothing for work, which need no subscription, and what a
		one-time license gives you now. Each guide answers from the facts of the {RECORDERS.length} recorders in the
		benchmark, read from their makers’ own pages, and links every fact to its source.
	</p>
</section>

<section class="wrap page-part list-part" aria-label="Guides">
	<ul class="list">
		{#each READING as { slug, h1, line } (slug)}
			<li>
				<h2>{h1}</h2>
				<p>{line}</p>
				<a class="arrow-link" href="{GUIDES}/{slug}"
					>Read the guide<span class="sr-only">: {h1}</span><Arrow class="ahead" /></a
				>
			</li>
		{/each}
	</ul>
</section>

<style>
	.list-part {
		padding-bottom: 96px;
	}

	.list {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 40px 64px;
		list-style: none;
	}

	.list li {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.list p {
		max-width: 520px;
		color: var(--fg-muted);
		font-size: 16px;
		line-height: 1.65;
		text-wrap: pretty;
	}

	.arrow-link {
		margin-top: 8px;
	}

	@media (max-width: 859px) {
		.list-part {
			padding-bottom: 72px;
		}

		.list {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
