<!-- A question guide (src/lib/questions.ts): the answer first, then the recorders of its group side by side, each in
     short, those left out and why, what the next years cost, how to choose, what Grip does not do, the questions,
     and every source. Every fact about another product opens the page it was read from. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import Arrow from '#lib/Arrow.svelte';
	import { CHECKED, CHECKED_ON, FACTS, GROUPS, RECORDERS } from '#lib/benchmark.ts';
	import Cost from '#lib/Cost.svelte';
	import Ending from '#lib/Ending.svelte';
	import Facts from '#lib/Facts.svelte';
	import Head from '#lib/Head.svelte';
	import Questions from '#lib/Questions.svelte';
	import { BENCHMARK, DOWNLOAD_URL, GITHUB_URL, GUIDES, SITE_URL } from '#lib/links.ts';
	import { LIMITS, recorder, sources } from '#lib/questions.ts';
	import type { Line } from '#lib/versus.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const question = $derived(data.question);
	const path = $derived(`/guides/${question.slug}`);
	const group = $derived(GROUPS.find(({ id }) => id === question.group));
	const members = $derived(question.entries.map(({ id }) => recorder(id)));
	const fine = $derived(
		question.cost.ids.flatMap((id) => recorder(id).plans.flatMap(({ fine }) => (fine ? [fine] : []))),
	);

	const jsonld = $derived([
		{
			'@type': 'Article',
			headline: question.h1,
			description: question.description,
			url: `${SITE_URL}${path}`,
			dateModified: CHECKED,
			author: { '@type': 'Organization', name: 'Bestboy', url: 'https://bestboy.dev' },
			publisher: { '@type': 'Organization', name: 'Bestboy', url: 'https://bestboy.dev' },
		},
		{
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'Grip', item: SITE_URL },
				{ '@type': 'ListItem', position: 2, name: 'Guides', item: `${SITE_URL}/guides` },
				{ '@type': 'ListItem', position: 3, name: question.h1, item: `${SITE_URL}${path}` },
			],
		},
		{
			'@type': 'ItemList',
			name: question.h1,
			numberOfItems: members.length,
			itemListElement: members.map(({ id, name }, i) => ({
				'@type': 'ListItem',
				position: i + 1,
				name,
				url: id === 'grip' ? SITE_URL : `${SITE_URL}/vs/${id}`,
			})),
		},
		{
			'@type': 'FAQPage',
			mainEntity: question.faqs.map(({ question, answer }) => ({
				'@type': 'Question',
				name: question,
				acceptedAnswer: { '@type': 'Answer', text: answer },
			})),
		},
	]);
</script>

<Head title={question.title} description={question.description} {path} {jsonld} />

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

<section class="wrap page-head">
	<nav class="kicker" aria-label="Breadcrumb">
		<a href={GUIDES}>Guides</a><i aria-hidden="true">/</i><span>{group?.label}</span>
	</nav>
	<h1>{question.h1} <span>{question.faint}</span></h1>
	<p class="lede">{question.lede}</p>
	<div class="page-cta">
		<a class="button primary" href={DOWNLOAD_URL}>Download Grip, free</a>
		<a class="arrow-link" href="{BENCHMARK}?compare={members.map(({ id }) => id).join('+')}"
			>These {members.length} beside the other {RECORDERS.length - members.length}<Arrow class="ahead" /></a
		>
	</div>
	<p class="checked">Checked on {CHECKED_ON} · every fact opens its source</p>
</section>

<section id="facts" class="wrap page-part" aria-labelledby="facts-title">
	<h2 id="facts-title">Side by side</h2>
	<p class="sub">Each value as its maker states it. Point at one, and its arrow opens the page it was read from.</p>
	<Facts recorders={members} rows={question.rows} />
</section>

<section id="each" class="wrap page-part" aria-labelledby="each-title">
	<h2 id="each-title">Each one in short</h2>
	<div class="each">
		{#each question.entries as { id, lines: said } (id)}
			{@const { name } = recorder(id)}
			<article>
				<h3>{name}</h3>
				{@render lines(said, name)}
				{#if id !== 'grip'}
					<a class="arrow-link" href={resolve('/(site)/vs/[id]', { id })}>Grip and {name}, side by side<Arrow class="ahead" /></a>
				{/if}
			</article>
		{/each}
	</div>
</section>

<section id="out" class="wrap page-part" aria-labelledby="out-title">
	<h2 id="out-title">Not in this list, and why</h2>
	<p class="sub">The other recorders compared here, each with the fact that leaves it out.</p>
	<ul class="lines">
		{#each question.out as { id, key, text, guide } (id)}
			{@const { name, facts } = recorder(id)}
			<li>
				{text}&NoBreak;<a
					class="source-arrow"
					href={facts[key].source}
					rel="noopener"
					aria-label="Source: {name}, {FACTS.find((fact) => fact.key === key)?.label.toLowerCase()}"><Arrow /></a
				>{#if guide}
					<a class="guide" href="{GUIDES}/{guide}">Read the license guide</a>{/if}
			</li>
		{/each}
	</ul>
</section>

<section id="cost" class="wrap page-part" aria-labelledby="cost-title">
	<h2 id="cost-title">{question.cost.title}</h2>
	<p class="sub">{question.cost.sub}</p>
	<Cost ids={question.cost.ids} />
	{#each fine as line (line)}
		<p class="fine-print">{line}</p>
	{/each}
</section>

<section id="choose" class="wrap page-part" aria-labelledby="choose-title">
	<h2 id="choose-title">How to choose</h2>
	{@render lines(question.picks, 'how to choose')}
	<h2 class="limits-title">What Grip does not do</h2>
	<ul class="lines">
		{#each LIMITS as limit (limit)}
			<li>{limit}</li>
		{/each}
	</ul>
</section>

<Questions faqs={question.faqs} />

<section id="sources" class="wrap page-part" aria-labelledby="sources-title">
	<h2 id="sources-title">Sources</h2>
	<p class="sub">
		Read on {CHECKED_ON}. Found one that is wrong or out of date?
		<a href="{GITHUB_URL}/issues">Open an issue</a> and it gets fixed.
	</p>
	<ol class="sources">
		{#each sources(question) as { url, label } (url)}
			<li><a href={url} rel="noopener">{label}</a></li>
		{/each}
	</ol>
</section>

<Ending
	title="Record the next one in Grip."
	sub="Free for work, with no account and no watermark. Every update is free too."
/>

<style>
	.each {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 40px 64px;
		margin-top: 28px;
	}

	.each article {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}

	.each .lines {
		margin-top: 12px;
	}

	.each .arrow-link {
		margin-top: 16px;
		font-size: 14px;
	}

	h3 {
		font-size: 20px;
		font-weight: 550;
		line-height: 26px;
		letter-spacing: -0.02em;
	}

	.guide {
		margin-left: 4px;
		color: var(--fg-default);
		font-weight: 500;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
		white-space: nowrap;
	}

	.limits-title {
		margin-top: 48px;
	}

	@media (max-width: 859px) {
		.each {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
