<!-- The hero: Grip's editor window playing the hero take, which a visitor can take over. The window is a set of takes
     captured from the running editor (`scripts/readme/editor.ts`), one per wallpaper, and the page lays its own
     controls on the window's: the timeline scrubs, the transport pauses, a tile swaps in its wallpaper's take at the
     same moment. Every pixel is one Grip drew. It plays like the page's clips: only while it is the clip most on
     screen, and under reduced motion it holds its still until someone presses play. -->
<script module lang="ts">
	import { asset } from '$app/paths';
	import type { AssetPath } from '$app/types';
	import editor from './editor.json';

	// A file the capture script names in editor.json, under the site's base; the site's tests check each one ships.
	const file = (path: string): string => asset(path as AssetPath);
	export const still = file(editor.still);
</script>

<script lang="ts">
	import { follow, start } from './Media.svelte';

	let { alt }: { alt: string } = $props();

	const { width: W, height: H, fps, frames, timeline, transport, wallpapers } = editor;
	const R = 13; // the corner, in the window's px: the page's other frames round theirs as much
	// A box in the window's px as a share of the window, so a control stays on its spot at any size.
	const place = ([x = 0, y = 0, w = 0, h = 0]: number[]): string =>
		`left:${(x / W) * 100}%;top:${(y / H) * 100}%;width:${(w / W) * 100}%;height:${(h / H) * 100}%`;
	// A frame as the editor's timecode reads it, cut to hundredths.
	const timecode = (at: number): string => {
		const hundredths = Math.floor((at * 100) / fps);
		return `${Math.floor(hundredths / 6000)}:${((hundredths % 6000) / 100).toFixed(2).padStart(5, '0')}`;
	};

	let video = $state<HTMLVideoElement>();
	let last = $state<HTMLCanvasElement>();
	let held = $state(false); // paused by the visitor, or under reduced motion until a press
	let scrubbing = $state(false);
	let frozen = $state(false); // a picked wallpaper's take loads under the last frame of the one before
	let chosen = $state(0);
	let frame = $state(0);
	let moment = 0; // where the loading take lands
	let queued: number | null = null; // a seek that waits for the one in flight

	function watch(media: HTMLVideoElement): () => void {
		held = matchMedia('(prefers-reduced-motion: reduce)').matches;
		return follow(media, () => held || scrubbing);
	}

	function seek(to: number): void {
		frame = Math.max(0, Math.min(frames - 1, to));
		const t = (frame + 0.5) / fps; // the frame's middle: its start rounds into the frame before
		if (frozen) moment = t;
		else if (video?.seeking) queued = t;
		else if (video) video.currentTime = t;
	}

	function seeked(): void {
		if (queued === null || !video) return;
		video.currentTime = queued;
		queued = null;
	}

	// The frame under the pointer, by the timeline's own map from its x to a moment.
	function under(e: PointerEvent): number {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = timeline.box[0] + ((e.clientX - box.left) / box.width) * timeline.box[2];
		return Math.round(((x - timeline.x0) / timeline.perSecond) * fps);
	}

	function grab(e: PointerEvent): void {
		if (e.button !== 0 || !video) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		scrubbing = true;
		video.pause();
		seek(under(e));
	}

	function drop(): void {
		if (!scrubbing) return;
		scrubbing = false;
		if (!held && video) start(video);
	}

	// The playhead as a slider: arrows step a frame, Page keys half a second, Home and End go to the ends. A step pauses.
	const STEPS: Record<string, number> = {
		ArrowLeft: -1,
		ArrowDown: -1,
		ArrowRight: 1,
		ArrowUp: 1,
		PageDown: -fps / 2,
		PageUp: fps / 2,
		Home: -frames,
		End: frames,
	};

	function step(e: KeyboardEvent): void {
		const by = STEPS[e.key];
		if (by === undefined || !video) return;
		e.preventDefault();
		const from = video.paused ? frame : Math.floor(video.currentTime * fps); // playing, `frame` trails a few
		held = true;
		video.pause();
		seek(from + by);
	}

	function toggle(): void {
		held = !held;
		if (held) video?.pause();
		else if (video) start(video);
	}

	// The picked wallpaper's take, at the same moment. Until it has that frame, the window keeps the last frame of the
	// take before, so it never flashes its still.
	async function pick(i: number): Promise<void> {
		const media = video;
		const src = wallpapers[i]?.src;
		if (i === chosen || !media || !last || !src) return;
		chosen = i;
		queued = null;
		if (!frozen) {
			moment = media.currentTime;
			last.width = media.videoWidth;
			last.height = media.videoHeight;
			last.getContext('2d')?.drawImage(media, 0, 0);
			frozen = true;
		}
		media.src = file(src);
		await new Promise((done) => media.addEventListener('loadedmetadata', done, { once: true }));
		if (chosen !== i) return;
		let at;
		do {
			at = moment; // a scrub meanwhile moves it
			media.currentTime = at;
			await new Promise((done) => media.addEventListener('seeked', done, { once: true }));
			if (chosen !== i) return;
		} while (moment !== at);
		frozen = false;
		if (!held && !scrubbing) start(media);
	}

	function played(): void {
		if (video && !scrubbing && !frozen) frame = Math.min(frames - 1, Math.floor(video.currentTime * fps));
	}
</script>

<div
	class={['window', { held, frozen }]}
	style:aspect-ratio="{W} / {H}"
	style:border-radius="{(R / W) * 100}% / {(R / H) * 100}%"
	style:--still="url({still})"
	style:--transport="url({file(transport.src)})"
>
	<video
		bind:this={video}
		{@attach watch}
		src={file(wallpapers[0]?.src ?? '')}
		poster={still}
		width={W}
		height={H}
		muted
		loop
		playsinline
		disablepictureinpicture
		preload="auto"
		aria-label={alt}
		onseeked={seeked}
		ontimeupdate={played}
	></video>
	<canvas bind:this={last} aria-hidden="true"></canvas>
	<button
		class="transport"
		type="button"
		style={place(transport.box)}
		aria-label={held ? 'Play' : 'Pause'}
		onclick={toggle}
	></button>
	<div
		class="scrub"
		style={place(timeline.box)}
		role="slider"
		tabindex="0"
		aria-label="Playhead"
		aria-valuemin={0}
		aria-valuemax={frames - 1}
		aria-valuenow={frame}
		aria-valuetext={timecode(frame)}
		onpointerdown={grab}
		onpointermove={(e) => scrubbing && seek(under(e))}
		onpointerup={drop}
		onpointercancel={drop}
		onkeydown={step}
	></div>
	{#each wallpapers as wallpaper, i (wallpaper.name)}
		<button
			class="tile"
			type="button"
			style={place(wallpaper.box)}
			aria-label="{wallpaper.name} wallpaper"
			aria-pressed={chosen === i}
			onclick={() => pick(i)}
		></button>
	{/each}
</div>

<style>
	/* The window's frame is the page's screenshot frame (Media.svelte): opaque before the take loads, so a stage
	   light's shadow under it never shows through, and its own stacking context, so a playing video keeps its
	   corners in Safari. */
	.window {
		position: relative;
		isolation: isolate;
		width: 100%;
		overflow: hidden;
		background: var(--still) 0 0 / 100% 100% var(--surface-elevated);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08),
			0 32px 64px -24px rgb(0 0 0 / 0.45);
	}

	video,
	canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}

	canvas {
		visibility: hidden;
	}

	.frozen canvas {
		visibility: visible;
	}

	.transport,
	.scrub,
	.tile {
		position: absolute;
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
	}

	/* Playing, the take draws the transport; paused or under the pointer, its sprite does: paused, paused under the
	   pointer, playing under the pointer. */
	.transport {
		border-radius: 50%;
		background: none 0 0 / 300% 100% no-repeat;
		cursor: pointer;
	}

	.held .transport {
		background-image: var(--transport);
	}

	.scrub {
		cursor: ew-resize;
		touch-action: pan-y;
	}

	.tile {
		border-radius: 22%;
		cursor: pointer;
	}

	.tile[aria-pressed='true'] {
		cursor: default;
	}

	@media (hover: hover) and (pointer: fine) {
		.transport:hover {
			background-image: var(--transport);
			background-position: 100% 0;
		}

		.held .transport:hover {
			background-position: 50% 0;
		}
	}

	/* A finger's reach around the transport, which a phone shows a few pixels wide. */
	@media (pointer: coarse) {
		.transport::after {
			content: '';
			position: absolute;
			inset: -16px;
		}
	}
</style>
