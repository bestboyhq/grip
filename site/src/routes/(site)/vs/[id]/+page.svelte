<!-- Grip and one other recorder of the benchmark (src/lib/versus.ts): the answer first, both side by side in the
     benchmark's own table, who should pick which, what moving means, the questions, and every source. -->
<script lang="ts">
	import Arrow from '#lib/Arrow.svelte';
	import { CHECKED_ON, RECORDERS } from '#lib/benchmark.ts';
	import Cost from '#lib/Cost.svelte';
	import Facts from '#lib/Facts.svelte';
	import Ending from '#lib/Ending.svelte';
	import Head from '#lib/Head.svelte';
	import Questions from '#lib/Questions.svelte';
	import { BENCHMARK, DOWNLOAD_URL, GITHUB_URL, GUIDES, SITE_URL } from '#lib/links.ts';
	import { question } from '#lib/questions.ts';
	import { GRIP, sources, type Line } from '#lib/versus.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const versus = $derived(data.versus);
	const them = $derived(data.them);
	const path = $derived(`/vs/${versus.id}`);
	// The question guide of the first group this recorder is in, one line under the table.
	const asked = $derived(question(versus.id));
	// A recorder that costs nothing either has no cost to chart beside Grip.
	const paid = $derived(them.plans.some(({ over }) => over(5) > 0));
	const fine = $derived(them.plans.flatMap(({ fine }) => (fine ? [fine] : [])));
	// The answer about the license ends with the guide to it.
	const faqs = $derived(
		versus.faqs.map(({ guide, ...faq }) =>
			guide && versus.guide
				? { ...faq, link: { href: `${GUIDES}/${versus.guide.slug}`, label: versus.guide.title } }
				: faq,
		),
	);

	const jsonld = $derived([
		{
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'Grip', item: SITE_URL },
				{ '@type': 'ListItem', position: 2, name: 'Benchmark', item: `${SITE_URL}/benchmark` },
				{ '@type': 'ListItem', position: 3, name: versus.h1, item: `${SITE_URL}${path}` },
			],
		},
		{
			'@type': 'FAQPage',
			mainEntity: versus.faqs.map(({ question, answer }) => ({
				'@type': 'Question',
				name: question,
				acceptedAnswer: { '@type': 'Answer', text: answer },
			})),
		},
	]);
</script>

<Head title={versus.title} description={versus.description} path={path} {jsonld} />

{#snippet lines(items: readonly Line[], label: string)}
	<ul class="lines">
		{#each items as { text, source, guide } (text)}
			<li>
				{text}&NoBreak;<a class="source-arrow" href={source} rel="noopener" aria-label="Source: {label}"><Arrow /></a
				>{#if guide}
					<a class="guide" href="{GUIDES}/{guide}">Read the license guide</a>{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<section class="wrap page-head" data-place="versus">
	<nav class="kicker" aria-label="Breadcrumb">
		<a href={BENCHMARK}>Benchmark</a><i aria-hidden="true">/</i><span>{versus.h1}</span>
	</nav>
	<h1>{versus.h1} <span>{versus.faint}</span></h1>
	<p class="lede">{versus.lede}</p>
	<div class="page-cta">
		<a class="button primary" href={DOWNLOAD_URL}>Download Grip, free</a>
		<a class="arrow-link" href="{BENCHMARK}?compare=grip+{them.id}"
			>Both beside the other {RECORDERS.length - 2}<Arrow class="ahead" /></a
		>
	</div>
	<p class="checked">Checked on {CHECKED_ON} · every fact opens its source</p>
</section>

<section id="facts" class="wrap page-part" aria-labelledby="facts-title">
	<h2 id="facts-title">Side by side</h2>
	<p class="sub">Each value as its maker states it. Point at one, and its arrow opens the page it was read from.</p>
	<Facts recorders={[GRIP, them]} two />
	{#if asked}
		<a class="arrow-link guide-link" href="{GUIDES}/{asked.slug}"
			>{asked.h1}, {them.name} included<Arrow class="ahead" /></a
		>
	{/if}
</section>

{#if paid}
	<section id="cost" class="wrap page-part" aria-labelledby="cost-title">
		<h2 id="cost-title">What the next years cost</h2>
		<p class="sub">
			Recording for work from today, every way {them.name} lists to pay, beside Grip. Move the slider to change
			the years.
		</p>
		<Cost ids={[them.id, 'grip']} />
		{#each fine as line (line)}
			<p class="fine-print">{line}</p>
		{/each}
	</section>
{/if}

<section id="pick" class="wrap page-part" aria-labelledby="pick-title">
	<h2 id="pick-title" class="sr-only">Which one to pick</h2>
	<div class="picks">
		<div>
			<h3>Pick {them.name} if</h3>
			{@render lines(versus.them, them.name)}
		</div>
		<div>
			<h3>Pick Grip if</h3>
			{@render lines(versus.grip, 'Grip')}
		</div>
	</div>
</section>

<section id="moving" class="wrap page-part" aria-labelledby="moving-title">
	<h2 id="moving-title">Moving to Grip</h2>
	<p class="sub">
		Grip opens no other recorder’s projects, {them.name}’s included. It imports any MP4 or MOV with File &gt;
		Import Video (Cmd+I), and each video becomes a new project. An imported video holds no record of your
		clicks, so automatic zoom and the redrawn cursor work on what Grip records.
	</p>
	<p class="sub">
		{versus.moving.text}&NoBreak;<a
			class="source-arrow"
			href={versus.moving.source}
			rel="noopener"
			aria-label="Source: {them.name}"><Arrow /></a
		>
	</p>
	{#if versus.guide}
		<a class="arrow-link guide-link" href="{GUIDES}/{versus.guide.slug}">{versus.guide.title}<Arrow class="ahead" /></a>
	{/if}
	<h2 class="limits-title">What Grip does not do</h2>
	<ul class="lines">
		<li>It runs only on macOS 15 or later, on Apple silicon. There is no Windows, Linux, or Intel version.</li>
		<li>It takes no scrolling screenshots: it captures an area, a window, or a whole display.</li>
		<li>Its support is its GitHub issues. There is no email, chat, or phone support.</li>
	</ul>
</section>

<Questions {faqs} />

<section id="sources" class="wrap page-part" aria-labelledby="sources-title">
	<h2 id="sources-title">Sources</h2>
	<p class="sub">
		Read on {CHECKED_ON}. Found one that is wrong or out of date?
		<a href="{GITHUB_URL}/issues">Open an issue</a> and it gets fixed.
	</p>
	<ol class="sources">
		{#each sources(versus) as { url, label } (url)}
			<li><a href={url} rel="noopener">{label}</a></li>
		{/each}
	</ol>
</section>

<Ending
	title="Record the next one in Grip."
	sub="Free for work, with no account and no watermark. Every update is free too."
/>

<style>
	.guide {
		margin-left: 4px;
		color: var(--fg-default);
		font-weight: 500;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
		white-space: nowrap;
	}

	.guide-link {
		display: flex;
		margin-top: 20px;
	}

	.limits-title {
		margin-top: 48px;
	}

	.picks {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 40px 64px;
	}

	h3 {
		font-size: 24px;
		font-weight: 550;
		line-height: 30px;
		letter-spacing: -0.02em;
	}

	@media (max-width: 859px) {
		.picks {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
