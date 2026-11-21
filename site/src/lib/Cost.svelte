<!-- What the years ahead cost: one bar for each way to pay for the recorders in `ids` (their `plans` in benchmark.ts),
     all on one scale, the most any recorder in `scale` costs in five years, so a bar grows as the years do. A page
     whose `ids` change passes every recorder it can show as `scale`, so a bar keeps its length while others come and
     go, and each row slides open or shut. Each name links to the price it was read from. The page is built at three
     years, so the bars are there before any script runs. -->
<script lang="ts">
	import { quintOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { slide } from 'svelte/transition';
	import { RECORDERS } from './benchmark.ts';

	let { ids, scale = ids }: { ids: readonly string[]; scale?: readonly string[] } = $props();

	const MAX = 5;
	const id = $props.id();
	let years = $state(3);

	const find = (wanted: string) => {
		const recorder = RECORDERS.find(({ id }) => id === wanted);
		if (!recorder) throw new Error(`No recorder ${wanted} in benchmark.ts`);
		return recorder;
	};
	const rows = $derived(
		ids.map(find).flatMap((recorder) => recorder.plans.map((plan) => ({ recorder, plan, free: plan.over(MAX) === 0 }))),
	);
	const top = $derived(Math.max(1, ...scale.map(find).flatMap(({ plans }) => plans.map(({ over }) => over(MAX)))));
	// quintOut is the curve of `--ease`, cubic-bezier(0.22, 1, 0.36, 1).
	const fold = $derived({ duration: prefersReducedMotion.current ? 0 : 240, easing: quintOut });
	const dollars = (amount: number) =>
		amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
</script>

<div class="span">
	<label for={id}>{years === 1 ? '1 year' : `${years} years`}</label>
	<input {id} type="range" min="1" max={MAX} step="1" bind:value={years} />
</div>
<dl class="costs">
	{#each rows as { recorder, plan, free } (`${recorder.id} ${plan.how}`)}
		<div transition:slide={fold}>
			<dt>
				<a href={recorder.facts.price.source} rel="noopener">{recorder.name}</a>
				<small>{plan.how}</small>
			</dt>
			<dd class="bar" class:free style:--part={plan.over(years) / top} aria-hidden="true"><i></i></dd>
			<dd class="sum" class:free>{dollars(plan.over(years))}</dd>
		</div>
	{/each}
</dl>

<style>
	.span {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-top: 28px;
	}

	label {
		width: 108px;
		font-size: 15px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}

	input {
		width: 220px;
		max-width: 100%;
		margin: 0;
		accent-color: var(--fg-default);
	}

	.costs {
		--columns: 240px minmax(0, 1fr) 96px;
		margin-top: 20px;
	}

	/* A row a grid of its own, on the same columns, so it can slide open and shut. */
	.costs div {
		display: grid;
		grid-template-columns: var(--columns);
		border-top: 1px solid var(--border-subtle);
	}

	dt,
	dd {
		padding-block: 13px;
	}

	/* A long plan name keeps clear of its bar. */
	dt {
		padding-right: 16px;
		font-size: 14px;
		font-weight: 500;
		line-height: 20px;
	}

	dt a {
		text-decoration: none;
	}

	small {
		display: block;
		color: var(--fg-muted);
		font-size: 12px;
		font-weight: 400;
		line-height: 18px;
	}

	.bar {
		display: flex;
		align-items: center;
	}

	.bar i {
		display: block;
		width: max(2px, calc(var(--part) * 100%));
		height: 8px;
		border-radius: 4px;
		background: var(--border-strong);
		transition: width 320ms var(--ease);
	}

	.sum {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		font-size: 15px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}

	.free i {
		background: var(--success);
	}

	.free.sum {
		color: var(--success);
	}

	@media (hover: hover) and (pointer: fine) {
		dt a:hover {
			color: var(--brand);
		}
	}

	@media (max-width: 1023px) {
		.costs {
			--columns: 150px minmax(0, 1fr) 76px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bar i {
			transition: none;
		}
	}
</style>
