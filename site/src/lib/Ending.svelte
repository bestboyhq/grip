<!-- The last part of a page that reads as a document (app.css `.page-part`): one line, an optional one under it, and the
     download. The home page has its own, Closing.svelte. -->
<script lang="ts">
	import { DOWNLOAD_URL } from './links.ts';

	let { title, sub }: { title: string; sub?: string } = $props();
</script>

<section id="start" class="wrap page-part end" aria-labelledby="start-title" data-place="closing">
	<h2 id="start-title">{title}</h2>
	{#if sub}<p class="sub">{sub}</p>{/if}
	<div class="page-cta">
		<a class="button primary" href={DOWNLOAD_URL}>Download for Mac</a>
		<span class="checked">Free · macOS 15 or later · Apple silicon</span>
	</div>
</section>

<style>
	.end {
		padding-block: 88px 112px;
	}

	.end h2 {
		font-size: clamp(30px, 3.4vw, 40px);
		line-height: 1.1;
		letter-spacing: -0.03em;
	}

	@media (max-width: 859px) {
		.end {
			padding-block: 64px 80px;
		}
	}
</style>
