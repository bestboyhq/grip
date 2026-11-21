// What search engines and AI assistants read beside the pages, written into the build after `vite build`:
// `sitemap.xml` and `llms.txt` list every page that is not `noindex`, each by its own title, description, and canonical
// link, so a new page appears in both with no list to extend; `benchmark.md` is the benchmark's facts as Markdown.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKED, FACTS, RECORDERS } from './src/lib/benchmark.ts';

export const BUILD = join(import.meta.dirname, 'build', 'grip');
const SITE = 'https://bestboy.dev/grip';
const GITHUB_URL = 'https://github.com/bestboyhq/grip';
const RAW = 'https://raw.githubusercontent.com/bestboyhq/grip/main';

export type Page = Readonly<{
	file: string;
	title: string;
	description: string;
	canonical: string;
	noindex: boolean;
	html: string;
}>;

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', quot: '"', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
export const text = (html: string): string =>
	html
		.replace(/<[^>]+>/gu, '')
		.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/giu, (whole, dec?: string, hex?: string, name?: string) =>
			dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name ?? ''] ?? whole),
		)
		.replace(/\s+/gu, ' ')
		.trim();

// Every built page, home first, then by path.
export function pages(build = BUILD): Page[] {
	return readdirSync(build, { recursive: true, encoding: 'utf8' })
		.filter((file) => file.endsWith('.html'))
		.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)))
		.map((file) => {
			const html = readFileSync(join(build, file), 'utf8');
			const attribute = (pattern: RegExp): string => text(pattern.exec(html)?.[1] ?? '');
			return {
				file,
				title: attribute(/<title>([\s\S]*?)<\/title>/u),
				description: attribute(/<meta name="description" content="([^"]*)"/u),
				canonical: attribute(/<link rel="canonical" href="([^"]*)"/u),
				noindex: /<meta name="robots" content="[^"]*noindex/u.test(html),
				html,
			};
		});
}

const xml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

export function sitemap(listed: readonly Page[]): string {
	const urls = listed.map((page) => `\t<url><loc>${xml(page.canonical)}</loc></url>\n`).join('');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
}

// Every claim in the summary comes from README.md.
const SUMMARY =
	'Grip is a free, open source screen recorder, screenshot tool, and video editor for the Mac, behind one shortcut. ' +
	'It runs on macOS 15 or later on Apple silicon and is licensed under AGPL-3.0: no subscription, no account, no watermark, and free for commercial use. ' +
	'It turns a raw recording into a polished video with no editing: zooms that follow your clicks and typing, a smooth cursor, ' +
	'captions and a clean voice made on your Mac in 25 European languages, a transcript you edit like a doc, ' +
	'and an MP4, a GIF, or a share link at the end. Coding agents record demos with it through its MCP server. ' +
	`Download it at https://bestboy.dev/download/grip; the source is at ${GITHUB_URL}.`;

const DOCS = [
	`- [README](${RAW}/README.md): what Grip does, how to install and use it, and how it works`,
	`- [Grip guide](${RAW}/docs/guide.md): every feature, setting, and shortcut, in one file`,
	`- [Set up Grip and record a demo](${SITE}/agents.md): the steps a coding agent follows to install Grip and record a demo of its change`,
	`- [Screen recorders for the Mac, compared](${SITE}/benchmark.md): the benchmark's facts as Markdown tables, each with its source`,
];

export function llms(listed: readonly Page[]): string {
	const group = (page: Page): string => {
		const path = page.canonical.slice(SITE.length);
		if (path === '/benchmark' || path.startsWith('/vs/')) return 'Comparisons';
		if (path === '/guides' || path.startsWith('/guides/')) return 'Guides';
		return 'Pages';
	};
	const sections = ['Pages', 'Comparisons', 'Guides'].map((name) => {
		const links = listed.filter((page) => group(page) === name);
		return links.length
			? `## ${name}\n\n${links.map((page) => `- [${page.title}](${page.canonical}): ${page.description}`).join('\n')}\n`
			: '';
	});
	return `# Grip\n\n> ${SUMMARY}\n\n${[...sections, `## Docs\n\n${DOCS.join('\n')}\n`].filter(Boolean).join('\n')}`;
}

// Pipes would split a cell.
const cell = (value: string): string => value.replaceAll('|', '\\|');

export function benchmark(): string {
	const day = new Date(`${CHECKED}T00:00:00Z`).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
	const tables = FACTS.map(({ key, label }) => {
		const rows = RECORDERS.map(({ name, facts }) => {
			const { value, note, source } = facts[key];
			return `| ${cell(name)} | [${cell([value].flat().join(', '))}](${source}) | ${cell(note ?? '')} |`;
		});
		return `## ${label}\n\n| Recorder | Answer | Note |\n| --- | --- | --- |\n${rows.join('\n')}\n`;
	});
	return [
		'# Screen recorders for the Mac, side by side\n',
		`${RECORDERS.length} screen recorders, compared on ${FACTS.length} facts: what each costs, where it runs, and what it asks of you.`,
		`Each fact is what the recorder's maker states on a public page, read on ${day}, and links to that page.`,
		'No fact comes from using the recorders.',
		'The price is what recording for work costs with no limits: a free plan that is only for personal use, or that caps the videos, is in its own table.',
		`The same comparison as a web page: ${SITE}/benchmark\n`,
		'## The recorders\n',
		`${RECORDERS.map(({ name, url }) => `- [${name}](${url})`).join('\n')}\n`,
		...tables,
	].join('\n');
}

if (import.meta.main) {
	const listed = pages().filter((page) => !page.noindex);
	writeFileSync(join(BUILD, 'sitemap.xml'), sitemap(listed));
	writeFileSync(join(BUILD, 'llms.txt'), llms(listed));
	writeFileSync(join(BUILD, 'benchmark.md'), benchmark());
	console.log(`Wrote sitemap.xml and llms.txt with ${listed.length} pages, and benchmark.md`);
}
