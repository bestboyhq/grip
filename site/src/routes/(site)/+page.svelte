<!-- Grip's landing page: the hero shows Grip's editor playing a take and what people say about theirs, then beat by beat how a
     take becomes one (auto-zoom, captions, the editor, the look, capture, how fast it opens, export), the bugs it
     designs out, why it is safe to rely on, the questions, and the close. Every claim and number comes from the README
     and the guide. -->
<script lang="ts">
	import capture from '../../../../.github/readme/capture.webp';
	import editor from '../../../../.github/readme/editor.webp';
	import Arrow from '#lib/Arrow.svelte';
	import BeatLabel, { type Beat } from '#lib/BeatLabel.svelte';
	import Cells from '#lib/Cells.svelte';
	import Closing from '#lib/Closing.svelte';
	import Faq from '#lib/Faq.svelte';
	import FeatureRow from '#lib/FeatureRow.svelte';
	import GitHubIcon from '#lib/GitHubIcon.svelte';
	import { still } from '#lib/Editor.svelte';
	import Head from '#lib/Head.svelte';
	import Hero from '#lib/Hero.svelte';
	import Media, { clip } from '#lib/Media.svelte';
	import Quotes, { type Quote } from '#lib/Quotes.svelte';
	import { reveal } from '#lib/reveal.ts';
	import SectionHeading from '#lib/SectionHeading.svelte';
	import StageLight from '#lib/StageLight.svelte';
	import { AGENTS, docHref, DOWNLOAD_URL, GITHUB_URL, SITE_DESCRIPTION } from '#lib/links.ts';

	// Each quote is the person's own, published with their permission.
	const quotes: readonly Quote[] = [
		{
			quote: 'I switched from my old recorder and never looked back. Recording used to feel like paperwork. Now it’s one keystroke.',
			name: 'Aleks',
			role: 'Product Engineer, PostHog',
		},
		{
			quote: 'It’s so snappy. I press the shortcut, talk, stop, and the link works before the upload is even done.',
			name: 'Mike',
			role: 'GTM Engineer',
		},
		{
			quote: 'People reply to my videos asking how I made them. Honestly, Grip did.',
			name: 'Bartosz',
			role: 'Product Engineer, Netflix',
		},
		{
			quote: 'If your engineers are shy about sharing updates, try giving them Grip.',
			name: 'Anna',
			role: 'Engineering Manager, ex-Box',
		},
	];

	const BEATS = [
		'love',
		'how',
		'zoom',
		'captions',
		'editor',
		'look',
		'capture',
		'speed',
		'export',
		'agents',
		'bugs',
		'open',
		'faq',
		'start',
	] as const;

	const beat = (id: (typeof BEATS)[number], kicker?: string): Beat => ({
		n: BEATS.indexOf(id) + 1,
		total: BEATS.length,
		...(kicker ? { kicker } : {}),
	});

	$effect(reveal);

	const steps = [
		{
			title: 'Press your shortcut',
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

	// Grip opens in 8 ms; each bar sets that against a familiar moment, drawn to scale.
	const speed = [
		{ name: 'Grip', note: 'Shortcut to ready', ms: 8 },
		{ name: 'Hummingbird', note: 'One wing flap', ms: 20 },
		{ name: 'Blink', note: 'The quickest one', ms: 100 },
		{ name: 'Heartbeat', note: 'One beat at rest', ms: 800 },
	];
	const longest = Math.max(...speed.map((row) => row.ms));

	// The formats clip's three windows, in its pixels: strip.html at 2x, cropped to them. The page shows only the
	// windows, on its own stage, with their labels in its own type.
	const STRIP = [76, 72, 2406, 688] as const;
	const formats = [
		{ ratio: '16:9', where: 'YouTube', x: 0, width: 1224, icon: [16, 11] },
		{ ratio: '1:1', where: 'LinkedIn', x: 1278, width: 688, icon: [12, 12] },
		{ ratio: '9:16', where: 'Reels', x: 2018, width: 388, icon: [9, 14] },
	] as const;
	const WINDOW_RADIUS = 16;
	const windowsMask = `url("data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${STRIP[2]} ${STRIP[3]}">${formats
			.map(({ x, width }) => `<rect x="${x}" width="${width}" height="${STRIP[3]}" rx="${WINDOW_RADIUS}"/>`)
			.join('')}</svg>`,
	)}")`;
	let formatWindows = $state<HTMLElement[]>([]);
	let formatsLit = $state(false);

	const agents = [
		{
			title: 'Records in a hidden window',
			body: 'Your agent hands Grip the steps to show its change. Grip plays them at a human pace, off screen, while you keep working.',
		},
		{
			title: 'Polished like your own takes',
			body: 'It zooms where each click lands and glides the cursor, then saves an MP4, a GIF, and a link for the pull request.',
		},
		{
			title: 'Reads your team’s comments',
			body: 'Teammates comment on the exact frame. Your agent reads each thread, fixes the code, and replies.',
		},
	];

	const bugs = [
		{
			title: 'Subtitles drift or ignore your cuts',
			body: 'Captions, zooms, keystrokes, and audio stay in sync through every cut and speed change.',
		},
		{
			title: 'Zooms shift when you trim the clip before them',
			body: 'Every zoom, caption, and keystroke stays on its moment, however you cut around it.',
		},
		{
			title: 'The cursor is baked into the video',
			body: 'Grip records the screen without the cursor and draws it back in, so you can smooth, resize, or hide it later.',
		},
		{
			title: 'The export doesn’t match the preview',
			body: 'One renderer draws both, so the export matches the preview frame for frame.',
		},
		{
			title: 'A crash or power loss eats the take',
			body: 'Grip writes the take to disk as it records and rebuilds an interrupted one at the next launch.',
		},
		{
			title: 'A full disk corrupts the recording',
			body: 'Grip won’t start with under 1 GB free, warns when space runs low, and keeps what it wrote.',
		},
		{
			title: 'A # or emoji in a project name breaks a feature',
			body: 'Names like “Demo #1 ✨ café” are in the test suite and the demo project.',
		},
		{
			title: 'Long projects make the editor crawl',
			body: 'The timeline is checked against a 2-hour project with 500 cuts, 300 zooms, and 20,000 caption words.',
		},
	];

	const trust = [
		{
			title: 'Open source',
			body: 'Every line is on GitHub under AGPL-3.0, so anyone can read it, build it, or keep it going.',
		},
		{
			title: 'Runs on your Mac',
			body: 'Recording, editing, transcription, and background removal stay on it. Only usage stats leave it, never what you record, and you can turn them off in Settings.',
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
				'Yes. Grip is free and open source under AGPL-3.0, with no subscription, no account, and no watermark.',
		},
		{
			question: 'Can I use it for commercial work?',
			answer:
				'Yes, for free. There is no commercial license or business edition to buy: the Grip you download records, edits, and exports for work exactly as it does for anything else. The videos and screenshots you make are yours.',
		},
		{
			question: 'How is Grip different from other screen recorders?',
			answer:
				'It keeps the raw recording apart from the edits. The screen is recorded without the cursor, every zoom and caption is an edit you can change, and one renderer draws the preview and the export, so they match frame for frame. A screenshot tool with markup sits on the same shortcut.',
		},
		{
			question: 'Is there a Windows version?',
			answer:
				'No. Grip is built on macOS frameworks for capture, encoding, and transcription, and it needs macOS 15 or later on Apple silicon.',
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

<Head title="Grip: professional recordings and screenshots within seconds" description={SITE_DESCRIPTION} path="" />

<!-- The hero editor's still, which shows until its take plays. -->
<svelte:head>
	<link rel="preload" as="image" href={still} fetchpriority="high" />
</svelte:head>

<Hero>
	<div class="actions">
		<a class="button primary" href={DOWNLOAD_URL}>
			{@render apple()}
			Download for macOS
		</a>
		<a class="button secondary" href={GITHUB_URL}>
			<GitHubIcon size={16} />
			Star on GitHub
		</a>
	</div>
	<p class="fine">
		<span>macOS 15 or later on Apple silicon</span>
		<span>No subscription</span>
		<span>No account</span>
		<span>No watermark</span>
	</p>
</Hero>

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

<SectionHeading
	id="how"
	beat={beat('how', 'How it works')}
	split
	title="Record once."
	quiet="Skip the editing."
	description="Raw recordings are hard to watch: a tiny cursor on a huge screen, nothing in focus, and a lot of “um”. Grip polishes the take for you, and keeps every edit a choice you can change."
>
	{#snippet after()}
		<Cells items={steps} ordered />
	{/snippet}
</SectionHeading>

<FeatureRow
	id="zoom"
	beat={beat('zoom', 'Auto-zoom')}
	title="It zooms where you click."
	body="Clicks and typing become zooms that follow your cursor, and a glass loupe magnifies one spot while the rest stays in view. The cursor is redrawn smooth, passing exactly through every click."
	href={docHref('polished-by-default')}
	linkLabel="What Grip polishes"
	checks={['Each zoom is an edit you can move', 'Keystrokes as keycaps in your layout']}
>
	<Media
		clip={clip('loupe')}
		width={1152}
		height={720}
		r={13}
		alt="A revenue dashboard: a glass loupe follows the cursor along the growth chart, magnifies each day's figure, then the Export CSV button as it turns to Exported."
	/>
</FeatureRow>

<FeatureRow
	id="captions"
	beat={beat('captions', 'Captions and voice')}
	mirrored
	title="Captions written on your Mac."
	body="Grip transcribes your voice on your Mac and times every word. It cuts background noise, softens harsh S sounds, keeps quiet phrases audible, and makes sure nothing clips, so you sound produced."
	href={docHref('polished-by-default')}
	linkLabel="How your voice sounds"
	checks={['25 European languages', 'As loud as online video']}
>
	<Media
		clip={clip('captions')}
		width={1152}
		height={720}
		r={13}
		alt="A launch checklist with big word-by-word captions, Okay, launch day. Changelog, done. Demo video, done., while each item is checked off."
	/>
</FeatureRow>

<FeatureRow
	id="editor"
	beat={beat('editor', 'Editor')}
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
	mirrored
	title="Frame it after the take."
	body="Pick a wallpaper, a device frame, and a camera style once the recording is done. Save the whole look as a preset, and every new take can wear it."
	href={docHref('make-it-yours')}
	linkLabel="Every look Grip has"
	checks={['165 wallpapers, drawn live on the GPU', 'MacBook, iPhone, and iPad frames']}
>
	<Media
		clip={clip('macbook')}
		width={1280}
		height={720}
		r={14}
		alt="A calendar app in a MacBook frame on a warm wallpaper: the view pushes in as a Design review event is created, then pulls back to the whole laptop."
	/>
</FeatureRow>

<FeatureRow
	id="capture"
	beat={beat('capture', 'Capture')}
	title="One keystroke. Screenshot or video."
	body="Press your keys, even macOS’s screenshot ones, and the screen freezes in the mode you used last. Draw arrows, boxes, ink, and text on top, pixelate what’s private, then copy it, save it, or record it."
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

<section id="speed" class="beat flush" aria-labelledby="speed-title">
	<div class="wrap">
		<BeatLabel {...beat('speed', 'Speed')} />
		<div class="speed">
			<p class="reading rise">
				<span class="ms"><span class="eight">8</span><span class="unit">ms</span></span>
				<span class="from">From shortcut to ready</span>
			</p>
			<div class="rise">
				<h2 id="speed-title">
					<span>Blink and you’ll miss it.</span>
				</h2>
				<p class="sub">
					Press your shortcut and the screen freezes, ready to record. Grip naps in your menu bar, so
					there is never anything to wait for.
				</p>
			</div>
		</div>
		<figure class="chart">
			<figcaption class="rise">Milliseconds, lower is faster</figcaption>
			<ul>
				{#each speed as row, index (row.name)}
					<li class={['rise', { grip: index === 0 }]} style:--share={row.ms / longest}>
						<span class="who"><span class="name">{row.name}</span> {row.note}</span>
						<span class="track">
							<span class="bar" aria-hidden="true"></span>
							{row.ms} ms
						</span>
					</li>
				{/each}
			</ul>
		</figure>
	</div>
</section>

<SectionHeading
	id="export"
	beat={beat('export', 'Export and share')}
	split
	title="One take, every format."
	quiet="Nothing falls out of frame."
	description="MP4 up to 4K, a GIF that fits a README, or subtitles aligned through every cut. Narrow formats follow the cursor, and share links take comments at the exact second."
>
	{#snippet after()}
		<div class="formats">
			<StageLight side="right" casters={formatWindows} bind:lit={formatsLit} />
			<div class={['strip', 'rise', { lit: formatsLit }]} style:--windows={windowsMask}>
				<ul aria-hidden="true">
					{#each formats as { ratio, where, x, width, icon }, index (ratio)}
						<li style:left="{(x / STRIP[2]) * 100}%" style:width="{(width / STRIP[2]) * 100}%">
							<span
								class="window"
								bind:this={formatWindows[index]}
								style:aspect-ratio="{width} / {STRIP[3]}"
								style:border-radius="{(WINDOW_RADIUS / width) * 100}% / {(WINDOW_RADIUS / STRIP[3]) * 100}%"
							></span>
							<span class="label">
								<i style:width="{icon[0]}px" style:height="{icon[1]}px"></i>{ratio}
								<span class="where">{where}</span>
							</span>
						</li>
					{/each}
				</ul>
				<Media
					clip={clip('formats')}
					width={2560}
					height={880}
					crop={STRIP}
					r={WINDOW_RADIUS}
					alt="One chat recording exported as 16:9 for YouTube, 1:1 for LinkedIn, and 9:16 for Reels, each following the cursor as a reply is sent."
				/>
			</div>
		</div>
	{/snippet}
</SectionHeading>

<SectionHeading
	id="agents"
	beat={beat('agents', 'For coding agents')}
	split
	title="Your agent records the demo."
	quiet="Every change ships with its video."
	description="Add Grip to Claude Code, Codex, Cursor, or any other MCP client. Your agent records each UI change it makes, and your team watches it instead of reading screenshots."
>
	<a class="arrow-link more" href={AGENTS}>
		Grip for agents
		<Arrow class="ahead" />
	</a>
	{#snippet after()}
		<Cells items={agents} />
	{/snippet}
</SectionHeading>

<SectionHeading
	id="bugs"
	beat={beat('bugs', 'Under the hood')}
	split
	title="The usual recorder bugs."
	quiet="Designed out."
	description="Each one shipped in a real screen recorder. Grip designs them out from the first commit instead of patching them later."
>
	{#snippet after()}
		<Cells items={bugs} ordered four />
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
		<Cells items={trust} />
	{/snippet}
</SectionHeading>

<Faq beat={beat('faq')} {faqs} />

<Closing
	beat={beat('start')}
	title="Record the demo you keep putting off."
	sub="Download Grip, press your shortcut, and have a link to share before the moment passes."
>
	<div class="close-actions rise">
		<div class="actions">
			<a class="button primary" href={DOWNLOAD_URL}>
				{@render apple()}
				Download for macOS
			</a>
			<a class="button secondary" href={docHref()}>Read the docs</a>
		</div>
		<p class="fine"><span>Free and open source</span> <span>AGPL-3.0</span></p>
	</div>
</Closing>

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
	.apple {
		translate: 0 -1.5px;
	}

	.actions {
		--rise: 3px;
		--blur: 8px;
		--duration: 1300ms;
		--delay: 300ms;
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}

	.fine {
		--rise: 3px;
		--blur: 8px;
		--duration: 1300ms;
		--delay: 300ms;
		margin-top: 16px;
		margin-left: -0.6em;
		clip-path: inset(-1em -1em -1em 0.6em);
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
		text-wrap: balance;
	}

	/* Each item leads with its dot, and the line starts one dot early behind the clip, so no line starts or ends on a
	   dot however the items wrap. */
	.fine span {
		white-space: nowrap;
	}

	.fine span::before {
		content: '·';
		display: inline-block;
		width: 0.6em;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
		margin-top: 12px;
	}

	.more {
		margin-top: 20px;
	}

	.flush {
		padding-bottom: 0;
	}

	.speed {
		display: grid;
		grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
		gap: 32px 80px;
		align-items: center;
	}

	.reading {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* The page's one poster numeral, painted like the quotes' marks, with no light behind it. No letter-spacing: it would
	   narrow the 8's box past its ink, and the paint, clipped to that box, would cut its right side. */
	.ms {
		display: flex;
		align-items: baseline;
		gap: 0.02em;
		margin: -0.06em 0 -0.1em -0.05em;
		font-size: clamp(160px, 22vw, 300px);
		font-weight: 550;
		line-height: 1;
	}

	.eight {
		background: var(--painting);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.unit {
		color: var(--fg-faint);
		font-size: 0.32em;
		letter-spacing: -0.03em;
	}

	.from {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.speed h2 {
		font-size: clamp(34px, 4.6vw, 52px);
		font-weight: 550;
		line-height: 1.06;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	.speed h2 span {
		display: block;
	}

	.sub {
		max-width: 560px;
		margin-top: 20px;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.chart {
		margin: 72px calc(-1 * max(var(--pad), env(safe-area-inset-left))) 0;
		padding: 40px max(var(--pad), env(safe-area-inset-left));
		border-top: 1px solid var(--frame);
	}

	figcaption {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 24px;
	}

	.chart ul {
		display: grid;
		gap: 20px;
		margin-top: 28px;
		list-style: none;
	}

	.chart li {
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		gap: 8px 24px;
		align-items: center;
	}

	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--fg-faint);
		font-size: 13px;
		line-height: 1.4;
	}

	.name {
		color: var(--fg-muted);
		font-size: 17px;
		font-weight: 550;
		letter-spacing: -0.01em;
	}

	.track {
		display: flex;
		align-items: center;
		gap: 14px;
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	/* To scale against the longest moment, which ends with its value at the edge. The floor only keeps Grip's sliver
	   visible on a phone, where a wider one would draw it as long as the hummingbird's. */
	.bar {
		flex: none;
		width: max(3px, calc((100% - 6ch - 14px) * var(--share)));
		height: 10px;
		border-radius: 3px;
		background: var(--border-default);
	}

	.grip .name,
	.grip .track {
		color: var(--fg-default);
	}

	.grip .bar {
		height: 14px;
		background: var(--painting);
	}

	/* The formats stand on a lit stage like the features' windows, across the whole column. */
	.formats {
		position: relative;
		margin: 72px calc(-1 * max(var(--pad), env(safe-area-inset-left))) 0;
		padding: 64px max(var(--pad), env(safe-area-inset-left));
		border-top: 1px solid var(--frame);
	}

	.strip {
		position: relative;
		max-width: 1120px;
		margin: 0 auto;
		padding-bottom: 40px;
	}

	/* The clip shows only its windows; the stage shows between them. */
	.strip :global(.frame) {
		mask: var(--windows) 0 0 / 100% 100% no-repeat;
	}

	/* Each window's ring and shadow sit under the clip, so a shadow never falls on the window beside it. */
	.strip ul {
		position: absolute;
		inset: 0;
		list-style: none;
	}

	.strip li {
		position: absolute;
		top: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
	}

	.window {
		width: 100%;
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08),
			0 32px 64px -24px rgb(0 0 0 / 0.45);
	}

	/* Lit, the stage draws the windows' long shadows, which a CSS shadow draws in steps. */
	.lit .window {
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08);
	}

	.label {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--fg-default);
		font-family: var(--mono);
		font-size: 13px;
		line-height: 20px;
		white-space: nowrap;
	}

	.label i {
		box-sizing: border-box;
		border: 1.5px solid var(--fg-muted);
		border-radius: 3px;
	}

	.where {
		color: var(--fg-muted);
	}

	@media (max-width: 1023px) {
		.chart {
			margin-top: 48px;
			padding-block: 32px;
		}

		.formats {
			margin-top: 48px;
			padding-block: 40px;
		}
	}

	@media (max-width: 859px) {
		.sub {
			font-size: 17px;
		}

		.speed {
			grid-template-columns: minmax(0, 1fr);
			gap: 32px;
		}
	}

	@media (max-width: 559px) {
		.chart li {
			grid-template-columns: minmax(0, 1fr);
		}

		.formats {
			padding: 32px 12px;
		}

		/* The 9:16 window is too narrow here for its platform beside its ratio. */
		.where {
			display: none;
		}

		.strip {
			padding-bottom: 32px;
		}

		.strip li {
			gap: 12px;
		}
	}
</style>
