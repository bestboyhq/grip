// The benchmark at /benchmark: the recorders it compares, Grip first and the rest by name, and for each one public
// fact per column, as its maker states it, with the page it was read from. Check every fact against its source again
// before changing CHECKED. A recorder gets its `take` once its recording of scripts/benchmark/take.swift is encoded
// into `static/media/benchmark-<id>.mp4` (media.sh), with the version that made it and the clip's size.
// Read a recorder's license before filming with it: FocuSee's lets a licensee publish nothing about it without
// written consent, and Loom's lets no one publish a comparison made on its free plan, so neither has a take.
// Recordly's own download asks for a Cloud subscription for any commercial use, a take included.
export const CHECKED = '2026-11-21';
// CHECKED as a page writes it: November 21, 2026.
export const CHECKED_ON = new Date(`${CHECKED}T00:00:00Z`).toLocaleDateString('en-US', {
	month: 'long',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC',
});
// How long take.swift runs.
export const SECONDS = 15;

// The rows, one fact each, from what a recorder costs to what it does, and how its cells show it, the same way for
// every recorder: a price leads with its headline, a mark is a short answer after a dot, green on the answers in
// `good`, red on those in `bad`, and gray on the rest, a year is set in mono, and platforms stand one a line, each
// after its glyph.
// A value stays a few words. A note says only what its value leaves out, and a row's notes all say the same kind
// of thing: a price's the other ways to pay, a platform's the macOS it needs, a license's name, an account's what it
// is needed for, updates' what happens after them, share links' limits, screenshots' extras, support's the other
// ways to reach the maker. A value that says it all has no note.
// The price is what recording for work costs with no limits, since most recordings are made for work: a free plan
// that is only for personal use, or that caps the videos, is in its own row.
export type Key =
	| 'price'
	| 'updates'
	| 'source'
	| 'since'
	| 'platforms'
	| 'account'
	| 'free'
	| 'where'
	| 'links'
	| 'zoom'
	| 'screenshots'
	| 'support';
export const FACTS: readonly Readonly<{
	key: Key;
	label: string;
	kind: 'price' | 'mark' | 'year' | 'platforms';
	good?: readonly string[];
	bad?: readonly string[];
}>[] = [
	{ key: 'price', label: 'Price for work', kind: 'price' },
	{ key: 'updates', label: 'Updates', kind: 'mark', good: ['Always free'] },
	{ key: 'free', label: 'Free plan or trial', kind: 'mark', good: ['Everything'], bad: ['None'] },
	{ key: 'account', label: 'Account', kind: 'mark', good: ['None'], bad: ['Required'] },
	{ key: 'platforms', label: 'Runs on', kind: 'platforms' },
	{ key: 'where', label: 'Where it works', kind: 'mark', good: ['On device'], bad: ['Cloud'] },
	{
		key: 'zoom',
		label: 'Automatic zoom',
		kind: 'mark',
		good: ['Clicks, typing', 'Clicks', 'Automatic'],
		bad: ['None', 'Coming soon'],
	},
	{ key: 'screenshots', label: 'Screenshots', kind: 'mark', good: ['Yes'], bad: ['No'] },
	{ key: 'links', label: 'Share links', kind: 'mark', good: ['Included'], bad: ['None'] },
	{ key: 'source', label: 'Source code', kind: 'mark', good: ['Open'], bad: ['Closed'] },
	{ key: 'support', label: 'Support', kind: 'mark' },
	{ key: 'since', label: 'First release', kind: 'year' },
];

// The platforms a recorder can run on; the page draws a glyph for each.
export type Platform = 'macOS' | 'Windows' | 'Linux' | 'Chrome' | 'iOS' | 'Android';

type Fact = Readonly<{ value: string | readonly Platform[]; note?: string; source: string }>;

// The ids of the recorders with a take, so the page asks only for clips that ship: none yet.
export type Filmed = never;

// One way to pay for a recorder to record for work, and what it has cost in all after a number of whole years, in US
// dollars at the prices its price fact links to.
// A plan whose price is worked out or may change says so in `fine`, the line a cost chart prints under it.
export type Plan = Readonly<{ how: string; over: (years: number) => number; fine?: string }>;

export type Recorder = Readonly<{
	name: string;
	url: string;
	plans: readonly Plan[];
	facts: Readonly<Record<Key, Fact>>;
}> &
	Readonly<
		| { id: Filmed; take: Readonly<{ version: string; width: number; height: number }> }
		| { id: string; take?: undefined }
	>;

// The recorders the table shows until a visitor picks others: Grip and four more, one a column. The rest are a press
// away, and in the page all along.
export const SHOWN: readonly string[] = ['grip', 'cap', 'cleanshot', 'loom', 'screen-studio'];

// A visitor's pick lives in the page's address, ?compare=grip+cap, so a comparison can be shared. A name that is no
// recorder is dropped, and the pick the page starts with leaves the address clean.
export function compared(search: string): readonly string[] {
	const ids = new URLSearchParams(search).get('compare')?.split(' ') ?? [];
	const known = RECORDERS.filter(({ id }) => ids.includes(id)).map(({ id }) => id);
	return known.length ? known : SHOWN;
}

export function compare(shown: ReadonlySet<string>, search: string): string {
	const params = new URLSearchParams(search);
	if (shown.size === SHOWN.length && SHOWN.every((id) => shown.has(id))) params.delete('compare');
	else params.set('compare', RECORDERS.filter(({ id }) => shown.has(id)).map(({ id }) => id).join(' '));
	return params.size ? `?${params}` : '';
}

// Spelled out, not taken from links.ts, so the site's tests can read this file without SvelteKit.
const GITHUB_URL = 'https://github.com/bestboyhq/grip';
const README = `${GITHUB_URL}#readme`;

export const RECORDERS: readonly Recorder[] = [
	{
		id: 'grip',
		name: 'Grip',
		url: 'https://bestboy.dev/grip',
		plans: [{ how: 'Free and open source', over: () => 0 }],
		facts: {
			price: { value: 'Free', source: README },
			updates: { value: 'Always free', note: 'In the app', source: README },
			source: { value: 'Open', note: 'AGPL-3.0', source: `${GITHUB_URL}/blob/main/LICENSE` },
			since: { value: '2026', source: `${GITHUB_URL}/releases/tag/v0.1.0` },
			platforms: { value: ['macOS'], note: 'macOS 15+, M1 or later', source: README },
			account: { value: 'None', note: 'Sign in to share', source: README },
			free: { value: 'Everything', source: README },
			where: { value: 'On device', source: README },
			links: { value: 'Included', note: '25/mo, 90 days', source: README },
			zoom: { value: 'Clicks, typing', source: README },
			screenshots: { value: 'Yes', note: 'With markup', source: README },
			support: { value: 'GitHub issues', source: `${GITHUB_URL}/issues` },
		},
	},
	{
		id: 'cap',
		name: 'Cap',
		url: 'https://cap.so',
		plans: [
			{ how: '$29 a year', over: (years) => 29 * years },
			{ how: '$58 once', over: () => 58 },
		],
		facts: {
			price: { value: '$29/yr', note: 'Or $58 once', source: 'https://cap.so/pricing' },
			updates: { value: 'Not stated', source: 'https://cap.so/pricing' },
			source: { value: 'Open', note: 'AGPL-3.0, MIT', source: 'https://github.com/CapSoftware/Cap' },
			since: { value: '2024', source: 'https://github.com/CapSoftware/Cap/releases' },
			platforms: {
				value: ['macOS', 'Windows', 'Linux', 'Chrome'],
				note: 'macOS 13.1+',
				source: 'https://cap.so/download',
			},
			account: { value: 'None', note: 'Sign in to share', source: 'https://cap.so/docs/recording/studio-mode' },
			free: { value: 'Personal use', note: '25 links/mo, 5 min each', source: 'https://cap.so/pricing' },
			where: { value: 'On device', note: 'Or live upload', source: 'https://cap.so/docs/recording/studio-mode' },
			links: { value: 'Included', note: '25/mo, 5 min each', source: 'https://cap.so/pricing' },
			zoom: { value: 'On request', note: 'In the editor, from clicks', source: 'https://cap.so/docs/recording/studio-mode' },
			screenshots: { value: 'Yes', note: 'With backgrounds, markup', source: 'https://cap.so/' },
			support: { value: 'Discord', note: 'Or email, GitHub\u00a0issues', source: 'https://cap.so/support' },
		},
	},
	{
		id: 'cleanshot',
		name: 'CleanShot X',
		url: 'https://cleanshot.com',
		plans: [
			{ how: '$35 once, then $19 a year for updates', over: (years) => 35 + 19 * (years - 1) },
			{ how: '$35 once, with one year of updates', over: () => 35 },
		],
		facts: {
			price: { value: '$35 once', note: 'Then $19/yr for updates', source: 'https://cleanshot.com/pricing' },
			updates: {
				value: '1 year',
				note: 'Then $19/yr, or keep the last version',
				source: 'https://cleanshot.com/why-updates-expire',
			},
			source: { value: 'Closed', source: 'https://cleanshot.com/eula' },
			since: { value: '2018', source: 'https://cleanshot.com/changelog' },
			platforms: { value: ['macOS'], note: 'macOS 13+', source: 'https://cleanshot.com/pricing' },
			account: { value: 'None', source: 'https://cleanshot.com/faq' },
			free: { value: 'None', note: 'Money back in 30 days', source: 'https://cleanshot.com/pricing' },
			where: { value: 'On device', source: 'https://cleanshot.com/faq' },
			links: { value: 'Included', note: '1 GB storage', source: 'https://cleanshot.com/pricing' },
			zoom: { value: 'Automatic', note: 'Follows the cursor', source: 'https://cleanshot.com/' },
			screenshots: { value: 'Yes', note: 'With markup, scrolling', source: 'https://cleanshot.com/' },
			support: { value: 'Email', source: 'https://cleanshot.com/contact' },
		},
	},
	{
		id: 'focusee',
		name: 'FocuSee',
		url: 'https://focusee.ai',
		plans: [
			{ how: '$19.99 a month', over: (years) => 19.99 * 12 * years },
			{ how: '$49.99 a year', over: (years) => 49.99 * years },
			{ how: '$199.99 once, for version 2', over: () => 199.99 },
		],
		facts: {
			price: {
				value: '$19.99/mo',
				note: 'Or $49.99/yr, $199.99 for v2',
				source: 'https://focusee.ai/pricing.htm',
			},
			updates: { value: 'While subscribed', note: 'Once: version 2 only', source: 'https://focusee.ai/pricing.htm' },
			source: { value: 'Closed', source: 'https://www.imobie.com/company/end-user-license-agreement.htm' },
			since: { value: '2023', source: 'https://focusee.ai/news/focusee-v2-release.htm' },
			platforms: { value: ['macOS', 'Windows'], note: 'macOS 10.15+', source: 'https://focusee.ai/specs.htm' },
			account: { value: 'Required', note: 'To activate', source: 'https://focusee.ai/guide/activate-the-software.htm' },
			free: { value: 'Trial', note: 'One export, watermarked', source: 'https://focusee.ai/faq/presales-and-billing.htm' },
			where: { value: 'On device', source: 'https://focusee.ai/faq/product-inquiries.htm' },
			links: {
				value: 'Included',
				note: '5 GB storage',
				source: 'https://focusee.ai/news/focusee-2025-june-and-july-update.htm',
			},
			zoom: { value: 'Clicks, typing', source: 'https://focusee.ai/' },
			screenshots: { value: 'No', source: 'https://focusee.ai/guide/export-video.htm' },
			support: { value: 'Live chat', note: 'Or email', source: 'https://focusee.ai/pricing.htm' },
		},
	},
	{
		id: 'kap',
		name: 'Kap',
		url: 'https://getkap.co',
		plans: [{ how: 'Free and open source', over: () => 0 }],
		facts: {
			price: { value: 'Free', source: 'https://github.com/wulkano/Kap/blob/main/LICENSE.md' },
			updates: {
				value: 'Last in 2022',
				note: 'v3.6.0, October 27',
				source: 'https://github.com/wulkano/Kap/releases',
			},
			source: { value: 'Open', note: 'MIT', source: 'https://github.com/wulkano/Kap' },
			since: { value: '2016', source: 'https://github.com/wulkano/Kap/releases/tag/v0.1.0' },
			platforms: { value: ['macOS'], note: 'macOS 12+', source: 'https://getkap.co/' },
			account: { value: 'Not stated', source: 'https://getkap.co/' },
			free: { value: 'Everything', source: 'https://github.com/wulkano/Kap/blob/main/LICENSE.md' },
			where: { value: 'On device', note: 'Exports GIF, MP4, WebM, APNG', source: 'https://getkap.co/' },
			links: { value: 'Plugins', note: 'Giphy, Streamable', source: 'https://getkap.co/' },
			zoom: { value: 'Not stated', source: 'https://getkap.co/' },
			screenshots: { value: 'Not stated', source: 'https://getkap.co/' },
			support: { value: 'GitHub issues', source: 'https://github.com/wulkano/Kap/issues' },
		},
	},
	{
		id: 'loom',
		name: 'Loom',
		url: 'https://www.loom.com',
		plans: [
			{ how: '$18 a month', over: (years) => 18 * 12 * years },
			{
				how: 'About $15 a month, paid yearly',
				over: (years) => 18 * 12 * 0.83 * years,
				fine: 'Loom publishes no yearly price, only “save 17% if you pay annually”, so its yearly bar is $18 a month less 17%.',
			},
		],
		facts: {
			price: { value: '$18/mo', note: '17% less paid yearly', source: 'https://www.loom.com/pricing' },
			updates: { value: 'Not stated', source: 'https://www.loom.com/pricing' },
			source: { value: 'Closed', source: 'https://www.atlassian.com/legal/atlassian-customer-agreement' },
			since: { value: '2016', source: 'https://en.wikipedia.org/wiki/Loom,_Inc.' },
			platforms: {
				value: ['macOS', 'Windows', 'Chrome', 'iOS', 'Android'],
				note: 'macOS 15+',
				source: 'https://support.atlassian.com/loom/docs/loom-device-compatibility/',
			},
			account: { value: 'Required', note: 'To record', source: 'https://www.atlassian.com/software/loom/screen-recorder' },
			free: { value: '25 videos', note: '5 min each, branded', source: 'https://www.loom.com/pricing' },
			where: { value: 'Cloud', source: 'https://www.atlassian.com/software/loom/screen-recorder' },
			links: { value: 'Included', source: 'https://www.atlassian.com/software/loom/screen-recorder' },
			zoom: { value: 'Coming soon', source: 'https://www.atlassian.com/software/loom/editing' },
			screenshots: { value: 'Yes', note: 'With markup', source: 'https://www.atlassian.com/software/loom/screenshot' },
			support: { value: 'Priority on paid', note: 'Or community forum', source: 'https://www.loom.com/pricing' },
		},
	},
	{
		id: 'obs',
		name: 'OBS Studio',
		url: 'https://obsproject.com',
		plans: [{ how: 'Free and open source', over: () => 0 }],
		facts: {
			price: { value: 'Free', source: 'https://obsproject.com/' },
			updates: { value: 'Always free', source: 'https://obsproject.com/' },
			source: { value: 'Open', note: 'GPL-2.0', source: 'https://github.com/obsproject/obs-studio' },
			since: { value: '2012', source: 'https://en.wikipedia.org/wiki/OBS_Studio' },
			platforms: {
				value: ['macOS', 'Windows', 'Linux'],
				note: 'macOS 13+, Intel or Apple silicon',
				source: 'https://obsproject.com/download',
			},
			account: { value: 'Not stated', source: 'https://obsproject.com/' },
			free: { value: 'Everything', source: 'https://obsproject.com/' },
			where: {
				value: 'On device',
				note: 'Or streams live',
				source: 'https://obsproject.com/kb/standard-recording-output-guide',
			},
			links: { value: 'Not stated', source: 'https://obsproject.com/' },
			zoom: { value: 'Not stated', source: 'https://obsproject.com/' },
			screenshots: {
				value: 'Yes',
				note: 'Of scenes and sources',
				source: 'https://github.com/obsproject/obs-studio/releases/tag/26.0.0',
			},
			support: { value: 'Forums', note: 'Or Discord, knowledge base', source: 'https://obsproject.com/help' },
		},
	},
	{
		id: 'openscreen',
		name: 'OpenScreen',
		url: 'https://getopenscreen.com',
		plans: [{ how: 'Free and open source', over: () => 0 }],
		facts: {
			price: { value: 'Free', source: 'https://getopenscreen.com/docs/faq/' },
			updates: { value: 'Always free', note: 'In the app', source: 'https://getopenscreen.com/docs/faq/' },
			source: { value: 'Open', note: 'MIT', source: 'https://github.com/getopenscreen/openscreen' },
			since: { value: '2025', source: 'https://github.com/siddharthvaddem/openscreen/releases' },
			platforms: {
				value: ['macOS', 'Windows', 'Linux'],
				note: 'macOS 13+',
				source: 'https://getopenscreen.com/docs/installation/',
			},
			account: { value: 'None', source: 'https://getopenscreen.com/docs/faq/' },
			free: { value: 'Everything', source: 'https://getopenscreen.com/' },
			where: { value: 'On device', source: 'https://getopenscreen.com/docs/faq/' },
			links: { value: 'None', source: 'https://getopenscreen.com/docs/faq/' },
			zoom: { value: 'Clicks', source: 'https://getopenscreen.com/features/auto-zoom/' },
			screenshots: { value: 'No', source: 'https://getopenscreen.com/' },
			support: { value: 'GitHub issues', note: 'Or Discord', source: 'https://getopenscreen.com/docs/faq/' },
		},
	},
	{
		id: 'quicktime',
		name: 'QuickTime',
		url: 'https://support.apple.com/guide/quicktime-player/welcome/mac',
		plans: [{ how: 'Free with macOS', over: () => 0 }],
		facts: {
			price: { value: 'Free', source: 'https://support.apple.com/en-us/106391' },
			updates: { value: 'With macOS', note: 'In macOS updates', source: 'https://support.apple.com/en-us/108382' },
			source: { value: 'Closed', source: 'https://www.apple.com/legal/sla/' },
			since: { value: '1991', source: 'https://en.wikipedia.org/wiki/QuickTime' },
			platforms: {
				value: ['macOS'],
				note: 'Comes with macOS',
				source: 'https://support.apple.com/en-us/106391',
			},
			account: { value: 'None', source: 'https://support.apple.com/en-us/102618' },
			free: { value: 'Everything', source: 'https://support.apple.com/en-us/106391' },
			where: { value: 'On device', source: 'https://support.apple.com/en-us/102618' },
			links: {
				value: 'None',
				source: 'https://support.apple.com/guide/quicktime-player/share-your-movies-qtp1ad6fa3c1/mac',
			},
			zoom: {
				value: 'None',
				source: 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac',
			},
			screenshots: { value: 'Yes', note: 'Through Screenshot', source: 'https://support.apple.com/en-us/102618' },
			support: { value: 'Apple Support', note: 'Chat or phone', source: 'https://support.apple.com/contact' },
		},
	},
	{
		id: 'recordly',
		name: 'Recordly',
		url: 'https://recordly.dev',
		plans: [
			{
				how: '$9 a month, early bird price',
				over: (years) => 9 * 12 * years,
				fine: 'Recordly’s $9 a month is an early bird price, and no Recordly page says how long it holds.',
			},
			{ how: '$15 a month, regular price', over: (years) => 15 * 12 * years },
		],
		facts: {
			price: {
				value: '$9/mo',
				note: 'Early bird, regular $15/mo',
				source: 'https://videos.recordly.dev/api/billing/catalog',
			},
			updates: { value: 'Not stated', source: 'https://github.com/webadderallorg/Recordly#readme' },
			source: { value: 'Open', note: 'AGPL-3.0', source: 'https://github.com/webadderallorg/Recordly' },
			since: { value: '2026', source: 'https://github.com/webadderallorg/Recordly/releases' },
			platforms: {
				value: ['macOS', 'Windows', 'Linux'],
				note: 'macOS 14+',
				source: 'https://github.com/webadderallorg/Recordly#readme',
			},
			account: {
				value: 'Required',
				note: 'To record',
				source: 'https://github.com/webadderallorg/Recordly/blob/main/docs/authentication.md',
			},
			free: {
				value: 'Personal use',
				note: '5 cloud links, 1 GB each',
				source: 'https://github.com/webadderallorg/Recordly/blob/main/src/i18n/locales/en/billing.json',
			},
			where: { value: 'On device', source: 'https://videos.recordly.dev/privacy' },
			links: { value: 'Included', note: 'Up to 10 GB each', source: 'https://videos.recordly.dev/api/billing/catalog' },
			zoom: {
				value: 'Suggested',
				note: 'From the cursor, in the editor',
				source: 'https://github.com/webadderallorg/Recordly#readme',
			},
			screenshots: { value: 'No', source: 'https://github.com/webadderallorg/Recordly#readme' },
			support: {
				value: 'GitHub issues',
				note: 'Or Discord',
				source: 'https://recordly.dev',
			},
		},
	},
	{
		id: 'screen-studio',
		name: 'Screen Studio',
		url: 'https://screen.studio',
		plans: [
			{ how: '$29 a month', over: (years) => 29 * 12 * years },
			{ how: '$108 a year', over: (years) => 108 * years },
		],
		facts: {
			price: { value: '$29/mo', note: 'Or $108/yr', source: 'https://screen.studio/pricing' },
			updates: { value: 'While subscribed', source: 'https://screen.studio/pricing' },
			source: { value: 'Closed', source: 'https://screen.studio/legal/terms-of-service' },
			since: { value: '2022', source: 'https://www.producthunt.com/products/screen-studio' },
			platforms: { value: ['macOS'], note: 'macOS 13.1+', source: 'https://screen.studio/download' },
			account: {
				value: 'Email code',
				note: 'To activate; legacy by key',
				source: 'https://screen.studio/guide/activating-screen-studio',
			},
			free: { value: 'Trial', note: 'Everything but export', source: 'https://screen.studio/download' },
			where: { value: 'On device', source: 'https://screen.studio/' },
			links: { value: 'Included', note: 'Up to 30 min each', source: 'https://screen.studio/guide/shareable-links' },
			zoom: { value: 'Clicks', source: 'https://screen.studio/' },
			screenshots: {
				value: 'No',
				note: 'Copies a video frame',
				source: 'https://screen.studio/guide/copy-current-frame-as-an-image',
			},
			support: { value: 'Email', note: 'Or Telegram group', source: 'https://screen.studio/guide' },
		},
	},
];

// What people search a recorder by, each worked out from the facts and the plans above, so no group names a
// recorder by hand: the benchmark's quick picks and the guides that answer one question share them. A recorder is
// free when one of its plans costs nothing, and it needs no subscription when one of its plans costs no more after
// five years than after one.
const good = (row: Key, value: Fact['value']): boolean =>
	typeof value === 'string' && FACTS.some((fact) => fact.key === row && fact.good?.includes(value));
export const GROUPS: readonly Readonly<{ id: string; label: string; has: (recorder: Recorder) => boolean }>[] = [
	{ id: 'open-source', label: 'Open source', has: ({ facts }) => good('source', facts.source.value) },
	{ id: 'free', label: 'Free for work', has: ({ plans }) => plans.some(({ over }) => over(5) === 0) },
	{
		id: 'no-subscription',
		label: 'No subscription',
		has: ({ plans }) => plans.some(({ over }) => over(5) === over(1)),
	},
	{ id: 'no-account', label: 'No account', has: ({ facts }) => good('account', facts.account.value) },
	{ id: 'zoom', label: 'Automatic zoom', has: ({ facts }) => good('zoom', facts.zoom.value) },
];
