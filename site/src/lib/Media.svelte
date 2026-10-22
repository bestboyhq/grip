<!-- A real screenshot or clip from Grip in the screenshot frame: its own corner radius, a hairline ring, and a shadow.
     A clip plays muted in a loop only while it is on screen; a press on its button pauses or plays it, and under
     reduced motion it holds its still until someone presses play. -->
<script lang="ts">
	type Props = {
		src: string;
		width: number;
		height: number;
		alt: string;
		// The corner radius in the media's own pixels, so the frame follows the corner at any size.
		r: number;
		// The window's box (x, y, width, height) inside a screenshot that bakes the window's shadow around it.
		crop?: readonly [number, number, number, number];
		// A clip's still frame; without one the media is an image.
		still?: string;
		eager?: boolean;
	};

	let { src, width, height, alt, r, crop, still, eager = false }: Props = $props();

	const box = $derived(crop ?? [0, 0, width, height]);
	let paused = $state(true);
	let held = $state(false);
	let video = $state<HTMLVideoElement>();

	function watch(clip: HTMLVideoElement): () => void {
		held = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const io = new IntersectionObserver(([entry]) => {
			if (entry?.isIntersecting && !held) clip.play().catch(() => {});
			else clip.pause();
		});
		io.observe(clip);
		return () => io.disconnect();
	}

	function toggle(): void {
		held = !paused;
		if (held) video?.pause();
		else video?.play().catch(() => {});
	}
</script>

<div
	class={['frame', { clip: still, held }]}
	style:aspect-ratio="{box[2]} / {box[3]}"
	style:border-radius="{(r / box[2]) * 100}% / {(r / box[3]) * 100}%"
>
	{#if still}
		<video
			bind:this={video}
			bind:paused
			{@attach watch}
			{src}
			poster={still}
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
			decoding="async"
			style:width="{(width / box[2]) * 100}%"
			style:margin="{(-box[1] / box[2]) * 100}% 0 0 {(-box[0] / box[2]) * 100}%"
		/>
	{/if}
</div>

<style>
	.frame {
		position: relative;
		width: 100%;
		overflow: hidden;
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08),
			0 32px 64px -24px rgb(0 0 0 / 0.45);
	}

	.clip {
		background: #000;
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
