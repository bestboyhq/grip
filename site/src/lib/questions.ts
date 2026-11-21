// The guides at /guides/<slug> that answer one question people ask before they buy a recorder, each over one group
// of the benchmark (GROUPS in benchmark.ts). The group decides who is in and who is out, so a fact that changes a
// group fails the tests until the copy follows. A line about another recorder restates a fact in benchmark.ts or
// names the page it was read from, as its maker states it; a line about Grip comes from the README. Free of
// SvelteKit, so the site's tests can read it.
import { CHECKED_ON, FACTS, GROUPS, RECORDERS, type Key, type Recorder } from './benchmark.ts';
import { GUIDES } from './guides.ts';
import type { Line } from './versus.ts';

type Faq = Readonly<{ question: string; answer: string }>;

export type Question = Readonly<{
	slug: string;
	group: string;
	title: string;
	description: string;
	h1: string;
	faint: string;
	lede: string;
	// One entry per recorder in the group, in the benchmark's order. A page links each one but Grip to /vs/<id>.
	entries: readonly Readonly<{ id: string; lines: readonly Line[] }>[];
	// One line per recorder out of the group: the fact in `key` keeps it out, and that fact's source is the line's.
	out: readonly Readonly<{ id: string; key: Key; text: string; guide?: string }>[];
	// The rows of the facts table, and the cost chart: its recorders, its heading, and the line under it.
	rows: readonly Key[];
	cost: Readonly<{ ids: readonly string[]; title: string; sub: string }>;
	picks: readonly Line[];
	faqs: readonly Faq[];
}>;

const GITHUB_URL = 'https://github.com/bestboyhq/grip';
const README = `${GITHUB_URL}#readme`;
const LICENSE = `${GITHUB_URL}/blob/main/LICENSE`;

// A count in the copy comes from the groups, so one more recorder in the benchmark keeps every sentence true.
const ALL = RECORDERS.length;
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const count = (...groups: readonly string[]): string => {
	const n = RECORDERS.filter((recorder) => groups.every((id) => GROUPS.find((g) => g.id === id)?.has(recorder))).length;
	return NUMBERS[n] ?? String(n);
};
const Count = (...groups: readonly string[]): string => count(...groups).replace(/^./u, (c) => c.toUpperCase());

// Lines about a recorder that more than one guide needs.
const KAP: readonly Line[] = [
	{
		text: 'Kap is “an open-source screen recorder built with web technology”, for macOS 12 or later.',
		source: 'https://getkap.co/',
	},
	{
		text: 'Its MIT license grants its use “free of charge”. It exports GIF, MP4, WebM, or APNG, and its plugins upload to Giphy and Streamable.',
		source: 'https://github.com/wulkano/Kap/blob/main/LICENSE.md',
	},
	{
		text: 'Its last release, version 3.6.0, came out on October 27, 2022.',
		source: 'https://github.com/wulkano/Kap/releases',
	},
];
const OBS: readonly Line[] = [
	{
		text: 'OBS Studio is “free and open source software for video recording and live streaming”, under GPL-2.0.',
		source: 'https://obsproject.com/',
	},
	{
		text: 'It runs on macOS 13 or later, on Intel or Apple silicon, on Windows 10 and 11, and on Linux.',
		source: 'https://obsproject.com/download',
	},
	{
		text: 'It saves recordings to a folder on your computer.',
		source: 'https://obsproject.com/kb/standard-recording-output-guide',
	},
];
const OBS_PICK: Line = {
	text: 'Pick OBS Studio if you stream live, or build scenes from many sources and switch between them as you record.',
	source: 'https://obsproject.com/',
};

// What Grip does not do, on every guide.
export const LIMITS: readonly string[] = [
	'It runs only on macOS 15 or later, on Apple silicon. There is no Windows, Linux, or Intel version.',
	'It takes no scrolling screenshots: it captures an area, a window, or a whole display.',
	'It opens no other recorder’s projects. It imports any MP4 or MOV with File > Import Video (Cmd+I).',
	'Its support is its GitHub issues. There is no email, chat, or phone support.',
];

export const QUESTIONS: readonly Question[] = [
	{
		slug: 'open-source-screen-recorders-mac',
		group: 'open-source',
		title: 'Open source screen recorders for Mac, compared',
		description:
			`Of ${ALL} Mac screen recorders compared, ${count('open-source')} are open source: Grip, Cap, Kap, OBS Studio, OpenScreen, and Recordly. Licenses, prices for work, and auto zoom.`,
		h1: 'Open source screen recorders for the Mac',
		faint: `${Count('open-source')} of the ${ALL} compared here. ${Count('open-source', 'free')} are free for work.`,
		lede: `Of the ${ALL} Mac screen recorders compared here on ${CHECKED_ON}, ${count('open-source')} are open source. Grip, Kap, OBS Studio, and OpenScreen are free for work, and Grip and OpenScreen zoom on clicks. Cap costs $29 a year or $58 once for work. Recordly costs $9 a month and needs an account. Kap’s last release was in October 2022.`,
		entries: [
			{
				id: 'grip',
				lines: [
					{
						text: 'Grip is a screen recorder, screenshot tool, and video editor, open source under AGPL-3.0.',
						source: LICENSE,
					},
					{
						text: 'It is free for any use, work included, with no subscription, no account, and no watermark.',
						source: README,
					},
					{
						text: 'It zooms on clicks and typing as you record, and runs on macOS 15 or later with Apple silicon.',
						source: README,
					},
				],
			},
			{
				id: 'cap',
				lines: [
					{ text: 'Cap is open source under AGPL-3.0 and MIT.', source: 'https://github.com/CapSoftware/Cap' },
					{
						text: 'It runs on macOS 13.1 or later, Windows, and Linux.',
						source: 'https://cap.so/download',
					},
					{
						text: 'It records with no account, and adds zooms in the editor, from clicks, when you ask.',
						source: 'https://cap.so/docs/recording/studio-mode',
					},
					{
						text: 'Its free plan is for personal use. Work costs $29 a year, or $58 once for a license that “never renews”.',
						source: 'https://cap.so/pricing',
					},
				],
			},
			{ id: 'kap', lines: KAP },
			{ id: 'obs', lines: OBS },
			{
				id: 'openscreen',
				lines: [
					{
						text: 'OpenScreen is a free recorder and video editor under MIT. Its FAQ says it “is free for commercial use, with no account and no watermark”.',
						source: 'https://getopenscreen.com/docs/faq/',
					},
					{ text: 'It zooms on clicks.', source: 'https://getopenscreen.com/features/auto-zoom/' },
					{
						text: 'It runs on macOS 13 or later, Windows, and Linux.',
						source: 'https://getopenscreen.com/docs/installation/',
					},
				],
			},
			{
				id: 'recordly',
				lines: [
					{
						text: 'Recordly is open source under AGPL-3.0, and runs on macOS 14 or later, Windows, and Linux.',
						source: 'https://github.com/webadderallorg/Recordly#readme',
					},
					{
						text: 'It needs an account to record.',
						source: 'https://github.com/webadderallorg/Recordly/blob/main/docs/authentication.md',
					},
					{
						text: 'Work costs $9 a month at its early bird price, or $15 a month regular.',
						source: 'https://videos.recordly.dev/api/billing/catalog',
					},
				],
			},
		],
		out: [
			{ id: 'cleanshot', key: 'source', text: 'CleanShot X is closed source, under its end user license agreement.' },
			{ id: 'focusee', key: 'source', text: 'FocuSee is closed source, under its maker’s end user license agreement.' },
			{ id: 'loom', key: 'source', text: 'Loom is closed source, under the Atlassian Customer Agreement.' },
			{ id: 'quicktime', key: 'source', text: 'QuickTime Player is closed source, under Apple’s software license agreements.' },
			{ id: 'screen-studio', key: 'source', text: 'Screen Studio is closed source, under its terms of service.' },
		],
		rows: ['source', 'price', 'free', 'account', 'platforms', 'zoom', 'links', 'updates'],
		cost: {
			ids: ['grip', 'cap', 'recordly'],
			title: 'What the next years cost',
			sub: 'Recording for work from today, every way Cap and Recordly list to pay, beside Grip. Kap, OBS Studio, and OpenScreen cost nothing too. Move the slider to change the years.',
		},
		picks: [
			{
				text: 'Pick Grip if you record on macOS 15 or later with Apple silicon, and want zooms on clicks and typing at no cost for work.',
				source: README,
			},
			{
				text: 'Pick OpenScreen if you record on Windows or Linux too, and want it free for work with no account.',
				source: 'https://getopenscreen.com/docs/faq/',
			},
			{
				text: 'Pick Cap if you want the video to upload while you record. Cap offers live upload as well as recording on device.',
				source: 'https://cap.so/docs/recording/studio-mode',
			},
			OBS_PICK,
			{
				text: 'Pick Recordly if your Mac runs macOS 14 and you want share links of up to 10 GB a video.',
				source: 'https://videos.recordly.dev/api/billing/catalog',
			},
		],
		faqs: [
			{
				question: 'Is there an open source alternative to Screen Studio?',
				answer: 'Yes. Of the recorders compared here, Grip, Cap, Kap, OBS Studio, OpenScreen, and Recordly are open source and run on the Mac. Grip and OpenScreen zoom on clicks as you record, and Grip zooms on typing too. Screen Studio is closed source, at $29 a month or $108 a year.',
			},
			{
				question: 'Which open source screen recorder for Mac has auto zoom?',
				answer: 'Grip zooms on clicks and typing as you record, and OpenScreen zooms on clicks. Cap adds zooms in the editor, from clicks, when you ask. Recordly suggests zooms from the cursor, in the editor. No page of Kap or OBS Studio states an automatic zoom.',
			},
			{
				question: 'Is an open source screen recorder free for work?',
				answer: 'Grip, Kap, OBS Studio, and OpenScreen are free for work. Cap’s free plan is for personal use, and work costs $29 a year or $58 once. Recordly’s free plan is for personal use, and work costs $9 a month at its early bird price.',
			},
			{
				question: 'Which license does each one use?',
				answer: 'Grip and Recordly use AGPL-3.0, OBS Studio uses GPL-2.0, Kap and OpenScreen use MIT, and Cap uses AGPL-3.0 and MIT. Grip’s license calls the rights it grants “irrevocable”.',
			},
		],
	},
	{
		slug: 'free-screen-recorders-mac',
		group: 'free',
		title: 'Free screen recorders for Mac, for work too',
		description: `Of ${ALL} Mac screen recorders compared, ${count('free')} cost nothing for work: Grip, Kap, OBS Studio, OpenScreen, and QuickTime. What each does, and who is left out.`,
		h1: 'Free screen recorders for the Mac',
		faint: `${Count('free')} of the ${ALL} compared here cost nothing for work.`,
		lede: `Of the ${ALL} Mac screen recorders compared here on ${CHECKED_ON}, ${count('free')} cost nothing for work: Grip, Kap, OBS Studio, OpenScreen, and QuickTime. Grip and OpenScreen say they add no watermark and need no account. OBS Studio also streams live. QuickTime comes with macOS. Kap’s last release was in October 2022.`,
		entries: [
			{
				id: 'grip',
				lines: [
					{
						text: 'Grip is free for commercial use and open source under AGPL-3.0, with no subscription, no account, and no watermark.',
						source: README,
					},
					{
						text: 'It zooms on clicks and typing, and makes share links: 25 uploads a month, up to 2 GB each, kept 90 days. It runs on macOS 15 or later with Apple silicon.',
						source: README,
					},
				],
			},
			{ id: 'kap', lines: KAP },
			{ id: 'obs', lines: OBS },
			{
				id: 'openscreen',
				lines: [
					{
						text: 'OpenScreen is open source under MIT. Its FAQ says it “is free for commercial use, with no account and no watermark”.',
						source: 'https://getopenscreen.com/docs/faq/',
					},
					{ text: 'It zooms on clicks.', source: 'https://getopenscreen.com/features/auto-zoom/' },
					{
						text: 'It runs on macOS 13 or later, Windows, and Linux.',
						source: 'https://getopenscreen.com/docs/installation/',
					},
				],
			},
			{
				id: 'quicktime',
				lines: [
					{ text: 'QuickTime Player comes with macOS, free.', source: 'https://support.apple.com/en-us/106391' },
					{
						text: 'It records the whole screen or a part of it, with the pointer and clicks if you choose.',
						source: 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac',
					},
					{
						text: 'It shares the movie file, and makes no share links.',
						source: 'https://support.apple.com/guide/quicktime-player/share-your-movies-qtp1ad6fa3c1/mac',
					},
				],
			},
		],
		out: [
			{ id: 'cap', key: 'free', text: 'Cap’s free plan is for personal use. Work costs $29 a year, or $58 once.' },
			{ id: 'cleanshot', key: 'free', text: 'CleanShot X has no free plan. It costs $35 once, with money back in 30 days.' },
			{ id: 'focusee', key: 'free', text: 'FocuSee’s trial makes one export, with a watermark.' },
			{ id: 'loom', key: 'free', text: 'Loom’s free plan holds 25 videos of 5 minutes each, branded. Work costs $18 per user a month.' },
			{ id: 'recordly', key: 'free', text: 'Recordly’s free plan is for personal use, with 5 cloud links of 1 GB each.' },
			{ id: 'screen-studio', key: 'free', text: 'Screen Studio’s trial does everything but export.' },
		],
		rows: ['price', 'free', 'account', 'where', 'links', 'zoom', 'platforms', 'source'],
		cost: {
			ids: ['cap', 'recordly', 'loom', 'grip'],
			title: 'What work costs where a free plan stops',
			sub: 'Cap’s and Recordly’s free plans are for personal use, and Loom’s holds 25 videos. Here is what each costs for work from today, beside Grip. Move the slider to change the years.',
		},
		picks: [
			{
				text: 'Pick Grip if you want zooms on clicks and typing, and share links, on macOS 15 or later with Apple silicon.',
				source: README,
			},
			{
				text: 'Pick OpenScreen if you record on Windows, Linux, or macOS 13 or 14.',
				source: 'https://getopenscreen.com/docs/installation/',
			},
			{
				text: 'Pick QuickTime if you want nothing to install. It comes with macOS.',
				source: 'https://support.apple.com/en-us/106391',
			},
			OBS_PICK,
			{
				text: 'Pick Loom if your team keeps its videos in one cloud library. Loom records to the cloud, with an account.',
				source: 'https://www.atlassian.com/software/loom/screen-recorder',
			},
		],
		faqs: [
			{
				question: 'Is there a free screen recorder for Mac with no watermark?',
				answer: 'Yes. Grip’s README says “no watermark”, and so does OpenScreen’s FAQ. Both are free for commercial use and open source. QuickTime Player is free with macOS.',
			},
			{
				question: 'What is a Loom alternative with no account on Mac?',
				answer: 'Grip records and edits with no account, and keeps the video on your Mac. Its share links sign in to bestboy.dev once, and take 25 uploads a month, up to 2 GB each, kept 90 days. Loom needs an account to record.',
			},
			{
				question: 'Can QuickTime zoom on clicks?',
				answer: 'No. QuickTime records the screen as it is, and can draw the pointer and clicks into the picture. Grip and OpenScreen zoom on clicks, and Grip zooms on typing too.',
			},
			{
				question: 'Are free screen recorders free for work?',
				answer: 'Grip, Kap, OBS Studio, OpenScreen, and QuickTime are. Cap’s and Recordly’s free plans are for personal use, and Loom’s free plan holds 25 videos of 5 minutes each.',
			},
		],
	},
	{
		slug: 'mac-screen-recorders-no-subscription',
		group: 'no-subscription',
		title: 'Mac screen recorders with no subscription, compared',
		description:
			`Of ${ALL} Mac screen recorders compared, ${count('no-subscription')} need no subscription. What a one-time price buys: a year of CleanShot X updates, FocuSee version 2, a Cap license.`,
		h1: 'Mac screen recorders with no subscription',
		faint: `${Count('no-subscription')} of the ${ALL} compared here. What each one-time price buys.`,
		lede: `Of the ${ALL} Mac screen recorders compared here on ${CHECKED_ON}, ${count('no-subscription')} work with no subscription. Grip, Kap, OBS Studio, OpenScreen, and QuickTime are free. CleanShot X costs $35 once with one year of updates, then $19 a year. FocuSee costs $199.99 once for version 2. Cap costs $58 once, for a license that “never renews”.`,
		entries: [
			{
				id: 'grip',
				lines: [
					{
						text: 'Grip is free and open source under AGPL-3.0, with no subscription, no account, and no watermark.',
						source: README,
					},
					{ text: 'Updates arrive in the app, and each one is free.', source: README },
					{ text: 'It runs on macOS 15 or later with Apple silicon.', source: README },
				],
			},
			{
				id: 'cap',
				lines: [
					{
						text: 'Cap costs $58 once, for a license that “never renews”, or $29 a year. Its pricing page does not say which updates the $58 license includes.',
						source: 'https://cap.so/pricing',
					},
					{
						text: 'It is open source, and runs on macOS 13.1 or later, Windows, and Linux.',
						source: 'https://cap.so/download',
					},
				],
			},
			{
				id: 'cleanshot',
				lines: [
					{
						text: 'CleanShot X costs $35 once, with one year of updates and 1 GB of CleanShot Cloud. It runs on macOS 13 or later.',
						source: 'https://cleanshot.com/pricing',
					},
					{
						text: 'Another year of updates costs $19. Without it, CleanShot says you can “continue using the last version forever, without renewing”.',
						source: 'https://cleanshot.com/why-updates-expire',
						guide: 'cleanshot-x-license-renewal',
					},
				],
			},
			{
				id: 'focusee',
				lines: [
					{
						text: 'FocuSee costs $199.99 once for “Lifetime Access to FocuSee 2.x”, and “upgrading to the next major version (e.g. Version 3) comes at an additional upgrade cost”. Its plans that renew cost $19.99 a month or $49.99 a year.',
						source: 'https://focusee.ai/pricing.htm',
					},
					{ text: 'It runs on macOS 10.15 or later and Windows.', source: 'https://focusee.ai/specs.htm' },
				],
			},
			{ id: 'kap', lines: KAP },
			{ id: 'obs', lines: OBS },
			{
				id: 'openscreen',
				lines: [
					{
						text: 'OpenScreen is free and open source under MIT, with “no account, no paid tier and no premium feature”.',
						source: 'https://getopenscreen.com/docs/faq/',
					},
					{
						text: 'It runs on macOS 13 or later, Windows, and Linux.',
						source: 'https://getopenscreen.com/docs/installation/',
					},
				],
			},
			{
				id: 'quicktime',
				lines: [
					{ text: 'QuickTime Player comes with macOS, free.', source: 'https://support.apple.com/en-us/106391' },
					{ text: 'It updates with macOS.', source: 'https://support.apple.com/en-us/108382' },
					{
						text: 'It records the screen, with the pointer and clicks if you choose, and has no automatic zoom.',
						source: 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac',
					},
				],
			},
		],
		out: [
			{
				id: 'loom',
				key: 'price',
				text: 'Loom costs $18 per user a month, or 17% less paid yearly, as long as you pay.',
			},
			{
				id: 'recordly',
				key: 'price',
				text: 'Recordly costs $9 a month at its early bird price, or $15 a month regular, as long as you pay.',
			},
			{
				id: 'screen-studio',
				key: 'price',
				text: 'Screen Studio costs $29 a month, or $108 a year. It sold a one-time license until October 2025.',
				guide: 'screen-studio-lifetime-license',
			},
		],
		rows: ['price', 'updates', 'source', 'account', 'platforms', 'zoom'],
		cost: {
			ids: ['grip', 'cap', 'cleanshot', 'focusee', 'screen-studio'],
			title: 'What the next years cost',
			sub: 'Recording for work from today, every way Cap, CleanShot X, and FocuSee list to pay, beside Grip and the Screen Studio subscription. Move the slider to change the years.',
		},
		picks: [
			{
				text: 'Pick Grip if you want every update free, on macOS 15 or later with Apple silicon.',
				source: README,
			},
			{
				text: 'Pick CleanShot X if you capture whole pages. It takes scrolling screenshots, and Grip does not.',
				source: 'https://cleanshot.com/',
			},
			{
				text: 'Pick Cap if you record on Windows or Linux too, and want one license that “never renews”.',
				source: 'https://cap.so/pricing',
			},
			{
				text: 'Pick FocuSee if you record on Windows too, and want zooms on clicks and typing.',
				source: 'https://focusee.ai/',
			},
			OBS_PICK,
		],
		faqs: [
			{
				question: 'Is there a screen recorder for Mac with a one-time purchase?',
				answer: 'Yes. CleanShot X costs $35 once with one year of updates, FocuSee $199.99 once for version 2, and Cap $58 once for a license that “never renews”. Grip, Kap, OBS Studio, OpenScreen, and QuickTime cost nothing.',
			},
			{
				question: 'Does a lifetime license include lifetime updates?',
				answer: 'Not always. CleanShot X’s $35 includes one year of updates, then $19 a year. FocuSee’s $199.99 buys version 2, and version 3 “comes at an additional upgrade cost”. Cap’s pricing page does not say which updates its $58 license includes. Every Grip update is free.',
			},
			{
				question: 'Does Screen Studio still sell a lifetime license?',
				answer: 'No. From December 2022 it sold a one-time license with one year of updates. Since October 2025 it sells only the subscription, $29 a month or $108 a year. Its FAQ says one-time licenses are “no longer available for new purchases”.',
			},
			{
				question: 'What happens to CleanShot X when its updates end?',
				answer: 'CleanShot says you can “continue using the last version forever, without renewing”. Another year of updates costs $19.',
			},
		],
	},
];

// Every guide, the questions first, as the index and the benchmark list them: its address, its H1, and one line.
export const READING: readonly Readonly<{ slug: string; h1: string; line: string }>[] = [
	...QUESTIONS.map(({ slug, h1, faint }) => ({ slug, h1, line: faint })),
	...GUIDES.map(({ slug, h1, line }) => ({ slug, h1, line })),
];

// The question guide a /vs/ page points to: the first whose group holds its recorder.
export const question = (id: string): Question | undefined =>
	QUESTIONS.find(({ group }) => GROUPS.find((g) => g.id === group)?.has(recorder(id)));

export function recorder(id: string): Recorder {
	const found = RECORDERS.find((r) => r.id === id);
	if (!found) throw new Error(`No recorder ${id}`);
	return found;
}

// Every page a guide reads from, once, labeled by what it shows: the facts of its table first, then its lines.
export function sources({ entries, out, rows, picks }: Question): readonly Readonly<{ url: string; label: string }>[] {
	const named = new Map<string, string>();
	const shown = [
		...entries.flatMap(({ id }) => rows.map((key) => ({ id, key }))),
		...out.map(({ id, key }) => ({ id, key })),
	];
	for (const { id, key } of shown) {
		const { name, facts } = recorder(id);
		const url = facts[key].source;
		const label = FACTS.find((fact) => fact.key === key)?.label.toLowerCase();
		const before = named.get(url);
		named.set(url, before ? `${before}, ${label}` : `${name}: ${label}`);
	}
	for (const { source } of [...entries.flatMap(({ lines }) => lines), ...picks])
		if (!named.has(source)) named.set(source, source.replace(/^https:\/\/(www\.)?/u, '').replace(/\/$/u, ''));
	return [...named].map(([url, label]) => ({ url, label }));
}
