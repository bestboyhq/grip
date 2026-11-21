// The license guides as built: `npm test` builds first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RECORDERS } from '../src/lib/benchmark.ts';
import { GUIDES, OURS } from '../src/lib/guides.ts';

const build = join(import.meta.dirname, '..', 'build', 'grip');
const built = (slug: string) => readFileSync(join(build, 'guides', `${slug}.html`), 'utf8');
// Every word of a guide, its sources' addresses included.
const copy = (guide: unknown) => JSON.stringify([guide, OURS]);

test('the index links every guide, and each guide is built', () => {
	const index = readFileSync(join(build, 'guides.html'), 'utf8');
	for (const { slug, h1 } of GUIDES) {
		assert.ok(index.includes(`href="/grip/guides/${slug}"`), `the index leaves out ${slug}`);
		assert.ok(built(slug).includes(h1), slug);
	}
});

test('every source is an https address the guide links to', () => {
	for (const guide of GUIDES) {
		const html = built(guide.slug);
		const urls = new Set(copy(guide).match(/https?:[^"]+/gu));
		assert.ok(urls.size > 3, guide.slug);
		for (const url of urls) {
			assert.ok(url.startsWith('https://') && !url.includes('&'), `${guide.slug}: ${url}`);
			assert.ok(html.includes(`href="${url}"`), `${guide.slug} does not link ${url}`);
		}
	}
});

test('the copy has no dash and claims nothing the makers did not state', () => {
	for (const guide of GUIDES) {
		const text = copy(guide);
		assert.doesNotMatch(text, /[–—]/u, `${guide.slug} has an en or em dash`);
		assert.doesNotMatch(text, /revoked|killed|took away/iu, guide.slug);
		// "Lifetime updates" only where a sentence denies them.
		for (const sentence of text.split(/(?<=[.?"])\s/u))
			if (/lifetime updates|updates for life/iu.test(sentence))
				assert.match(sentence, /\b(never|not|no)\b/iu, `${guide.slug}: ${sentence}`);
	}
});

test('no plan a guide shows costs less over more years', () => {
	for (const guide of GUIDES)
		for (const id of guide.cost.ids) {
			const recorder = RECORDERS.find((r) => r.id === id);
			assert.ok(recorder, `${guide.slug}: no recorder ${id}`);
			for (const { how, over } of recorder.plans)
				for (let years = 1; years < 5; years++)
					assert.ok(over(years + 1) >= over(years), `${id}, ${how}: less in ${years + 1} years`);
		}
});
