<script lang="ts">
	import { asset } from '$app/paths';
	import Arrow from './Arrow.svelte';
	import GitHubIcon from './GitHubIcon.svelte';
	import { GITHUB_URL, HOME, isExternal, SITEMAP } from './links';
	import ThemeSwitcher from './ThemeSwitcher.svelte';

	let { sitemap = false }: { sitemap?: boolean } = $props();
</script>

<footer class={['footer', { sitemap }]} data-place="footer">
	{#if sitemap}
		<div class="map">
			<div class="about">
				<a class="mark" href={HOME}>
					<img class="app-icon" src={asset('icons/grip.webp')} width="28" height="28" alt="" />
					Grip
				</a>
				<p>Professional recordings and screenshots within seconds.</p>
			</div>
			{#each SITEMAP as column (column.label)}
				<nav aria-label={column.label}>
					<h2>{column.label}</h2>
					<ul>
						{#each column.links as link (link.href)}
							<li>
								<a
									href={link.href}
									data-sveltekit-reload={link.reload || isExternal(link) ? true : undefined}
								>
									{link.title}{#if isExternal(link)}<Arrow class="out" />{/if}
								</a>
							</li>
						{/each}
					</ul>
				</nav>
			{/each}
		</div>
	{/if}
	<div class="line">
		<p class="tiny">
			<span>© {new Date().getFullYear()} Bestboy</span>
		</p>
		<div class="end tips">
			<ThemeSwitcher />
			<a class="social" href={GITHUB_URL} aria-label="GitHub" data-tip="GitHub">
				<GitHubIcon size={16} />
			</a>
		</div>
	</div>
</footer>

<style>
	.footer {
		position: relative;
		width: 100%;
		max-width: var(--col);
		margin: auto auto 0;
	}

	.sitemap::before {
		content: '';
		position: absolute;
		top: -4px;
		left: 50%;
		width: 100vw;
		height: 9px;
		margin-left: -50vw;
		background: var(--crosses);
		background-repeat: no-repeat;
		pointer-events: none;
	}

	.map {
		display: grid;
		grid-template-columns: minmax(0, 1fr) repeat(4, 10rem);
		gap: 48px 24px;
		padding: 72px max(var(--pad), env(safe-area-inset-right)) 0
			max(var(--pad), env(safe-area-inset-left));
	}

	.mark {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--fg-default);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-decoration: none;
	}

	.mark img {
		--s: 28px;
	}

	.about p {
		max-width: 240px;
		margin-top: 14px;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
	}

	h2 {
		display: flex;
		align-items: center;
		height: 28px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 400;
	}

	ul {
		list-style: none;
	}

	li a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 28px;
		color: var(--fg-secondary);
		font-size: 14px;
		text-decoration: none;
		-webkit-user-select: none;
		user-select: none;
	}

	li a:active {
		color: var(--fg-default);
	}

	li a :global(.out) {
		width: 9px;
		height: 9px;
		color: var(--fg-faint);
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 24px max(var(--pad), env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom))
			max(var(--pad), env(safe-area-inset-left));
	}

	.sitemap .line {
		margin-top: 72px;
		padding-bottom: max(32px, env(safe-area-inset-bottom));
	}

	.tiny {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 24px;
		color: var(--fg-faint);
		font-size: 12px;
	}

	.tiny span {
		white-space: nowrap;
	}

	.end {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.social {
		display: inline-flex;
		align-items: center;
		color: var(--fg-faint);
	}

	.social :global(svg) {
		flex: none;
	}

	.social:active {
		color: var(--fg-default);
	}

	@media (hover: hover) and (pointer: fine) {
		li a:hover,
		.social:hover {
			color: var(--fg-default);
		}
	}

	@media (max-width: 1023px) {
		.map {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.about {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 559px) {
		.map {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 40px 24px;
			padding-top: 56px;
		}

		.sitemap .line {
			margin-top: 56px;
		}

		.tiny span {
			white-space: normal;
		}
	}

	@media (pointer: coarse) {
		.social::after {
			content: '';
			position: absolute;
			inset: -14px -19px -14px -9px;
		}

		li a {
			min-height: 40px;
		}
	}
</style>
