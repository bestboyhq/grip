// The benchmark at /benchmark: the recorders it compares, Grip first and the rest by name, and for each one public
// fact per column, as its maker states it, with the page it was read from. Check every fact against its source again
// before changing CHECKED. A recorder gets its `take` once its recording of scripts/benchmark/take.swift is encoded
// into `static/media/benchmark-<id>.mp4` (media.sh), with the version that made it and the clip's size.
// Read a recorder's license before filming with it: FocuSee's lets a licensee publish nothing about it without
// written consent, and Loom's lets no one publish a comparison made on its free plan, so neither has a take.
export const CHECKED = '2026-11-19';
// How long take.swift runs.
export const SECONDS = 15;

// The columns, one fact each, and how its cells show it, the same way in every row: a price leads with its
// headline, a mark is a short answer after a dot that turns green on the answers in `good`, a year is set in mono,
// and chips list platforms. A value stays a few words; the rest goes in its note.
type Key = 'price' | 'source' | 'since' | 'platforms' | 'account' | 'free' | 'where' | 'zoom';
export const FACTS: readonly Readonly<{
	key: Key;
	label: string;
	kind: 'price' | 'mark' | 'year' | 'chips';
	good?: readonly string[];
}>[] = [
	{ key: 'price', label: 'Price', kind: 'price' },
	{ key: 'source', label: 'Source code', kind: 'mark', good: ['Open'] },
	{ key: 'since', label: 'First release', kind: 'year' },
	{ key: 'platforms', label: 'Runs on', kind: 'chips' },
	{ key: 'account', label: 'Account', kind: 'mark', good: ['None', 'Only to share'] },
	{ key: 'free', label: 'Free plan or trial', kind: 'mark', good: ['Everything'] },
	{ key: 'where', label: 'Where it works', kind: 'mark', good: ['On device'] },
	{ key: 'zoom', label: 'Automatic zoom', kind: 'mark', good: ['Clicks and typing', 'Clicks'] },
];

type Fact = Readonly<{ value: string | readonly string[]; note?: string; source: string }>;

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
			platforms: { value: ['macOS'], note: 'macOS 15+, Apple\u00a0silicon', source: README },
			account: { value: 'Only to share', note: 'None to record or export', source: README },
			free: { value: 'Everything', note: 'No watermark', source: README },
			where: { value: 'On device', note: 'Share links upload', source: README },
			zoom: { value: 'Clicks and typing', source: README },
		},
	},
	{
		id: 'cap',
		name: 'Cap',
		url: 'https://cap.so',
		facts: {
			price: {
				value: 'Free',
				note: 'For work: $29/yr or $58 once',
				source: 'https://cap.so/pricing',
			},
			source: { value: 'Open', note: 'AGPL-3.0, MIT', source: 'https://github.com/CapSoftware/Cap' },
			since: { value: '2024', source: 'https://github.com/CapSoftware/Cap/releases' },
			platforms: { value: ['macOS', 'Windows', 'Linux', 'Chrome'], source: 'https://cap.so/download' },
			account: { value: 'Only to share', source: 'https://cap.so/docs/recording/studio-mode' },
			free: { value: 'Personal use', note: '25 links/mo, 5 min each', source: 'https://cap.so/pricing' },
			where: {
				value: 'On device',
				note: 'Or live upload',
				source: 'https://cap.so/docs/recording/studio-mode',
			},
			zoom: { value: 'On request', note: 'From clicks, in the editor', source: 'https://cap.so/docs/recording/studio-mode' },
		},
	},
	{
		id: 'cleanshot',
		name: 'CleanShot X',
		url: 'https://cleanshot.com',
		facts: {
			price: { value: '$35 once', note: 'With a year of updates', source: 'https://cleanshot.com/pricing' },
			source: { value: 'Closed', source: 'https://cleanshot.com/eula' },
			since: { value: '2018', source: 'https://cleanshot.com/changelog' },
			platforms: { value: ['macOS'], note: 'macOS 13+', source: 'https://cleanshot.com/pricing' },
			account: {
				value: 'To download',
				note: 'An email or a license key',
				source: 'https://licenses.cleanshot.com/download/cleanshotx',
			},
			free: { value: 'None', note: 'Money back in 30 days', source: 'https://cleanshot.com/pricing' },
			where: { value: 'On device', note: 'Optional cloud', source: 'https://cleanshot.com/features' },
			zoom: { value: 'Follows the cursor', source: 'https://cleanshot.com/features' },
		},
	},
	{
		id: 'focusee',
		name: 'FocuSee',
		url: 'https://focusee.ai',
		facts: {
			price: {
				value: '$19.99/mo',
				note: 'Or $49.99/yr, or $199.99 once',
				source: 'https://focusee.ai/pricing.htm',
			},
			source: { value: 'Closed', source: 'https://www.imobie.com/company/end-user-license-agreement.htm' },
			since: { value: '2023', source: 'https://focusee.ai/news/focusee-v2-release.htm' },
			platforms: {
				value: ['macOS', 'Windows'],
				note: 'macOS 10.15+, Windows 10+',
				source: 'https://focusee.ai/specs.htm',
			},
			account: { value: 'Not stated', source: 'https://focusee.ai/faq/presales-and-billing.htm' },
			free: { value: 'Trial', note: 'One export, watermarked', source: 'https://focusee.ai/faq/presales-and-billing.htm' },
			where: { value: 'On device', note: '5 GB cloud to share', source: 'https://focusee.ai/pricing.htm' },
			zoom: { value: 'Clicks and typing', source: 'https://focusee.ai/' },
		},
	},
	{
		id: 'loom',
		name: 'Loom',
		url: 'https://www.loom.com',
		facts: {
			price: { value: 'Free', note: 'Business is $18/user/mo', source: 'https://www.loom.com/pricing' },
			source: { value: 'Closed', source: 'https://www.atlassian.com/legal/atlassian-customer-agreement' },
			since: { value: '2016', source: 'https://en.wikipedia.org/wiki/Loom,_Inc.' },
			platforms: {
				value: ['macOS', 'Windows', 'Chrome', 'iOS', 'Android'],
				source: 'https://support.atlassian.com/loom/docs/loom-device-compatibility/',
			},
			account: { value: 'Required', source: 'https://www.atlassian.com/software/loom/screen-recorder' },
			free: { value: '25 videos', note: '5 min each, branded', source: 'https://www.loom.com/pricing' },
			where: {
				value: 'Cloud',
				note: 'Each video uploads',
				source: 'https://www.atlassian.com/software/loom/screen-recorder',
			},
			zoom: { value: 'Coming soon', source: 'https://www.atlassian.com/software/loom/editing' },
		},
	},
	{
		id: 'quicktime',
		name: 'QuickTime',
		url: 'https://support.apple.com/guide/quicktime-player/welcome/mac',
		facts: {
			price: {
				value: 'Free',
				note: 'Comes with macOS',
				source: 'https://support.apple.com/guide/quicktime-player/welcome/mac',
			},
			source: { value: 'Closed', source: 'https://www.apple.com/legal/sla/' },
			since: { value: '1991', source: 'https://en.wikipedia.org/wiki/QuickTime' },
			platforms: { value: ['macOS'], source: 'https://support.apple.com/guide/quicktime-player/welcome/mac' },
			account: { value: 'None', source: 'https://support.apple.com/en-us/102618' },
			free: { value: 'Everything', note: 'No watermark', source: 'https://support.apple.com/en-us/102618' },
			where: { value: 'On device', source: 'https://support.apple.com/en-us/102618' },
			zoom: {
				value: 'None',
				source: 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac',
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
			platforms: { value: ['macOS'], source: 'https://screen.studio/' },
			account: {
				value: 'To activate',
				note: 'A code sent to your email',
				source: 'https://screen.studio/guide/activating-screen-studio',
			},
			free: { value: 'None', note: 'All but export works', source: 'https://screen.studio/download' },
			where: {
				value: 'On device',
				note: 'Share links upload',
				source: 'https://screen.studio/guide/exporting-the-video',
			},
			zoom: { value: 'Clicks', source: 'https://screen.studio/' },
		},
	},
];
