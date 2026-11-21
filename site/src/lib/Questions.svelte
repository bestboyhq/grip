<!-- The questions of a page that reads as a document (app.css `.page-part`): its title beside them, the first one open,
     and an optional link under an answer. The home page has its own, Faq.svelte. -->
<script lang="ts">
	import Arrow from './Arrow.svelte';

	type Question = Readonly<{
		question: string;
		answer: string;
		link?: Readonly<{ href: string; label: string }>;
	}>;

	let { faqs }: { faqs: readonly Question[] } = $props();
</script>

<section id="faq" class="wrap page-part" aria-labelledby="faq-title">
	<div class="faq">
		<h2 id="faq-title">Questions</h2>
		<div>
			{#each faqs as { question, answer, link }, i (question)}
				<details open={i === 0}>
					<summary>
						<span class="idx" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
						<span class="q">{question}</span>
						<span class="plus" aria-hidden="true"></span>
					</summary>
					<p>{answer}</p>
					{#if link}
						<a class="arrow-link" href={link.href}>{link.label}<Arrow class="ahead" /></a>
					{/if}
				</details>
			{/each}
		</div>
	</div>
</section>

<style>
	.faq {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
		gap: 24px 64px;
		align-items: start;
	}

	details + details {
		border-top: 1px solid var(--border-default);
	}

	summary {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) 16px;
		gap: 16px;
		align-items: center;
		min-height: 64px;
		padding: 16px 0;
		list-style: none;
		cursor: pointer;
		-webkit-user-select: none;
		user-select: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.idx {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 24px;
		font-variant-numeric: tabular-nums;
	}

	.q {
		font-size: 16px;
		font-weight: 500;
		line-height: 24px;
		text-wrap: pretty;
	}

	.plus {
		position: relative;
		justify-self: end;
		width: 12px;
		height: 12px;
	}

	.plus::before,
	.plus::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		width: 12px;
		height: 1.5px;
		margin-top: -0.75px;
		border-radius: 1px;
		background: var(--fg-muted);
		transition: rotate 200ms var(--ease);
	}

	.plus::after {
		rotate: 90deg;
	}

	details[open] .plus::after {
		rotate: 0deg;
	}

	p {
		max-width: 560px;
		padding: 0 0 24px 40px;
		color: var(--fg-muted);
		font-size: 15px;
		line-height: 1.65;
		text-wrap: pretty;
	}

	.arrow-link {
		margin: -8px 0 24px 40px;
		font-size: 14px;
	}

	@media (max-width: 1023px) {
		.faq {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
