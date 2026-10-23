// The built page and the worker in front of it: `npm test` builds first.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LOGDASH_SITE } from '../src/lib/logdash.ts';
import worker, { type Env } from '../worker/index.ts';

const SITE = 'https://bestboy.dev/grip';
const build = join(import.meta.dirname, '..', 'build', 'grip');
const page = readFileSync(join(build, 'index.html'), 'utf8');

test('the page has one canonical URL under bestboy.dev/grip, a description, and its image', () => {
	const canonicals = [...page.matchAll(/<link rel="canonical" href="([^"]+)"/gu)];
	assert.deepEqual(
		canonicals.map((match) => match[1]),
		[SITE],
	);
	assert.match(page, /<meta name="description" content="[^"]+"/u);
	assert.match(page, /<meta property="og:image" content="https:\/\/bestboy\.dev\/grip\/og\.jpg"/u);
	assert.ok(existsSync(join(build, 'og.jpg')));
});

test('every download goes through bestboy.dev, which finds the latest DMG', () => {
	const downloads = page.match(/href="https:\/\/bestboy\.dev\/download\/grip"/gu) ?? [];
	assert.ok(downloads.length >= 3, `${downloads.length} download links`);
	assert.doesNotMatch(page, /\.dmg"/u);
});

test('every clip and its still ship with the page', () => {
	const media = [...page.matchAll(/(?:src|poster)="\/grip\/(media\/[\w.-]+)"/gu)].map(
		(match) => match[1] ?? '',
	);
	assert.ok(media.length >= 10, `${media.length} clips and stills`);
	for (const file of media) assert.ok(existsSync(join(build, file)), file);
});

test('the page ships no draft quotes', () => {
	assert.doesNotMatch(page, /Role, Company|\[my old/u);
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
	assert.equal((await range('/og.jpg', 'bytes=0-4')).status, 200);
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
