<!-- Screen recorders side by side (src/lib/benchmark.ts): what each makes of the same scripted take, then a table of
     public facts, each linked to the maker's page it was read from, then how both were made. The one page that
     names other recorders, in plain text; a recorder with no take yet shows in the table alone. -->
<script lang="ts">
	import { asset } from '$app/paths';
	import Arrow from '#lib/Arrow.svelte';
	import { CHECKED, FACTS, RECORDERS, SECONDS } from '#lib/benchmark.ts';
	import Head from '#lib/Head.svelte';
	import { GITHUB_URL } from '#lib/links.ts';
	import Media from '#lib/Media.svelte';

	const takes = RECORDERS.filter((recorder) => recorder.take);
	const count = RECORDERS.length;
	const checked = new Date(`${CHECKED}T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	});
	const SCRIPT = `${GITHUB_URL}/tree/main/scripts/benchmark`;

	// The row and the column of the cell under the mouse or holding the focus, as the table counts them: row 0 is the
	// head, column 0 the names. A finger lights nothing; it only scrolls.
	let hot = $state<Readonly<{ row: number; col: number }>>();
	function aim(event: Event) {
		if (event instanceof PointerEvent && event.pointerType === 'touch') return;
		const cell = event.target instanceof Element ? event.target.closest('th, td') : null;
		const row = cell?.parentElement;
		hot =
			cell instanceof HTMLTableCellElement && row instanceof HTMLTableRowElement
				? { row: row.rowIndex, col: cell.cellIndex }
				: undefined;
	}
	const cool = () => (hot = undefined);

	// A hyphen holds its line together, so AGPL-3.0 never breaks after AGPL, and a number keeps the word after it, so
	// 5 min never ends one line and starts the next.
	const whole = (text: string) => text.replaceAll('-', '\u2011').replace(/(\d) /gu, '$1\u00a0');
</script>

<Head
	title="Screen recorders for the Mac, side by side - Grip"
	description="{count} screen recorders for the Mac compared: price, license, platforms, and limits, each fact linked to its source."
	path="/benchmark"
/>

<section class="wrap head" data-place="benchmark">
	<p class="kicker">Benchmark</p>
	<h1>Screen recorders for the Mac, side by side<span>Every fact links to its source.</span></h1>
	<p class="lede">
		Does the world need another screen recorder? Judge for yourself. Here are {count} of them: what each
		costs, where it runs, and what it asks of you{#if takes.length}, and what each makes of the same
			{SECONDS} seconds{/if}.
	</p>
</section>

{#if takes.length}
	<section id="takes" class="wrap part" aria-labelledby="takes-title">
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

<section id="facts" class="wrap part" aria-labelledby="facts-title">
	<h2 id="facts-title">The facts</h2>
	<p class="sub">Read from each maker’s own pages on {checked}.</p>
	<div class="scroll">
		<table onpointerover={aim} onpointerleave={cool} onfocusin={aim} onfocusout={cool}>
			<thead>
				<tr>
					<td></td>
					{#each FACTS as { key, label }, col (key)}
						<th scope="col" class:hot={hot?.col === col + 1}>{label}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each RECORDERS as { id, name, url, facts }, row (id)}
					<tr class:hot={hot?.row === row + 1}>
						<th scope="row"><a href={url} rel="noopener">{name}</a></th>
						{#each FACTS as { key, label, kind, good }, col (key)}
							{@const { value, note, source } = facts[key]}
							<!-- The arrow to the source ends the cell's last line. -->
							{#snippet link()}
								&NoBreak;<a
									class="source"
									href={source}
									rel="noopener"
									aria-label="Source: {name}, {label.toLowerCase()}"><Arrow /></a
								>
							{/snippet}
							<td class={kind} class:hot={hot?.col === col + 1}>
								{#if typeof value === 'string'}
									<span class="value" class:good={good?.includes(value)}
										>{whole(value)}{#if !note}{@render link()}{/if}</span
									>
								{:else}
									<span class="value"
										>{#each value as chip (chip)}<span class="chip">{chip}</span>{/each}{#if !note}{@render link()}{/if}</span
									>
								{/if}
								{#if note}
									<span class="note">{whole(note)}{@render link()}</span>
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<section id="method" class="wrap part" aria-labelledby="method-title">
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

<style>
	.head {
		padding-block: 96px 64px;
	}

	.kicker {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 28px;
		color: var(--fg-secondary);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.kicker::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border-default);
	}

	h1 {
		font-size: clamp(34px, 4.6vw, 52px);
		font-weight: 550;
		line-height: 1.06;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	h1 span {
		display: block;
		color: var(--fg-faint);
	}

	.lede {
		max-width: 640px;
		margin-top: 24px;
		color: var(--fg-muted);
		font-size: 19px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.part {
		position: relative;
		padding-block: 56px;
	}

	.part:last-child {
		padding-bottom: 96px;
	}

	.part::before {
		content: '';
		position: absolute;
		z-index: 1;
		top: -4px;
		left: 50%;
		width: 100vw;
		height: 9px;
		margin-left: -50vw;
		background: var(--crosses);
		background-repeat: no-repeat;
		pointer-events: none;
	}

	h2 {
		font-size: 24px;
		font-weight: 550;
		line-height: 30px;
		letter-spacing: -0.02em;
	}

	.sub {
		max-width: 560px;
		margin-top: 8px;
		color: var(--fg-muted);
		font-size: 16px;
		line-height: 1.65;
		text-wrap: pretty;
	}

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

	/* The table scrolls sideways inside its own box where the column is too narrow for it, out to the page's edges,
	   each recorder's name held at the left. Its columns share the width by how much each has to say. Each cell
	   pads both sides, so a lit row or column has room around its text, and the table reaches past the column by
	   that much to keep its text on the column's edges. */
	.scroll {
		--cell: 11px;
		margin: 32px calc(-1 * var(--pad)) 0;
		padding-inline: var(--pad);
		overflow-x: auto;
		isolation: isolate;
	}

	table {
		width: calc(100% + 2 * var(--cell));
		min-width: 1024px;
		margin-inline: calc(-1 * var(--cell));
		border-collapse: collapse;
	}

	th,
	td {
		padding: 14px var(--cell);
		border-top: 1px solid var(--border-subtle);
		text-align: left;
		vertical-align: top;
	}

	thead th,
	thead td {
		border-top: 0;
		padding-top: 10px;
	}

	thead th {
		color: var(--fg-secondary);
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 400;
		line-height: 16px;
	}

	/* Above the source links, which are positioned too, and solid out to the box's edge, so nothing that scrolls
	   under the names shows in the padding beside them; the box isolates them, so the page's rails stay on top. As
	   narrow as the longest name. */
	thead td,
	tbody th {
		position: sticky;
		z-index: 1;
		left: calc(-1 * var(--cell));
		width: 1px;
		background: var(--surface-root);
	}

	thead td::before,
	tbody th::before {
		content: '';
		position: absolute;
		inset: -1px 100% 0 calc(var(--cell) - var(--pad));
		background: var(--surface-root);
	}

	tbody th a {
		color: var(--fg-default);
		font-size: 15px;
		font-weight: 550;
		line-height: 20px;
		text-decoration: none;
		white-space: nowrap;
	}

	/* Every cell of a column shows its fact one way (src/lib/benchmark.ts): the value on top, read at a glance, and
	   under it a quieter note. */
	tbody td {
		color: var(--fg-prose);
		font-size: 13px;
		line-height: 20px;
	}

	.value,
	.note {
		display: block;
		text-wrap: pretty;
	}

	.note {
		margin-top: 2px;
		color: var(--fg-muted);
		font-size: 12px;
		line-height: 18px;
	}

	.price .value {
		color: var(--fg-default);
		font-size: 15px;
		font-weight: 550;
	}

	.year .value {
		color: var(--fg-secondary);
		font-family: var(--mono);
	}

	/* A mark's dot sits on its first line, and its note lines up with its words. */
	.mark .value,
	.mark .note {
		position: relative;
		padding-left: 14px;
	}

	.mark .value {
		white-space: nowrap;
	}

	.mark .value::before {
		content: '';
		position: absolute;
		top: 7px;
		left: 0;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--fg-faint);
	}

	.mark .good::before {
		background: var(--success);
	}

	/* Wide enough for two chips a line, so no platform list stands in a tower, and for a price's note to take two
	   lines, not four. */
	td.chips {
		min-width: 150px;
	}

	td.price {
		min-width: 118px;
	}

	.chips .value {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
	}

	.chip {
		padding: 0 6px;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--fg-secondary);
		font-size: 12px;
		line-height: 18px;
	}

	/* The row and the column in hand, and brightest the cell where they cross. Instant, as every hover here. */
	.hot,
	tr.hot > * {
		background: var(--surface-elevated);
	}

	thead .hot,
	tr.hot > th a {
		color: var(--fg-default);
	}

	tr.hot > td.hot {
		background: var(--surface-hover);
		color: var(--fg-prose);
	}

	.source {
		position: relative;
		display: inline-flex;
		margin-left: 5px;
		color: var(--fg-faint);
		vertical-align: 1px;
	}

	.source :global(svg) {
		width: 9px;
		height: 9px;
	}

	/* A pointer or a finger gets more of the link than its 9px arrow. */
	.source::after {
		content: '';
		position: absolute;
		inset: -8px;
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

	@media (hover: hover) and (pointer: fine) {
		tbody th a:hover,
		.source:hover {
			color: var(--brand);
		}

		/* An arrow in every cell is noise: a mouse finds the one in the cell it points at, and a finger sees them all. */
		.source {
			opacity: 0;
		}

		tr.hot > td.hot .source,
		.source:focus-visible {
			opacity: 1;
		}
	}

	@media (max-width: 859px) {
		.head {
			padding-block: 72px 48px;
		}

		.lede {
			font-size: 17px;
		}

		.part {
			padding-block: 44px;
		}

		.part:last-child {
			padding-bottom: 72px;
		}

		.takes,
		.rules {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
