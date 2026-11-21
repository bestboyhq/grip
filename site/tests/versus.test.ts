// The pages at /vs/<id> (src/lib/versus.ts), read as built.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FACTS, RECORDERS } from '../src/lib/benchmark.ts';
import { GRIP, VERSUS } from '../src/lib/versus.ts';

const build = join(import.meta.dirname, '..', 'build', 'grip');
// The HTML escapes a quote and an ampersand, so a page's text is compared as the HTML writes it.
const html = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

test('every recorder but Grip has its page, which links the source of every fact and line it shows', () => {
	assert.deepEqual(
		VERSUS.map(({ id }) => id).toSorted(),
		RECORDERS.filter(({ id }) => id !== 'grip').map(({ id }) => id).toSorted(),
	);
	for (const versus of VERSUS) {
		const file = join(build, 'vs', `${versus.id}.html`);
		assert.ok(existsSync(file), `${versus.id} is not built`);
		const page = readFileSync(file, 'utf8');
		const them = RECORDERS.find(({ id }) => id === versus.id);
		for (const { name, facts } of [GRIP, them].filter((r) => r !== undefined))
			for (const { key } of FACTS)
				assert.ok(page.includes(`href="${facts[key].source}"`), `${versus.id}: ${name}'s ${key} links nowhere`);
		for (const { source } of [...versus.them, ...versus.grip, versus.moving])
			assert.ok(page.includes(`href="${source}"`), `${versus.id}: ${source}`);
		// The structured questions are the page's own, word for word.
		const data = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/su.exec(page)?.[1] ?? '{}');
		const faq = data['@graph']?.find((item: { '@type': string }) => item['@type'] === 'FAQPage');
		assert.deepEqual(
			faq?.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text]),
			versus.faqs.map(({ question, answer }) => [question, answer]),
		);
		for (const { question } of versus.faqs) assert.ok(page.includes(html(question)), question);
	}
});

test('the copy cites only https pages, answers in 40 to 60 words, and holds no long dash', () => {
	for (const versus of VERSUS) {
		for (const { source } of [...versus.them, ...versus.grip, versus.moving])
			assert.match(source, /^https:\/\/[^\s"&<>]+$/u, `${versus.id}: ${source}`);
		const words = versus.lede.split(/\s+/u).length;
		assert.ok(words >= 40 && words <= 60, `${versus.id}'s lede has ${words} words`);
		assert.ok(versus.title.includes(`Grip vs ${RECORDERS.find(({ id }) => id === versus.id)?.name}`), versus.title);
	}
	assert.doesNotMatch(JSON.stringify(VERSUS), /[–—]/u);
});

test('a plan never costs less over more years', () => {
	for (const { name, plans } of RECORDERS) {
		assert.ok(plans.length, `${name} has no plan`);
		for (const { how, over } of plans)
			for (let years = 1; years < 10; years++)
				assert.ok(over(years + 1) >= over(years), `${name}, ${how}, after ${years} years`);
	}
});
