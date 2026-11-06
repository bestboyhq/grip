import { asset, resolve } from '$app/paths';

export const SITE_URL = 'https://bestboy.dev/grip';
export const SITE_DESCRIPTION =
	'Grip is a free, open source screen recorder for the Mac: professional recordings and screenshots within seconds. It zooms where you click, glides your cursor, and captions your voice.';

// The DMG's name carries its version, so bestboy.dev looks up the latest release's and redirects to it.
export const DOWNLOAD_URL = 'https://bestboy.dev/download/grip';
export const GITHUB_URL = 'https://github.com/bestboyhq/grip';
export const BESTBOY_URL = 'https://bestboy.dev';

// Grip's docs are its README.
export const docHref = (section = 'readme'): string => `${GITHUB_URL}#${section}`;
const README_MD = 'https://raw.githubusercontent.com/bestboyhq/grip/main/README.md';

export const HOME = resolve('/(site)').replace(/\/$/u, '');
export const CHANGELOG = resolve('/(site)/changelog');

export type Link = Readonly<{
	title: string;
	href: string;
	line?: string;
	icon?: string;
	tag?: string;
	reload?: boolean;
	current?: boolean;
}>;

export type Menu = Readonly<{
	id: string;
	title: string;
	columns: readonly Readonly<{ label?: string; plain?: boolean; links: readonly Link[] }>[];
	strip?: Readonly<{ lead: string; text: string; link: Link }>;
}>;

export const isExternal = (link: Link): boolean => link.href.startsWith('http');

const LLMS: Link = { title: 'llms.txt', href: `${BESTBOY_URL}/llms.txt` };

// The brand's switcher: one line each, read top to bottom as one story.
export const APPS: Menu = {
	id: 'apps',
	title: 'Grip',
	columns: [
		{
			links: [
				{
					title: 'Tony',
					tag: 'Say it',
					href: `${BESTBOY_URL}/tony`,
					icon: asset('icons/tony.webp'),
					line: 'Speak to your agents.',
				},
				{
					title: 'Malini',
					tag: 'Build it',
					href: `${BESTBOY_URL}/malini`,
					icon: asset('icons/malini.webp'),
					line: 'Ship and automate them.',
				},
				{
					title: 'Grip',
					tag: 'Share it',
					href: HOME,
					icon: asset('icons/grip.webp'),
					line: 'Showcase the results.',
					current: true,
				},
			],
		},
	],
	strip: {
		lead: 'The suite',
		text: 'Use one, or all three together',
		link: { title: 'How they fit', href: `${BESTBOY_URL}/#turn` },
	},
};

export const MENUS: readonly Menu[] = [
	{
		id: 'product',
		title: 'Product',
		columns: [
			{
				label: 'Record',
				links: [
					{ title: 'Capture', href: `${HOME}#capture`, line: 'One keystroke, a screenshot or a video' },
					{ title: 'Auto-zoom', href: `${HOME}#zoom`, line: 'Zooms that follow your clicks' },
					{ title: 'Captions', href: `${HOME}#captions`, line: 'Word by word, made on your Mac' },
				],
			},
			{
				label: 'Edit and share',
				links: [
					{ title: 'Editor', href: `${HOME}#editor`, line: 'Edit your video like a doc' },
					{ title: 'Look', href: `${HOME}#look`, line: 'Pick the frame after the take' },
					{ title: 'Export', href: `${HOME}#export`, line: 'MP4, GIF, subtitles, or a link' },
				],
			},
		],
	},
	{
		id: 'resources',
		title: 'Resources',
		columns: [
			{
				label: 'Docs',
				links: [
					{ title: 'Grip docs', href: docHref(), line: 'Capture, edit, and share, in its README' },
					{ title: 'Shortcuts', href: docHref('shortcuts'), line: 'Every key, on one page' },
					{ title: 'Changelog', href: CHANGELOG, line: 'What you can do now, release by release' },
				],
			},
			{
				label: 'For agents',
				links: [
					{ title: 'Agent tools', href: docHref('agents'), line: 'Let any agent cut, zoom, and caption' },
					{ ...LLMS, line: 'Every app’s docs, as markdown' },
					{ title: 'Grip in one file', href: README_MD, line: 'All its docs at once, for an agent’s context' },
				],
			},
			{
				label: 'Project',
				plain: true,
				links: [
					{ title: 'Releases', href: `${GITHUB_URL}/releases` },
					{ title: 'Issues', href: `${GITHUB_URL}/issues` },
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
			{ title: 'Look', href: `${HOME}#look` },
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
			{ title: 'Changelog', href: CHANGELOG },
			{ title: 'Releases', href: `${GITHUB_URL}/releases` },
			{ title: 'Issues', href: `${GITHUB_URL}/issues` },
			{ title: 'bestboy.dev', href: BESTBOY_URL },
		],
	},
];
