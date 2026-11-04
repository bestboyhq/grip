// Every Grip release a person would notice, newest first, one line per change; a release with nothing to see (0.26)
// stays out. Backticks mark a key.
export type Release = Readonly<{
	// The day its tag shipped.
	date: string;
	title: string;
	notes: string | readonly (readonly [name: string, fact: string])[];
}> &
	// A release with a silent clip says what it shows, for a screen reader; the clip is
	// `static/media/changelog-<version>.mp4`, its still beside it.
	Readonly<{ version: Shown; clip: string } | { version: string; clip?: undefined }>;

export type Shown = '0.29' | '0.22' | '0.11' | '0.3';

export const RELEASES: readonly Release[] = [
	{
		version: '0.30',
		date: '2026-11-04',
		title: 'Any model gets the same polished edit',
		notes: [
			['Clean cuts.', 'Agents cut fillers and dead air like the Transcript tab, never mid-word.'],
			['Captions from your script.', 'Hand over the script, and the captions read it word for word.'],
			['Agents check their work.', 'A frame as the export renders it, and every problem with its fix.'],
			['Fixes:', 'Auto zooms hold through a drag.'],
		],
	},
	{
		version: '0.29',
		date: '2026-11-03',
		title: 'Agents edit your videos, and you redo lines by voice',
		clip: 'An agent in a terminal cuts the filler words from a Grip project, zooms in on a click, and turns on captions, while the open editor follows each edit.',
		notes: [
			['Agents.', 'Grip is an MCP server. Agents cut, zoom, caption, export, and share.'],
			['One undo.', 'An agent’s edit lands in the open editor as one step.'],
			['Voiceovers.', 'Press `V` and talk over the video. The old voice steps aside.'],
			['Usage stats, on by default.', 'Never what you record. Turn it off in Settings.'],
		],
	},
	{
		version: '0.28',
		date: '2026-10-28',
		title: 'A rounder, relit glass loupe',
		notes: [
			['Round by default.', 'Liquid stretch is a toggle. Saved projects keep theirs.'],
			['Relit.', 'Lit from above, a frosted rim, half the shadow.'],
			['Fixes:', 'Colors stay exact, and QuickTime no longer plays them washed out.'],
		],
	},
	{
		version: '0.27',
		date: '2026-10-26',
		title: 'Grip opens faster',
		notes: [
			['Opens at login.', 'Grip waits in the menu bar, so the picker is up in a frame or two.'],
			['Instant picker.', 'It shows at once, over a frozen screen.'],
			['Faster launch.', 'The toolbar shows fully drawn in its first frame.'],
		],
	},
	{
		version: '0.25',
		date: '2026-10-26',
		title: 'Pick your own record shortcut',
		notes: 'Onboarding asks for the keys that open Grip from any app. macOS’s screenshot keys work too.',
	},
	{
		version: '0.24',
		date: '2026-10-24',
		title: 'A cleaner voice, and zooms that glide',
		notes: [
			['Voice cleanup.', 'Noise removal, a de-esser, and a leveler, all on your Mac.'],
			['Gliding zooms.', 'Back-to-back zooms glide to the next framing instead of jumping.'],
		],
	},
	{
		version: '0.23',
		date: '2026-10-24',
		title: 'No upload meter in Share',
		notes: 'Grip speaks up only when a share is refused: why, and when uploads open again.',
	},
	{
		version: '0.22',
		date: '2026-10-24',
		title: 'A trim lens, a Presets tab, and a new look',
		clip: 'Dragging a clip’s edge in the timeline opens a lens over it, and moving up into the lens trims frame by frame.',
		notes: [
			['Trim lens.', 'Drag a clip edge and a lens magnifies it. Move up into it to trim by the frame.'],
			['Presets tab.', 'Try a preset on your own frame first. One can be your default look.'],
			['A new look.', 'Bestboy’s colors, motion, and type in every window.'],
		],
	},
	{
		version: '0.21',
		date: '2026-10-23',
		title: 'Dashed thirds for the area',
		notes: 'Sizing the area shows dashed rule-of-thirds lines.',
	},
	{
		version: '0.20',
		date: '2026-10-23',
		title: 'A new installer headline',
		notes: 'It leads with “Show, don’t tell.”',
	},
	{
		version: '0.19',
		date: '2026-10-22',
		title: 'One-key blur and familiar cut keys',
		notes: [
			['Blur.', 'Press `B` to hide a name or an email.'],
			['Cut keys.', '`⌘B` or `C` cuts at the playhead. `Q` and `W` delete before or after it.'],
			['Recent projects.', 'In the menu bar and toolbar menus, with thumbnails.'],
		],
	},
	{
		version: '0.18',
		date: '2026-10-22',
		title: 'See the frame you trim to',
		notes: 'Dragging a clip edge shows that frame in the preview, even footage you bring back.',
	},
	{
		version: '0.17',
		date: '2026-10-20',
		title: 'Fresh area picks and setting previews',
		notes: [
			['Fresh area picks.', 'The picker opens empty, so a quick `↩` never records a stale spot.'],
			['Setting previews.', 'Each recording option plays a small preview of what it does.'],
			['macOS’s keys.', 'Record on `⇧⌘5`. Grip hands it back when you quit.'],
		],
	},
	{
		version: '0.16',
		date: '2026-10-19',
		title: 'A louder, even voice',
		notes: [
			['Even voice.', 'Quiet phrases stay audible, as loud as online video.'],
			['Honest waveform.', 'The waveform draws the voice you hear.'],
		],
	},
	{
		version: '0.15',
		date: '2026-10-18',
		title: 'Share links on bestboy.dev',
		notes: [
			['Hosted links.', 'Links live on bestboy.dev. Sign in once with Google or an email code.'],
			['Free to watch.', 'Viewers and commenters need no account.'],
		],
	},
	{
		version: '0.14',
		date: '2026-10-18',
		title: 'The inspector moves left, and zooms get snappier',
		notes: 'A stiffer spring lands every zoom sooner.',
	},
	{
		version: '0.13',
		date: '2026-10-18',
		title: 'One-click export',
		notes: [
			['Repeat export.', 'Export repeats your last settings and destination. `▾` changes them.'],
			['Progress rings.', 'On the button and the menu bar, and a notification when done.'],
		],
	},
	{
		version: '0.12',
		date: '2026-10-18',
		title: 'Combined zooms and new click effects',
		notes: [
			['Combined zooms.', 'Overlapping zooms stack in rows, and chained loupes glide as one.'],
			['Click effects.', 'A swell through the screen, a lit wave, a soft circle, or a focus ring.'],
		],
	},
	{
		version: '0.11',
		date: '2026-10-16',
		title: 'A glass loupe and a calmer timeline',
		clip: 'A glass loupe follows the cursor along a revenue chart, then a click on Export CSV ripples through the screen.',
		notes: [
			['Glass loupe.', 'Magnify one spot and keep the whole screen in view.'],
			['Click ripple.', 'Each click ripples through the screen.'],
			['Calmer timeline.', 'Zooms, layouts, and masks get lanes that show up once used.'],
		],
	},
	{
		version: '0.10',
		date: '2026-10-14',
		title: 'Screenshot a display or a window',
		notes: 'Pick a display or a window, and `⌘C` copies it.',
	},
	{
		version: '0.9',
		date: '2026-10-14',
		title: 'Crop, and per-clip control',
		notes: [
			['Crop.', 'Keep the part that matters. Zooms aim inside it.'],
			['Auto-zoom on the countdown.', 'Press `Z` to flip it before you record.'],
			['Per-clip control.', 'Mute system audio, hide the cursor, or stop smoothing for one clip.'],
		],
	},
	{
		version: '0.8',
		date: '2026-10-08',
		title: 'The picker remembers its mode again',
		notes: 'Every way in opens the picker in your last mode, across restarts.',
	},
	{
		version: '0.7',
		date: '2026-10-08',
		title: 'Auto-zoom becomes your choice',
		notes: 'A switch in Settings decides whether new recordings get auto zooms.',
	},
	{
		version: '0.6',
		date: '2026-10-08',
		title: 'Recent captures and quiet updates',
		notes: [
			['Recent captures.', 'Your last five, with thumbnails, in the menu bar.'],
			['Faster picker.', 'It opens in about half the time.'],
			['Quiet updates.', 'They install while you’re away, never during a recording or an export.'],
		],
	},
	{
		version: '0.5',
		date: '2026-10-07',
		title: 'A slimmer timeline',
		notes: 'Clips drop their titles, so the clip lane takes less room.',
	},
	{
		version: '0.4',
		date: '2026-10-07',
		title: 'Plain video by default, and a frozen screen',
		notes: [
			['Plain by default.', 'Recordings show edge to edge. A background brings its own padding.'],
			['Freeze, then mark up.', 'The screen freezes as the picker opens. Ink thins with speed.'],
			['One permission less.', 'Accessibility covers keystrokes, so Input Monitoring is gone.'],
		],
	},
	{
		version: '0.3',
		date: '2026-10-06',
		title: 'Capture starts with an area',
		clip: 'An area picked over a frozen screen gets an arrow and a circle, is copied as a screenshot, then recorded into a result card with Copy, GIF, Link, and Edit.',
		notes: [
			['Area first.', '`⌥⌘↩` opens on your last area. `↩` records, `⌘C` copies.'],
			['Markup.', 'Arrow, box, pen, text, and pixelate, beside the area.'],
			['Result card.', 'Every recording ends in one: Copy, GIF, Link, or Edit.'],
		],
	},
	{
		version: '0.2',
		date: '2026-10-06',
		title: 'Updates show on the toolbar',
		notes: 'A downloaded update waits on the recording toolbar, ready to restart into.',
	},
	{
		version: '0.1',
		date: '2026-10-05',
		title: 'First release',
		notes: [
			['Auto-zoom.', 'Clicks and typing become zooms that follow your cursor.'],
			['A redrawn cursor.', 'Smoothed, exact on every click, hidden when idle.'],
			['Captions on your Mac.', '25 languages, word by word. Delete words and the video follows.'],
			['Export and share.', 'MP4 up to 4K at 60 fps, GIF, subtitles, or a link.'],
		],
	},
];
