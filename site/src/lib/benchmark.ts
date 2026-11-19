// The benchmark at /benchmark: the recorders it compares, Grip first and the rest by name, and for each one public
// fact per column, as its maker states it, with the page it was read from. Check every fact against its source again
// before changing CHECKED. A recorder gets its `take` once its recording of scripts/benchmark/take.swift is encoded
// into `static/media/benchmark-<id>.mp4` (media.sh), with the version that made it and the clip's size.
// Read a recorder's license before filming with it: FocuSee's lets a licensee publish nothing about it without
// written consent, and Loom's lets no one publish a comparison made on its free plan, so neither has a take.
export const CHECKED = '2026-11-19';
// How long take.swift runs.
export const SECONDS = 15;

export const FACTS = [
	['price', 'Price'],
	['source', 'Source code'],
	['since', 'First release'],
	['platforms', 'Runs on'],
	['account', 'Account'],
	['free', 'Free plan or trial'],
	['where', 'Where it works'],
	['zoom', 'Automatic zoom'],
] as const;

type Fact = readonly [text: string, source: string];

// The ids of the recorders with a take, so the page asks only for clips that ship: none yet.
export type Filmed = never;

export type Recorder = Readonly<{
	name: string;
	url: string;
	facts: Readonly<Record<(typeof FACTS)[number][0], Fact>>;
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
			price: ['Free', README],
			source: ['Open, AGPL-3.0', `${GITHUB_URL}/blob/main/LICENSE`],
			since: ['2026', `${GITHUB_URL}/releases/tag/v0.1.0`],
			platforms: ['macOS 15 or later, Apple silicon', README],
			account: ['None to record or export. One to share a link.', README],
			free: ['Everything, with no watermark', README],
			where: ['On your Mac. A share link uploads the video.', README],
			zoom: ['On clicks and typing', README],
		},
	},
	{
		id: 'cap',
		name: 'Cap',
		url: 'https://cap.so',
		facts: {
			price: [
				'Free for personal use. For work, $58 once or $29 a year. Pro is $8.16 a user a month, billed yearly.',
				'https://cap.so/pricing',
			],
			source: ['Open, AGPL-3.0 with MIT parts', 'https://github.com/CapSoftware/Cap'],
			since: ['2024', 'https://github.com/CapSoftware/Cap/releases'],
			platforms: ['macOS, Windows, Linux, Chrome', 'https://cap.so/download'],
			account: ['One to share a link', 'https://cap.so/docs/recording/studio-mode'],
			free: ['No time limit on local recordings. 25 share links a month, 5 minutes each.', 'https://cap.so/pricing'],
			where: [
				'On your computer in Studio Mode. Instant Mode uploads as it records.',
				'https://cap.so/docs/recording/studio-mode',
			],
			zoom: ['On clicks, when you ask for it in the editor', 'https://cap.so/docs/recording/studio-mode'],
		},
	},
	{
		id: 'cleanshot',
		name: 'CleanShot X',
		url: 'https://cleanshot.com',
		facts: {
			price: [
				'$35 once, with a year of updates. Pro is $10 a user a month, billed yearly.',
				'https://cleanshot.com/pricing',
			],
			source: ['Closed', 'https://cleanshot.com/eula'],
			since: ['2018', 'https://cleanshot.com/changelog'],
			platforms: ['macOS 13 or later', 'https://cleanshot.com/pricing'],
			account: ['An email or a license key to download it', 'https://licenses.cleanshot.com/download/cleanshotx'],
			free: ['No trial. Money back within 30 days.', 'https://cleanshot.com/pricing'],
			where: ['Records an MP4 or a GIF. A cloud upload is optional.', 'https://cleanshot.com/features'],
			zoom: ['Follows the cursor', 'https://cleanshot.com/features'],
		},
	},
	{
		id: 'focusee',
		name: 'FocuSee',
		url: 'https://focusee.ai',
		facts: {
			price: ['$49.99 a year or $19.99 a month. $199.99 once for version 2.', 'https://focusee.ai/pricing.htm'],
			source: ['Closed', 'https://www.imobie.com/company/end-user-license-agreement.htm'],
			since: ['2023', 'https://focusee.ai/news/focusee-v2-release.htm'],
			platforms: ['macOS 10.15 or later, Windows 10 or later', 'https://focusee.ai/specs.htm'],
			account: ['Not stated on its site', 'https://focusee.ai/faq/presales-and-billing.htm'],
			free: ['A trial with one export, watermarked', 'https://focusee.ai/faq/presales-and-billing.htm'],
			where: ['A desktop app, with 5 GB of cloud storage to share from', 'https://focusee.ai/pricing.htm'],
			zoom: ['On clicks and typing', 'https://focusee.ai/'],
		},
	},
	{
		id: 'loom',
		name: 'Loom',
		url: 'https://www.loom.com',
		facts: {
			price: ['A free plan. Business is $18 a user a month.', 'https://www.loom.com/pricing'],
			source: ['Closed', 'https://www.atlassian.com/legal/atlassian-customer-agreement'],
			since: ['2016', 'https://en.wikipedia.org/wiki/Loom,_Inc.'],
			platforms: [
				'macOS, Windows, Chrome, iOS, Android',
				'https://support.atlassian.com/loom/docs/loom-device-compatibility/',
			],
			account: ['Required', 'https://www.atlassian.com/software/loom/screen-recorder'],
			free: ['25 videos, 5 minutes each, with Loom branding', 'https://www.loom.com/pricing'],
			where: [
				'In the cloud: each recording uploads to your account.',
				'https://www.atlassian.com/software/loom/screen-recorder',
			],
			zoom: ['Listed as coming soon', 'https://www.atlassian.com/software/loom/editing'],
		},
	},
	{
		id: 'quicktime',
		name: 'QuickTime',
		url: 'https://support.apple.com/guide/quicktime-player/welcome/mac',
		facts: {
			price: ['Comes with macOS', 'https://support.apple.com/guide/quicktime-player/welcome/mac'],
			source: ['Closed', 'https://www.apple.com/legal/sla/'],
			since: ['1991', 'https://en.wikipedia.org/wiki/QuickTime'],
			platforms: ['macOS', 'https://support.apple.com/guide/quicktime-player/welcome/mac'],
			account: ['None', 'https://support.apple.com/en-us/102618'],
			free: ['No limit, no watermark', 'https://support.apple.com/en-us/102618'],
			where: ['On your Mac', 'https://support.apple.com/en-us/102618'],
			zoom: ['None', 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac'],
		},
	},
	{
		id: 'screen-studio',
		name: 'Screen Studio',
		url: 'https://screen.studio',
		facts: {
			price: ['$9 a month billed yearly, or $29 a month', 'https://screen.studio/pricing'],
			source: ['Closed', 'https://screen.studio/legal/terms-of-service'],
			since: ['2022', 'https://www.producthunt.com/products/screen-studio'],
			platforms: ['macOS', 'https://screen.studio/'],
			account: ['A code sent to your email activates it', 'https://screen.studio/guide/activating-screen-studio'],
			free: ['No free plan. Without a plan, everything works but export.', 'https://screen.studio/download'],
			where: [
				'Exports a file on your Mac. Share links are hosted.',
				'https://screen.studio/guide/exporting-the-video',
			],
			zoom: ['On clicks', 'https://screen.studio/'],
		},
	},
];
