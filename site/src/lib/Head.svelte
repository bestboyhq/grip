<script lang="ts">
	import { SITE_URL } from './links.ts';
	// The hero rendered by `scripts/og.ts`. Its URL carries a hash of its content, and the sites that unfurl a link
	// cache an image by its URL, so a new image is never served from an old one's cache.
	import og from './og.jpg';

	// `jsonld` is the page's structured data, schema.org objects without their `@context`.
	type Props = {
		title: string;
		description: string;
		path: string;
		noindex?: boolean;
		jsonld?: readonly Readonly<Record<string, unknown>>[];
	};

	let { title, description, path, noindex = false, jsonld = [] }: Props = $props();

	const canonical = $derived(`${SITE_URL}${path}`);
	// "<" is escaped so that no text in the data can close the script element.
	const data = $derived(
		JSON.stringify({ '@context': 'https://schema.org', '@graph': jsonld }).replaceAll('<', '\\u003c'),
	);
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
		content="Grip's page: Professional recordings and screenshots within seconds. Below, Grip's editor playing a take of a deployments dashboard, its glass loupe over a build that is Ready."
	/>
	<meta name="twitter:card" content="summary_large_image" />
	{#if jsonld.length}
		{@html `<script type="application/ld+json">${data}</script>`}
	{/if}
</svelte:head>
