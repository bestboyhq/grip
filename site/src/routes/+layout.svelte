<!-- Every page's type and styles. The site's pages wear its bar and footer from `(site)`; the Open Graph card (`og`)
     is the hero alone. -->
<script lang="ts">
	import '@fontsource-variable/inter/opsz.css';
	import inter from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
	import '../app.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<link
		rel="preload"
		href={inter}
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
		fetchpriority="high"
	/>
</svelte:head>

{@render children()}
