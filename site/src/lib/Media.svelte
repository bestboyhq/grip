<!-- A real screenshot or clip from Grip in the screenshot frame: its own corner radius, a hairline ring, and a shadow.
     A clip plays muted in a loop only while it is on screen; a press on its button pauses or plays it, and under
     reduced motion it holds its still until someone presses play. It comes in the page's theme and follows a switch. -->
<script module lang="ts">
	import { asset } from '$app/paths';

	type Theme = 'light' | 'dark';
	export type Clip = Readonly<Record<Theme, { src: string; still: string }>>;

	// A clip from `static/media` (see `media.sh`) with its still, in each theme.
	export const clip = (name: 'hero' | 'loupe' | 'captions' | 'macbook' | 'formats'): Clip => ({
		light: { src: asset(`media/${name}-light.mp4`), still: asset(`media/${name}-light.webp`) },
		dark: { src: asset(`media/${name}-dark.mp4`), still: asset(`media/${name}-dark.webp`) },
	});
</script>

<script lang="ts">
	type Props = {
		// An image, or else a clip.
		src?: string;
		clip?: Clip;
		width: number;
		height: number;
		alt: string;
		// The corner radius in the media's own pixels, so the frame follows the corner at any size.
		r: number;
		// The window's box (x, y, width, height) inside a screenshot that bakes the window's shadow around it.
		crop?: readonly [number, number, number, number];
		eager?: boolean;
	};

	let { src, clip, width, height, alt, r, crop, eager = false }: Props = $props();

	const box = $derived(crop ?? [0, 0, width, height]);
	let paused = $state(true);
	let held = $state(false);
	let video = $state<HTMLVideoElement>();

	function watch(media: HTMLVideoElement): () => void {
		held = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const io = new IntersectionObserver(([entry]) => {
			if (entry?.isIntersecting && !held) media.play().catch(() => {});
			else media.pause();
		});
		// The clip in the page's theme. A switch swaps the other in at the same moment, playing if this one was.
		const root = document.documentElement;
		const scheme = matchMedia('(prefers-color-scheme: dark)');
		const pick = (): void => {
			const chosen = root.dataset.theme;
			const theme = chosen === 'light' || chosen === 'dark' ? chosen : scheme.matches ? 'dark' : 'light';
			const next = clip?.[theme];
			if (!next || media.getAttribute('src') === next.src) return;
			const { currentTime, paused } = media;
			media.poster = next.still;
			media.src = next.src;
			media.addEventListener('loadedmetadata', () => (media.currentTime = currentTime), { once: true });
			if (!paused) media.play().catch(() => {});
		};
		pick();
		const themed = new MutationObserver(pick);
		themed.observe(root, { attributeFilter: ['data-theme'] });
		scheme.addEventListener('change', pick);
		io.observe(media);
		return () => {
			io.disconnect();
			themed.disconnect();
			scheme.removeEventListener('change', pick);
		};
	}

	function toggle(): void {
		held = !paused;
		if (held) video?.pause();
		else video?.play().catch(() => {});
	}
</script>

<div
	class={['frame', { clip, held }]}
	style:aspect-ratio="{box[2]} / {box[3]}"
	style:border-radius="{(r / box[2]) * 100}% / {(r / box[3]) * 100}%"
	style:--still-light={clip && `url(${clip.light.still})`}
	style:--still-dark={clip && `url(${clip.dark.still})`}
>
	{#if clip}
		<video
			bind:this={video}
			bind:paused
			{@attach watch}
			{width}
			{height}
			muted
			loop
			playsinline
			disablepictureinpicture
			preload={eager ? 'auto' : 'none'}
			aria-label={alt}
		></video>
		<button
			class="toggle"
			type="button"
			aria-label={paused ? 'Play the clip' : 'Pause the clip'}
			onclick={toggle}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true">
				{#if paused}
					<path d="M5 3.4v9.2a.6.6 0 0 0 .92.5l7.1-4.6a.6.6 0 0 0 0-1L5.92 2.9A.6.6 0 0 0 5 3.4Z" />
				{:else}
					<rect x="4" y="3" width="2.6" height="10" rx=".8" />
					<rect x="9.4" y="3" width="2.6" height="10" rx=".8" />
				{/if}
			</svg>
		</button>
	{:else}
		<img
			{src}
			{width}
			{height}
			{alt}
			loading={eager ? 'eager' : 'lazy'}
			decoding={eager ? 'sync' : 'async'}
			style:width="{(width / box[2]) * 100}%"
			style:margin="{(-box[1] / box[2]) * 100}% 0 0 {(-box[0] / box[2]) * 100}%"
		/>
	{/if}
</div>

<style>
	/* Opaque before the media loads, so a stage light's shadow cast under the frame never shows through it. */
	.frame {
		position: relative;
		width: 100%;
		overflow: hidden;
		background: var(--surface-elevated);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08),
			0 32px 64px -24px rgb(0 0 0 / 0.45);
	}

	/* A clip's still in the page's theme, there before the script picks the clip and under its poster after. */
	.clip {
		background: var(--still-dark) 0 0 / 100% 100% var(--surface-elevated);
	}

	:global(:root[data-theme='light']) .clip {
		background-image: var(--still-light);
	}

	@media (prefers-color-scheme: light) {
		:global(:root:not([data-theme])) .clip {
			background-image: var(--still-light);
		}
	}

	img,
	video {
		display: block;
		max-width: none;
		height: auto;
	}

	video {
		width: 100%;
	}

	.toggle {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.56);
		color: #fff;
		backdrop-filter: blur(8px);
		cursor: pointer;
		opacity: 0;
		transition: opacity 180ms var(--ease);
	}

	.toggle svg {
		width: 14px;
		height: 14px;
		fill: currentColor;
	}

	.held .toggle,
	.toggle:focus-visible {
		opacity: 1;
	}

	@media (hover: hover) and (pointer: fine) {
		.frame:hover .toggle {
			opacity: 1;
		}

		.toggle:hover {
			background: rgb(0 0 0 / 0.72);
		}
	}

	@media (pointer: coarse) {
		.toggle {
			opacity: 1;
		}

		.toggle::after {
			content: '';
			position: absolute;
			inset: -6px;
		}
	}
</style>
