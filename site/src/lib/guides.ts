// The license guides at /guides/<slug>: what a buyer of another recorder's one-time license has now, each fact as
// its maker states it with the page it was read from. Check every fact against its source again before changing
// CHECKED. Prices of today's plans live in benchmark.ts, which the cost bars read; the copy here only names them.
// Free of SvelteKit imports, so the site's tests can read it in plain Node.
export const CHECKED = '2026-11-21';
export const PUBLISHED = '2026-11-21';

// A page a fact was read from, and how the page names it: in an arrow's label and in the list of sources.
export type Source = Readonly<{ href: string; label: string }>;
// Words, and the page they come from when they state a fact about another product.
export type Said = Readonly<{ text: string; source?: Source }>;
// One answer: what it is about, the answer in a few words, its dot, and the sentences under it.
export type Answer = Readonly<{ label: string; value: string; tone?: 'good' | 'bad'; note: readonly Said[] }>;
export type Pick = Readonly<{ id: string; chip: string; answers: readonly Answer[] }>;
export type Step = Readonly<{ when: string; datetime: string; title: string; note: readonly Said[] }>;
export type Cell = Readonly<{ title: string; note: readonly Said[] }>;
export type Question = Readonly<{ question: string; answer: string }>;

export type Guide = Readonly<{
	slug: string;
	// The recorder the guide is about, by its id in benchmark.ts.
	recorder: string;
	title: string;
	description: string;
	line: string;
	crumb: readonly string[];
	h1: string;
	quiet: string;
	lede: readonly (string | Readonly<{ b: string }>)[];
	have: Readonly<{ sub: string; group: string; picked: string; picks: readonly Pick[] }>;
	changed: Readonly<{ sub: string; steps: readonly Step[] }>;
	cost: Readonly<{ sub: string; ids: readonly string[]; fine: readonly Said[] }>;
	grip: Readonly<{ sub: string; cells: readonly Cell[] }>;
	limits: readonly (readonly Said[])[];
	faqs: readonly Question[];
	sources: readonly Source[];
	close: string;
}>;

// Spelled out, not taken from links.ts, so the tests can read this file without SvelteKit.
const GITHUB_URL = 'https://github.com/bestboyhq/grip';
const README: Source = { href: `${GITHUB_URL}#readme`, label: 'Grip’s README' };
const LICENSE: Source = { href: `${GITHUB_URL}/blob/main/LICENSE`, label: 'Grip’s license' };

// What Grip answers, beside every pick.
export const OURS: Answer = {
	label: 'With Grip',
	value: 'Free, every update',
	tone: 'good',
	note: [{ text: 'No license key, no account, nothing to renew.', source: README }],
};

const archived = (stamp: string, url: string, label: string): Source => ({
	href: `https://web.archive.org/web/${stamp}/${url}`,
	label,
});

const SS = {
	pricing: { href: 'https://screen.studio/pricing', label: 'screen.studio/pricing, today’s plans' },
	faq: { href: 'https://screen.studio/', label: 'screen.studio, FAQ on one-time licenses' },
	terms: { href: 'https://screen.studio/legal/terms-of-service', label: 'screen.studio, terms of service' },
	y2022: archived('20221208105008', 'https://www.screen.studio/', 'screen.studio as of December 8, 2022'),
	y2023: archived('20230603090458', 'https://www.screen.studio/', 'screen.studio as of June 3, 2023'),
	y2024: archived('20241105160800', 'https://screen.studio/', 'screen.studio as of November 5, 2024'),
	y2025: archived('20250919152620', 'https://screen.studio/', 'screen.studio as of September 19, 2025'),
	gone: archived('20251003024324', 'https://screen.studio/', 'screen.studio as of October 3, 2025'),
} satisfies Record<string, Source>;

const CS = {
	pricing: { href: 'https://cleanshot.com/pricing', label: 'cleanshot.com/pricing, today’s plans' },
	updates: { href: 'https://cleanshot.com/why-updates-expire', label: 'cleanshot.com, why updates expire' },
	features: { href: 'https://cleanshot.com/features', label: 'cleanshot.com/features' },
	faq: { href: 'https://cleanshot.com/faq', label: 'cleanshot.com/faq' },
	y2021: archived('20210520101111', 'https://cleanshot.com/pricing', 'cleanshot.com/pricing as of May 20, 2021'),
	y2026: archived('20260710224030', 'https://cleanshot.com/pricing', 'cleanshot.com/pricing as of July 10, 2026'),
} satisfies Record<string, Source>;

const CAP: Source = { href: 'https://cap.so/pricing', label: 'cap.so/pricing' };

// What a Screen Studio buyer of a year has today, read from the page they bought on and the pages now.
const owner = (year: number, then: Source, later = false): readonly Answer[] => [
	{
		label: 'Your copy',
		value: 'Still valid',
		tone: 'good',
		note: [{ text: 'Screen Studio’s FAQ: “Your license is of course still valid.”', source: SS.faq }],
	},
	{
		label: 'Updates',
		value: `Ended in ${year + 1}`,
		tone: 'bad',
		note: [
			{
				text: `The license came with one year of updates.${later ? ' Its site names no later date.' : ''}`,
				source: then,
			},
		],
	},
	{
		label: 'New versions',
		value: 'Renew, or subscribe',
		note: [
			{
				text: 'The FAQ says “you can still renew your license at any time”, and names no price.',
				source: SS.faq,
			},
			{ text: 'The subscription is $108 a year.', source: SS.pricing },
		],
	},
];

const screenStudio: Guide = {
	slug: 'screen-studio-lifetime-license',
	recorder: 'screen-studio',
	title: 'Screen Studio lifetime license in 2026: one-time purchase',
	description:
		'Screen Studio sold a one-time license from 2022 to 2025: use forever, updates for one year. What you have now, what renewing costs, and a free option.',
	line: 'You bought it once between 2022 and 2025. What your license gives you now, and what the next years cost.',
	crumb: ['Screen Studio', 'One-time license'],
	h1: 'Screen Studio lifetime license in 2026',
	quiet: 'A one-time purchase: use forever, updates for one year.',
	lede: [
		'Screen Studio sold a one-time license from December 2022 to September 2025. If you bought one, ',
		{ b: 'your license is still valid' },
		', and it came with ',
		{ b: 'one year of updates' },
		'. It never promised updates for life. New versions need a renewal or the subscription, now $108 a year. Grip is a free, open source recorder with no license to run out.',
	],
	have: {
		sub: 'Pick the year you bought. Each answer comes from Screen Studio’s own pages, then and now.',
		group: 'When you bought Screen Studio',
		picked: '2023',
		picks: [
			{ id: '2022', chip: '2022', answers: owner(2022, SS.y2022) },
			{ id: '2023', chip: '2023', answers: owner(2023, SS.y2023) },
			{ id: '2024', chip: '2024', answers: owner(2024, SS.y2024, true) },
			{ id: '2025', chip: '2025', answers: owner(2025, SS.y2025, true) },
			{
				id: 'sub',
				chip: 'I subscribe',
				answers: [
					{
						label: 'Your copy',
						value: 'While you pay',
						note: [
							{
								text: 'The terms: when the agreement ends, the right to use the app ends with it.',
								source: SS.terms,
							},
						],
					},
					{
						label: 'Updates',
						value: 'Included',
						tone: 'good',
						note: [{ text: '“New features as they ship.”', source: SS.pricing }],
					},
					{
						label: 'Your files',
						value: 'Yours',
						tone: 'good',
						note: [
							{ text: 'Recordings, project files, and exports are yours under the terms.', source: SS.terms },
						],
					},
				],
			},
		],
	},
	changed: {
		sub: 'Four years, read from Screen Studio’s pages as the Wayback Machine kept them.',
		steps: [
			{
				when: 'Dec 2022',
				datetime: '2022-12',
				title: '$89, paid once',
				note: [{ text: 'One Mac and one year of updates. “Pay once, use forever.”', source: SS.y2022 }],
			},
			{
				when: 'Jun 2023',
				datetime: '2023-06',
				title: '$189 for three Macs',
				note: [{ text: 'Up from $139. One Mac stays at $89.', source: SS.y2023 }],
			},
			{
				when: 'Nov 2024',
				datetime: '2024-11',
				title: '$229 once, or $108 a year',
				note: [
					{ text: 'The subscription arrives. The one-time license renews at $109 a year.', source: SS.y2024 },
				],
			},
			{
				when: 'Oct 2025',
				datetime: '2025-10',
				title: 'Subscription only',
				note: [
					{
						text: 'The one-time license leaves the page between September 19 and October 3.',
						source: SS.gone,
					},
				],
			},
			{
				when: 'Today',
				datetime: CHECKED,
				title: '$29 a month, or $108 a year',
				note: [{ text: 'Old licenses stay valid, and they can renew.', source: SS.faq }],
			},
		],
	},
	cost: {
		sub: 'Recording for work from today, at the prices each maker lists. Move the slider to change the years.',
		ids: ['screen-studio', 'cleanshot', 'cap', 'grip'],
		fine: [
			{
				text: 'CleanShot X counts its optional $19 renewal for each year after the first. Without it, the last version you have keeps working.',
				source: CS.updates,
			},
		],
	},
	grip: {
		sub: 'Grip is free because it is open source, not because of a plan you can fall off.',
		cells: [
			{
				title: 'Free for work',
				note: [{ text: 'There is no commercial license and no business edition to buy.', source: README }],
			},
			{
				title: 'Nothing to activate',
				note: [{ text: 'No license key and no account. Only a share link asks you to sign in.', source: README }],
			},
			{ title: 'Every update', note: [{ text: 'Grip updates itself. There is no update period to renew.', source: README }] },
			{
				title: 'Yours to keep',
				note: [{ text: 'AGPL-3.0 calls the rights it grants “irrevocable”. The source is public.', source: LICENSE }],
			},
		],
	},
	limits: [
		[{ text: 'It needs macOS 15 or later on Apple silicon. There is no Intel and no Windows version.' }],
		[
			{
				text: 'It does not open Screen Studio projects. It imports any video with File > Import Video, so a finished export moves over.',
			},
		],
	],
	faqs: [
		{
			question: 'Is Screen Studio a one-time purchase?',
			answer: 'Not for new buyers. Since October 2025 it sells only the subscription: $29 a month, or $108 a year billed yearly.',
		},
		{
			question: 'Was it a lifetime license?',
			answer:
				'The copy was sold to use forever, and the updates were for one year. The 2022 page said “Pay once, use forever” beside “1 year of updates”.',
		},
		{
			question: 'Does my old Screen Studio license still work?',
			answer:
				'Yes. Screen Studio’s FAQ says: “Your license is of course still valid.” You can renew it to get new versions again.',
		},
		{
			question: 'What does a renewal cost?',
			answer:
				'Screen Studio does not publish today’s renewal price for a one-time license. In November 2024 its page offered a renewal at $109 for another year of updates.',
		},
		{
			question: 'Is Grip free for commercial work?',
			answer: 'Yes. Grip is free and open source under AGPL-3.0, with no subscription, account, or watermark.',
		},
	],
	sources: [SS.pricing, SS.faq, SS.terms, SS.y2022, SS.y2023, SS.y2024, SS.y2025, SS.gone, CS.pricing, CS.updates, CAP],
	close: 'Record the next one in Grip.',
};

const cleanshot: Guide = {
	slug: 'cleanshot-x-license-renewal',
	recorder: 'cleanshot',
	title: 'CleanShot X license renewal in 2026: one-time purchase',
	description:
		'CleanShot X is a one-time purchase: $35 with one year of updates, then an optional $19 a year. What you keep without a renewal, and a free open source option.',
	line: 'Your year of updates ended. What you keep without a renewal, and what renewing costs over the years.',
	crumb: ['CleanShot X', 'License renewal'],
	h1: 'CleanShot X license renewal in 2026',
	quiet: 'Your copy keeps working. A renewal buys one more year of updates.',
	lede: [
		'CleanShot X Basic is a one-time purchase: ',
		{ b: '$35, with one year of updates' },
		' and 1 GB of Cloud storage. After that year, ',
		{ b: 'the version you have keeps working' },
		'. A renewal is optional and costs ',
		{ b: '$19 a year' },
		' for another year of updates. Grip is a free, open source screenshot tool and recorder with nothing to renew.',
	],
	have: {
		sub: 'Pick where you are. Each answer comes from CleanShot’s own pages.',
		group: 'Where you are with CleanShot X',
		picked: 'after',
		picks: [
			{
				id: 'first',
				chip: 'In the first year',
				answers: [
					{
						label: 'Your copy',
						value: 'Yours to keep',
						tone: 'good',
						note: [{ text: '“Pay once, use forever.”', source: CS.pricing }],
					},
					{
						label: 'Updates',
						value: 'Included',
						tone: 'good',
						note: [{ text: 'The $35 comes with one year of updates.', source: CS.pricing }],
					},
					{
						label: 'Cloud',
						value: '1 GB',
						note: [{ text: 'Basic comes with 1 GB of CleanShot Cloud storage.', source: CS.pricing }],
					},
				],
			},
			{
				id: 'after',
				chip: 'After the first year',
				answers: [
					{
						label: 'Your copy',
						value: 'Still works',
						tone: 'good',
						note: [{ text: 'CleanShot: “we will never take your access to the app.”', source: CS.updates }],
					},
					{
						label: 'Updates',
						value: 'Ended after one year',
						tone: 'bad',
						note: [
							{
								text: 'You keep the last version you got. CleanShot calls the renewal “completely optional”.',
								source: CS.updates,
							},
						],
					},
					{
						label: 'New versions',
						value: 'Renew for $19',
						note: [
							{
								text: 'After updates expire, you can “renew them for another year at just $19 per seat”.',
								source: CS.updates,
							},
						],
					},
				],
			},
			{
				id: 'renew',
				chip: 'I renew each year',
				answers: [
					{
						label: 'Your copy',
						value: 'Yours to keep',
						tone: 'good',
						note: [{ text: '“Pay once, use forever.”', source: CS.pricing }],
					},
					{
						label: 'Updates',
						value: 'One more year each time',
						tone: 'good',
						note: [{ text: 'Each $19 renewal adds another year of updates.', source: CS.updates }],
					},
					{
						label: 'Where',
						value: 'License Manager',
						note: [
							{
								text: 'CleanShot: “You can manage your license and renew the updates using our License Manager.”',
								source: CS.updates,
							},
						],
					},
				],
			},
			{
				id: 'pro',
				chip: 'I am on Pro',
				answers: [
					{
						label: 'Your copy',
						value: 'Latest version',
						tone: 'good',
						note: [
							{
								text: 'CleanShot: “If you are an active Cloud Pro subscriber, you always get the latest version of the app”.',
								source: CS.updates,
							},
						],
					},
					{
						label: 'Updates',
						value: 'Included',
						tone: 'good',
						note: [{ text: 'There is nothing to renew while Pro is active.', source: CS.updates }],
					},
					{
						label: 'What it costs',
						value: '$10 a user a month',
						note: [
							{
								text: 'Billed yearly. “Pro adds unlimited Cloud storage, custom branding, and team features.”',
								source: CS.pricing,
							},
						],
					},
				],
			},
		],
	},
	changed: {
		sub: 'Read from CleanShot’s pricing page, as the Wayback Machine kept it and as it reads today.',
		steps: [
			{
				when: 'May 2021',
				datetime: '2021-05',
				title: '$29, paid once',
				note: [
					{
						text: 'One year of updates and 1 GB of Cloud storage. A renewal is optional at $19 a year.',
						source: CS.y2021,
					},
				],
			},
			{
				when: 'Jul 2026',
				datetime: '2026-07',
				title: 'Still $29',
				note: [
					{
						text: 'The same year of updates and the same $19 renewal. Pro is $8 a user a month, billed yearly.',
						source: CS.y2026,
					},
				],
			},
			{
				when: 'Today',
				datetime: CHECKED,
				title: '$35 once, $19 to renew',
				note: [{ text: 'Pro is $10 a user a month, billed yearly. The renewal stays at $19.', source: CS.pricing }],
			},
		],
	},
	cost: {
		sub: 'From today, at the prices each maker lists. Move the slider to change the years.',
		ids: ['cleanshot', 'cap', 'grip'],
		fine: [
			{
				text: 'CleanShot X shows two bars: with the optional $19 renewal for each year after the first, and without it. Without it, the last version you have keeps working.',
				source: CS.updates,
			},
		],
	},
	grip: {
		sub: 'Grip has no first year of updates, so it has no second one to pay for. It is free because it is open source, not because of a plan that can end.',
		cells: [
			{
				title: 'Screenshots with markup',
				note: [
					{
						text: 'An area, a window, or a display. Arrow, rectangle, pen, text, and pixelate, each on one key, in six colors.',
						source: README,
					},
				],
			},
			{
				title: 'Recordings that edit themselves',
				note: [
					{
						text: 'Clicks and typing become zooms, and captions are made on your Mac in 25 European languages.',
						source: README,
					},
				],
			},
			{ title: 'Every update', note: [{ text: 'Grip updates itself. There is no update year to renew.', source: README }] },
			{
				title: 'Yours to keep',
				note: [{ text: 'AGPL-3.0 calls the rights it grants “irrevocable”. The source is public.', source: LICENSE }],
			},
		],
	},
	limits: [
		[
			{
				text: 'No scrolling capture. CleanShot X captures a scrolling page, vertical or horizontal, in every app.',
				source: CS.features,
			},
		],
		[
			{
				text: 'No text recognition. CleanShot X copies the text in an area and reads QR codes, on device.',
				source: CS.features,
			},
		],
		[{ text: 'No screenshots pinned on top of other windows, and no self-timer for a screenshot.', source: CS.features }],
		[
			{
				text: 'Fewer markup tools. Grip has arrow, rectangle, pen, text, and pixelate. CleanShot X adds blur, spotlight, step counters, a highlighter, lines, and ellipses.',
				source: CS.features,
			},
		],
		[
			{
				text: 'No cloud for screenshots. Grip copies a screenshot or saves it to the Desktop, and its share links are for videos. CleanShot Cloud gives a screenshot a link.',
				source: CS.features,
			},
		],
		[
			{
				text: 'No team admin. CleanShot Pro has a custom domain, branding, SSO, and SCIM.',
				source: CS.pricing,
			},
		],
		[
			{
				text: 'It needs macOS 15 or later on Apple silicon. CleanShot X runs on macOS 13 or later.',
				source: CS.faq,
			},
		],
	],
	faqs: [
		{
			question: 'Is CleanShot X a one-time purchase?',
			answer:
				'Yes. CleanShot X Basic is $35, paid once, with one year of updates and 1 GB of Cloud storage. Its pricing page says “Pay once, use forever.”',
		},
		{
			question: 'Does CleanShot X stop working if I do not renew?',
			answer:
				'No. CleanShot’s page on updates says you can “continue using the last version forever, without renewing”. You stop getting new versions.',
		},
		{
			question: 'How much is a CleanShot X renewal?',
			answer:
				'$19 a year for another year of updates. It is optional, and you renew in CleanShot’s License Manager.',
		},
		{
			question: 'Is there a CleanShot X lifetime license?',
			answer:
				'CleanShot does not use the word “lifetime”. Basic is a one-time purchase: the app keeps working, and the updates last one year unless you renew.',
		},
		{
			question: 'Is there a free CleanShot X alternative?',
			answer:
				'Grip is free and open source under AGPL-3.0. It takes screenshots of an area, a window, or a display with markup, and it records video with automatic zoom. It has no scrolling capture, no text recognition, and no cloud for screenshots.',
		},
	],
	sources: [CS.pricing, CS.updates, CS.features, CS.faq, CS.y2021, CS.y2026, CAP],
	close: 'Take the next screenshot in Grip.',
};

export const GUIDES: readonly Guide[] = [screenStudio, cleanshot];
