<!-- Grip for coding agents: the review pain first (a pull request read from screenshots beside one with a video), then
     how an agent records its change, where the link goes, how the team's comments come back to the agent, setting it
     up in any agent, the questions, and the close. The one thing to copy is the prompt that sends an agent to
     `static/agents.md`. -->
<script lang="ts">
	import { asset } from '$app/paths';
	import Arrow from '#lib/Arrow.svelte';
	import { type Beat } from '#lib/BeatLabel.svelte';
	import Cells from '#lib/Cells.svelte';
	import Closing from '#lib/Closing.svelte';
	import Faq from '#lib/Faq.svelte';
	import FeatureRow from '#lib/FeatureRow.svelte';
	import Glow, { type Layer } from '#lib/Glow.svelte';
	import Head from '#lib/Head.svelte';
	import Media, { clip } from '#lib/Media.svelte';
	import SectionHeading from '#lib/SectionHeading.svelte';
	import { docHref, DOWNLOAD_URL, SITE_URL } from '#lib/links.ts';
	import { reveal } from '#lib/reveal.ts';

	const PROMPT = `Read ${SITE_URL}/agents.md and record a demo of this change.`;
	const SERVER = '/Applications/Grip.app/Contents/Resources/grip-mcp';
	const ENTRY = `{ "mcpServers": { "grip": { "command": "${SERVER}" } } }`;

	type Agent = Readonly<{
		key: string;
		name: string;
		command: string;
		install?: Readonly<{ label: string; href: string; then: string }>;
		note?: string;
	}>;

	// Each agent's own way to add a local server, at user scope so Grip works in every project.
	const AGENTS: readonly Agent[] = [
		{ key: 'claude', name: 'Claude Code', command: `claude mcp add --scope user grip -- ${SERVER}` },
		{ key: 'codex', name: 'Codex', command: `codex mcp add grip -- ${SERVER}` },
		{
			key: 'cursor',
			name: 'Cursor',
			command: ENTRY,
			install: {
				label: 'Add to Cursor',
				href: `https://cursor.com/en/install-mcp?name=grip&config=${encodeURIComponent(btoa(JSON.stringify({ command: SERVER })))}`,
				then: 'or add it to ~/.cursor/mcp.json',
			},
		},
		{ key: 'opencode', name: 'OpenCode', command: `opencode mcp add grip --global -- ${SERVER}` },
		{
			key: 'vscode',
			name: 'VS Code',
			command: `code --add-mcp '${JSON.stringify({ name: 'grip', type: 'stdio', command: SERVER })}'`,
			install: {
				label: 'Add to VS Code',
				href: `https://vscode.dev/redirect?url=${encodeURIComponent(`vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'grip', type: 'stdio', command: SERVER }))}`)}`,
				then: 'or run',
			},
		},
		{ key: 'gemini', name: 'Gemini CLI', command: `gemini mcp add --scope user grip ${SERVER}` },
		{
			key: 'other',
			name: 'Other',
			command: ENTRY,
			note: 'Claude Desktop, Devin Desktop, Kiro, and most MCP apps take this entry. Zed takes it under context_servers, and Amp under amp.mcpServers.',
		},
	];

	let agent = $state(AGENTS[0]);
	let copied = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy(text: string): Promise<void> {
		await navigator.clipboard.writeText(text);
		copied = text;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = ''), 1600);
	}

	const BEATS = ['problem', 'how', 'clicks', 'everywhere', 'review', 'setup', 'faq', 'start'] as const;

	const beat = (id: (typeof BEATS)[number], kicker?: string): Beat => ({
		n: BEATS.indexOf(id) + 1,
		total: BEATS.length,
		...(kicker ? { kicker } : {}),
	});

	$effect(reveal);

	// The light over the pull requests, the landing page's own.
	const HORIZON: readonly Layer[] = [{ box: [0, -0.46, 1, 0.9], peak: [0.42, 0.86], start: 0.18 }];

	const problem = [
		{
			title: 'A screenshot is one frame',
			body: 'Loading, hover, empty, and error states live between the screenshots. That is where the bugs are.',
		},
		{
			title: 'Before and after skip the during',
			body: 'Motion, focus, and timing exist only while the change runs. No still can show them.',
		},
		{
			title: 'Nobody records the video',
			body: 'Recording, trimming, and uploading take longer than the fix did, so the video never gets made.',
		},
	];

	const how = [
		{
			title: 'Your agent writes the steps',
			body: 'Open the page, click Deploy, wait for Ready. The same selectors its tests already use.',
		},
		{
			title: 'Grip plays and polishes them',
			body: 'In a hidden window, at a human pace. It zooms where each click lands, glides the cursor, and marks each step.',
		},
		{
			title: 'The video lands in the pull request',
			body: 'An MP4, a GIF, and a share link, with one frame per step that your agent checks before it posts.',
		},
	];

	const everywhere = [
		{
			title: 'In the pull request',
			body: 'Under a Demo heading at the top of the description, where the reviewer starts reading.',
		},
		{
			title: 'In the issue and the channel',
			body: 'Linear and Slack show its poster and title, so people know what they are about to watch.',
		},
		{
			title: 'Private when it has to be',
			body: 'A private link plays only for your team, or for someone you send its key to.',
		},
	];

	const faqs = [
		{
			question: 'Which apps can it record?',
			answer:
				'Any web page your agent can open: a dev server on localhost, a preview deployment, or production.',
		},
		{
			question: 'Does it take over my screen?',
			answer:
				'No. Grip plays the steps in a hidden window, so you keep working, and macOS never asks for Screen Recording.',
		},
		{
			question: 'How does the video get into the pull request?',
			answer:
				'Your agent puts the share link under a Demo heading at the top of the description. It plays in any browser, with no app to install.',
		},
		{
			question: 'Do I need an account?',
			answer:
				'Not to record: the MP4 and the GIF stay on your Mac. A share link signs in to bestboy.dev once.',
		},
		{
			question: 'Can teammates without an account comment?',
			answer:
				'Yes. Anyone who can open the link can comment as a guest, and your agent reads their comments too.',
		},
		{
			question: 'Can I change the video?',
			answer:
				'Yes. Each demo is a Grip project. Open it to cut, zoom, or add a voiceover, and export again.',
		},
		{
			question: 'Does it run in CI?',
			answer: 'Not yet. Grip runs on macOS 15 or later on Apple silicon.',
		},
		{
			question: 'Is it free?',
			answer:
				'Yes. Grip is free and open source under AGPL-3.0, and viewers and comments never cost anything.',
		},
	];

	const CALL = `record_demo({
  "url": "http://localhost:3000/deployments",
  "title": "Deploy from the list",
  "steps": [
    { "click": "text=Deploy", "say": "Deploy from the list" },
    { "wait": "text=Building" },
    { "wait": "text=Ready", "say": "It updates live" }
  ],
  "share": true
})`;

	const RESULT = `{
  "state": "done",
  "seconds": 4.3,
  "steps": [
    { "index": 1, "label": "Deploy from the list", "ok": true },
    { "index": 2, "label": "wait text=Building", "ok": true },
    { "index": 3, "label": "It updates live", "ok": true }
  ],
  "mp4": "~/Desktop/Deploy from the list.mp4",
  "gif": "~/Desktop/Deploy from the list.gif",
  "link": "https://bestboy.dev/v/x7Kq2mP9aB3c"
}`;

	let showing = $state<'call' | 'result'>('call');
</script>

<Head
	title="Grip for agents: a video of every change your agent ships"
	description="Your coding agent records each UI change it makes, and Grip polishes it into a video for the pull request. Your team comments on the frame, and the agent reads every thread."
	path="/agents"
/>

{#snippet copyIcon()}
	<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
		<rect x="5.25" y="5.25" width="8" height="8" rx="2" />
		<path d="M10.75 3.25v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
	</svg>
{/snippet}

{#snippet paste()}
	<div class="paste">
		<p class="paste-label">Paste into your agent</p>
		<div class="paste-body">
			<p class="prompt">{PROMPT}</p>
			<button class="button primary small copy" type="button" onclick={() => copy(PROMPT)}>
				{@render copyIcon()}
				<span aria-live="polite">{copied === PROMPT ? 'Copied' : 'Copy'}</span>
			</button>
		</div>
	</div>
{/snippet}

{#snippet strings(code: string)}
	{#each code.split(/("[^"]*")/u) as part, index (index)}{#if index % 2}<span class="s">{part}</span
			>{:else}{part}{/if}{/each}
{/snippet}

<section class="hero" aria-labelledby="hero-title" data-place="hero">
	<div class="wrap intro">
		<a class="eyebrow" href="#setup">
			<span>An MCP server and a CLI for any coding agent</span>
			<Arrow class="ahead" />
		</a>
		<h1 id="hero-title">
			<span>Stop imagining what a pull request does.</span>
			<span class="quiet">Watch it work.</span>
		</h1>
		<p class="lede">
			A UI change arrives as a diff and two screenshots, and you play the rest in your head. With Grip, your
			coding agent records every change it ships, polished, and links it in the pull request.
		</p>
		<div class="start">
			{@render paste()}
			<p class="or">
				<span>Or add it to</span>
				{#each AGENTS.slice(0, -1) as item (item.key)}
					<a class="chip" href="#setup" onclick={() => (agent = item)}>{item.name}</a>
				{/each}
			</p>
		</div>
		<p class="fine">
			<span>macOS 15 or later on Apple silicon</span>
			<span>Free and open source</span>
			<span>Any MCP client</span>
		</p>
	</div>
	<div class="plate beat">
		<div class="gl" aria-hidden="true">
			<Glow layers={HORIZON} opacity={0.85} />
		</div>
		<div class="wrap">
			<div class="compare">
				<div class="side">
					<p class="side-label"><b>Today</b> screenshots</p>
					<article class="pr" aria-label="A pull request with screenshots, waiting on review for two days">
						<header class="pr-head">
							<p class="pr-title">feat(deployments): deploy from the list <span>#482</span></p>
							<p class="pr-meta">
								<span class="state">Open</span>
								<span>Opened by an agent 2 days ago</span>
								<span class="diff"><span class="add">+412</span> −38</span>
							</p>
						</header>
						<div class="pr-body">
							<p>Adds a <code>Deploy</code> button. New deploys appear at the top and update live until Ready.</p>
							<div class="shots">
								{#each ['before', 'after'] as const as shot (shot)}
									<figure
										class="shot"
										style:--light="url({asset(`media/agents-${shot}-light.webp`)})"
										style:--dark="url({asset(`media/agents-${shot}-dark.webp`)})"
									>
										<figcaption>{shot === 'before' ? 'Before' : 'After'}</figcaption>
										<span class="still" role="img" aria-label="The deployments list {shot} the change"></span>
									</figure>
								{/each}
							</div>
							<div class="review">
								<span class="avatar" aria-hidden="true">AR</span>
								<div>
									<p class="who"><b>anaruiz</b> requested changes</p>
									<p>
										Does Deploy lock while it runs? What does the new row show before it’s Ready? I’ll pull the
										branch and click through it.
									</p>
								</div>
							</div>
						</div>
						<p class="pr-foot"><span class="dot"></span>Waiting on review for 2 days</p>
					</article>
				</div>
				<div class="side">
					<p class="side-label"><b>With Grip</b> recorded by the agent</p>
					<article class="pr" aria-label="The same pull request with a video, merged nine minutes after it opened">
						<header class="pr-head">
							<p class="pr-title">feat(deployments): deploy from the list <span>#482</span></p>
							<p class="pr-meta">
								<span class="state">Merged</span>
								<span>Opened by an agent 9 minutes ago</span>
								<span class="diff"><span class="add">+412</span> −38</span>
							</p>
						</header>
						<div class="pr-body">
							<p>Adds a <code>Deploy</code> button. New deploys appear at the top and update live until Ready.</p>
							<Media
								clip={clip('hero')}
								width={2304}
								height={1440}
								r={36}
								flat
								alt="The demo the agent recorded: the view zooms in as the cursor glides to Deploy, and a glass loupe follows the new build from Building to Ready."
							/>
							<p class="link"><span class="url">bestboy.dev/v/x7Kq2mP9aB3c</span> Recorded with Grip</p>
							<div class="review">
								<span class="avatar" aria-hidden="true">AR</span>
								<div>
									<p class="who"><b>anaruiz</b> approved</p>
									<p>Watched it. The button locks and the row builds in place. Ship it.</p>
								</div>
							</div>
						</div>
						<p class="pr-foot"><span class="dot done"></span>Merged 9 minutes after it opened</p>
					</article>
				</div>
			</div>
			<p class="caption">The same pull request. One you imagine, one you watch.</p>
		</div>
	</div>
</section>

<SectionHeading
	id="problem"
	beat={beat('problem', 'The problem')}
	split
	title="Your team ships more than anyone can read."
	quiet="Review is the slow part now."
	description="Agents open pull requests all day. Each one is a diff, a summary the agent wrote, and maybe a screenshot. To know a UI change works, someone still pulls the branch and clicks through it."
>
	{#snippet after()}
		<Cells items={problem} />
	{/snippet}
</SectionHeading>

<SectionHeading
	id="how"
	beat={beat('how', 'How it works')}
	split
	title="The presentation layer, automated."
	quiet="Every change ships with its video."
	description="Your agent already knows what it changed, so it knows what to click. It hands Grip the steps in one tool call, and Grip records and polishes the video with no model in the loop."
>
	{#snippet after()}
		<Cells items={how} ordered />
	{/snippet}
</SectionHeading>

<FeatureRow
	id="clicks"
	beat={beat('clicks', 'One tool call')}
	title="It zooms where your agent clicks."
	body="An agent’s clicks never move your real cursor, so a screen recording of them has nothing to follow. Grip makes each click itself, so it knows where every one lands."
	href={docHref('agents')}
	linkLabel="Every agent tool"
	checks={[
		'No Screen Recording permission',
		'Your screen stays free while it records',
		'A failed step stops the demo and names it',
	]}
>
	<div class="code">
		<div class="code-head">
			<button
				class="tab"
				type="button"
				aria-pressed={showing === 'call'}
				onclick={() => (showing = 'call')}>Tool call</button
			>
			<button
				class="tab"
				type="button"
				aria-pressed={showing === 'result'}
				onclick={() => (showing = 'result')}>Result</button
			>
		</div>
		<div class="panes">
			<pre class:off={showing !== 'call'}>{@render strings(CALL)}</pre>
			<pre class:off={showing !== 'result'}>{@render strings(RESULT)}</pre>
		</div>
	</div>
</FeatureRow>

<SectionHeading
	id="everywhere"
	beat={beat('everywhere', 'One link')}
	split
	title="One link for the whole team."
	quiet="Wherever they already work."
	description="Not everyone reads GitHub. The link plays in any browser, so design, product, and support see what changed without the branch."
>
	{#snippet after()}
		<Cells items={everywhere} />
	{/snippet}
</SectionHeading>

<FeatureRow
	id="review"
	beat={beat('review', 'The review loop')}
	mirrored
	title="Your team comments on the frame. Your agent answers."
	body="Teammates comment on the exact moment and spot in the video. Your agent reads every thread through Grip, fixes the code, records the fix behind the same link, and replies on each one."
	href={docHref('agents')}
	linkLabel="How your agent reads feedback"
	checks={['Guests comment without an account', 'Each thread keeps its moment and spot', 'A reply can resolve its thread']}
>
	<div class="code term">
		<p class="code-head path">~/acme/storefront</p>
		<pre><span class="you">› Read the feedback on bestboy.dev/v/x7Kq2mP9aB3c and fix it.</span>

<b>●</b> get_feedback
  <i>└</i> 3 open threads
    <i>0:01</i>  anaruiz   Deploy should lock while it runs
    <i>0:03</i>  mayachen  The new row jumps when it turns Ready
    <i>0:04</i>  guest     Can the row show the commit message?
<b>●</b> Fixed 3 threads in app/deployments/list.tsx
<b>●</b> record_demo  <em>✓ ✓ ✓ ✓</em>  4.6 s
  <i>└</i> version 2 of <span class="u">bestboy.dev/v/x7Kq2mP9aB3c</span>
<b>●</b> reply_feedback  3 replies, 3 resolved</pre>
	</div>
</FeatureRow>

<SectionHeading
	id="setup"
	beat={beat('setup', 'Set up')}
	split
	title="One paste."
	quiet="Your agent does the rest."
	description="Your agent reads one Markdown file. It installs Grip if it is missing, adds Grip to its own tools, and records a demo to prove it works."
>
	{#snippet after()}
		<div class="bench rise">
			<div class="setup">
				<div>
					<p class="col-label">What your agent does</p>
					<div class="code term">
						<p class="code-head path">~/acme/storefront</p>
						<pre><span class="you">› {PROMPT}</span>

<b>●</b> Fetch bestboy.dev/grip/agents.md
<b>●</b> Grip is not installed. Installing it in /Applications
  <i>└ Grip.app, signed and notarized</i>
<b>●</b> claude mcp add --scope user grip -- /Applications/Grip.app/…/grip-mcp
  <i>└ Grip’s tools load in the next session. This demo uses its CLI.</i>
<b>●</b> grip record_demo &lt; demo.json
  <i>└</i> <em>✓</em> click Deploy  <em>✓</em> wait Building  <em>✓</em> wait Ready  <i>4.3 s</i>
  <i>└</i> <span class="u">bestboy.dev/v/x7Kq2mP9aB3c</span>
<b>●</b> Added the demo to pull request #482.</pre>
					</div>
				</div>
				<div>
					<p class="col-label">Or add it yourself</p>
					<div class="code">
						<div class="code-head">
							<div class="tabs" role="group" aria-label="Your agent">
								{#each AGENTS as item (item.key)}
									<button
										class="tab"
										type="button"
										aria-pressed={agent.key === item.key}
										onclick={() => (agent = item)}>{item.name}</button
									>
								{/each}
							</div>
							<button
								class="button secondary small copy"
								type="button"
								aria-label="Copy the {agent.name} setup"
								onclick={() => copy(agent.command)}
							>
								{@render copyIcon()}
								<span aria-live="polite">{copied === agent.command ? 'Copied' : 'Copy'}</span>
							</button>
						</div>
						{#if agent.install}
							<p class="pane-actions">
								<a class="button primary small" href={agent.install.href}>{agent.install.label}</a>
								<span>{agent.install.then}</span>
							</p>
						{/if}
						<pre class="command">{#each agent.command.split('/') as part, index (index)}{#if index}<wbr />/{/if}{part}{/each}</pre>
						{#if agent.note}<p class="pane-note">{agent.note}</p>{/if}
						<p class="pane-note">
							Needs Grip in Applications. <a href={DOWNLOAD_URL}>Download for macOS</a>
						</p>
					</div>
				</div>
			</div>
		</div>
	{/snippet}
</SectionHeading>

<Faq beat={beat('faq')} {faqs} />

<Closing
	beat={beat('start')}
	title="Ship the video with the change."
	sub="Paste one line into your agent. Its next pull request shows how the change works."
>
	<div class="close-paste rise">
		{@render paste()}
	</div>
</Closing>

<style>
	/* The opening, as the landing page's hero enters: each part rises out of a blur in turn. */
	.intro {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding-top: 72px;
		padding-bottom: 64px;
	}

	.intro > *,
	.plate .wrap {
		animation:
			blur-in calc(var(--duration) * var(--pace)) var(--enter-ease) calc(var(--delay) * var(--pace))
				backwards,
			unblur calc(var(--duration) * var(--pace) * 0.705) var(--unblur-ease)
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
		padding: 0 11px 0 12px;
		white-space: nowrap;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		color: var(--fg-secondary);
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
	}

	.eyebrow :global(.ahead) {
		width: 11px;
		height: 11px;
		color: var(--fg-faint);
		rotate: 135deg;
	}

	h1 {
		--rise: 4px;
		--blur: 12px;
		--duration: 1400ms;
		--delay: 0ms;
		max-width: 1000px;
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

	.start {
		--rise: 3px;
		--blur: 8px;
		--duration: 1300ms;
		--delay: 300ms;
		width: 100%;
		max-width: 880px;
		margin-top: 32px;
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

	/* The one thing to copy. */
	.paste {
		border-radius: 16px;
		background: var(--surface-elevated);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08);
	}

	.paste-label {
		padding: 12px 18px 0;
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.paste-body {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 8px 10px 12px 18px;
	}

	.prompt {
		flex: 1;
		min-width: 0;
		font-family: var(--mono);
		font-size: 14px;
		line-height: 1.6;
	}

	.copy {
		flex: none;
		min-width: 88px;
		border: 0;
		font-family: inherit;
		cursor: pointer;
	}

	.copy svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.or {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 6px;
		margin-top: 16px;
		color: var(--fg-muted);
		font-size: 13px;
	}

	.or > span {
		margin-right: 4px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 11px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		color: var(--fg-secondary);
		font-weight: 500;
		text-decoration: none;
	}

	/* The two pull requests on the landing page's lit plate. */
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
		isolation: isolate;
		padding: 64px 0;
	}

	.plate .wrap {
		--rise: 6px;
		--blur: 8px;
		--duration: 1400ms;
		--delay: 350ms;
	}

	.gl {
		position: absolute;
		z-index: -1;
		inset: 0 calc(50% - var(--col) / 2);
		color: var(--panel);
		pointer-events: none;
	}

	.compare {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 24px;
	}

	.side {
		display: flex;
		flex-direction: column;
	}

	.side-label {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 14px;
		color: var(--fg-secondary);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.side-label::after {
		content: '';
		flex: 1;
		height: 1px;
		margin-left: 4px;
		background: var(--border-default);
	}

	.side-label b {
		color: var(--fg-default);
		font-weight: 500;
	}

	.pr {
		display: flex;
		flex: 1;
		flex-direction: column;
		overflow: hidden;
		border-radius: 14px;
		background: var(--surface-elevated);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08),
			0 32px 64px -24px rgb(0 0 0 / 0.45);
	}

	.pr-head {
		padding: 16px 18px 14px;
		border-bottom: 1px solid var(--border-default);
	}

	.pr-title {
		font-size: 15px;
		font-weight: 550;
		line-height: 1.4;
		letter-spacing: -0.01em;
	}

	.pr-title span {
		color: var(--fg-faint);
		font-weight: 400;
	}

	.pr-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
		margin-top: 8px;
		color: var(--fg-muted);
		font-size: 12px;
		line-height: 22px;
	}

	.state {
		padding: 0 9px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--border-default);
		color: var(--fg-default);
		font-weight: 550;
	}

	.diff {
		font-family: var(--mono);
	}

	.add {
		color: var(--success);
	}

	.pr-body {
		display: grid;
		flex: 1;
		align-content: start;
		gap: 14px;
		padding: 16px 18px 18px;
	}

	/* The screenshots take the height the video beside them leaves, so both cards end together. */
	.pr-body:has(.shots) {
		grid-template-rows: auto 1fr auto;
	}

	.pr-body p {
		color: var(--fg-prose);
		font-size: 13px;
		line-height: 1.55;
	}

	code {
		padding: 1px 5px;
		border-radius: 5px;
		background: var(--surface-well);
		box-shadow: inset 0 0 0 0.5px var(--border-default);
		font-family: var(--mono);
		font-size: 12px;
	}

	.shots {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.shot {
		display: flex;
		flex-direction: column;
		margin: 0;
	}

	/* A screenshot in the page's theme, as `Media` picks a clip's still. */
	.still {
		flex: 1;
		aspect-ratio: 4 / 5;
		border-radius: 8px;
		background: var(--dark) 0 0 / cover var(--surface-well);
		box-shadow: 0 0 0 1px var(--ring-faint);
	}

	:global(:root[data-theme='light']) .still {
		background-image: var(--light);
	}

	@media (prefers-color-scheme: light) {
		:global(:root:not([data-theme])) .still {
			background-image: var(--light);
		}
	}

	figcaption,
	.link {
		font-family: var(--mono);
		font-size: 11px;
	}

	figcaption {
		margin-bottom: 6px;
		color: var(--fg-muted);
		line-height: 18px;
	}

	.pr-body .link {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		color: var(--fg-muted);
		font-size: 12px;
	}

	.url {
		color: var(--fg-default);
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
	}

	.review {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr);
		gap: 10px;
		padding-top: 14px;
		border-top: 1px solid var(--border-default);
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--surface-hover);
		color: var(--fg-secondary);
		font-size: 10px;
		font-weight: 600;
	}

	.pr-body .who {
		color: var(--fg-muted);
		font-size: 12px;
	}

	.who b {
		color: var(--fg-default);
		font-weight: 550;
	}

	.pr-body .who + p {
		margin-top: 2px;
	}

	.pr-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: auto;
		padding: 11px 18px;
		border-top: 1px solid var(--border-default);
		background: var(--surface-well);
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 12px;
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--fg-faint);
	}

	.dot.done {
		background: var(--success);
	}

	.caption {
		max-width: 560px;
		margin: 24px auto 0;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
		text-align: center;
		text-wrap: balance;
	}

	/* Code and terminals: a card like the page's screenshots, its head a strip of tabs or the folder it runs in. */
	.code {
		width: 100%;
		overflow: hidden;
		border-radius: 12px;
		background: var(--surface-elevated);
		box-shadow: 0 0 0 1px var(--ring-faint);
	}

	.code-head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 41px;
		padding: 6px;
		border-bottom: 1px solid var(--border-default);
	}

	.path {
		padding-inline: 14px;
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 12px;
	}

	.tabs {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		gap: 2px;
		min-width: 0;
	}

	.tab {
		height: 28px;
		padding: 0 11px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--fg-muted);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.tab[aria-pressed='true'] {
		background: var(--surface-hover);
		color: var(--fg-default);
	}

	pre {
		margin: 0;
		padding: 18px 20px 20px;
		overflow-x: auto;
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.75;
	}

	/* Both tabs share one cell, so the card keeps the taller one's height and never jumps. */
	.panes {
		display: grid;
	}

	.panes > pre {
		grid-area: 1 / 1;
		min-width: 0; /* a long line scrolls inside the card */
	}

	.off {
		visibility: hidden;
	}

	/* The one line a reader copies: whole at any width. */
	pre.command {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	pre :global(.s),
	.command,
	.you,
	.term b {
		color: var(--fg-default);
	}

	.term b {
		font-weight: 400;
	}

	.term i {
		color: var(--fg-faint);
		font-style: normal;
	}

	.term em {
		color: var(--success);
		font-style: normal;
	}

	.term .u {
		color: var(--fg-default);
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
	}

	/* The setup, on a band of panel the width of the column, like the landing page's formats. */
	.bench {
		margin: 72px calc(-1 * max(var(--pad), env(safe-area-inset-left))) 0;
		padding: 64px max(var(--pad), env(safe-area-inset-left));
		border-top: 1px solid var(--frame);
		background: var(--panel);
	}

	.setup {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 40px;
		max-width: 920px;
		margin: 0 auto;
	}

	.col-label {
		margin-bottom: 12px;
		color: var(--fg-secondary);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.code-head .copy {
		align-self: flex-start;
	}

	.pane-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 14px;
		padding: 18px 20px 0;
		color: var(--fg-muted);
		font-size: 13px;
	}

	.pane-note {
		padding: 0 20px 18px;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
	}

	.pane-note a {
		color: var(--fg-default);
		font-weight: 500;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
	}

	.close-paste {
		flex: 1 1 100%;
		max-width: 880px;
	}

	@media (hover: hover) and (pointer: fine) {
		.eyebrow:hover {
			box-shadow: inset 0 0 0 1px var(--border-default);
			color: var(--fg-default);
		}

		.eyebrow:hover :global(.ahead) {
			translate: 0 2px;
		}

		.chip:hover,
		.tab:hover {
			color: var(--fg-default);
		}

		.chip:hover {
			box-shadow: inset 0 0 0 1px var(--border-default);
		}

		.pane-note a:hover {
			text-decoration-color: var(--fg-default);
		}
	}

	@media (max-width: 1023px) {
		.intro {
			padding-top: 56px;
		}

		.compare {
			grid-template-columns: minmax(0, 1fr);
			gap: 48px;
		}

		.bench {
			margin-top: 48px;
			padding-block: 40px;
		}
	}

	@media (max-width: 859px) {
		.lede {
			font-size: 17px;
		}
	}

	@media (max-width: 639px) {
		.plate {
			padding: 40px 0;
		}

		.paste-body {
			flex-direction: column;
			align-items: stretch;
			gap: 12px;
		}

		.prompt {
			font-size: 13px;
		}

		.paste .copy {
			height: 40px;
		}

		.bench {
			padding: 32px 12px;
		}

		.code-head {
			flex-wrap: wrap;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.intro > *,
		.plate .wrap {
			animation: fade-in 400ms ease backwards;
		}
	}
</style>
