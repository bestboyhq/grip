<!-- Disco December's sending dialog: the contest and its prize in one sentence, how winners are picked under it, and
     three steps between, get Grip, record, send the link in, which takes signing in. A sender can take a demo out
     again here. The platform keeps the demos in, behind its showcase API on this site's own
     origin in production (the platform's docs/api.md, "The showcase"). Anywhere else nobody reads as signed in, so the
     last step signs in. It reports to Logdash, as `grip_web_disco_*`, each step a person reaches and how each send
     ends; the platform counts what follows, up to each vote. -->
<script module lang="ts">
	import { asset } from '$app/paths';
	import { BESTBOY_URL, DOWNLOAD_URL } from './links.ts';

	const API = `${BESTBOY_URL}/api/showcase`;
	// The demos one account can have in at once.
	const MOST = 3;
	// The guide's steps, the one a person is on open and the ones behind them ticked.
	const STEPS = [
		{ id: 'download', title: 'Download Grip', done: 'On your Mac' },
		{ id: 'record', title: 'Record a stunning demo', done: 'Recorded' },
		{ id: 'submit', title: 'Submit your link', done: '' },
	];

	type Demo = { id: string; title: string; host: string | null; counts: boolean };
	// What the API answers: what went in or out, or why not, with the field a refused link is about.
	type Reply = { error?: string; field?: 'link' | 'site'; title?: string; host?: string; again?: boolean };
	type Answer = { error?: string; field?: Reply['field']; refused?: string; entered?: Reply; withdrawn?: string };
</script>

<script lang="ts">
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { track } from './track.ts';

	// Told when the dialog opens and closes, and the time left to enter, from the strip's clock.
	let { ontoggle, left = '' }: { ontoggle?: (open: boolean) => void; left?: string } = $props();

	let send = $state<HTMLDialogElement>();
	// Drawn once first opened, so no page carries it in its HTML.
	let shown = $state(false);
	let step = $state(0);
	let downloading = $state(false);
	let sending = $state(false);
	let signedIn = $state(false);
	let mine = $state<Demo[]>([]);
	let answer = $state<Answer>({});
	// The step last reported, and when this opening started and how many demos it sent in, for the report on close.
	let reported = -1;
	let since = 0;
	let sent = 0;

	// Signing in comes back to this page at `#submit`, where the dialog opens on the link.
	const signIn = $derived(`${BESTBOY_URL}/login?next=${encodeURIComponent(`${page.url.pathname}#submit`)}`);

	// Who is signed in and their demos in. A page that cannot read them, on another origin or with the platform down,
	// reads as signed out.
	async function refresh(): Promise<void> {
		const data: { signedIn?: boolean; mine?: Demo[] } = await fetch(API)
			.then((r) => (r.ok ? r.json() : {}))
			.catch(() => ({}));
		signedIn = !!data.signedIn;
		mine = data.mine ?? [];
	}

	// A step's way on takes the focus, since the button that led there folds away.
	async function go(to: number): Promise<void> {
		step = to;
		if (reported !== to) {
			reported = to;
			track('grip_web_disco_step_viewed', { step: STEPS[to].id, signed_in: signedIn });
		}
		await tick();
		send?.querySelector<HTMLElement>(`[data-step="${to}"] .body :is(input, .primary)`)?.focus();
	}

	// It opens on the first step, or on the last for someone back from signing in or with a demo in already, already
	// there rather than folding the first step away.
	export async function open(last = false): Promise<void> {
		if (send?.open) return;
		await refresh();
		step = last || mine.length ? 2 : 0;
		downloading = false;
		answer = {};
		[reported, since, sent] = [-1, Date.now(), 0];
		// Sign-in comes back through `#submit`, the only other way in.
		track('grip_web_disco_opened', {
			step: STEPS[step].id,
			signed_in: signedIn,
			demos: mine.length,
			from: last ? 'submit_link' : 'strip',
		});
		shown = true;
		await tick();
		ontoggle?.(true);
		send?.showModal();
		await go(step);
	}

	// A demo sent in before it had a website gets one by being sent in again: its link goes in the field, and the focus
	// waits on its website.
	function addSite(id: string): void {
		const field = (name: string) => send?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
		field('link')!.value = `${new URL(BESTBOY_URL).host}/v/${id}`;
		field('site')?.focus();
	}

	// Sends the form's demo in, or takes `demo` out. One taken in clears the form and the list reads again; a visitor
	// signed out meanwhile signs in first.
	async function call(e: SubmitEvent, demo?: Demo): Promise<void> {
		e.preventDefault();
		const form = e.currentTarget as HTMLFormElement;
		sending = true;
		const r = await fetch(
			demo ? `${API}/${encodeURIComponent(demo.id)}` : API,
			demo
				? { method: 'DELETE' }
				: {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(Object.fromEntries(new FormData(form))),
					},
		).catch(() => null);
		if (r?.status === 401) {
			track('grip_web_disco_sign_in_started', { why: 'expired' });
			return location.assign(signIn);
		}
		const reply: Reply = (await r?.json().catch(() => null)) ?? {};
		// A refusal is the platform's 4xx with its reason; anything else that is not ok failed on the way.
		const refused = !!r && r.status >= 400 && r.status < 500;
		const result = r?.ok ? (demo ? 'withdrawn' : reply.again ? 'updated' : 'entered') : refused ? 'refused' : 'failed';
		if (result === 'entered') sent++;
		track(demo ? 'grip_web_disco_withdrawn' : 'grip_web_disco_submitted', {
			result,
			status: r?.status,
			field: refused ? reply.field : undefined,
			reason: refused ? reply.error : undefined,
		});
		if (r?.ok) {
			form.reset();
			await refresh();
		}
		sending = false;
		const error = r?.ok ? undefined : (reply.error ?? 'Something went wrong. Try again.');
		if (!demo) answer = error ? { error, field: reply.field } : { entered: reply };
		else {
			answer = error ? { refused: error } : { withdrawn: reply.title };
			// A withdrawn row goes, so the focus goes back to the field.
			send?.querySelector<HTMLElement>('input[name="link"]')?.focus();
		}
	}
</script>

{#snippet check()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true"><path d="M20.46 6.18 8.82 17.82 3.53 12.53" /></svg
	>
{/snippet}

{#if shown}
	<dialog
		class="send"
		bind:this={send}
		data-place="disco"
		aria-labelledby="send-title"
		onclose={() => {
			track('grip_web_disco_closed', {
				step: STEPS[step].id,
				entered: sent,
				seconds: Math.round((Date.now() - since) / 1000),
			});
			ontoggle?.(false);
		}}
		onclick={(e) => {
			if (e.target === e.currentTarget) send?.close();
		}}
	>
		<!-- What it is and what it wins, in one sentence, for someone who clicked the strip not knowing. -->
		<div class="intro">
			<h2 id="send-title">
				Make a demo of your product in Grip. <span>The best ones play on Grip’s home page all December.</span>
			</h2>
			<p class="meta"><span>Disco December</span><span>Free</span><span>Closes in <b>{left}</b></span></p>
		</div>
		<ol class="steps">
			{#each STEPS as { title, done }, k (k)}
				{@const at = k < step ? 'done' : k === step ? 'now' : 'next'}
				<li data-step={k} data-at={at} aria-current={at === 'now' ? 'step' : undefined}>
					{#if at === 'done'}
						<button type="button" class="row" onclick={() => go(k)}
							><span class="dot">{@render check()}</span><span class="title">{title}</span><span class="sum"
								>{done}</span
							></button
						>
					{:else}
						<div class="row">
							<span class="dot">{k + 1}</span><span class="title">{title}</span>
						</div>
					{/if}
					<div class="more" inert={at !== 'now'}>
						<div>
							<div class="body">
								{#if k === 0}
									<p>Grip records your screen and gives you a video worth watching. It is free, for Mac.</p>
									{#if downloading}
										<p class="note">Downloading. Open Grip once it lands.</p>
									{/if}
									<div class="acts">
										{#if downloading}
											<button type="button" class="button primary" onclick={() => go(1)}>Next</button>
										{:else}
											<a
												class="button primary"
												href={DOWNLOAD_URL}
												onclick={() => {
													downloading = true;
													go(0);
												}}
												><img class="app-icon" src={asset('icons/grip.webp')} width="18" height="18" alt="" />Download
												for Mac</a
											>
											<button type="button" class="button secondary" onclick={() => go(1)}
												>Already installed</button
											>
										{/if}
									</div>
								{:else if k === 1}
									<p>
										Open Grip and record your project at its best. Then share it, and copy the link Grip
										gives you.
									</p>
									<ul class="tips">
										<li>Show one thing it does, start to finish.</li>
										<li>Keep it short and sharp.</li>
										<li>Share it from Grip as a public link.</li>
									</ul>
									<div class="acts">
										<button type="button" class="button primary" onclick={() => go(2)}>I have my link</button>
									</div>
								{:else if signedIn}
									<p>
										Paste the link Grip gave you, and the website it sends visitors to. You can have up to {MOST}
										demos in.
									</p>
									<form onsubmit={(e) => call(e)}>
										<label class="pill">
											<input
												name="link"
												type="text"
												inputmode="url"
												placeholder="bestboy.dev/v/…"
												aria-label="Your Grip link"
												aria-invalid={!!answer.error && answer.field !== 'site'}
												aria-describedby={answer.error && answer.field !== 'site' ? 'link-error' : undefined}
												autocomplete="off"
												spellcheck="false"
												required
											/>
										</label>
										<label class="pill">
											<input
												name="site"
												type="text"
												inputmode="url"
												placeholder="yourproduct.com"
												aria-label="Your website"
												aria-invalid={!!answer.error && answer.field === 'site'}
												aria-describedby={answer.error && answer.field === 'site' ? 'link-error' : undefined}
												autocomplete="url"
												spellcheck="false"
												required
											/>
											<button class="button primary small" type="submit" disabled={sending}>Submit</button>
										</label>
										{#if answer.error}
											<p class="error" id="link-error">{answer.error}</p>
										{:else if answer.entered?.again}
											<p class="ok" role="status">
												“{answer.entered.title}” now sends visitors to {answer.entered.host}.
											</p>
										{:else if answer.entered}
											<p class="ok" role="status">“{answer.entered.title}” is in. Share its link to get votes.</p>
										{:else if answer.withdrawn}
											<p class="ok" role="status">
												“{answer.withdrawn}” is out. You can send it in again until Nov 30.
											</p>
										{/if}
									</form>
									{#if mine.length}
										<h3>Yours</h3>
										<ul class="mine">
											{#each mine as demo (demo.id)}
												<li>
													<a href="{BESTBOY_URL}/v/{demo.id}">{demo.title}</a>
													{#if demo.host}
														<span class="host">{demo.host}</span>
													{:else}
														<button type="button" class="out add" onclick={() => addSite(demo.id)}
															>Add website</button
														>
													{/if}
													{#if demo.counts}
														<span class="state">{@render check()}In</span>
													{:else}
														<span class="state off">Not counted</span>
													{/if}
													<form onsubmit={(e) => call(e, demo)}>
														<button class="out" aria-label="Withdraw “{demo.title}”">Withdraw</button>
													</form>
												</li>
											{/each}
										</ul>
									{/if}
									{#if answer.refused}
										<p class="error" role="alert">{answer.refused}</p>
									{/if}
									{#if answer.entered}
										<div class="acts">
											<button type="button" class="button primary" onclick={() => send?.close()}>Done</button>
										</div>
									{/if}
								{:else}
									<p>
										Sign in with the account you share from in Grip, so we know the demo is yours. You come
										right back here.
									</p>
									<div class="acts">
										<a
											class="button primary"
											href={signIn}
											onclick={() => track('grip_web_disco_sign_in_started', { why: 'signed_out' })}
											>Sign in to submit</a
										>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</li>
			{/each}
		</ol>
		<p class="foot">
			<b>Best</b> means the most votes in Best idea, Best craft, or Best demo, from anyone signed in. The top 3 in
			each win.
		</p>
		<!-- Last, so the dialog opens on a step and not on this. -->
		<button type="button" class="close" aria-label="Close" onclick={() => send?.close()}
			><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg></button
		>
	</dialog>
{/if}

<style>
	/* A checklist of the three steps, with the sign-in page's pill field in the last. */
	dialog {
		width: min(500px, calc(100vw - 32px));
		margin: auto;
		padding: 0;
		border: 0;
		border-radius: 14px;
		background: var(--surface-elevated);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 14px 36px -8px rgb(0 0 0 / 0.4);
		color: var(--fg-default);
		font-size: 15px;
		line-height: 1.6;
	}

	dialog[open] {
		animation: popin 200ms var(--ease);
	}

	@keyframes popin {
		from {
			opacity: 0;
			transform: scale(0.94);
		}
	}

	/* The page's dim is the strip's (`Disco.svelte`): under the strip, so its ball shines on over it. */
	dialog::backdrop {
		background: none;
	}

	/* The page stays put under the open dialog; its gutter is stable, so nothing shifts. */
	:global(html:has(dialog.send[open])) {
		overflow: hidden;
	}

	/* Its first line centers on the close button's. */
	.intro {
		padding: 14px 20px 6px;
	}

	h2 {
		margin: 0;
		padding-right: 40px;
		font-size: 21px;
		font-weight: 650;
		line-height: 28px;
		letter-spacing: -0.015em;
		text-wrap: balance;
	}

	h2 span {
		color: var(--fg-muted);
	}

	/* A dot in each gap, clipped where a line wraps, so no line starts with one. */
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 20px;
		margin: 12px 0 0;
		overflow: clip;
		color: var(--fg-faint);
		font: 12px/16px var(--mono);
	}

	.meta span {
		position: relative;
	}

	.meta span + span::before {
		content: '·';
		position: absolute;
		left: -14px;
	}

	.meta b {
		color: var(--fg-default);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.foot {
		margin: 0 20px;
		padding: 12px 0 16px;
		border-top: 1px solid var(--border-default);
		color: var(--fg-faint);
		font-size: 12.5px;
		line-height: 1.5;
	}

	.foot b {
		color: var(--fg-muted);
		font-weight: 550;
	}

	button {
		border: 0;
		font-family: inherit;
		cursor: pointer;
	}

	.close {
		position: absolute;
		top: 15px;
		right: 14px;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--fg-muted);
	}

	.close svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
	}

	@media (hover: hover) and (pointer: fine) {
		.close:hover {
			background: var(--surface-hover);
			color: var(--fg-default);
		}
	}

	/* Each step a row with its number on a line down to the next; the one a person is on opens under its row. */
	.steps {
		margin: 0;
		padding: 0 20px 4px;
		list-style: none;
	}

	.steps > li {
		position: relative;
	}

	.steps > li:not(:last-child)::before {
		content: '';
		position: absolute;
		top: 38px;
		bottom: -10px;
		left: 11.5px;
		width: 1px;
		background: var(--border-default);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		height: 52px;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
	}

	.dot {
		position: relative;
		z-index: 1;
		display: grid;
		flex: none;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--surface-elevated);
		box-shadow: inset 0 0 0 1px var(--border-strong);
		color: var(--fg-faint);
		font: 12px/1 var(--mono);
		transition:
			background 200ms,
			color 200ms;
	}

	.dot svg {
		width: 12px;
		height: 12px;
	}

	[data-at='now'] .dot {
		background: var(--surface-inverse);
		box-shadow: none;
		color: var(--surface-root);
	}

	[data-at='done'] .dot {
		background: color-mix(in srgb, var(--brand) 16%, var(--surface-elevated));
		box-shadow: none;
		color: var(--brand);
	}

	.title {
		font-size: 15px;
		font-weight: 550;
		letter-spacing: -0.01em;
		transition: color 200ms;
	}

	[data-at='next'] .title {
		color: var(--fg-faint);
	}

	[data-at='done'] .title {
		color: var(--fg-muted);
	}

	.sum {
		margin-left: auto;
		color: var(--fg-faint);
		font: 12px/16px var(--mono);
	}

	@media (hover: hover) and (pointer: fine) {
		button.row:hover .title {
			color: var(--fg-default);
		}
	}

	.more {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 320ms var(--ease);
	}

	[data-at='now'] .more {
		grid-template-rows: 1fr;
	}

	/* Room for a focus ring at the edges it clips. */
	.more > div {
		min-height: 0;
		margin: 0 -4px;
		overflow: hidden;
	}

	.body {
		padding: 0 4px 18px 40px;
		opacity: 0;
		transition: opacity 200ms;
	}

	[data-at='now'] .body {
		opacity: 1;
		transition-delay: 80ms;
	}

	.body p {
		margin: 0;
		color: var(--fg-muted);
		font-size: 14px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.tips {
		display: grid;
		gap: 6px;
		margin: 14px 0 0;
		padding: 0;
		list-style: none;
	}

	.tips li {
		display: flex;
		gap: 10px;
		font-size: 14px;
		line-height: 22px;
	}

	.tips li::before {
		content: '';
		flex: none;
		width: 5px;
		height: 5px;
		margin-top: 9px;
		border-radius: 50%;
		background: var(--fg-faint);
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 18px;
	}

	.acts .button {
		height: 36px;
		padding: 0 16px;
		font-size: 14px;
		line-height: 1.5;
	}

	.acts .app-icon {
		--s: 18px;
		margin-left: -4px;
	}

	.body .note {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 14px;
		color: var(--fg-secondary);
		font: 12px/16px var(--mono);
	}

	.note::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--brand);
		animation: blink 1.2s ease-in-out infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}

	.body > form {
		margin-top: 16px;
	}

	/* An input with its button inside. */
	.pill {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 4px 5px 4px 16px;
		border-radius: 999px;
		background: var(--surface-elevated);
		box-shadow: inset 0 0 0 1px var(--border-default);
	}

	.pill + .pill {
		margin-top: 8px;
	}

	@media (hover: hover) and (pointer: fine) {
		.pill:hover {
			box-shadow: inset 0 0 0 1px var(--border-strong);
		}
	}

	.pill:has(input:focus) {
		box-shadow:
			inset 0 0 0 1px var(--brand),
			0 0 0 3px color-mix(in srgb, var(--brand) 15%, transparent);
	}

	.pill:has(input[aria-invalid='true']) {
		box-shadow:
			inset 0 0 0 1px var(--error-content),
			0 0 0 3px color-mix(in srgb, var(--error-content) 15%, transparent);
	}

	.pill input {
		flex: 1 1 auto;
		min-width: 0;
		padding: 6px 0;
		border: 0;
		background: none;
		color: var(--fg-default);
		font: 13px var(--mono);
	}

	/* iOS zooms into a field under 16px when it takes focus. The field also takes taps on the pill's left and vertical
	   padding: padding grows by what the margin takes back, so nothing moves. */
	@media (pointer: coarse) {
		.pill input {
			margin: -4px 0 -4px -16px;
			padding: 10px 0 10px 16px;
			font-size: 16px;
		}
	}

	.pill input::placeholder {
		color: var(--fg-faint);
	}

	.pill input:focus {
		outline: none;
	}

	.pill .button {
		flex: none;
	}

	.pill .button:disabled {
		background: var(--surface-hover);
		box-shadow: inset 0 0 0 1px var(--border-default);
		color: var(--fg-muted);
		cursor: default;
	}

	.body .error,
	.body .ok {
		margin: 10px 0 0 16px;
		font-size: 13px;
		line-height: 20px;
	}

	.body .error {
		color: var(--error-content);
	}

	h3 {
		margin: 18px 0 4px;
		color: var(--fg-faint);
		font: 400 12px/16px var(--mono);
	}

	.mine {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mine li {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 40px;
		border-top: 1px solid var(--border-default);
	}

	.mine a {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--fg-default);
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* A phone has no room for a title beside the rest of its row, so the title takes a line of its own. */
	@media (max-width: 479px) {
		.mine li {
			flex-wrap: wrap;
			gap: 2px 16px;
			padding: 8px 0;
		}

		.mine a {
			flex-basis: 100%;
		}

		.mine form {
			margin-left: auto;
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.mine a:hover {
			color: var(--brand);
		}
	}

	.state {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 6px;
		color: var(--fg-secondary);
		font: 12px/16px var(--mono);
	}

	.state svg {
		width: 12px;
		height: 12px;
		color: var(--brand);
	}

	.state.off {
		color: var(--fg-faint);
	}

	/* Taking a demo out is quiet, as anyone can send it in again. */
	.mine form {
		display: flex;
	}

	.out {
		padding: 0;
		border: 0;
		background: none;
		color: var(--fg-faint);
		font: 12px/16px var(--mono);
	}

	.host {
		flex: none;
		max-width: 40%;
		overflow: hidden;
		color: var(--fg-faint);
		font: 12px/16px var(--mono);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* A demo with no website yet asks for one in the brand's color, the one thing its row still needs. */
	.out.add {
		color: var(--brand);
	}

	@media (hover: hover) and (pointer: fine) {
		.out:hover {
			color: var(--fg-default);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		dialog[open],
		.note::before {
			animation: none;
		}
	}
</style>
