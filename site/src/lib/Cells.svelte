<!-- A row of numbered cells under a heading, each a title and a line, with its stat first when it has one. Three to a
     row stack on narrower screens; four to a row wrap to two, then to one. -->
<script lang="ts">
	type Cell = Readonly<{ title: string; body: string; stat?: string }>;

	type Props = { items: readonly Cell[]; ordered?: boolean; four?: boolean };

	let { items, ordered = false, four = false }: Props = $props();

	const pad = (value: number): string => String(value).padStart(2, '0');
</script>

<svelte:element this={ordered ? 'ol' : 'ul'} class={['cells', { four }]}>
	{#each items as item, index (item.title)}
		<li class="rise">
			<span class="idx" aria-hidden="true">{pad(index + 1)}</span>
			{#if item.stat}<span class="stat">{item.stat}</span>{/if}
			<h3>{item.title}</h3>
			<p>{item.body}</p>
		</li>
	{/each}
</svelte:element>

<style>
	.cells {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 72px calc(-1 * max(var(--pad), env(safe-area-inset-left))) 0;
		list-style: none;
	}

	.cells li {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 40px var(--pad);
		border-top: 1px solid var(--frame);
	}

	.cells li + li {
		border-left: 1px solid var(--frame);
	}

	.idx {
		margin-bottom: 4px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 24px;
		font-variant-numeric: tabular-nums;
	}

	.stat {
		font-size: 28px;
		font-weight: 550;
		line-height: 1.2;
		letter-spacing: -0.03em;
	}

	h3 {
		font-size: 17px;
		font-weight: 550;
		line-height: 1.4;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}

	p {
		color: var(--fg-muted);
		font-size: 15px;
		line-height: 1.6;
		text-wrap: pretty;
	}

	.four {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.four li:nth-child(4n + 1) {
		border-left: 0;
	}

	@media (max-width: 1023px) {
		.cells {
			grid-template-columns: minmax(0, 1fr);
			margin-top: 48px;
		}

		.cells li {
			padding-block: 32px;
		}

		.cells li + li {
			border-left: 0;
		}

		.four {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.four li:nth-child(even) {
			border-left: 1px solid var(--frame);
		}
	}

	@media (max-width: 559px) {
		.four {
			grid-template-columns: minmax(0, 1fr);
		}

		.four li:nth-child(even) {
			border-left: 0;
		}
	}
</style>
