// The guides that answer one question over a group of the benchmark (src/lib/questions.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FACTS, GROUPS, RECORDERS } from '../src/lib/benchmark.ts';
import { QUESTIONS, recorder, sources } from '../src/lib/questions.ts';

const members = (group: string): string[] => {
	const found = GROUPS.find(({ id }) => id === group);
	assert.ok(found, `no group ${group}`);
	return RECORDERS.filter(found.has).map(({ id }) => id);
};

test('the groups hold what the facts say today', () => {
	assert.deepEqual(members('open-source'), ['grip', 'cap', 'kap', 'obs', 'openscreen', 'recordly']);
	assert.deepEqual(members('free'), ['grip', 'kap', 'obs', 'openscreen', 'quicktime']);
	assert.deepEqual(members('no-subscription'), [
		'grip',
		'cap',
		'cleanshot',
		'focusee',
		'kap',
		'obs',
		'openscreen',
		'quicktime',
	]);
});

test('each guide lists its group exactly, and every recorder out of it with the fact that keeps it out', () => {
	for (const question of QUESTIONS) {
		const inside = members(question.group);
		assert.deepEqual(question.entries.map(({ id }) => id), inside, `${question.slug}: entries`);
		assert.deepEqual(
			question.out.map(({ id }) => id),
			RECORDERS.map(({ id }) => id).filter((id) => !inside.includes(id)),
			`${question.slug}: left out`,
		);
		for (const { id } of question.entries) assert.ok(question.lede.includes(recorder(id).name), `${question.slug}: ${id}`);
		const keys = FACTS.map(({ key }) => key);
		for (const key of question.rows) assert.ok(keys.includes(key), key);
		for (const id of question.cost.ids) recorder(id);
	}
});

test('the copy cites https pages, fits a search result, answers in 40 to 60 words, and holds no long dash', () => {
	assert.equal(new Set(QUESTIONS.map(({ title }) => title)).size, QUESTIONS.length);
	assert.equal(new Set(QUESTIONS.map(({ slug }) => slug)).size, QUESTIONS.length);
	for (const question of QUESTIONS) {
		for (const { url } of sources(question)) assert.match(url, /^https:\/\/[^\s"&<>]+$/u, `${question.slug}: ${url}`);
		const lines = [...question.entries.flatMap(({ lines }) => lines), ...question.picks];
		for (const { source } of lines) assert.ok(sources(question).some(({ url }) => url === source), source);
		assert.ok(question.title.length <= 60, question.title);
		assert.ok(question.description.length <= 160, question.description);
		const words = question.lede.split(/\s+/u).length;
		assert.ok(words >= 40 && words <= 60, `${question.slug}'s lede has ${words} words`);
		assert.ok(question.faqs.length >= 3 && question.faqs.length <= 5, question.slug);
		assert.ok(question.picks.length >= 3 && question.picks.length <= 5, question.slug);
		for (const { text } of question.picks) assert.match(text, /^Pick /u);
	}
	assert.doesNotMatch(JSON.stringify(QUESTIONS), /[–—!]/u);
});

test('each guide is built, links every source, and states its questions word for word', () => {
	for (const question of QUESTIONS) {
		const page = readFileSync(join(import.meta.dirname, '..', 'build', 'grip', 'guides', `${question.slug}.html`), 'utf8');
		for (const { url } of sources(question)) assert.ok(page.includes(`href="${url}"`), `${question.slug}: ${url}`);
		const data = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/su.exec(page)?.[1] ?? '{}');
		const faq = data['@graph']?.find((item: { '@type': string }) => item['@type'] === 'FAQPage');
		assert.deepEqual(
			faq?.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text]),
			question.faqs.map(({ question, answer }) => [question, answer]),
		);
	}
});
