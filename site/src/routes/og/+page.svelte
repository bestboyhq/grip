<!-- The Open Graph image's source: the hero as a card, which `scripts/og.ts` renders at 1200x630 into `$lib/og.jpg`.
     Nothing links here, and search engines are told to skip it. -->
<script lang="ts">
	import Hero from '#lib/Hero.svelte';
</script>

<svelte:head>
	<title>Open Graph card - Grip</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Hero card />

<style>
	/* One still frame: no scrolling, and no scrollbar gutter whatever the system's scrollbar setting. */
	:global(html) {
		overflow: hidden;
		scrollbar-gutter: auto;
	}
</style>
