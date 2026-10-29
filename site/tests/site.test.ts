// The built page and the worker in front of it: `npm test` builds first.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fingerprint, HASH, IMAGE, RENDER } from '../og.ts';
import { LOGDASH_SITE } from '../src/lib/logdash.ts';
import worker, { type Env } from '../worker/index.ts';

const SITE = 'https://bestboy.dev/grip';
const build = join(import.meta.dirname, '..', 'build', 'grip');
const page = readFileSync(join(build, 'index.html'), 'utf8');
const card = readFileSync(join(build, 'og.html'), 'utf8');
// The Open Graph image, named by a hash of its content.
const SHARED =
	/<meta property="og:image" content="https:\/\/bestboy\.dev\/grip\/(_app\/immutable\/assets\/og\.[\w-]+\.jpg)"/u;

test('the page has one canonical URL under bestboy.dev/grip and a description', () => {
	const canonicals = [...page.matchAll(/<link rel="canonical" href="([^"]+)"/gu)];
	assert.deepEqual(
		canonicals.map((match) => match[1]),
		[SITE],
	);
	assert.match(page, /<meta name="description" content="[^"]+"/u);
});

test('the Open Graph image shows the hero as it is built', () => {
	assert.equal(
		fingerprint(),
		readFileSync(HASH, 'utf8').trim(),
		`The hero changed since its Open Graph image was rendered: run \`${RENDER}\` from the repo root and commit site/src/lib/og.jpg and og.hash.`,
	);
});

test('every page that shares the image names it by its content, with its size and what it shows', () => {
	const headline = (/<h1[^>]*>([\s\S]*?)<\/h1>/u.exec(card)?.[1] ?? '')
		.replace(/<[^>]+>/gu, '')
		.replace(/\s+/gu, ' ')
		.trim();
	assert.ok(headline);
	for (const file of ['index.html', '404.html']) {
		const html = readFileSync(join(build, file), 'utf8');
		const image = SHARED.exec(html)?.[1];
		assert.ok(image, `${file} shares no content-named image`);
		assert.deepEqual(readFileSync(join(build, image)), readFileSync(IMAGE), file);
		assert.match(html, /<meta property="og:image:width" content="1200"/u, file);
		assert.match(html, /<meta property="og:image:height" content="630"/u, file);
		assert.match(html, /<meta name="twitter:card" content="summary_large_image"/u, file);
		const alt = /<meta property="og:image:alt" content="([^"]+)"/u.exec(html)?.[1] ?? '';
		assert.ok(
			alt.includes(headline),
			`${file}: the og:image:alt in src/lib/Head.svelte leaves out the headline the image shows, “${headline}”`,
		);
	}
});

test('the card the image is rendered from stays out of search', () => {
	assert.match(card, /<meta name="robots" content="noindex"/u);
	assert.doesNotMatch(card, /rel="canonical"/u);
});

test('every download goes through bestboy.dev, which finds the latest DMG', () => {
	const downloads = page.match(/href="https:\/\/bestboy\.dev\/download\/grip"/gu) ?? [];
	assert.ok(downloads.length >= 3, `${downloads.length} download links`);
	assert.doesNotMatch(page, /\.dmg"/u);
});

test('every clip ships with the page in both themes, its still beside it', () => {
	const stills = [...page.matchAll(/url\(\/grip\/(media\/[\w.-]+)-(light|dark)\.webp\)/gu)];
	assert.ok(stills.length >= 10, `${stills.length} stills`);
	for (const [, name, theme] of stills) {
		assert.ok(stills.some((other) => other[1] === name && other[2] !== theme), `${name} in one theme`);
		for (const file of [`${name}-${theme}.webp`, `${name}-${theme}.mp4`])
			assert.ok(existsSync(join(build, file)), file);
	}
});

test('the page loads Logdash from the Grip site and reports to it', () => {
	assert.match(page, /<script defer="" src="\/grip\/_ld\/script\.js"/u);
	assert.match(page, new RegExp(`data-site="${LOGDASH_SITE}"`, 'u'));
	assert.match(page, /data-endpoint="\/grip\/_ld\/events"/u);
});

const assets: Env = {
	ASSETS: {
		fetch: (request) =>
			Promise.resolve(
				new Response(new URL(request.url).pathname, {
					headers: { 'Set-Cookie': 'a=b', 'Content-Type': 'text/html' },
				}),
			),
	},
};

function get(url: string): Promise<Response> {
	return worker.fetch(new Request(url), assets);
}

test('the worker marks every host but bestboy.dev noindex and never sets cookies', async () => {
	const canonical = await get(SITE);
	assert.equal(canonical.headers.get('X-Robots-Tag'), null);
	assert.equal(canonical.headers.get('Set-Cookie'), null);
	const preview = await get('https://grip-site.bestboy.workers.dev/grip');
	assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex');
});

test('the worker drops trailing slashes with a permanent redirect', async () => {
	const response = await get(`${SITE}/?x=1`);
	assert.equal(response.status, 301);
	assert.equal(response.headers.get('Location'), `${SITE}?x=1`);
});

test('the worker caches immutable assets for a year and lets the page revalidate in the background', async () => {
	const asset = await get(`${SITE}/_app/immutable/assets/0.abc.css`);
	assert.equal(asset.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
	const swr = 'public, max-age=0, stale-while-revalidate=86400';
	for (const path of ['', '/__data.json'])
		assert.equal((await get(`${SITE}${path}`)).headers.get('Cache-Control'), swr, path);
	assert.equal((await get(`${SITE}/media/hero.mp4`)).headers.get('Cache-Control'), null);
});

test('the worker answers one byte range of a clip, as Safari needs to play it', async () => {
	const range = (path: string, value: string) =>
		worker.fetch(new Request(`${SITE}${path}`, { headers: { Range: value } }), assets);
	const clip = '/media/hero.mp4'; // the fake assets answer with the path, 20 bytes
	const head = await range(clip, 'bytes=0-4');
	assert.equal(head.status, 206);
	assert.equal(head.headers.get('Content-Range'), 'bytes 0-4/20');
	assert.equal(head.headers.get('Content-Length'), '5');
	assert.equal(await head.text(), '/grip');
	assert.equal(await (await range(clip, 'bytes=12-')).text(), 'hero.mp4');
	assert.equal(await (await range(clip, 'bytes=-3')).text(), 'mp4');
	assert.equal(await (await range(clip, 'bytes=15-99')).text(), 'o.mp4');
	const past = await range(clip, 'bytes=20-');
	assert.equal(past.status, 416);
	assert.equal(past.headers.get('Content-Range'), 'bytes */20');
	const whole = await get(`${SITE}${clip}`);
	assert.equal(whole.status, 200);
	assert.equal(whole.headers.get('Accept-Ranges'), 'bytes');
	assert.equal((await range('/favicon.png', 'bytes=0-4')).status, 200);
});

test('the worker refuses Logdash events that are not from a Grip page', async () => {
	const send = (body: object, type = 'application/json') =>
		worker.fetch(
			new Request(`${SITE}/_ld/events`, {
				method: 'POST',
				headers: { 'Content-Type': type },
				body: JSON.stringify(body),
			}),
			assets,
		);
	const event = { name: 'pageview', path: '/grip' };
	const batch = (events: object[]) => ({ siteId: LOGDASH_SITE, events });
	assert.equal((await send(batch([event]), 'text/plain')).status, 415);
	assert.equal((await send({ siteId: '0'.repeat(24), events: [event] })).status, 400);
	assert.equal((await send(batch([event, { ...event, path: '/malini' }]))).status, 400);
	assert.equal((await send(batch([]))).status, 400);
	assert.equal((await send(batch(Array(21).fill(event)))).status, 400);
	const big = await send(batch([{ ...event, pad: '€'.repeat(11000) }]));
	assert.equal(big.status, 413);
	assert.equal(big.headers.get('Cache-Control'), 'no-store');
});

// A CSS timing function at progress x: the curve's y where its x is x.
const bezier =
	([x1 = 0, y1 = 0, x2 = 1, y2 = 1]: number[]) =>
	(x: number): number => {
		const at = (t: number, a: number, b: number): number => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
		let [low, high] = [0, 1];
		for (let step = 0; step < 50; step++) {
			const t = (low + high) / 2;
			if (at(t, x1, x2) < x) low = t;
			else high = t;
		}
		return at((low + high) / 2, y1, y2);
	};

test('the blur of every entrance follows --enter-ease until it is a fraction of a pixel, then stops', () => {
	const source = ['src/app.css', 'src/lib/Hero.svelte']
		.map((file) => readFileSync(join(import.meta.dirname, '..', file), 'utf8'))
		.join('\n');
	const curve = (name: string): number[] =>
		(new RegExp(`--${name}: cubic-bezier\\(([^)]+)\\)`, 'u').exec(source)?.[1] ?? '').split(',').map(Number);
	const enter = bezier(curve('enter-ease'));
	const unblur = bezier(curve('unblur-ease'));
	const left = Number(/@keyframes unblur[\s\S]*?blur\(calc\(var\(--blur\) \* ([\d.]+)\)\)/u.exec(source)?.[1]);
	const cut = [...source.matchAll(/unblur calc\(var\(--duration\) \* var\(--pace\) \* ([\d.]+)\)/gu)].map((match) => Number(match[1]));
	assert.equal(cut.length, 2, 'the hero and .rise both run unblur');
	assert.ok(cut.every((value) => value === cut[0]), `unblur stops at ${cut.join(' and ')} of the time`);
	assert.ok(left <= 0.03, `unblur stops at ${left} of its blur, a third of a pixel at 12px at most`);
	for (let step = 0; step <= 100; step++) {
		const x = (step / 100) * (cut[0] ?? 0);
		const drift = Math.abs(1 - enter(x) - (1 - (1 - left) * unblur(x / (cut[0] ?? 1))));
		assert.ok(drift < 1e-3, `at ${x.toFixed(3)} of the time the blur is off --enter-ease by ${drift.toFixed(4)} of itself`);
	}
});
