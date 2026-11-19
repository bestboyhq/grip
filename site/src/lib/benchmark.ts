// The benchmark at /benchmark: the recorders it compares, Grip first and the rest by name, and for each one public
// fact per column, as its maker states it, with the page it was read from. Check every fact against its source again
// before changing CHECKED. A recorder gets its `take` once its recording of scripts/benchmark/take.swift is encoded
// into `static/media/benchmark-<id>.mp4` (media.sh), with the version that made it and the clip's size.
// Read a recorder's license before filming with it: FocuSee's lets a licensee publish nothing about it without
// written consent, and Loom's lets no one publish a comparison made on its free plan, so neither has a take.
// Recordly's own download asks for a Cloud subscription for any commercial use, a take included.
export const CHECKED = '2026-11-19';
// How long take.swift runs.
export const SECONDS = 15;

// The columns, one fact each, and how its cells show it, the same way in every row: a price leads with its
// headline, a mark is a short answer after a dot, green on the answers in `good`, red on those in `bad`, and gray on
// the rest, a year is set in mono, and platforms stand one a line, each after its glyph.
// A value stays a few words. A note says only what its value leaves out, and a column's notes all say the same kind
// of thing: a price's the other ways to pay, a platform's the macOS it needs, a license's name, an account's what it
// is needed for, share links' limits, screenshots' extras, support's the other ways to reach the maker. A value that
// says it all has no note.
// The price is what recording for work costs with no limits, since most recordings are made for work: a free plan
// that is only for personal use, or that caps the videos, is in its own column.
type Key =
	| 'price'
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
	{ key: 'source', label: 'Source code', kind: 'mark', good: ['Open'], bad: ['Closed'] },
	{ key: 'since', label: 'First release', kind: 'year' },
	{ key: 'platforms', label: 'Runs on', kind: 'platforms' },
	{ key: 'account', label: 'Account', kind: 'mark', good: ['None'], bad: ['Required'] },
	{ key: 'free', label: 'Free plan or trial', kind: 'mark', good: ['Everything'], bad: ['None'] },
	{ key: 'where', label: 'Where it works', kind: 'mark', good: ['On device'], bad: ['Cloud'] },
	{ key: 'links', label: 'Share links', kind: 'mark', good: ['Included'], bad: ['None'] },
	{
		key: 'zoom',
		label: 'Automatic zoom',
		kind: 'mark',
		good: ['Clicks, typing', 'Clicks'],
		bad: ['None', 'Coming soon'],
	},
	{ key: 'screenshots', label: 'Screenshots', kind: 'mark', good: ['Yes'], bad: ['No'] },
	{ key: 'support', label: 'Support', kind: 'mark', bad: ['Paid plans only'] },
];

// The platforms a recorder can run on; the page draws a glyph for each.
export type Platform = 'macOS' | 'Windows' | 'Linux' | 'Chrome' | 'iOS' | 'Android';

type Fact = Readonly<{ value: string | readonly Platform[]; note?: string; source: string }>;

// The ids of the recorders with a take, so the page asks only for clips that ship: none yet.
export type Filmed = never;

export type Recorder = Readonly<{
	name: string;
	url: string;
	facts: Readonly<Record<Key, Fact>>;
}> &
	Readonly<
		| { id: Filmed; take: Readonly<{ version: string; width: number; height: number }> }
		| { id: string; take?: undefined }
	>;

// Spelled out, not taken from links.ts, so the site's tests can read this file without SvelteKit.
const GITHUB_URL = 'https://github.com/bestboyhq/grip';
const README = `${GITHUB_URL}#readme`;

export const RECORDERS: readonly Recorder[] = [
	{
		id: 'grip',
		name: 'Grip',
		url: 'https://bestboy.dev/grip',
		facts: {
			price: { value: 'Free', source: README },
			source: { value: 'Open', note: 'AGPL-3.0', source: `${GITHUB_URL}/blob/main/LICENSE` },
			since: { value: '2026', source: `${GITHUB_URL}/releases/tag/v0.1.0` },
			platforms: { value: ['macOS'], note: 'macOS 15+, M1 or later', source: README },
			account: { value: 'None', source: README },
			free: { value: 'Everything', source: README },
			where: { value: 'On device', source: README },
			links: { value: 'Included', source: README },
			zoom: { value: 'Clicks, typing', source: README },
			screenshots: { value: 'Yes', note: 'With markup', source: README },
			support: { value: 'GitHub issues', source: `${GITHUB_URL}/issues` },
		},
	},
	{
		id: 'cap',
		name: 'Cap',
		url: 'https://cap.so',
		facts: {
			price: { value: '$29/yr', note: 'Or $58 once', source: 'https://cap.so/pricing' },
			source: { value: 'Open', note: 'AGPL-3.0, MIT', source: 'https://github.com/CapSoftware/Cap' },
			since: { value: '2024', source: 'https://github.com/CapSoftware/Cap/releases' },
			platforms: {
				value: ['macOS', 'Windows', 'Linux', 'Chrome'],
				note: 'macOS 13.1+',
				source: 'https://cap.so/download',
			},
			account: { value: 'None', source: 'https://cap.so/docs/recording/studio-mode' },
			free: { value: 'Personal use', note: '25 links/mo, 5 min each', source: 'https://cap.so/pricing' },
			where: { value: 'On device', note: 'Or live upload', source: 'https://cap.so/docs/recording/studio-mode' },
			links: { value: 'Included', note: '25/mo, 5 min each', source: 'https://cap.so/pricing' },
			zoom: { value: 'On request', note: 'From clicks, in the editor', source: 'https://cap.so/docs/recording/studio-mode' },
			screenshots: { value: 'Yes', note: 'With backgrounds', source: 'https://cap.so/' },
			support: { value: 'Discord', note: 'Or email, GitHub\u00a0issues', source: 'https://cap.so/support' },
		},
	},
	{
		id: 'cleanshot',
		name: 'CleanShot X',
		url: 'https://cleanshot.com',
		facts: {
			price: { value: '$35 once', note: 'Then $19/yr for updates', source: 'https://cleanshot.com/pricing' },
			source: { value: 'Closed', source: 'https://cleanshot.com/eula' },
			since: { value: '2018', source: 'https://cleanshot.com/changelog' },
			platforms: { value: ['macOS'], note: 'macOS 13+', source: 'https://cleanshot.com/pricing' },
			account: { value: 'None', source: 'https://cleanshot.com/faq' },
			free: { value: 'None', note: 'Money back in 30 days', source: 'https://cleanshot.com/pricing' },
			where: { value: 'On device', source: 'https://cleanshot.com/features' },
			links: { value: 'Included', note: '1 GB storage', source: 'https://cleanshot.com/pricing' },
			zoom: { value: 'Manual', note: 'They follow the cursor', source: 'https://cleanshot.com/features' },
			screenshots: { value: 'Yes', note: 'With markup, scrolling', source: 'https://cleanshot.com/' },
			support: { value: 'Email', source: 'https://cleanshot.com/contact' },
		},
	},
	{
		id: 'focusee',
		name: 'FocuSee',
		url: 'https://focusee.ai',
		facts: {
			price: {
				value: '$19.99/mo',
				note: 'Or $49.99/yr, $199.99 once',
				source: 'https://focusee.ai/pricing.htm',
			},
			source: { value: 'Closed', source: 'https://www.imobie.com/company/end-user-license-agreement.htm' },
			since: { value: '2023', source: 'https://focusee.ai/news/focusee-v2-release.htm' },
			platforms: { value: ['macOS', 'Windows'], note: 'macOS 10.15+', source: 'https://focusee.ai/specs.htm' },
			account: { value: 'Required', note: 'To activate', source: 'https://focusee.ai/guide/activate-the-software.htm' },
			free: { value: 'Trial', note: 'One export, watermarked', source: 'https://focusee.ai/faq/presales-and-billing.htm' },
			where: { value: 'On device', source: 'https://focusee.ai/pricing.htm' },
			links: { value: 'Included', note: '5 GB storage', source: 'https://focusee.ai/pricing.htm' },
			zoom: { value: 'Clicks, typing', source: 'https://focusee.ai/' },
			screenshots: { value: 'No', source: 'https://focusee.ai/guide/export-video.htm' },
			support: { value: 'Live chat', note: 'Or email', source: 'https://focusee.ai/pricing.htm' },
		},
	},
	{
		id: 'loom',
		name: 'Loom',
		url: 'https://www.loom.com',
		facts: {
			price: { value: '$18/mo', note: '17% less paid yearly', source: 'https://www.loom.com/pricing' },
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
			links: { value: 'Included', source: 'https://www.loom.com/pricing' },
			zoom: { value: 'Coming soon', source: 'https://www.atlassian.com/software/loom/editing' },
			screenshots: { value: 'Yes', note: 'With markup', source: 'https://www.atlassian.com/software/loom/screenshot' },
			support: {
				value: 'Paid plans only',
				note: 'Or community forum',
				source: 'https://www.atlassian.com/enterprise/support-services',
			},
		},
	},
	{
		id: 'openscreen',
		name: 'OpenScreen',
		url: 'https://getopenscreen.com',
		facts: {
			price: { value: 'Free', source: 'https://getopenscreen.com/docs/faq/' },
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
		facts: {
			price: { value: 'Free', source: 'https://support.apple.com/guide/quicktime-player/welcome/mac' },
			source: { value: 'Closed', source: 'https://www.apple.com/legal/sla/' },
			since: { value: '1991', source: 'https://en.wikipedia.org/wiki/QuickTime' },
			platforms: {
				value: ['macOS'],
				note: 'Comes with macOS',
				source: 'https://support.apple.com/guide/quicktime-player/welcome/mac',
			},
			account: { value: 'None', source: 'https://support.apple.com/en-us/102618' },
			free: { value: 'Everything', source: 'https://support.apple.com/en-us/102618' },
			where: { value: 'On device', source: 'https://support.apple.com/en-us/102618' },
			links: {
				value: 'None',
				source: 'https://support.apple.com/guide/quicktime-player/share-your-movies-qtp1ad6fa3c1/mac',
			},
			zoom: {
				value: 'None',
				source: 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac',
			},
			screenshots: {
				value: 'No',
				source: 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac',
			},
			support: { value: 'Apple Support', note: 'Chat or phone', source: 'https://support.apple.com/contact' },
		},
	},
	{
		id: 'recordly',
		name: 'Recordly',
		url: 'https://recordly.dev',
		facts: {
			price: {
				value: '$9/mo',
				note: 'Early bird, regular $15/mo',
				source: 'https://videos.recordly.dev/api/billing/catalog',
			},
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
				note: 'Or Discord, email',
				source: 'https://github.com/webadderallorg/Recordly#readme',
			},
		},
	},
	{
		id: 'screen-studio',
		name: 'Screen Studio',
		url: 'https://screen.studio',
		facts: {
			price: { value: '$29/mo', note: 'Or $108/yr', source: 'https://screen.studio/pricing' },
			source: { value: 'Closed', source: 'https://screen.studio/legal/terms-of-service' },
			since: { value: '2022', source: 'https://www.producthunt.com/products/screen-studio' },
			platforms: { value: ['macOS'], note: 'macOS 13.1+', source: 'https://screen.studio/download' },
			account: {
				value: 'Required',
				note: 'To activate',
				source: 'https://screen.studio/guide/activating-screen-studio',
			},
			free: { value: 'Trial', note: 'Everything but export', source: 'https://screen.studio/download' },
			where: { value: 'On device', source: 'https://screen.studio/guide/exporting-the-video' },
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
