<script lang="ts">
	import { SITE_URL } from './links.ts';
	// The hero rendered by `scripts/og.ts`. Its URL carries a hash of its content, and the sites that unfurl a link
	// cache an image by its URL, so a new image is never served from an old one's cache.
	import og from './og.jpg';

	type Props = { title: string; description: string; path: string; noindex?: boolean };

	let { title, description, path, noindex = false }: Props = $props();

	const canonical = $derived(`${SITE_URL}${path}`);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	{#if noindex}
		<meta name="robots" content="noindex" />
	{:else}
		<link rel="canonical" href={canonical} />
	{/if}
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Grip" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={new URL(og, SITE_URL).href} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="Grip's page: Professional recordings and screenshots within seconds. Below, a deployments dashboard Grip polished, its glass loupe magnifying a new build's timer."
	/>
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>
