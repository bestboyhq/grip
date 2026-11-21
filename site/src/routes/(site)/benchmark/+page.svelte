<!-- Screen recorders side by side (src/lib/benchmark.ts): what each makes of the same scripted take, then a table of
     public facts, each linked to the maker's page it was read from, then how both were made. The one page that
     names other recorders, in plain text; a recorder with no take yet shows in the table alone. -->
<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { asset, resolve } from '$app/paths';
	import Arrow from '#lib/Arrow.svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { CHECKED_ON, compare, compared, FACTS, GROUPS, RECORDERS, SECONDS, SHOWN } from '#lib/benchmark.ts';
	import Cost from '#lib/Cost.svelte';
	import Facts from '#lib/Facts.svelte';
	import Ending from '#lib/Ending.svelte';
	import Head from '#lib/Head.svelte';
	import { GITHUB_URL, GUIDES, SITE_URL } from '#lib/links.ts';
	import { READING } from '#lib/questions.ts';
	import { VERSUS } from '#lib/versus.ts';
	import Media from '#lib/Media.svelte';

	const takes = RECORDERS.filter((recorder) => recorder.take);
	const count = RECORDERS.length;
	const SCRIPT = `${GITHUB_URL}/tree/main/scripts/benchmark`;

	// The recorders in the table, one a column, kept in the address. Every recorder is in the page; the rest only
	// hide, and the last one shown stays. The page is built before anyone asks for it, so a shared pick is read once
	// it runs.
	const shown = new SvelteSet(SHOWN);
	onMount(() => {
		shown.clear();
		for (const id of compared(location.search)) shown.add(id);
	});
	const keep = () => replaceState(`${location.pathname}${compare(shown, location.search)}${location.hash}`, {});
	function pick(id: string) {
		if (shown.has(id)) shown.delete(id);
		else shown.add(id);
		keep();
	}

	// A quick pick shows exactly its group, and is pressed while the table shows that group and no other recorder.
	const quick = [
		{ id: 'all', label: `All ${count}`, ids: RECORDERS.map(({ id }) => id) },
		...GROUPS.map(({ id, label, has }) => ({ id, label, ids: RECORDERS.filter(has).map(({ id }) => id) })),
	];
	const only = (ids: readonly string[]) => ids.length === shown.size && ids.every((id) => shown.has(id));
	function show(ids: readonly string[]) {
		shown.clear();
		for (const id of ids) shown.add(id);
		keep();
	}

	// The cost chart follows the table: the recorders shown, in the table's order, with the fine print of their plans.
	const costed = $derived(RECORDERS.filter(({ id }) => shown.has(id)));
	const fine = $derived(costed.flatMap(({ plans }) => plans.flatMap(({ fine }) => (fine ? [fine] : []))));

	// Each recorder but Grip has its own page beside Grip, and the list names them in the table's order.
	const pages = RECORDERS.flatMap((recorder) => {
		const versus = VERSUS.find(({ id }) => id === recorder.id);
		return versus ? [{ ...versus, name: recorder.name, href: resolve('/(site)/vs/[id]', { id: versus.id }) }] : [];
	});
	const jsonld = [
		{
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'Grip', item: SITE_URL },
				{ '@type': 'ListItem', position: 2, name: 'Benchmark', item: `${SITE_URL}/benchmark` },
			],
		},
		{
			'@type': 'ItemList',
			name: 'Mac screen recorders compared',
			numberOfItems: count,
			itemListElement: RECORDERS.map(({ id, name }, i) => ({
				'@type': 'ListItem',
				position: i + 1,
				name,
				url: id === 'grip' ? SITE_URL : `${SITE_URL}/vs/${id}`,
			})),
		},
	];
</script>

<Head
	title="Mac screen recorders compared, with sources - Grip"
	description="{count} Mac screen recorders compared on price, updates, license, platforms, account, and limits, from Grip to Screen Studio, each fact linked to its source."
	path="/benchmark"
	{jsonld}
/>

<section class="wrap page-head" data-place="benchmark">
	<p class="kicker">Benchmark</p>
	<h1>Mac screen recorders compared <span>Every fact links to its source.</span></h1>
	<p class="lede">
		{count} screen recorders for the Mac, side by side on {FACTS.length} public facts: what each costs, how long
		its updates last, its license, where it runs, and what it asks of you. Each fact is read from its maker’s
		own pages on {CHECKED_ON}, and links to them. {#if takes.length}Each recorder also films the same
			{SECONDS} seconds.{:else}It holds no measurements and no recordings: only what the makers publish.{/if}
	</p>
</section>

{#if takes.length}
	<section id="takes" class="wrap page-part" aria-labelledby="takes-title">
		<h2 id="takes-title">One take, {takes.length} recorders</h2>
		<p class="sub">
			A script plays the same clicks, typing, and scroll on the same page. Each recorder films it at the
			settings it ships with.
		</p>
		<ul class="takes">
			{#each RECORDERS as recorder (recorder.id)}
				{#if recorder.take}
					{@const { id, name, take } = recorder}
					<li>
						<Media
							clip={{ src: asset(`media/benchmark-${id}.mp4`), still: asset(`media/benchmark-${id}.webp`) }}
							width={take.width}
							height={take.height}
							r={take.width / 80}
							alt="The take as {name} {take.version} exports it at its default settings."
							flat
						/>
						<p><b>{name}</b> {take.version}</p>
					</li>
				{/if}
			{/each}
		</ul>
	</section>
{/if}

<section id="facts" class="wrap page-part" aria-labelledby="facts-title">
	<h2 id="facts-title">The facts</h2>
	<p class="sub">Read from each maker’s own pages on {CHECKED_ON}.</p>
	<div class="pick quick" role="group" aria-label="Recorders to show">
		<span>Show</span>
		{#each quick as { id, label, ids } (id)}
			<button type="button" aria-pressed={only(ids)} onclick={() => show(ids)}>{label}</button>
		{/each}
	</div>
	<div class="pick" role="group" aria-label="Recorders to compare">
		{#each RECORDERS as { id, name } (id)}
			<button
				type="button"
				aria-pressed={shown.has(id)}
				disabled={shown.size === 1 && shown.has(id)}
				onclick={() => pick(id)}>{name}</button
			>
		{/each}
	</div>
	<Facts recorders={RECORDERS} {shown} />
</section>

<section id="cost" class="wrap page-part" aria-labelledby="cost-title">
	<h2 id="cost-title">What the next years cost</h2>
	<p class="sub">
		Recording for work from today, every way each recorder in the table lists to pay. Pick recorders above, and
		move the slider to change the years.
	</p>
	<Cost ids={costed.map(({ id }) => id)} scale={RECORDERS.map(({ id }) => id)} />
	{#each fine as line (line)}
		<p class="fine-print">{line}</p>
	{/each}
</section>

<section id="versus" class="wrap page-part" aria-labelledby="versus-title">
	<h2 id="versus-title">Grip beside each one</h2>
	<p class="sub">One page a recorder: both side by side, who should pick which, and the questions people ask.</p>
	<ul class="versus">
		{#each pages as { id, name, faint, href } (id)}
			<li>
				<a class="arrow-link" {href}>Grip vs {name}<Arrow class="ahead" /></a>
				<p>{faint}</p>
			</li>
		{/each}
	</ul>
</section>

<section id="guides" class="wrap page-part" aria-labelledby="guides-title">
	<h2 id="guides-title">Guides</h2>
	<p class="sub">One question each, answered from these facts. <a href={GUIDES}>Every guide</a></p>
	<ul class="versus reading">
		{#each READING as { slug, h1, line } (slug)}
			<li>
				<a class="arrow-link" href="{GUIDES}/{slug}">{h1}<Arrow class="ahead" /></a>
				<p>{line}</p>
			</li>
		{/each}
	</ul>
</section>

<section id="method" class="wrap page-part" aria-labelledby="method-title">
	<h2 id="method-title">How this is made</h2>
	<ul class="rules">
		{#if takes.length}
			<li>
				<b><a href={SCRIPT}>One script.</a></b>
				It opens one page and sends the same clicks, typing, and scroll through macOS at the same times, so a
				recorder sees them as it sees yours.
			</li>
			<li>
				<b>Default settings.</b>
				Every recorder films the take as it ships. Nothing is edited after but the ends of the take, cut off.
			</li>
			<li><b>Nothing hidden.</b> A free plan’s watermark and limits stay in the recording.</li>
			<li>
				<b>Only where allowed.</b>
				A recorder whose license keeps its recordings out of a comparison has no take here.
			</li>
		{/if}
		<li>
			<b>First-hand facts.</b>
			Each one comes from the maker’s own page where there is one: point at a fact, and its arrow opens the
			page it was read from.
		</li>
		<li>
			<b>Made by Grip’s makers.</b>
			Found a fact that is wrong or out of date? <a href="{GITHUB_URL}/issues">Open an issue</a> and it gets
			fixed.
		</li>
	</ul>
</section>

<Ending
	title="Record the next one in Grip."
	sub="Free for work, with no account and no watermark. Every update is free too."
/>

<style>
	.takes {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 40px 24px;
		align-items: start;
		margin-top: 32px;
		list-style: none;
	}

	.takes p {
		margin-top: 12px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.takes b {
		margin-right: 4px;
		color: var(--fg-default);
		font-family: var(--sans);
		font-size: 15px;
		font-weight: 550;
	}

	/* The quick picks: a second, lighter row above the recorders, with no ring until one is in hand. */
	.quick {
		align-items: center;
		gap: 4px;
	}

	.quick + .pick {
		margin-top: 12px;
	}

	.quick span {
		margin-right: 6px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.quick button {
		height: 24px;
		padding: 0 9px;
		box-shadow: none;
		font-size: 12px;
	}

	.versus {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 28px 32px;
		margin-top: 24px;
		list-style: none;
	}

	.versus p {
		margin-top: 4px;
		color: var(--fg-muted);
		font-size: 14px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	/* A guide's name is a sentence, so three to a row. */
	.versus.reading {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.rules {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 20px 64px;
		max-width: 960px;
		margin-top: 24px;
		list-style: none;
	}

	.rules li {
		color: var(--fg-muted);
		font-size: 15px;
		line-height: 1.6;
		text-wrap: pretty;
	}

	.rules b {
		color: var(--fg-default);
		font-weight: 550;
	}

	.rules a {
		color: var(--fg-default);
		text-underline-offset: 3px;
	}

	@media (max-width: 859px) {
		.takes,
		.rules {
			grid-template-columns: minmax(0, 1fr);
		}

		.versus,
		.versus.reading {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 559px) {
		.versus,
		.versus.reading {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
