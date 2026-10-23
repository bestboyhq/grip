import { asset, resolve } from '$app/paths';

export const SITE_URL = 'https://bestboy.dev/grip';
export const SITE_DESCRIPTION =
	'Grip is a free, open source screen recorder for the Mac. It zooms where you click, glides your cursor, and captions your voice, so one take becomes a video worth watching.';

// The DMG's name carries its version, so bestboy.dev looks up the latest release's and redirects to it.
export const DOWNLOAD_URL = 'https://bestboy.dev/download/grip';
export const GITHUB_URL = 'https://github.com/bestboyhq/grip';
export const BESTBOY_URL = 'https://bestboy.dev';

// Grip's docs are its README.
export const docHref = (section = 'readme'): string => `${GITHUB_URL}#${section}`;
const README_MD = 'https://raw.githubusercontent.com/bestboyhq/grip/main/README.md';

export const HOME = resolve('/').replace(/\/$/u, '');

export type Link = Readonly<{
	title: string;
	href: string;
	line?: string;
	icon?: string;
	tag?: string;
	reload?: boolean;
}>;

export type Menu = Readonly<{
	id: string;
	title: string;
	columns: readonly Readonly<{ label: string; plain?: boolean; links: readonly Link[] }>[];
	strip?: Readonly<{ lead: string; text: string; link: Link }>;
}>;

export const isExternal = (link: Link): boolean => link.href.startsWith('http');

const LLMS: Link = { title: 'llms.txt', href: `${BESTBOY_URL}/llms.txt` };

export const MENUS: readonly Menu[] = [
	{
		id: 'product',
		title: 'Product',
		columns: [
			{
				label: 'Apps',
				links: [
					{
						title: 'Tony',
						tag: 'Say it',
						href: `${BESTBOY_URL}/tony`,
						icon: asset('icons/tony.webp'),
						line: 'Hold a key. Speak. Let go.',
					},
					{
						title: 'Malini',
						tag: 'Build it',
						href: `${BESTBOY_URL}/malini`,
						icon: asset('icons/malini.webp'),
						line: 'Run many agents. Come back to merged pull requests.',
					},
					{
						title: 'Grip',
						tag: 'Share it',
						href: HOME,
						icon: asset('icons/grip.webp'),
						line: 'Record your screen. Get a video worth watching.',
					},
				],
			},
			{
				label: 'More',
				plain: true,
				links: [
					{ title: 'How they fit together', href: `${BESTBOY_URL}/#turn` },
					{ title: 'Questions', href: `${BESTBOY_URL}/#faq` },
				],
			},
		],
		strip: {
			lead: 'The suite',
			text: 'Use one, or all three together',
			link: { title: 'Download', href: `${BESTBOY_URL}/#top` },
		},
	},
	{
		id: 'resources',
		title: 'Resources',
		columns: [
			{
				label: 'Docs',
				links: [
					{
						title: 'Grip docs',
						href: docHref(),
						line: 'Capture, edit, and share, in its README',
					},
					{
						title: 'Malini docs',
						href: `${BESTBOY_URL}/malini/docs`,
						line: 'Install, workstreams, jobs, and extensions',
					},
					{
						title: 'Tony docs',
						href: `${BESTBOY_URL}/tony/docs`,
						line: 'Install, languages, your words, and privacy',
					},
				],
			},
			{
				label: 'For agents',
				links: [
					{ ...LLMS, line: "Every app's docs, as markdown" },
					{
						title: 'Grip in one file',
						href: README_MD,
						line: "All its docs at once, for an agent's context",
					},
				],
			},
		],
	},
];

export const SITEMAP: readonly Readonly<{ label: string; links: readonly Link[] }>[] = [
	{
		label: 'Product',
		links: [
			{ title: 'Capture', href: `${HOME}#capture` },
			{ title: 'Auto-zoom', href: `${HOME}#zoom` },
			{ title: 'Captions', href: `${HOME}#captions` },
			{ title: 'Editor', href: `${HOME}#editor` },
			{ title: 'Export', href: `${HOME}#export` },
			{ title: 'Download', href: DOWNLOAD_URL },
		],
	},
	{
		label: 'Docs',
		links: [
			{ title: 'Capture', href: docHref('capture-in-one-keystroke') },
			{ title: 'Editing', href: docHref('edit-a-video-like-a-doc') },
			{ title: 'Shortcuts', href: docHref('shortcuts') },
			{ title: 'Build from source', href: docHref('build-from-source') },
		],
	},
	{
		label: 'For agents',
		links: [LLMS, { title: 'Docs as markdown', href: README_MD }],
	},
	{
		label: 'Project',
		links: [
			{ title: 'Source code', href: GITHUB_URL },
			{ title: 'Releases', href: `${GITHUB_URL}/releases` },
			{ title: 'Issues', href: `${GITHUB_URL}/issues` },
			{ title: 'bestboy.dev', href: BESTBOY_URL },
		],
	},
];
