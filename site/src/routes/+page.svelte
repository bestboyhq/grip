<!-- Grip's landing page: the hero shows a video Grip made, then beat by beat how a take becomes one (capture,
     auto-zoom, captions, the editor, the look, export), the bugs it designs out, why it is safe to rely on, what
     people say, the questions, and the close. Every claim and number comes from the README. -->
<script lang="ts">
	import capture from '../../../.github/readme/capture.webp';
	import editor from '../../../.github/readme/editor.webp';
	import { dev } from '$app/env';
	import { asset } from '$app/paths';
	import Arrow from '#lib/Arrow.svelte';
	import BeatLabel, { type Beat } from '#lib/BeatLabel.svelte';
	import FeatureRow from '#lib/FeatureRow.svelte';
	import GitHubIcon from '#lib/GitHubIcon.svelte';
	import Glow, { type Layer } from '#lib/Glow.svelte';
	import Head from '#lib/Head.svelte';
	import Media from '#lib/Media.svelte';
	import Quotes, { type Quote } from '#lib/Quotes.svelte';
	import SectionHeading from '#lib/SectionHeading.svelte';
	import { docHref, DOWNLOAD_URL, GITHUB_URL, SITE_DESCRIPTION } from '#lib/links.ts';

	const HORIZON: readonly Layer[] = [{ box: [0, -0.46, 1, 0.9], peak: [0.42, 0.86], start: 0.18 }];

	// Drafts of the quotes this section wants, shown only in `npm run dev`. Real quotes, each with the person's name
	// and permission, replace them before the section ships; the site test fails on a draft.
	const quotes: readonly Quote[] = dev
		? [
				'I switched from [my old recorder] and never looked back. Recording used to feel like paperwork. Now it’s one keystroke.',
				'It’s so snappy. I press the shortcut, talk, stop, and the link works before the upload is even done.',
				'Every video I send looks like a product launch. The zooms and the smooth cursor are just there.',
				'Our engineers used to be shy about sharing updates. With Grip, they share them far more often.',
				'Comments land on the exact second. Feedback that used to take a call now takes a link.',
				'I used to lose an afternoon editing a two-minute demo. Now I don’t edit at all.',
				'People reply to my videos asking how I made them. Honestly, Grip did.',
				'Our whole team moved over from [my old recorder] in a week. Nobody asked to go back.',
			].map((quote) => ({ quote, name: 'Name', role: 'Role, Company' }))
		: [];

	const SECTIONS = [
		'how',
		'capture',
		'zoom',
		'captions',
		'editor',
		'look',
		'export',
		'bugs',
		'open',
		'love',
		'faq',
		'start',
	] as const;

	const BEATS = SECTIONS.filter((id) => id !== 'love' || quotes.length > 0);

	const beat = (id: (typeof SECTIONS)[number], kicker?: string): Beat => ({
		n: BEATS.indexOf(id) + 1,
		total: BEATS.length,
		...(kicker ? { kicker } : {}),
	});

	const pad = (value: number): string => String(value).padStart(2, '0');

	// A clip from `static/media` (see `media.sh`) with its still.
	const clip = (name: 'hero' | 'loupe' | 'captions' | 'macbook' | 'formats') => ({
		src: asset(`media/${name}.mp4`),
		still: asset(`media/${name}.webp`),
	});

	$effect(() => {
		const io = new IntersectionObserver(
			(entries) => {
				let wave = 0;
				for (const { isIntersecting, target } of entries) {
					if (!isIntersecting || !(target instanceof HTMLElement)) continue;
					target.style.setProperty('--i', String(Math.min(wave++, 3)));
					target.dataset.reveal = 'go';
					io.unobserve(target);
				}
			},
			{ rootMargin: `${document.documentElement.scrollHeight}px 0px -10% 0px` },
		);
		const waiting = [...document.querySelectorAll<HTMLElement>('.beat, .rise, .sitemap')].filter(
			(element) => element.getBoundingClientRect().top > innerHeight,
		);
		for (const element of waiting) {
			element.dataset.reveal = 'wait';
			io.observe(element);
		}
		return () => {
			io.disconnect();
			for (const element of waiting) delete element.dataset.reveal;
		};
	});

	const steps = [
		{
			title: 'Press ⌥⌘↩︎',
			body: 'The screen freezes under Grip’s overlay with your last area selected. Mark it up and copy it, or press Return to record.',
		},
		{
			title: 'Talk it through',
			body: 'Camera, mic, and system audio record on one clock. Grip stays out of the shot and warns you when your mic goes silent.',
		},
		{
			title: 'Stop and share',
			body: 'A small card offers an MP4 under 20 MB, a GIF under 10 MB, or a link that works before the upload finishes.',
		},
	];

	const bugs = [
		{
			bug: 'Subtitles drift or ignore your cuts',
			fix: 'Captions, zooms, keystrokes, and audio all map through one shared time map of cuts and speed changes.',
		},
		{
			bug: 'Zooms shift when you trim the clip before them',
			fix: 'Every timed item lives in source time, so a zoom stays on its moment however you cut around it.',
		},
		{
			bug: 'The cursor is baked into the video',
			fix: 'The screen is recorded without the cursor, and Grip redraws it from the event stream.',
		},
		{
			bug: 'The export doesn’t match the preview',
			fix: 'The frame at any moment is a pure function of the project, drawn by one renderer for both.',
		},
		{
			bug: 'A crash or power loss eats the take',
			fix: 'Tracks are written in fragments, and an interrupted recording is rebuilt at the next launch.',
		},
		{
			bug: 'A full disk corrupts the recording',
			fix: 'Grip won’t start with under 1 GB free, warns when space runs low, and keeps what it wrote.',
		},
		{
			bug: 'A # or emoji in a project name breaks a feature',
			fix: 'Names like “Demo #1 ✨ café” are in the test suite and the demo project.',
		},
		{
			bug: 'Long projects make the editor crawl',
			fix: 'The timeline is checked against a 2-hour project with 500 cuts, 300 zooms, and 20,000 caption words.',
		},
	];

	const trust = [
		{
			title: 'Open source',
			body: 'Every line is on GitHub under AGPL-3.0, so anyone can read it, build it, or keep it going.',
		},
		{
			title: 'Runs on your Mac',
			body: 'Recording, editing, transcription, and background removal stay on it. No telemetry, and crash reports stay on your disk.',
		},
		{
			title: 'No account to record',
			body: 'Only sharing a link signs in to bestboy.dev, once. Viewers, teammates, and comments never cost anything.',
		},
	];

	const faqs = [
		{
			question: 'Is Grip free?',
			answer:
				'Yes. Grip is free and open source under AGPL-3.0, with no subscription, no account, and no watermark. Share links live on bestboy.dev with a free account, and watching one takes nothing.',
		},
		{
			question: 'What do I need?',
			answer:
				'macOS 15 or later on Apple silicon. Captions download a speech model of about 670 MB the first time you use them.',
		},
		{
			question: 'Where do my recordings go?',
			answer:
				'Nowhere, unless you share them. Grip goes online only to download the speech model once, to check for updates, and to upload what you share.',
		},
		{
			question: 'Can I change an edit later?',
			answer:
				'Always. Grip keeps your screen, camera, mic, and every click and keystroke on separate tracks. Every zoom, cut, and caption is an edit you can undo, and the raw recording never changes.',
		},
		{
			question: 'What if my Mac crashes mid-recording?',
			answer:
				'You keep the take. Grip writes tracks in fragments and rebuilds an interrupted recording at the next launch.',
		},
		{
			question: 'Which languages do captions support?',
			answer:
				'25 European languages, transcribed on your Mac by NVIDIA Parakeet v3, with timing for every word.',
		},
		{
			question: 'Can I script it?',
			answer:
				'Yes. grip:// links start and stop a recording and open projects, so Raycast, Shortcuts, or a shell script can drive Grip.',
		},
		{
			question: 'How do updates work?',
			answer:
				'Grip updates itself. Updates download in the background and install while you’re away, never during a recording or an export.',
		},
	];
</script>

<Head title="Grip: record your screen, get a video worth watching" description={SITE_DESCRIPTION} path="" />

<svelte:head>
	<link rel="preload" as="image" href={clip('hero').still} fetchpriority="high" />
</svelte:head>

<div class="progress" aria-hidden="true"></div>

<section class="hero" aria-labelledby="hero-title" data-place="hero">
	<div class="wrap intro">
		<a class="eyebrow" href={GITHUB_URL}>
			<GitHubIcon size={14} />
			<span>Free and open source macOS app</span>
			<Arrow class="ahead" />
		</a>
		<h1 id="hero-title">
			<span>Record your screen.</span>
			<span class="quiet">Get a video worth watching.</span>
		</h1>
		<p class="lede">
			Grip zooms where you click, glides your cursor, and captions your voice for you. Record once,
			skip the editing, and share a link before you leave the flow.
		</p>
		<div class="actions">
			<a class="button primary" href={DOWNLOAD_URL}>
				{@render apple()}
				Download for macOS
			</a>
			<a class="button secondary" href={docHref()}>Read the docs</a>
		</div>
		<p class="fine">
			macOS 15 or later on Apple silicon · No&nbsp;account · No&nbsp;watermark
		</p>
	</div>
	<div class="plate beat">
		<div class="horizon" aria-hidden="true"></div>
		<div class="gl" aria-hidden="true">
			<Glow layers={HORIZON} opacity={0.85} />
		</div>
		<figure class="wrap window">
			<Media
				{...clip('hero')}
				width={1522}
				height={950}
				r={14}
				eager
				alt="A deployments dashboard polished by Grip: the view zooms in as the cursor glides to Deploy, the click swells through the screen, and a glass loupe magnifies the new build's timer as it turns from Building to Ready."
			/>
			<figcaption>
				Exported by Grip from a raw 6-second take. The zoom, the gliding cursor, and the click swell
				are automatic.
			</figcaption>
		</figure>
	</div>
</section>

<SectionHeading
	id="how"
	beat={beat('how', 'How it works')}
	split
	title="Record once."
	quiet="Skip the editing."
	description="Raw recordings are hard to watch: a tiny cursor on a huge screen, nothing in focus, and a lot of “um”. Grip polishes the take for you, and keeps every edit a choice you can change."
>
	{#snippet after()}
		<ol class="cells">
			{#each steps as step, index (step.title)}
				<li class="rise">
					<span class="idx" aria-hidden="true">{pad(index + 1)}</span>
					<h3>{step.title}</h3>
					<p>{step.body}</p>
				</li>
			{/each}
		</ol>
	{/snippet}
</SectionHeading>

<FeatureRow
	id="capture"
	beat={beat('capture', 'Capture')}
	title="One keystroke. Screenshot or video."
	body="Press ⌥⌘↩︎ and the screen freezes in the mode you used last. Draw arrows, boxes, ink, and text on top, pixelate what’s private, then copy it, save it, or record it."
	href={docHref('capture-in-one-keystroke')}
	linkLabel="How capture works"
	checks={['Five markup tools, one key each', 'Area, display, window, or iPhone']}
>
	<Media
		src={capture}
		width={2200}
		height={1472}
		r={27}
		alt="Grip's capture overlay on a frozen screen: a red box and arrow mark up a web app's Create project form, two project names are pixelated, and a bar offers Save and Copy."
	/>
</FeatureRow>

<FeatureRow
	id="zoom"
	beat={beat('zoom', 'Auto-zoom')}
	mirrored
	title="It zooms where you click."
	body="Clicks and typing become zooms that follow your cursor, and a glass loupe magnifies one spot while the rest stays in view. The cursor is redrawn smooth, passing exactly through every click."
	href={docHref('polished-by-default')}
	linkLabel="What Grip polishes"
	checks={['Each zoom is an edit you can move', 'Keystrokes as keycaps in your layout']}
>
	<Media
		{...clip('loupe')}
		width={898}
		height={562}
		r={10}
		alt="A revenue dashboard: a glass loupe follows the cursor along the growth chart, magnifies each day's figure, then the Export CSV button as it turns to Exported."
	/>
</FeatureRow>

<FeatureRow
	id="captions"
	beat={beat('captions', 'Captions and voice')}
	title="Captions written on your Mac."
	body="NVIDIA Parakeet v3 transcribes your voice on device, with timing for every word. Noise reduction, a compressor, and a limiter make it sound produced."
	href={docHref('polished-by-default')}
	linkLabel="How your voice sounds"
	checks={['25 European languages', 'Loudness normalized to -14 LUFS']}
>
	<Media
		{...clip('captions')}
		width={1152}
		height={720}
		r={12}
		alt="A launch checklist with big word-by-word captions, Okay, launch day. Changelog, done. Demo video, done., while each item is checked off."
	/>
</FeatureRow>

<FeatureRow
	id="editor"
	beat={beat('editor', 'Editor')}
	mirrored
	title="Edit a video like a doc."
	body="Select words in the transcript and press Delete, and the video follows. Grip finds filler words and long pauses and removes them in one click. The rest is a keyboard-first timeline."
	href={docHref('edit-a-video-like-a-doc')}
	linkLabel="Everything the editor does"
	checks={['C cuts, X ripple-deletes, Z zooms', 'Speed from 0.25× to 8×, pitch kept']}
>
	<Media
		src={editor}
		width={2784}
		height={1864}
		crop={[112, 76, 2560, 1640]}
		r={34}
		alt="The Grip editor: a glass loupe over a Create project button in the preview, three filler words struck through in the transcript, and the timeline split where they were cut."
	/>
</FeatureRow>

<FeatureRow
	id="look"
	beat={beat('look', 'Make it yours')}
	title="Frame it after the take."
	body="Pick a wallpaper, a device frame, and a camera style once the recording is done. Save the whole look as a preset, and every new take can wear it."
	href={docHref('make-it-yours')}
	linkLabel="Every look Grip has"
	checks={['185 wallpapers, drawn live on the GPU', 'MacBook, iPhone, and iPad frames']}
>
	<Media
		{...clip('macbook')}
		width={1112}
		height={626}
		r={12}
		alt="A calendar app in a MacBook frame on a warm wallpaper: the view pushes in as a Design review event is created, then pulls back to the whole laptop."
	/>
</FeatureRow>

<SectionHeading
	id="export"
	beat={beat('export', 'Export and share')}
	split
	title="One take, every format."
	quiet="Nothing falls out of frame."
	description="MP4 up to 4K, a GIF that fits a README, or subtitles aligned through every cut. Narrow formats follow the cursor, and share links take comments at the exact second."
>
	{#snippet after()}
		<div class="formats rise">
			<Media
				{...clip('formats')}
				width={1280}
				height={440}
				r={12}
				alt="One chat recording exported as 16:9 for YouTube, 1:1 for LinkedIn, and 9:16 for Reels, each following the cursor as a reply is sent."
			/>
		</div>
	{/snippet}
</SectionHeading>

<SectionHeading
	id="bugs"
	beat={beat('bugs', 'Under the hood')}
	split
	title="The usual recorder bugs."
	quiet="Designed out."
	description="Each one shipped in a real screen recorder. Grip rules them out from the first commit: raw tracks, one time map, and one renderer for preview and export."
>
	{#snippet after()}
		<ol class="cells bugs">
			{#each bugs as item, index (item.bug)}
				<li class="rise">
					<span class="idx" aria-hidden="true">{pad(index + 1)}</span>
					<h3>{item.bug}</h3>
					<p>{item.fix}</p>
				</li>
			{/each}
		</ol>
	{/snippet}
</SectionHeading>

<SectionHeading
	id="open"
	beat={beat('open')}
	title="Free and open source."
	quiet="Your recordings stay yours."
>
	<div class="buttons">
		<a class="button secondary small" href={GITHUB_URL}>
			<GitHubIcon size={14} />
			Star on GitHub
		</a>
		<a class="button secondary small" href="{GITHUB_URL}/blob/main/AGENTS.md">Read the rules</a>
	</div>
	{#snippet after()}
		<ul class="cells">
			{#each trust as item, index (item.title)}
				<li class="rise">
					<span class="idx" aria-hidden="true">{pad(index + 1)}</span>
					<h3>{item.title}</h3>
					<p>{item.body}</p>
				</li>
			{/each}
		</ul>
	{/snippet}
</SectionHeading>

{#if quotes.length > 0}
	<SectionHeading
		id="love"
		beat={beat('love', 'From people who switched')}
		split
		title="Show, don’t tell."
		quiet="In their own words."
		description="People come to Grip from recorders that felt slow and editors that ate the afternoon. This is what they say a week later."
	>
		{#snippet after()}
			<Quotes {quotes} />
		{/snippet}
	</SectionHeading>
{/if}

<section id="faq" class="beat" aria-labelledby="faq-title">
	<div class="wrap">
		<BeatLabel {...beat('faq')} />
		<div class="faq">
			<div class="faq-intro rise">
				<h2 id="faq-title">Questions</h2>
				<p>
					Another question? <a href="{GITHUB_URL}/issues">Ask on GitHub</a>
				</p>
			</div>
			<div class="answers rise">
				{#each faqs as faq, index (faq.question)}
					<details>
						<summary>
							<span class="idx" aria-hidden="true">{pad(index + 1)}</span>
							<span class="q">{faq.question}</span>
							<span class="plus" aria-hidden="true"></span>
						</summary>
						<p>{faq.answer}</p>
					</details>
				{/each}
			</div>
		</div>
	</div>
</section>

<section id="start" class="beat closing" aria-labelledby="start-title" data-place="closing">
	<div class="wrap">
		<div class="close">
			<div class="glow" aria-hidden="true"></div>
			<BeatLabel {...beat('start')} />
			<div class="end">
				<div class="rise">
					<h2 id="start-title">Record the demo you keep putting off.</h2>
					<p class="sub">
						Download Grip, press ⌥⌘↩︎, and have a link to share before the moment passes.
					</p>
				</div>
				<div class="close-actions rise">
					<div class="actions">
						<a class="button primary" href={DOWNLOAD_URL}>
							{@render apple()}
							Download for macOS
						</a>
						<a class="button secondary" href={docHref()}>Read the docs</a>
					</div>
					<p class="fine">Free and open source · AGPL-3.0</p>
				</div>
			</div>
		</div>
	</div>
</section>

{#snippet apple()}
	<svg
		class="apple"
		viewBox="4 3.1 14.8 18.2"
		width="13"
		height="16"
		aria-hidden="true"
		fill="currentColor"
	>
		<path
			d="M16.37 12.73c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.97.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74s1.78.74 3 .72c1.24-.02 2.02-1.12 2.78-2.23.88-1.28 1.24-2.52 1.26-2.58-.03-.01-2.4-.92-2.42-3.69ZM14.1 5.98c.63-.77 1.06-1.83.94-2.89-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28Z"
		/>
	</svg>
{/snippet}

<style>
	.progress {
		display: none;
	}

	@supports (animation-timeline: scroll()) {
		.progress {
			position: fixed;
			z-index: 50;
			inset: 0 0 auto;
			display: block;
			height: 3px;
			background: var(--painting);
			transform-origin: 0 50%;
			animation: fill linear both;
			animation-timeline: scroll(root);
		}
	}

	@keyframes fill {
		from {
			scale: 0 1;
		}
	}

	.intro {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding-top: 72px;
		padding-bottom: 64px;
	}

	.intro > *,
	.window {
		animation: blur-in calc(var(--duration) * var(--pace)) var(--enter-ease)
			calc(var(--delay) * var(--pace)) backwards;
	}

	.eyebrow {
		--rise: 3px;
		--blur: 8px;
		--duration: 1200ms;
		--delay: 250ms;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 11px 0 10px;
		white-space: nowrap;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		color: var(--fg-secondary);
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
	}

	.apple {
		translate: 0 -1.5px;
	}

	.eyebrow :global(.ahead) {
		width: 11px;
		height: 11px;
		color: var(--fg-faint);
	}

	h1 {
		--rise: 4px;
		--blur: 12px;
		--duration: 1400ms;
		--delay: 0ms;
		margin-top: 24px;
		font-size: clamp(38px, 5.2vw, 68px);
		font-weight: 550;
		line-height: 1.02;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	h1 span {
		display: block;
	}

	.quiet {
		color: var(--fg-faint);
	}

	.lede {
		--rise: 3px;
		--blur: 10px;
		--duration: 1300ms;
		--delay: 150ms;
		max-width: 640px;
		margin-top: 24px;
		color: var(--fg-muted);
		font-size: 19px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.actions {
		--rise: 3px;
		--blur: 8px;
		--duration: 1300ms;
		--delay: 300ms;
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 32px;
	}

	.fine {
		--rise: 3px;
		--blur: 8px;
		--duration: 1300ms;
		--delay: 300ms;
		margin-top: 16px;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
	}

	.plate {
		--seam: linear-gradient(
			90deg,
			transparent 4%,
			#1957fa 18%,
			#6365cd 32%,
			#9e6594 44%,
			#d35351 58%,
			#ed3e11 70%,
			#fb8400 82%,
			transparent 96%
		);
		--delay: 350ms;
		isolation: isolate;
		padding: 64px 0;
		background: linear-gradient(var(--panel) 0 0) 50% 0 / var(--col) 100% no-repeat;
	}

	@property --grow {
		syntax: '<number>';
		inherits: true;
		initial-value: 1;
	}

	.horizon,
	.gl {
		position: absolute;
		z-index: -1;
		pointer-events: none;
	}

	.horizon {
		inset: -46% calc(50% - var(--col) / 2) auto;
		height: 90%;
		background: var(--painting);
		mask-image: radial-gradient(
			closest-side,
			light-dark(rgb(0 0 0 / 0.42), rgb(0 0 0 / 0.86)) 18%,
			transparent
		);
		filter: blur(48px);
		opacity: 0.85;
		clip-path: inset(calc(100% * 46 / 90) 0 0 0);
		animation: swell calc(1600ms * var(--pace)) var(--enter-ease) calc(450ms * var(--pace))
			backwards;
	}

	.gl {
		inset: 0 calc(50% - var(--col) / 2);
		color: var(--panel);
		animation: grow calc(1600ms * var(--pace)) var(--enter-ease) calc(450ms * var(--pace)) backwards;
	}

	.window {
		--rise: 6px;
		--blur: 8px;
		--duration: 1400ms;
		--delay: 350ms;
		position: relative;
		container-type: inline-size;
	}

	figcaption {
		max-width: 560px;
		margin: 24px auto 0;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
		text-align: center;
		text-wrap: balance;
	}

	@keyframes grow {
		from {
			--grow: 0;
		}
	}

	@keyframes swell {
		from {
			opacity: 0;
			scale: 0.6;
		}
	}

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
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 24px;
		font-variant-numeric: tabular-nums;
	}

	.cells .idx {
		margin-bottom: 4px;
	}

	.cells li > :global(svg) {
		margin: 4px 0 8px;
		color: var(--fg-muted);
	}

	.cells h3 {
		font-size: 17px;
		font-weight: 550;
		line-height: 1.4;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}

	.cells p {
		color: var(--fg-muted);
		font-size: 15px;
		line-height: 1.6;
		text-wrap: pretty;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
		margin-top: 12px;
	}

	.bugs {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.bugs li:nth-child(4n + 1) {
		border-left: 0;
	}

	.formats {
		margin: 72px calc(-1 * max(var(--pad), env(safe-area-inset-left))) 0;
		padding: 64px max(var(--pad), env(safe-area-inset-left));
		border-top: 1px solid var(--frame);
		background: var(--panel);
	}

	.faq {
		display: grid;
		grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
		gap: 24px 64px;
		align-items: start;
	}

	.faq-intro {
		position: sticky;
		top: calc(var(--bar-h) + 32px);
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	h2 {
		font-size: clamp(30px, 3.4vw, 40px);
		font-weight: 550;
		line-height: 1.1;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.faq-intro p,
	.sub {
		max-width: 560px;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.faq-intro a {
		color: var(--fg-default);
		font-weight: 500;
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-decoration-thickness: 1.5px;
		text-underline-offset: 3px;
		white-space: nowrap;
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

	summary:active .q {
		color: var(--fg-secondary);
	}

	details p {
		max-width: 600px;
		padding: 0 32px 22px 40px;
		color: var(--fg-muted);
		font-size: 16px;
		line-height: 24px;
		text-wrap: pretty;
	}

	details::details-content {
		height: 0;
		overflow: clip;
	}

	details[open]::details-content {
		height: auto;
	}

	@media (prefers-reduced-motion: no-preference) {
		details::details-content {
			interpolate-size: allow-keywords;
			transition:
				height 200ms var(--ease),
				content-visibility 200ms allow-discrete;
		}
	}

	.close {
		position: relative;
		padding: 56px 64px 64px;
	}

	.glow {
		position: absolute;
		z-index: -1;
		inset: 10% 20% 0 10%;
		background:
			radial-gradient(closest-side, #1957fa, transparent) 0 30% / 55% 80% no-repeat,
			radial-gradient(closest-side, #d94f46, transparent) 50% 60% / 50% 70% no-repeat,
			radial-gradient(closest-side, #fb8600, transparent) 100% 40% / 45% 70% no-repeat;
		filter: blur(48px);
		opacity: 0.14;
		pointer-events: none;
	}

	.end {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 32px 48px;
	}

	.end > div:first-child {
		flex: 1 1 520px;
		max-width: 780px;
	}

	.end .sub {
		margin-top: 20px;
	}

	.close-actions .actions {
		margin-top: 0;
	}

	@media (hover: hover) and (pointer: fine) {
		.eyebrow:hover {
			box-shadow: inset 0 0 0 1px var(--border-default);
			color: var(--fg-default);
		}

		.eyebrow:hover :global(.ahead) {
			translate: 2px 0;
		}

		summary:hover .plus::before,
		summary:hover .plus::after {
			background: var(--fg-default);
		}

		.faq-intro a:hover {
			text-decoration-color: var(--fg-default);
		}
	}

	@media (max-width: 1023px) {
		.intro {
			padding-top: 56px;
		}

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

		.bugs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.bugs li:nth-child(even) {
			border-left: 1px solid var(--frame);
		}

		.formats {
			margin-top: 48px;
			padding-block: 40px;
		}
	}

	@media (max-width: 859px) {
		.lede,
		.faq-intro p,
		.sub {
			font-size: 17px;
		}

		.faq {
			grid-template-columns: minmax(0, 1fr);
			gap: 32px;
		}

		.faq-intro {
			position: static;
		}

		.close {
			padding: 44px 28px 48px;
		}

		.end > div:first-child {
			flex-basis: auto;
		}
	}

	@media (max-width: 639px) {
		.plate {
			padding: 40px 0;
		}

		.window {
			padding-inline: 12px;
		}
	}

	@media (max-width: 559px) {
		.bugs {
			grid-template-columns: minmax(0, 1fr);
		}

		.bugs li:nth-child(even) {
			border-left: 0;
		}

		.formats {
			padding: 32px 12px;
		}

		summary {
			grid-template-columns: minmax(0, 1fr) 16px;
		}

		summary .idx {
			display: none;
		}

		details p {
			padding: 0 24px 20px 0;
		}

		.close {
			margin-inline: -12px;
			padding: 40px 12px 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.intro > *,
		.window {
			animation: fade-in 400ms ease backwards;
		}

		.horizon,
		.gl,
		.plate {
			animation: none;
		}
	}
</style>
