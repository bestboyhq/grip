// The pages at /vs/<id>: Grip and one other recorder of the benchmark (benchmark.ts), side by side. Each page's copy is
// written from that recorder's own facts. A line about the other recorder restates a fact in benchmark.ts or names
// the page it was read from, as its maker states it; a line about Grip comes from the README. Free of SvelteKit, so
// the site's tests can read it.
import { FACTS, RECORDERS, type Recorder } from './benchmark.ts';

// One line of a list, and the page it was read from.
// A line may end with a link to the license guide at /guides/<guide>.
export type Line = Readonly<{ text: string; source: string; guide?: string }>;

export type Versus = Readonly<{
	id: string;
	title: string;
	description: string;
	h1: string;
	faint: string;
	lede: string;
	// Who should pick the other recorder, and who Grip.
	them: readonly Line[];
	grip: readonly Line[];
	// What moving to Grip leaves behind, past what every move does, and the guide to the license left behind.
	moving: Line;
	guide?: Readonly<{ slug: string; title: string }>;
	// The answer about the license ends with a link to `guide`.
	faqs: readonly Readonly<{ question: string; answer: string; guide?: true }>[];
}>;

const GITHUB_URL = 'https://github.com/bestboyhq/grip';
const README = `${GITHUB_URL}#readme`;
const LICENSE = `${GITHUB_URL}/blob/main/LICENSE`;

// Lines about Grip that more than one page needs.
const FREE: Line = {
	text: 'You record for work and want to pay nothing. Grip has no subscription, no commercial license, and no watermark.',
	source: README,
};
const NO_ACCOUNT: Line = {
	text: 'You want to record and edit with no account. Only a share link signs in to bestboy.dev, once.',
	source: README,
};
const MARKUP: Line = {
	text: 'You want screenshots and recordings behind one shortcut, with arrows, boxes, ink, text, and pixelate before you paste.',
	source: README,
};
const CAPTIONS: Line = {
	text: 'You want captions and a cleaned-up voice, made on your Mac in 25 European languages.',
	source: README,
};
const SOURCE: Line = {
	text: 'You want to read the code. Grip is open source under AGPL-3.0, which calls the rights it grants “irrevocable”.',
	source: LICENSE,
};
const WINDOWS = (name: string): Readonly<{ question: string; answer: string }> => ({
	question: 'Does Grip run on Windows?',
	answer: `No. Grip is built on macOS frameworks and needs macOS 15 or later on Apple silicon. If you record on Windows, pick ${name}.`,
});
const IMPORT = (name: string): Readonly<{ question: string; answer: string }> => ({
	question: `Can Grip open my ${name} projects?`,
	answer: `No. Grip opens no other recorder’s projects. It imports any MP4 or MOV with File > Import Video (Cmd+I), and each video becomes a new Grip project you can cut, zoom by hand, frame, and export.`,
});

export const VERSUS: readonly Versus[] = [
	{
		id: 'screen-studio',
		title: 'Grip vs Screen Studio: free, open source Mac alternative',
		description:
			'Screen Studio costs $108 a year and activates with an emailed code; Grip is free, open source, and needs no account, on macOS 15 with Apple silicon.',
		h1: 'Grip vs Screen Studio',
		faint: 'Both zoom where you click. One is a subscription.',
		lede: 'Screen Studio is a closed source Mac recorder at $29 a month, or $108 a year, activated with a code sent to your purchase email. Grip is free and open source under AGPL-3.0, with no account or activation. Both run only on the Mac: Screen Studio on macOS 13.1 or later, Grip on macOS 15 or later with Apple silicon.',
		them: [
			{
				text: 'Your Mac runs macOS 13.1 or 14. Screen Studio supports them, and Grip needs macOS 15 or later.',
				source: 'https://screen.studio/download',
			},
			{
				text: 'You hold a one-time license from before October 2025. Screen Studio’s FAQ says “Your license is of course still valid”, and you can renew it.',
				source: 'https://screen.studio/',
				guide: 'screen-studio-lifetime-license',
			},
			{
				text: 'You want help by email from the maker. Grip’s support is its GitHub issues.',
				source: 'https://screen.studio/guide',
			},
		],
		grip: [
			FREE,
			{
				text: 'You want to record with no account and no activation. Screen Studio is activated with a code sent to the email you bought it with.',
				source: 'https://screen.studio/guide/activating-screen-studio',
			},
			{
				text: 'You want zooms on typing as well as on clicks.',
				source: README,
			},
			{
				text: 'You take screenshots with markup. Screen Studio copies a frame of a video as an image.',
				source: 'https://screen.studio/guide/copy-current-frame-as-an-image',
			},
			SOURCE,
		],
		moving: {
			text: 'Moving does not end what you have. Screen Studio’s terms say your “recordings, project files and exported videos” are yours, and an old license stays valid.',
			source: 'https://screen.studio/legal/terms-of-service',
		},
		guide: { slug: 'screen-studio-lifetime-license', title: 'Screen Studio’s one-time license, year by year' },
		faqs: [
			{
				question: 'Is Grip a free alternative to Screen Studio?',
				answer: 'Yes. Grip is free for any use, work included, with no subscription and no watermark. Screen Studio costs $29 a month, or $108 a year billed yearly. Both zoom on clicks, and Grip zooms on typing too.',
			},
			{
				question: 'Does Screen Studio still sell a lifetime license?',
				guide: true,
				answer: 'No. From December 2022 it sold a one-time license with one year of updates. Since October 2025 it sells only the subscription. Its FAQ says one-time licenses are “no longer available for new purchases”, and that an old license “is of course still valid”.',
			},
			IMPORT('Screen Studio'),
			{
				question: 'Does Grip run on Windows or Intel Macs?',
				answer: 'No. Grip needs macOS 15 or later on Apple silicon. Screen Studio is a Mac app too, and it runs on macOS 13.1 or later.',
			},
			{
				question: 'Is Grip open source?',
				answer: 'Yes, under AGPL-3.0, and its license calls the rights it grants “irrevocable”. Screen Studio is closed source.',
			},
		],
	},
	{
		id: 'cleanshot',
		title: 'Grip vs CleanShot X: free, open source Mac alternative',
		description:
			'CleanShot X is $35 once with one year of updates, then $19 a year; Grip is free and open source, with every update free, on macOS 15 and Apple silicon.',
		h1: 'Grip vs CleanShot X',
		faint: 'One year of updates, or every update free.',
		lede: 'CleanShot X costs $35 once with one year of updates, then $19 a year to keep updating, and it is closed source. Grip is free and open source under AGPL-3.0, with free updates. Both run only on the Mac and need no account: CleanShot X on macOS 13 or later, Grip on macOS 15 or later with Apple silicon.',
		them: [
			{
				text: 'You capture whole pages. CleanShot X takes scrolling screenshots, and Grip does not.',
				source: 'https://cleanshot.com/',
			},
			{
				text: 'Your team needs a workspace with SSO and SCIM. CleanShot Pro has them, at $10 per user a month billed yearly. Grip has neither.',
				source: 'https://cleanshot.com/pricing',
			},
			{
				text: 'Your Mac runs macOS 13 or 14. Grip needs macOS 15 or later on Apple silicon.',
				source: 'https://cleanshot.com/pricing',
			},
			{
				text: 'You want to pay once and keep a version. CleanShot says you can “continue using the last version forever, without renewing”.',
				source: 'https://cleanshot.com/why-updates-expire',
				guide: 'cleanshot-x-license-renewal',
			},
		],
		grip: [
			{
				text: 'You want zooms that start on each click and keystroke. Grip zooms on clicks and typing. CleanShot X’s automatic zooms follow the cursor.',
				source: 'https://cleanshot.com/',
			},
			{
				text: 'You want new versions with no renewal. Grip updates itself, and each update is free.',
				source: README,
			},
			CAPTIONS,
			SOURCE,
		],
		moving: {
			text: 'Moving ends nothing you paid for. Without a renewal, CleanShot says you can “continue using the last version forever”, so it can stay beside Grip for scrolling screenshots.',
			source: 'https://cleanshot.com/why-updates-expire',
		},
		guide: { slug: 'cleanshot-x-license-renewal', title: 'CleanShot X’s updates and the $19 renewal' },
		faqs: [
			{
				question: 'Is Grip a free alternative to CleanShot X?',
				answer: 'For recording, editing, and screenshots with markup, yes. Grip is free and open source, and every update is free. It does not take scrolling screenshots, and CleanShot X does. CleanShot X Basic is $35 once.',
			},
			{
				question: 'Is CleanShot X a one-time purchase?',
				guide: true,
				answer: 'Yes, with one year of updates. Basic is $35 once, and a renewal of $19 a year gives another year of updates. Without it, CleanShot says you can “continue using the last version forever, without renewing”.',
			},
			{
				question: 'Does Grip take scrolling screenshots?',
				answer: 'No. Grip captures an area, a window, or a whole display. If you need scrolling capture, keep CleanShot X for it.',
			},
			IMPORT('CleanShot X'),
			{
				question: 'Does Grip run on Windows?',
				answer: 'No. Grip needs macOS 15 or later on Apple silicon. CleanShot X is a Mac app too, and it runs on macOS 13 or later.',
			},
		],
	},
	{
		id: 'cap',
		title: 'Grip vs Cap: free, open source Mac alternative for work',
		description:
			'Cap is open source and costs $29 a year, or $58 once, for work; Grip is open source and free for work too, with no account, on macOS 15 and Apple silicon.',
		h1: 'Grip vs Cap',
		faint: 'Two open source recorders. One is free for work.',
		lede: 'Cap and Grip are both open source, and both record with no account. Cap is free for personal use and costs $29 a year, or $58 once, for work. It runs on macOS 13.1 or later, Windows, and Linux. Grip is free for any use, work included, under AGPL-3.0, and it runs on macOS 15 or later with Apple silicon.',
		them: [
			{
				text: 'You record on Windows or Linux. Cap runs on both, and Grip runs only on the Mac.',
				source: 'https://cap.so/download',
			},
			{
				text: 'Your Mac runs macOS 13.1 or 14. Grip needs macOS 15 or later on Apple silicon.',
				source: 'https://cap.so/download',
			},
			{
				text: 'You want the video to upload while you record. Cap offers live upload as well as recording on device.',
				source: 'https://cap.so/docs/recording/studio-mode',
			},
		],
		grip: [
			{
				text: 'You record for work and want to pay nothing. Cap’s free plan is for personal use.',
				source: 'https://cap.so/pricing',
			},
			{
				text: 'You want zooms placed as you record. Cap adds zooms in the editor, from clicks, when you ask. Grip zooms on clicks and typing.',
				source: 'https://cap.so/docs/recording/studio-mode',
			},
			MARKUP,
			CAPTIONS,
		],
		moving: {
			text: 'Cap’s pricing page says its $58 desktop license is one “that never renews”: there is no subscription to cancel.',
			source: 'https://cap.so/pricing',
		},
		faqs: [
			{
				question: 'Is Grip a free alternative to Cap?',
				answer: 'Yes, on the Mac. Both are open source and need no account. Cap’s free plan is for personal use, and work costs $29 a year or $58 once. Grip is free for work too. Cap also runs on Windows and Linux.',
			},
			{
				question: 'Is Cap free for commercial use?',
				answer: 'Not on its free plan, which is for personal use. Work needs its desktop license: $29 a year, or $58 once, “for a license that never renews”. Grip is free for commercial use.',
			},
			{
				question: 'Does Grip run on Windows or Linux?',
				answer: 'No. Grip is built on macOS frameworks and needs macOS 15 or later on Apple silicon. If you record on Windows or Linux, pick Cap.',
			},
			IMPORT('Cap'),
		],
	},
	{
		id: 'focusee',
		title: 'Grip vs FocuSee: free, open source Mac alternative',
		description:
			'FocuSee costs $49.99 a year or $199.99 once for version 2 and needs an account; Grip is free, open source, and needs no account, on macOS 15.',
		h1: 'Grip vs FocuSee',
		faint: 'Both zoom on clicks and typing. One costs nothing.',
		lede: 'FocuSee is a closed source recorder for macOS 10.15 or later and Windows. It costs $19.99 a month, $49.99 a year, or $199.99 once for version 2, and needs an account to activate. Grip is free and open source under AGPL-3.0, needs no account, and runs on macOS 15 or later with Apple silicon. Both zoom on clicks and typing.',
		them: [
			{
				text: 'You record on Windows. FocuSee runs on Windows and the Mac.',
				source: 'https://focusee.ai/specs.htm',
			},
			{
				text: 'Your Mac runs a macOS before 15. FocuSee supports macOS 10.15 or later.',
				source: 'https://focusee.ai/specs.htm',
			},
			{
				text: 'You want help by live chat. FocuSee offers it, and email. Grip’s support is its GitHub issues.',
				source: 'https://focusee.ai/pricing.htm',
			},
		],
		grip: [
			{
				text: 'You want to try everything before you pay, or never pay. FocuSee’s trial makes one export, with a watermark.',
				source: 'https://focusee.ai/faq/presales-and-billing.htm',
			},
			{
				text: 'You want to record with no account. FocuSee asks for one to activate.',
				source: 'https://focusee.ai/guide/activate-the-software.htm',
			},
			{
				text: 'You want every new version free. FocuSee’s one-time license says “upgrading to the next major version (e.g. Version 3) comes at an additional upgrade cost”.',
				source: 'https://focusee.ai/pricing.htm',
			},
			{
				text: 'You take screenshots too. FocuSee exports video, and Grip adds screenshots with markup.',
				source: 'https://focusee.ai/guide/export-video.htm',
			},
		],
		moving: {
			text: 'FocuSee’s one-time license is “Lifetime Access to FocuSee 2.x”, so a copy you bought keeps that version.',
			source: 'https://focusee.ai/pricing.htm',
		},
		faqs: [
			{
				question: 'Is Grip a free alternative to FocuSee?',
				answer: 'Yes, on a Mac with Apple silicon. Both zoom on clicks and typing. Grip is free and open source with no account. FocuSee costs $19.99 a month, $49.99 a year, or $199.99 once for version 2.',
			},
			{
				question: 'Does FocuSee have a lifetime license?',
				answer: 'Yes, for one major version. $199.99 once buys “Lifetime Access to FocuSee 2.x”, and “upgrading to the next major version (e.g. Version 3) comes at an additional upgrade cost”. Its monthly and yearly plans include new versions while you subscribe.',
			},
			WINDOWS('FocuSee'),
			IMPORT('FocuSee'),
		],
	},
	{
		id: 'loom',
		title: 'Grip vs Loom: free, open source Mac alternative, no account',
		description:
			'Loom is a cloud recorder that needs an account and costs $18 per user a month; Grip is free, open source, and records on your Mac with no account.',
		h1: 'Grip vs Loom',
		faint: 'A cloud for your team, or a recorder on your Mac.',
		lede: 'Loom is a closed source cloud recorder for Mac, Windows, Chrome, iOS, and Android. It needs an account to record. Its free plan holds 25 videos of 5 minutes each, and work costs $18 per user a month. Grip is free and open source under AGPL-3.0, and records on your Mac with no account, on macOS 15 or later.',
		them: [
			{
				text: 'Your team records on Windows, in Chrome, or on a phone. Loom runs on all of them, and Grip runs only on the Mac.',
				source: 'https://support.atlassian.com/loom/docs/loom-device-compatibility/',
			},
			{
				text: 'You want each video in the cloud from the moment you record. Loom works in the cloud, and Grip keeps the video on your Mac until you share it.',
				source: 'https://www.atlassian.com/software/loom/screen-recorder',
			},
		],
		grip: [
			{
				text: 'You want to record with no account. Loom needs one to record.',
				source: 'https://www.atlassian.com/software/loom/screen-recorder',
			},
			{
				text: 'You want to record as many videos as you like, with no branding. Loom’s free plan holds 25 videos of 5 minutes each, branded. Grip’s share links take 25 uploads a month, up to 2 GB each, and last 90 days.',
				source: 'https://www.loom.com/pricing',
			},
			{
				text: 'You want automatic zoom now. Loom’s editing page lists it as coming soon.',
				source: 'https://www.atlassian.com/software/loom/editing',
			},
			CAPTIONS,
		],
		moving: {
			text: 'Grip does not read Loom’s library or its links. A video you import gets a new link when you share it from Grip.',
			source: README,
		},
		faqs: [
			{
				question: 'Is there a Loom alternative for Mac with no account?',
				answer: 'Grip records and edits with no account, and keeps the video on your Mac. Sharing a link signs in to bestboy.dev once. Loom needs an account to record.',
			},
			{
				question: 'Is Grip a free alternative to Loom?',
				answer: 'Yes, on a Mac with Apple silicon. Grip is free for work, with no limit on recordings and no watermark. Its share links take 25 uploads a month, up to 2 GB each, and last 90 days. Loom’s free plan holds 25 videos of 5 minutes each, and its Business plan is $18 per user a month.',
			},
			{
				question: 'Does Grip run on Windows or on a phone?',
				answer: 'No. Grip needs macOS 15 or later on Apple silicon. If your team records on Windows, Chrome, iOS, or Android, pick Loom.',
			},
			{
				question: 'Can I move my Loom videos to Grip?',
				answer: 'Any MP4 or MOV you have imports with File > Import Video (Cmd+I), and becomes a new Grip project. Grip does not read Loom’s library or its links.',
			},
		],
	},
	{
		id: 'openscreen',
		title: 'Grip vs OpenScreen: free, open source Mac alternatives',
		description:
			'OpenScreen and Grip are both free and open source with no account; OpenScreen also runs on Windows and Linux, and Grip adds share links and screenshots.',
		h1: 'Grip vs OpenScreen',
		faint: 'Both free and open source. Here is what differs.',
		lede: 'OpenScreen and Grip are both free for work, open source, and need no account. OpenScreen is MIT licensed and runs on macOS 13 or later, Windows, and Linux. Grip is AGPL-3.0 and runs on macOS 15 or later with Apple silicon. Grip adds share links, zooms on typing as well as clicks, and screenshots with markup.',
		them: [
			{
				text: 'You record on Windows or Linux, or on macOS 13 or 14. OpenScreen runs on all of them.',
				source: 'https://getopenscreen.com/docs/installation/',
			},
			{
				text: 'You want to build on its code under the MIT license. Grip’s AGPL-3.0 asks that changes you ship or serve stay open.',
				source: 'https://github.com/getopenscreen/openscreen',
			},
		],
		grip: [
			{
				text: 'You share links with comments. OpenScreen’s FAQ says: “No share links, cloud storage, team workspaces or comments.” Grip’s links take 25 uploads a month, up to 2 GB each, and last 90 days.',
				source: 'https://getopenscreen.com/docs/faq/',
			},
			{
				text: 'You want zooms on typing as well as on clicks. OpenScreen zooms on clicks.',
				source: 'https://getopenscreen.com/features/auto-zoom/',
			},
			MARKUP,
			CAPTIONS,
		],
		moving: {
			text: 'Both are free, so nothing ends when you move. OpenScreen stays installed beside Grip if you want it.',
			source: 'https://getopenscreen.com/docs/faq/',
		},
		faqs: [
			{
				question: 'How do OpenScreen and Grip differ?',
				answer: 'Both are free, open source, and need no account. OpenScreen is MIT licensed and runs on macOS, Windows, and Linux. Grip is AGPL-3.0, runs on macOS 15 or later with Apple silicon, and adds share links, zooms on typing, and screenshots.',
			},
			{
				question: 'Are both free for commercial use?',
				answer: 'Yes. OpenScreen’s FAQ says: “It is free for commercial use, with no account and no watermark.” Grip is free for commercial use too.',
			},
			{
				question: 'Does Grip run on Windows or Linux?',
				answer: 'No. Grip needs macOS 15 or later on Apple silicon. If you record on Windows or Linux, pick OpenScreen.',
			},
			IMPORT('OpenScreen'),
		],
	},
	{
		id: 'quicktime',
		title: 'Grip vs QuickTime: a free, open source alternative for Mac',
		description:
			'QuickTime comes free with macOS and records the screen as it is; Grip is free and open source, and zooms, redraws the cursor, captions, and shares links.',
		h1: 'Grip vs QuickTime',
		faint: 'Both free. One edits the take for you.',
		lede: 'QuickTime Player comes free with every Mac and records the screen with no account. Grip is free too, open source under AGPL-3.0, and needs macOS 15 or later with Apple silicon. After the take, Grip zooms on clicks and typing, redraws the cursor, captions your voice, and makes share links. QuickTime has no automatic zoom and no share links.',
		them: [
			{
				text: 'You want nothing to install. QuickTime Player comes with macOS.',
				source: 'https://support.apple.com/guide/quicktime-player/welcome/mac',
			},
			{
				text: 'Your Mac has an Intel chip or runs a macOS before 15. QuickTime comes with it, and Grip needs macOS 15 or later on Apple silicon.',
				source: 'https://support.apple.com/guide/quicktime-player/welcome/mac',
			},
			{
				text: 'You want help by chat or phone. Apple Support offers both.',
				source: 'https://support.apple.com/contact',
			},
		],
		grip: [
			{
				text: 'You want zooms on what you click. QuickTime records the screen as it is.',
				source: 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac',
			},
			{
				text: 'You share a link instead of a file. QuickTime shares the movie file. Grip’s links take 25 uploads a month, up to 2 GB each, and last 90 days.',
				source: 'https://support.apple.com/guide/quicktime-player/share-your-movies-qtp1ad6fa3c1/mac',
			},
			{
				text: 'You edit by transcript: delete words, and the video follows. Filler words and long pauses go in one click.',
				source: README,
			},
			MARKUP,
		],
		moving: {
			text: 'QuickTime’s options can draw the pointer and clicks into the picture, and a recording keeps them as it imports: cut it, zoom by hand, frame it, and export it.',
			source: 'https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac',
		},
		faqs: [
			{
				question: 'Can QuickTime record my screen?',
				answer: 'Yes. In QuickTime Player, choose File > New Screen Recording, which opens the Screenshot tools, then click Record. Its options can include the pointer or clicks in the recording.',
			},
			{
				question: 'How is Grip different from QuickTime?',
				answer: 'QuickTime records the screen as it is. Grip records the cursor apart from the screen and redraws it, zooms on clicks and typing, captions your voice on your Mac, and shares a link. Both are free.',
			},
			{
				question: 'Can Grip edit a QuickTime recording?',
				answer: 'Yes. Import the .mov with File > Import Video (Cmd+I), and it becomes a Grip project. It holds no record of your clicks, so automatic zoom and the redrawn cursor work only on what Grip records.',
			},
			{
				question: 'Does Grip run on Intel Macs?',
				answer: 'No. Grip needs macOS 15 or later on Apple silicon. On an Intel Mac, QuickTime is the recorder that comes with macOS.',
			},
		],
	},
	{
		id: 'recordly',
		title: 'Grip vs Recordly: free, open source Mac alternative',
		description:
			'Recordly is open source, needs an account to record, and costs $9 a month for work; Grip is open source, free for work, and needs no account.',
		h1: 'Grip vs Recordly',
		faint: 'Both open source. One asks for an account.',
		lede: 'Recordly and Grip are both open source under AGPL-3.0. Recordly runs on macOS 14 or later, Windows, and Linux. It needs an account to record, and work costs $9 a month at its early bird price, $15 regular. Grip is free for any use, needs no account, and runs on macOS 15 or later with Apple silicon.',
		them: [
			{
				text: 'You record on Windows or Linux, or on macOS 14. Recordly runs on all of them.',
				source: 'https://github.com/webadderallorg/Recordly#readme',
			},
			{
				text: 'You share large videos as links. Recordly’s paid plan takes up to 10 GB a video, and Grip takes up to 2 GB.',
				source: 'https://videos.recordly.dev/api/billing/catalog',
			},
		],
		grip: [
			{
				text: 'You want to record with no account. Recordly’s docs say its builds need a sign-in, with “no guest or local demo login”.',
				source: 'https://github.com/webadderallorg/Recordly/blob/main/docs/authentication.md',
			},
			{
				text: 'You record for work and want to pay nothing. Recordly’s free plan is for personal use.',
				source: 'https://github.com/webadderallorg/Recordly/blob/main/src/i18n/locales/en/billing.json',
			},
			{
				text: 'You want zooms placed as you record. Recordly suggests zooms from the cursor in its editor. Grip zooms on clicks and typing.',
				source: 'https://github.com/webadderallorg/Recordly#readme',
			},
			MARKUP,
		],
		moving: {
			text: 'Both are open source under AGPL-3.0, so the code of each stays public, whichever one you record with.',
			source: 'https://github.com/webadderallorg/Recordly',
		},
		faqs: [
			{
				question: 'Is Grip a free alternative to Recordly?',
				answer: 'Yes, on a Mac with Apple silicon. Both are open source under AGPL-3.0. Grip is free for work with no account. Recordly is free for personal use, and work costs $9 a month at its early bird price.',
			},
			{
				question: 'Do I need an account to use Recordly?',
				answer: 'Yes. Its docs say its builds ask for a sign-in before you record, with “no guest or local demo login”. Grip records and edits with no account.',
			},
			{
				question: 'Does Grip run on Windows or Linux?',
				answer: 'No. Grip needs macOS 15 or later on Apple silicon. If you record on Windows or Linux, pick Recordly.',
			},
			IMPORT('Recordly'),
		],
	},
	{
		id: 'kap',
		title: 'Grip vs Kap: two free, open source Mac recorders',
		description:
			'Kap is a free, open source Mac recorder whose last release came out in October 2022; Grip is free, open source, and zooms on clicks and typing on macOS 15.',
		h1: 'Grip vs Kap',
		faint: 'Both free and open source, on the Mac.',
		lede: 'Kap is an open source screen recorder for macOS 12 or later, under MIT, and it exports GIF, MP4, WebM, or APNG. Its last release, version 3.6.0, came out on October 27, 2022. Grip is free and open source under AGPL-3.0, on macOS 15 or later with Apple silicon, and its updates arrive in the app.',
		them: [
			{
				text: 'Your Mac has an Intel chip, or runs macOS 12, 13, or 14. Kap has a download for Intel, and Grip needs macOS 15 or later on Apple silicon.',
				source: 'https://getkap.co/',
			},
			{
				text: 'You export WebM or APNG. Kap lists both, and Grip exports MP4 and GIF.',
				source: 'https://getkap.co/',
			},
			{
				text: 'You share through plugins. Kap’s plugins upload to Giphy and Streamable.',
				source: 'https://getkap.co/',
			},
		],
		grip: [
			{
				text: 'You want new versions. Grip’s arrive in the app, each one free, and Kap’s last release came out on October 27, 2022.',
				source: 'https://github.com/wulkano/Kap/releases',
			},
			{
				text: 'You want the take polished with no editing: zooms on clicks and typing, a smooth cursor, and captions.',
				source: README,
			},
			{
				text: 'You want a share link when you stop. Grip’s links take 25 uploads a month, up to 2 GB each, and last 90 days.',
				source: README,
			},
			MARKUP,
		],
		moving: {
			text: 'Kap exports MP4, and Grip imports an MP4 as a new project.',
			source: 'https://getkap.co/',
		},
		faqs: [
			{
				question: 'Is Grip a free alternative to Kap?',
				answer: 'Yes. Both are free and open source, Kap under MIT and Grip under AGPL-3.0. Grip also zooms on clicks and typing, redraws the cursor, and captions your voice.',
			},
			{
				question: 'When was Kap last updated?',
				answer: 'Kap’s releases page lists version 3.6.0, from October 27, 2022, as its last release. Grip’s updates arrive in the app, each one free.',
			},
			{
				question: 'Does Grip export GIFs?',
				answer: 'Yes. Grip exports an MP4 up to 4K at 60 fps, or a GIF that fits under the size you set.',
			},
			{
				question: 'Does Grip run on Intel Macs?',
				answer: 'No. Grip needs macOS 15 or later on Apple silicon. Kap has a download for Intel Macs and needs macOS 12 or later.',
			},
			IMPORT('Kap'),
		],
	},
	{
		id: 'obs',
		title: 'Grip vs OBS Studio: two free, open source recorders',
		description:
			'OBS Studio is free and open source, and records and streams on Mac, Windows, and Linux; Grip is free, open source, and zooms on clicks and typing on macOS 15.',
		h1: 'Grip vs OBS Studio',
		faint: 'Both free and open source. One streams live.',
		lede: 'OBS Studio is free and open source under GPL-2.0, for recording and live streaming on macOS 13 or later, Windows, and Linux. Grip is free and open source under AGPL-3.0, on macOS 15 or later with Apple silicon. Grip zooms on clicks and typing and makes share links. No OBS Studio page states an automatic zoom.',
		them: [
			{
				text: 'You stream live. OBS Studio is “free and open source software for video recording and live streaming”, and Grip does not stream.',
				source: 'https://obsproject.com/',
			},
			{
				text: 'You build scenes from many sources, such as windows, webcams, and capture cards, and switch between them with transitions as you record.',
				source: 'https://obsproject.com/',
			},
			{
				text: 'You record on Windows, Linux, or an Intel Mac. OBS Studio runs on all three, and Grip needs macOS 15 or later on Apple silicon.',
				source: 'https://obsproject.com/download',
			},
			{
				text: 'You want help from a forum and a Discord. OBS Studio’s help page lists both.',
				source: 'https://obsproject.com/help',
			},
		],
		grip: [
			{
				text: 'You want the take polished with no editing: zooms on clicks and typing, a smooth cursor, and captions.',
				source: README,
			},
			{
				text: 'You want a share link when you stop. Grip’s links take 25 uploads a month, up to 2 GB each, and last 90 days.',
				source: README,
			},
			MARKUP,
			CAPTIONS,
		],
		moving: {
			text: 'OBS Studio saves recordings to a folder on your computer and can remux them to MP4, which Grip imports as a new project.',
			source: 'https://obsproject.com/kb/standard-recording-output-guide',
		},
		faqs: [
			{
				question: 'Is Grip a free alternative to OBS Studio?',
				answer: 'For recording on a Mac, yes. Both are free and open source. OBS Studio records and streams live on Mac, Windows, and Linux. Grip records on the Mac and polishes the take for you: it zooms on clicks and typing, redraws the cursor, and captions your voice.',
			},
			{
				question: 'Can Grip stream live?',
				answer: 'No. Grip records to a video on your Mac and makes share links. To stream live, pick OBS Studio.',
			},
			{
				question: 'Can OBS Studio zoom on clicks?',
				answer: 'No OBS Studio page states an automatic zoom. Grip zooms on clicks and typing as you record.',
			},
			WINDOWS('OBS Studio'),
			IMPORT('OBS Studio'),
		],
	},
];
// The recorder a page sets beside Grip, and Grip.
export const GRIP: Recorder = RECORDERS.find(({ id }) => id === 'grip') as Recorder;
export const recorder = (id: string): Recorder | undefined => RECORDERS.find((r) => r.id === id);

// Every page a page links to as a source, each once, named by the facts read from it, then the lines' own pages.
export function sources({ id, them, grip, moving }: Versus): readonly Readonly<{ url: string; label: string }>[] {
	const named = new Map<string, string>();
	for (const { name, facts } of [GRIP, recorder(id)].filter((r) => r !== undefined))
		for (const { key, label } of FACTS) {
			const url = facts[key].source;
			const before = named.get(url);
			named.set(url, before ? `${before}, ${label.toLowerCase()}` : `${name}: ${label.toLowerCase()}`);
		}
	for (const { source } of [...them, ...grip, moving])
		if (!named.has(source)) named.set(source, source.replace(/^https:\/\/(www\.)?/u, '').replace(/\/$/u, ''));
	return [...named].map(([url, label]) => ({ url, label }));
}
