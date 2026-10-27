<script lang="ts">
	import { docHref, HOME } from '#lib/links.ts';
	import Head from '#lib/Head.svelte';
</script>

<Head title="Not found - Grip" description="This page does not exist." path="/404" noindex />

<section class="wrap missing">
	<p class="code">404</p>
	<h1>Not found</h1>
	<p class="sub">This page does not exist.</p>
	<div class="actions">
		<a class="button primary" href={HOME}>Go home</a>
		<a class="button secondary" href={docHref()}>Read the docs</a>
	</div>
</section>

<style>
	.missing {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-block: 112px;
		text-align: center;
	}

	.code {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	h1 {
		margin-top: 20px;
		font-size: clamp(30px, 3.4vw, 40px);
		font-weight: 550;
		line-height: 1.1;
		letter-spacing: -0.03em;
	}

	.sub {
		margin-top: 20px;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1.55;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
		margin-top: 32px;
	}
</style>
