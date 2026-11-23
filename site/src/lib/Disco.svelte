<!-- Disco December, the demo contest on bestboy.dev, as a strip over every page until it closes: its facts rolling by
     with a countdown. Hovered, or focused from the keyboard, it throws a party: a mirror ball comes down into it and
     lights the page (`disco.ts`), and the line says what a click does, from the ball out. A touch screen has no hover,
     so there the party runs a few seconds every ten. A press opens the sending dialog over the page (`Send.svelte`),
     which dims all of the page but the strip: the party goes on over the dim while the dialog is open, with the
     contest's facts on the line, since the click is made. -->
<script module lang="ts">
	import { disco, type Tuning } from './disco.ts';

	const CLOSES = Date.UTC(2026, 11, 1);
	const FACTS = [
		'Disco December',
		'Demo contest',
		'3 categories',
		'9 winners',
		'31 days on bestboy.dev',
		'Record in Grip',
		'Submit your demo',
		'Get votes',
		'Closes in ',
	].map((fact) => Array.from(fact));
	// The look, tuned by eye on the landing page.
	const V: Tuning = {
		rows: 16,
		grout: 0.09,
		groutColor: '#140a26',
		specPow: 260,
		turn: 45000,
		gain: 4,
		beams: 0.2,
		beamAlpha: 2.4,
		spread: 0.8,
		fan: [0.95, 1.25],
		width: [3.5, 0.004],
		sigma: [10, 4],
		halo: 0.3,
		rise: 420,
	};
	const SWEEP = 12000; // ms, the strip's gradient sweep (`disco-sweep`)
	// The change runs out from the ball at SPEED px a second, and each letter takes RISE ms.
	const SPEED = 1100;
	const RISE = 550;

	type Letter = { el: HTMLElement; from: number; to: number; seen: boolean; d: number };
</script>

<script lang="ts">
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Send from './Send.svelte';
	import { track } from './track.ts';

	let now = $state(Date.now());
	// The party is on while a pointer is over the strip, keyboard focus is on it, or its dialog is open; the line says
	// what a click does only for the first two.
	let hover = $state(false);
	let opened = $state(false);
	const on = $derived(hover || opened);
	let talk = $state(false);
	let busy = $state(false);
	// Whether the screen has no hover, known once the page runs: the line that says what a click does waits for it.
	let touch = $state<boolean>();
	let strip = $state<HTMLButtonElement>();
	let ball = $state<HTMLCanvasElement>();
	let sky = $state<HTMLCanvasElement>();
	let back = $state<HTMLCanvasElement>();
	let msg = $state<HTMLElement>();
	let send = $state<ReturnType<typeof Send>>();

	const two = (n: number): string => String(n).padStart(2, '0');
	// Left blank in the built page, which would show the time it was built.
	const left = $derived.by(() => {
		if (!browser) return '';
		const s = Math.max(0, Math.floor((CLOSES - now) / 1000));
		return `${Math.floor(s / 86400)}d ${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
	});
	const message = $derived(Array.from(`${touch ? 'Tap' : 'Click'} to enter the demo contest`));

	$effect(() => {
		const clock = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(clock);
	});

	// The light, started again on each page, since each has its own seam and hero.
	const path = $derived(page.url.pathname);
	$effect(() => {
		void path;
		if (!strip || !ball || !sky || !back) return;
		const sweep = strip
			.getAnimations()
			.find((a) => a instanceof CSSAnimation && a.animationName === 'disco-sweep');
		return disco(
			{
				strip,
				ball,
				front: sky,
				back,
				seam: document.querySelector('[data-seam]'),
				// A page with no hero has its light in front of the top bar too, and behind all its content.
				hero: document.querySelector('[data-place="hero"]') ?? document.getElementById('main'),
				phase: () => Number(sweep?.currentTime ?? 0) / SWEEP,
				above: () => opened,
				still: matchMedia('(prefers-reduced-motion: reduce)').matches,
			},
			V,
		);
	});

	// Every letter of both lines, and each word with its letters. Each letter keeps when its change starts and ends,
	// so a party that ends halfway turns every letter back from where it is: one still waiting never moves, one moving
	// turns back at once, and one done waits for the wave going the other way. A word blurs when its first letter
	// moves: a blur on every letter costs a fifth of the frames.
	let letters: Letter[] = [];
	let words: [HTMLElement, Letter[]][] = [];
	$effect(() => {
		if (!strip || !msg) return;
		const of = new Map<Element, Letter>();
		letters = [...strip.querySelectorAll<HTMLElement>('.roll .c')].map((el) => {
			const letter = { el, from: 0, to: 0, seen: false, d: 0 };
			of.set(el, letter);
			return letter;
		});
		words = [...strip.querySelectorAll<HTMLElement>('.track > *')].map((word) => [
			word,
			[...word.querySelectorAll('.c')].flatMap((el) => of.get(el) ?? []),
		]);
		// Both lines roll at the same speed, so a letter and the one that takes its place stay together.
		const facts = strip.querySelector<HTMLElement>('.facts');
		const line = msg;
		const pace = (): void => {
			if (facts) line.style.animationDuration = `${(70 * line.scrollWidth) / facts.scrollWidth}s`;
		};
		pace();
		void document.fonts.ready.then(pace);
	});

	const say = (next: boolean): void => {
		if (!strip || talk === next) return;
		const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const t = performance.now();
		const box = strip.getBoundingClientRect();
		const mid = box.left + box.width / 2;
		// Every box is read before any style is written, so the page lays out once, not once a letter.
		const boxes = letters.map(({ el }) => el.getBoundingClientRect());
		letters.forEach((letter, i) => {
			// A letter out of view changes at once, so only the few in view animate.
			const r = boxes[i];
			letter.seen = r.right > -40 && r.left < innerWidth + 40;
			letter.d = 0;
			if (!letter.seen || t < letter.from) [letter.from, letter.to] = [t, t];
			else if (t < letter.to) [letter.from, letter.to] = [t, 2 * t - letter.from];
			else {
				if (!calm)
					letter.d =
						(next ? 120 : 0) +
						(Math.abs(r.left + r.width / 2 - mid) / (next ? SPEED : SPEED * 1.6)) * 1000 +
						Math.random() * 30;
				[letter.from, letter.to] = [t + letter.d, t + letter.d + RISE];
			}
		});
		for (const { el, seen, d } of letters) {
			el.style.transition = seen ? '' : 'none';
			el.style.setProperty('--d', `${Math.round(d)}ms`);
		}
		for (const [word, its] of words) {
			word.style.transition = its.some(({ seen }) => seen) ? '' : 'none';
			word.style.setProperty('--w', `${Math.round(Math.min(...its.map(({ d }) => d)))}ms`);
		}
		talk = next;
	};
	const party = (next: boolean): void => {
		hover = next;
		say(hover && !opened);
	};
	// A hover counts once a page, once it lasts long enough to see the ball come down: a pointer on its way past the
	// strip, to the browser's tabs, does not count.
	let counted = '';
	let dwell = 0;
	const noticed = (via: 'pointer' | 'keyboard'): void => {
		if (counted === path) return;
		counted = path;
		track('grip_web_disco_hovered', { via });
	};
	const enter = (): void => {
		party(true);
		dwell = window.setTimeout(() => noticed('pointer'), 600);
	};
	const leave = (): void => {
		clearTimeout(dwell);
		party(false);
	};
	const toggle = (open: boolean): void => {
		opened = open;
		say(hover && !opened);
	};

	$effect(() => {
		if (!touch) return;
		let off = 0;
		const every = setInterval(() => {
			party(true);
			off = window.setTimeout(() => party(false), 3500);
		}, 10000);
		return () => {
			clearInterval(every);
			clearTimeout(off);
		};
	});

	// The dialog opens once it knows who is signed in, which takes a moment.
	const open = async (last = false): Promise<void> => {
		busy = true;
		await send?.open(last);
		busy = false;
	};

	onMount(() => {
		touch = matchMedia('(hover: none)').matches;
		// Sign-in comes back to `#submit`, where the dialog opens on its last step.
		if (now < CLOSES && location.hash === '#submit') void open(true);
	});
</script>

{#if now < CLOSES}
	<button
		bind:this={strip}
		class={['disco', { on, talk }]}
		type="button"
		data-place="disco"
		aria-haspopup="dialog"
		aria-label="Disco December, a demo contest: submit your demo by Nov 30"
		aria-busy={busy || undefined}
		onclick={() => open()}
		onpointerenter={() => touch === false && enter()}
		onpointerleave={() => touch === false && leave()}
		onfocus={() => {
			if (!strip?.matches(':focus-visible')) return;
			party(true);
			noticed('keyboard');
		}}
		onblur={() => party(false)}
	>
		<span class="roll" aria-hidden="true">
			<span class="track facts">
				{#each { length: 4 }, copy (copy)}
					{#each FACTS as fact, i (i)}
						<span class={{ lead: i === 0 }}
							>{#each fact as c, k (k)}<span class="c">{c}</span>{/each}{#if i === FACTS.length - 1}<b
									class="c">{left}</b
								>{/if}</span
						><i><i class="c">✦</i></i>
					{/each}
				{/each}
			</span>
			{#if touch !== undefined}
				<span class="track msg" bind:this={msg}>
					{#each { length: 24 }, copy (copy)}
						<span class="lead">{#each message as c, k (k)}<span class="c">{c}</span>{/each}</span><i
							><i class="c">✦</i></i
						>
					{/each}
				</span>
			{/if}
		</span>
		<canvas class="ball" bind:this={ball} aria-hidden="true"></canvas>
		<canvas class="sky" bind:this={sky} aria-hidden="true"></canvas>
	</button>
	<!-- The light in the hero, behind its text and buttons: under the page's own layers, over its background. -->
	<canvas class="light" bind:this={back} aria-hidden="true"></canvas>
	<div class={['dim', { opened }]} aria-hidden="true"></div>
	<Send bind:this={send} ontoggle={toggle} />
{/if}

<style>
	@property --open {
		syntax: '<number>';
		inherits: true;
		initial-value: 0;
	}

	.disco {
		all: unset;
		box-sizing: border-box;
		position: relative;
		z-index: 30;
		display: block;
		width: 100%;
		height: 40px;
		cursor: pointer;
		color: #fff;
		background: linear-gradient(90deg, #1d4ed8, #7c3aed, #c2410c, #7c3aed, #1d4ed8) 0 0 / 200% 100%;
		animation: disco-sweep 12s linear infinite;
		font: 500 12px/40px var(--mono);
		-webkit-tap-highlight-color: transparent;
		--ball: 88px;
		--cut: -0.32;
		--open: 0;
		transition: --open 0.3s ease 0.05s;
	}

	.disco::before {
		content: '';
		position: absolute;
		inset: 0;
		background: #fff;
		opacity: 0;
		transition: opacity 0.2s ease;
		pointer-events: none;
	}

	.disco:hover::before {
		opacity: 0.1;
	}

	.disco:active::before {
		opacity: 0.18;
		transition-duration: 0s;
	}

	.disco:focus-visible {
		outline: 2px solid #fff;
		outline-offset: -4px;
	}

	.disco[aria-busy='true'] {
		cursor: progress;
	}

	.disco.on {
		--open: 1;
		transition: --open 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) 0.12s;
	}

	@media (max-width: 1099px) {
		.disco {
			--ball: 64px;
		}
	}

	/* The line opens around the ball only while the ball is down. */
	.roll {
		position: absolute;
		inset: 0;
		overflow: hidden;
		--g: calc((var(--ball) / 2 + 32px) * var(--open));
		--h: calc((var(--ball) / 2 + 4px) * var(--open));
		mask-image: linear-gradient(
			90deg,
			transparent,
			#000 32px calc(50% - var(--g)),
			transparent calc(50% - var(--h)) calc(50% + var(--h)),
			#000 calc(50% + var(--g)) calc(100% - 32px),
			transparent
		);
	}

	.track {
		display: inline-flex;
		white-space: nowrap;
		animation: disco-roll 70s linear infinite;
	}

	.msg {
		position: absolute;
		left: 0;
		top: 0;
	}

	.track > span {
		padding: 0 16px;
		letter-spacing: 0.02em;
	}

	.lead {
		font-weight: 700;
	}

	i {
		font-style: normal;
		color: rgb(255 255 255 / 0.55);
	}

	b {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}

	/* Rise: the old line lifts away blurred while the new one rises in, from the ball out. Letters move one by one,
	   and words blur one by one: a blur on every letter costs a fifth of the frames. What is gone is hidden too, once
	   its change ends, so the page never draws blurred text nobody sees. */
	.c {
		display: inline-block;
		white-space: pre;
		transition:
			transform 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) var(--d, 0s),
			opacity 0.3s ease var(--d, 0s),
			visibility 0.55s var(--d, 0s);
	}

	.track > * {
		transition:
			filter 0.4s ease var(--w, 0s),
			visibility 0.55s var(--w, 0s);
	}

	.talk .facts .c {
		transform: translateY(-55%);
		opacity: 0;
		visibility: hidden;
	}

	.disco:not(.talk) .msg .c {
		transform: translateY(55%);
		opacity: 0;
		visibility: hidden;
	}

	.talk .facts > *,
	.disco:not(.talk) .msg > * {
		filter: blur(4px);
		visibility: hidden;
	}

	/* The ball waits above the page, out of sight, and comes down for the party. */
	.ball {
		position: absolute;
		left: 50%;
		top: calc(var(--ball) * var(--cut));
		width: var(--ball);
		height: var(--ball);
		margin-left: calc(var(--ball) / -2);
		border-radius: 50%;
		box-shadow:
			0 0 18px 2px rgb(255 61 180 / 0.4),
			0 0 48px 10px rgb(124 58 237 / 0.3),
			0 6px 30px 6px rgb(0 229 255 / 0.12);
		translate: 0 calc(var(--ball) * (-1 - var(--cut)) - 56px);
		transition: translate 0.45s cubic-bezier(0.55, 0, 0.8, 0.2);
	}

	.on .ball {
		translate: 0 0;
		transition: translate 1.1s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.sky,
	.light {
		position: absolute;
		left: 0;
		top: 0;
		width: 100%;
		height: 0;
		pointer-events: none;
	}

	.light {
		z-index: -1;
	}

	/* The dim behind the dialog, over the page and its top bar, under the strip. A flat dim, so it never bands. */
	.dim {
		position: fixed;
		inset: 0;
		z-index: 29;
		background: rgb(0 0 0 / 0.5);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			opacity 200ms var(--ease),
			visibility 200ms;
	}

	.dim.opened {
		opacity: 1;
		visibility: visible;
	}

	/* The light is made for a dark page: on a light one, deeper colors keep it from washing out. */
	:global(:root[data-theme='light']) .sky,
	:global(:root[data-theme='light']) .light {
		filter: saturate(2.2);
	}

	@media (prefers-color-scheme: light) {
		:global(:root:not([data-theme])) .sky,
		:global(:root:not([data-theme])) .light {
			filter: saturate(2.2);
		}
	}

	@keyframes -global-disco-sweep {
		to {
			background-position: -200% 0;
		}
	}

	@keyframes disco-roll {
		to {
			translate: -50% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.disco,
		.track {
			animation: none;
		}

		/* The ball is down the moment the party starts, so the still light is drawn there and then. */
		.disco,
		.disco.on,
		.ball,
		.on .ball {
			transition: none;
		}

		.c {
			transition:
				opacity 0.2s,
				visibility 0.2s;
			transform: none !important;
		}

		.track > * {
			transition: visibility 0.2s;
			filter: none !important;
		}
	}
</style>
