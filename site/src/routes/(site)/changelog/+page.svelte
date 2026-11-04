<!-- What changed in each release, newest first (src/lib/changelog.ts): its version and day beside it, a headline, a
     line per change, and for the ones worth seeing, a silent clip lying flat on the page. -->
<script lang="ts">
	import { asset } from '$app/paths';
	import { RELEASES, type Shown } from '#lib/changelog.ts';
	import Head from '#lib/Head.svelte';
	import Media, { type Clip } from '#lib/Media.svelte';

	// A changelog clip is recorded in one theme and shows in both.
	const clip = (version: Shown): Clip => {
		const one = {
			src: asset(`media/changelog-${version}.mp4`),
			still: asset(`media/changelog-${version}.webp`),
		};
		return { light: one, dark: one };
	};

	const day = (iso: string): string =>
		new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC',
		});
</script>

<Head
	title="Changelog - Grip"
	description="What changed in each Grip release, newest first."
	path="/changelog"
/>

{#snippet keyed(text: string)}
	{#each text.split('`') as part, i (i)}{#if i % 2}<kbd>{part}</kbd>{:else}{part}{/if}{/each}
{/snippet}

<section class="wrap head" data-place="changelog">
	<p class="kicker">Changelog</p>
	<h1>What’s new in Grip<span>Every release, newest first.</span></h1>
</section>

<div class="wrap" data-place="releases">
	{#each RELEASES as release (release.version)}
		<article class="release" id="v{release.version}">
			<div class="meta">
				<a class="version" href="#v{release.version}">{release.version}</a>
				<time datetime={release.date}>{day(release.date)}</time>
			</div>
			<div class="notes">
				<h2>{release.title}</h2>
				{#if release.clip}
					<div class="clip">
						<Media
							clip={clip(release.version)}
							width={1920}
							height={1080}
							r={32}
							alt={release.clip}
							flat
						/>
					</div>
				{/if}
				{#if typeof release.notes === 'string'}
					<p class="line">{@render keyed(release.notes)}</p>
				{:else}
					<ul>
						{#each release.notes as [name, fact] (name)}
							<li><strong>{name}</strong> {@render keyed(fact)}</li>
						{/each}
					</ul>
				{/if}
			</div>
		</article>
	{/each}
</div>

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
	}

	h1 span {
		display: block;
		color: var(--fg-faint);
	}

	.release {
		position: relative;
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		gap: 16px 64px;
		padding-block: 56px;
	}

	.release::before {
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

	.release:last-child {
		padding-bottom: 96px;
	}

	.meta {
		position: sticky;
		top: calc(var(--bar-h) + 32px);
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.version {
		width: fit-content;
		color: var(--fg-default);
		font-family: var(--mono);
		font-size: 20px;
		font-weight: 500;
		line-height: 28px;
		letter-spacing: -0.02em;
		text-decoration: none;
	}

	time {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.notes {
		max-width: 720px;
	}

	h2 {
		font-size: 26px;
		font-weight: 550;
		line-height: 1.2;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}

	.clip {
		margin-top: 24px;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 20px;
		list-style: none;
	}

	li,
	.line {
		color: var(--fg-muted);
		font-size: 15px;
		line-height: 1.6;
		text-wrap: pretty;
	}

	.line {
		margin-top: 12px;
	}

	strong {
		color: var(--fg-default);
		font-weight: 550;
	}

	kbd {
		padding: 1px 5px;
		border-radius: 5px;
		background: var(--surface-well);
		box-shadow: inset 0 0 0 0.5px var(--border-default);
		color: var(--fg-default);
		font-family: var(--mono);
		font-size: 12px;
	}

	@media (hover: hover) and (pointer: fine) {
		.version:hover {
			color: var(--brand);
		}
	}

	@media (max-width: 859px) {
		.head {
			padding-block: 72px 48px;
		}

		.release {
			grid-template-columns: minmax(0, 1fr);
			padding-block: 44px;
		}

		.release:last-child {
			padding-bottom: 72px;
		}

		.meta {
			position: static;
			flex-direction: row;
			align-items: baseline;
			gap: 12px;
		}
	}
</style>
