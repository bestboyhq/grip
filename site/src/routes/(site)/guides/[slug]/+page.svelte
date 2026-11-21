<!-- A license guide (src/lib/guides.ts): the question in the reader's words and its answer first, then what they have
     now for each way they bought, how the license changed, what the next years cost, and Grip with what it does not
     do. Every fact about another product opens the page it was read from. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import Arrow from '#lib/Arrow.svelte';
	import { RECORDERS } from '#lib/benchmark.ts';
	import Cost from '#lib/Cost.svelte';
	import { CHECKED, OURS, PUBLISHED, type Said } from '#lib/guides.ts';
	import Ending from '#lib/Ending.svelte';
	import Head from '#lib/Head.svelte';
	import Questions from '#lib/Questions.svelte';
	import { DOWNLOAD_URL, GITHUB_URL, SITE_URL } from '#lib/links.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const guide = $derived(data.guide);

	const GUIDES = resolve('/(site)/guides');
	const path = $derived(`/guides/${guide.slug}`);
	const name = $derived(RECORDERS.find(({ id }) => id === guide.recorder)?.name ?? guide.recorder);
	const checked = new Date(`${CHECKED}T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	});

	// The pick shows its answers; a new pick fades them in, and the first one, built with the page, does not.
	let picked = $derived(guide.have.picked);
	let fresh = $state(false);
	const answers = $derived(guide.have.picks.find(({ id }) => id === picked)?.answers ?? []);
	function pick(id: string) {
		picked = id;
		fresh = true;
	}

	const jsonld = $derived([
		{
			'@type': 'Article',
			headline: guide.h1,
			description: guide.description,
			url: `${SITE_URL}${path}`,
			datePublished: PUBLISHED,
			dateModified: CHECKED,
			author: { '@type': 'Organization', name: 'Bestboy', url: 'https://bestboy.dev' },
			publisher: { '@type': 'Organization', name: 'Bestboy', url: 'https://bestboy.dev' },
		},
		{
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'Grip', item: SITE_URL },
				{ '@type': 'ListItem', position: 2, name: 'Guides', item: `${SITE_URL}/guides` },
				{ '@type': 'ListItem', position: 3, name: guide.h1, item: `${SITE_URL}${path}` },
			],
		},
		{
			'@type': 'FAQPage',
			mainEntity: guide.faqs.map(({ question, answer }) => ({
				'@type': 'Question',
				name: question,
				acceptedAnswer: { '@type': 'Answer', text: answer },
			})),
		},
	]);
</script>

<Head title={guide.title} description={guide.description} path={path} {jsonld} />

<!-- Sentences, each fact's arrow on the end of its last line. -->
{#snippet said(parts: readonly Said[])}
	{#each parts as { text, source }, i (i)}{i ? ' ' : ''}{text}{#if source}&NoBreak;<a
				class="source-arrow"
				href={source.href}
				rel="noopener"
				aria-label="Source: {source.label}"><Arrow /></a
			>{/if}{/each}
{/snippet}

<section class="wrap page-head">
	<nav class="kicker" aria-label="Breadcrumb">
		<a href={GUIDES}>Guides</a>
		{#each guide.crumb as crumb (crumb)}<i aria-hidden="true">/</i><span>{crumb}</span>{/each}
	</nav>
	<h1>{guide.h1} <span>{guide.quiet}</span></h1>
	<p class="lede">
		{#each guide.lede as part, i (i)}{#if typeof part === 'string'}{part}{:else}<b>{part.b}</b>{/if}{/each}
	</p>
	<div class="page-cta">
		<a class="button primary" href={DOWNLOAD_URL}>Download Grip, free</a>
		<a class="arrow-link" href={resolve('/(site)/vs/[id]', { id: guide.recorder })}
			>Grip and {name}, side by side<Arrow class="ahead" /></a
		>
	</div>
	<p class="checked">Checked on {checked} · every fact opens its source</p>
</section>

<section class="wrap page-part" aria-labelledby="have-title">
	<h2 id="have-title">What you have now</h2>
	<p class="sub">{guide.have.sub}</p>
	<div class="pick" role="group" aria-label={guide.have.group}>
		{#each guide.have.picks as { id, chip } (id)}
			<button type="button" aria-pressed={picked === id} onclick={() => pick(id)}>{chip}</button>
		{/each}
	</div>
	<ul class="cells" class:fresh aria-live="polite">
		{#key answers}
			{#each answers as { label, value, tone, note } (label)}
				<li>
					<span class="label">{label}</span>
					<span class={['mark', tone]}>{value}</span>
					<p>{@render said(note)}</p>
				</li>
			{/each}
		{/key}
		<li class="ours">
			<span class="label">{OURS.label}</span>
			<span class={['mark', OURS.tone]}>{OURS.value}</span>
			<p>{@render said(OURS.note)}</p>
		</li>
	</ul>
</section>

<section class="wrap page-part" aria-labelledby="years-title">
	<h2 id="years-title">How the license changed</h2>
	<p class="sub">{guide.changed.sub}</p>
	<ol class="years" style:--n={guide.changed.steps.length}>
		{#each guide.changed.steps as { when, datetime, title, note } (datetime)}
			<li>
				<time {datetime}>{when}</time>
				<b>{title}</b>
				<p>{@render said(note)}</p>
			</li>
		{/each}
	</ol>
</section>

<section class="wrap page-part" aria-labelledby="cost-title">
	<h2 id="cost-title">What the next years cost</h2>
	<p class="sub">{guide.cost.sub}</p>
	<Cost ids={guide.cost.ids} />
	<p class="fine-print">{@render said(guide.cost.fine)}</p>
</section>

<section class="wrap page-part" aria-labelledby="grip-title">
	<h2 id="grip-title">A license with no end date</h2>
	<p class="sub">{guide.grip.sub}</p>
	<ul class="cells">
		{#each guide.grip.cells as { title, note }, i (title)}
			<li>
				<span class="label" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
				<h3>{title}</h3>
				<p>{@render said(note)}</p>
			</li>
		{/each}
	</ul>
	<h2 id="limits-title" class="limits-title">What Grip does not do</h2>
	<ul class="lines" aria-labelledby="limits-title">
		{#each guide.limits as limit, i (i)}
			<li>{@render said(limit)}</li>
		{/each}
	</ul>
</section>

<Questions faqs={guide.faqs} />

<section class="wrap page-part" aria-labelledby="sources-title">
	<h2 id="sources-title">Sources</h2>
	<p class="sub">
		Read on {checked}. Found one that is wrong or out of date?
		<a href="{GITHUB_URL}/issues">Open an issue</a> and it gets fixed.
	</p>
	<ol class="sources">
		{#each guide.sources as { href, label } (href)}
			<li><a {href} rel="noopener">{label}</a></li>
		{/each}
	</ol>
</section>

<Ending title={guide.close} />

<style>
	/* A row of cells from rail to rail, as the landing page's. */
	.cells {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		margin: 32px calc(-1 * max(var(--pad), env(safe-area-inset-left))) 0;
		list-style: none;
		border-bottom: 1px solid var(--frame);
	}

	.cells li {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 28px var(--pad) 32px;
		border-top: 1px solid var(--frame);
	}

	.cells li + li {
		border-left: 1px solid var(--frame);
	}

	.label {
		margin-bottom: 6px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.mark {
		position: relative;
		padding-left: 16px;
		font-size: 19px;
		font-weight: 550;
		line-height: 1.3;
		letter-spacing: -0.015em;
		text-wrap: balance;
	}

	.mark::before {
		content: '';
		position: absolute;
		top: 9px;
		left: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--fg-faint);
	}

	.mark.good::before {
		background: var(--success);
	}

	.mark.bad::before {
		background: var(--error-content);
	}

	.cells p {
		color: var(--fg-muted);
		font-size: 14px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.cells h3 {
		font-size: 17px;
		font-weight: 550;
		line-height: 1.4;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}

	.cells .ours {
		background: var(--surface-elevated);
	}

	/* A new answer fades in where the old one stood: each pick builds its cells anew, so the fade starts over. */
	@media (prefers-reduced-motion: no-preference) {
		.fresh li:not(.ours) > :not(.label) {
			animation: fade-in 240ms var(--ease);
		}
	}

	/* The license over the years: its dates on one line. */
	.years {
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		gap: 0 24px;
		margin-top: 40px;
		list-style: none;
	}

	.years li {
		position: relative;
		padding-top: 24px;
		border-top: 1px solid var(--border-default);
	}

	.years li::before {
		content: '';
		position: absolute;
		top: -4px;
		left: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--fg-faint);
	}

	.years li:last-child::before {
		background: var(--fg-default);
	}

	.years time {
		display: block;
		color: var(--fg-secondary);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.years b {
		display: block;
		margin-top: 10px;
		font-size: 16px;
		font-weight: 550;
		line-height: 1.35;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}

	.years p {
		margin-top: 6px;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.limits-title {
		margin-top: 56px;
	}

	@media (max-width: 1023px) {
		.cells {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.cells li:nth-child(odd) {
			border-left: 0;
		}

		.years {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
		}
	}

	@media (max-width: 639px) {
		.cells {
			grid-template-columns: minmax(0, 1fr);
		}

		.cells li + li {
			border-left: 0;
		}
	}
</style>
