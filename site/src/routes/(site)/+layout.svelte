<script lang="ts">
	import { dev } from '$app/env';
	import { page } from '$app/state';
	import Bar from '#lib/Bar.svelte';
	import Footer from '#lib/Footer.svelte';
	import { HOME } from '#lib/links.ts';
	import { LOGDASH_SITE } from '#lib/logdash.ts';
	import { press, watch } from '#lib/track.ts';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// Only the landing page ends on the sitemap; a missing page hydrates with no route at all, so it is matched by name.
	const product = $derived(page.route.id === '/(site)');

	// Each page counts its parts and depth afresh, so the count starts over when the path changes, not the hash. The
	// landing page hydrates as `/grip/` and turns `/grip` on its first hash link, so the trailing slash is dropped.
	const path = $derived(page.url.pathname.replace(/\/$/u, ''));
	$effect(() => {
		void path;
		return watch();
	});
</script>

<svelte:document onclickcapture={press} onauxclickcapture={press} />

<svelte:head>
	{#if !dev}
		<script
			defer
			src="{HOME}/_ld/script.js"
			data-site={LOGDASH_SITE}
			data-endpoint="{HOME}/_ld/events"
		></script>
	{/if}
</svelte:head>

<div class="site">
	<a class="skip" href="#main">Skip to content</a>
	<Bar />
	<main id="main">
		{@render children()}
	</main>
	<Footer sitemap={product} />
</div>
