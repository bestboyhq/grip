<script lang="ts" module>
	export type Beat = Readonly<{ n: number; total: number; kicker?: string }>;
</script>

<script lang="ts">
	let { n, total, kicker, centered = false }: Beat & { centered?: boolean } = $props();

	const pad = (value: number): string => String(value).padStart(2, '0');
</script>

<div class={['label', 'rise', { centered }]}>
	<span class="num" aria-hidden="true">
		<span>{pad(n)}</span>
		<span class="of">/</span>
		<span class="of">{pad(total)}</span>
	</span>
	{#if kicker}<span class="kick">{kicker}</span>{/if}
	<span class="rule" aria-hidden="true"></span>
</div>

<style>
	.label {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 36px;
		color: var(--fg-secondary);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.num {
		display: inline-flex;
		gap: 1ch;
		color: var(--fg-default);
		font-variant-numeric: tabular-nums;
	}

	.of {
		color: var(--fg-faint);
	}

	.kick {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rule {
		flex: 1;
		min-width: 24px;
		height: 1px;
		background: var(--border-default);
	}

	.centered {
		max-width: 640px;
		margin-inline: auto;
	}

	.centered::before {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border-default);
	}

	@media (max-width: 559px) {
		.label {
			margin-bottom: 28px;
		}
	}
</style>
