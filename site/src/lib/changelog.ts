// Every Grip release a person would notice, newest first, one line per change and the reader as its subject: what
// they can do now. A release with nothing for them (0.20, 0.26) stays out. Backticks mark a key.
export type Release = Readonly<{
	// The day its tag shipped.
	date: string;
	title: string;
	notes: string | readonly (readonly [name: string, fact: string])[];
}> &
	// A release with a silent clip says what it shows, for a screen reader; the clip is
	// `static/media/changelog-<version>.mp4`, its still beside it.
	Readonly<{ version: Shown; clip: string } | { version: string; clip?: undefined }>;

export type Shown = '0.33' | '0.29' | '0.22' | '0.11' | '0.3';

export const RELEASES: readonly Release[] = [
	{
		version: '0.33',
		date: '2026-11-12',
		title: 'See inside every clip, and drag it into place',
		clip: 'Each clip in the timeline shows frames of its recording. A clip is dragged to the front: it lifts, a slot opens where it lands, the other clips slide aside, and its zoom goes with it.',
		notes: [
			['Frames in every clip.', 'See what a clip holds without playing it.'],
			['Drag to reorder.', 'Drag a clip to a new place, and its zooms and captions go with it. `Esc` puts it back.'],
		],
	},
	{
		version: '0.31',
		date: '2026-11-05',
		title: 'Look at yourself, and you look into the lens',
		notes: [
			['Under your camera.', 'The camera bubble starts right below the lens, at the top of your screen.'],
			['Out of your way.', 'It fades while you point at it and drags anywhere. Each display keeps your spot.'],
			['Only for you.', 'Moving it no longer moves the camera in your video. Place that as you edit.'],
			['A timeline that follows.', 'It glides along with the playhead, and pinch zooms around your pointer.'],
			['Trim across a split.', 'Drag a clip’s edge into the clip next to it, and that clip gives way.'],
			['Fixes:', 'Undo puts the playhead back, click effects play on past a cut, and the toolbar keeps its size.'],
		],
	},
	{
		version: '0.30',
		date: '2026-11-04',
		title: 'Hand your video to any agent and get a clean edit',
		notes: [
			['Clean cuts.', 'Your agent cuts fillers and dead air the way the Transcript tab does, never mid-word.'],
			['Captions from your script.', 'Hand over the script, and the captions read it word for word.'],
			['Agents check their work.', 'Your agent sees each frame you’ll export, and what to fix.'],
			['Fixes:', 'Auto zooms hold through a drag.'],
		],
	},
	{
		version: '0.29',
		date: '2026-11-03',
		title: 'Ask an agent to edit, and redo any line by voice',
		clip: 'An agent in a terminal cuts the filler words from a Grip project, zooms in on a click, and turns on captions, while the open editor follows each edit.',
		notes: [
			['Your agent.', 'Add Grip to it from Settings, and it cuts, zooms, captions, exports, and shares for you.'],
			['One undo.', 'Watch an agent’s edit land in your editor, and undo it in one step.'],
			['Voiceovers.', 'Press `V` and say the line again. The old voice steps aside.'],
			['Usage stats, on by default.', 'Never what you record. Turn it off in Settings.'],
		],
	},
	{
		version: '0.28',
		date: '2026-10-28',
		title: 'Your loupe looks more like glass',
		notes: [
			['Round by default.', 'Turn on liquid stretch if you want it. Saved projects keep theirs.'],
			['Relit.', 'Lit from above, with a frosted rim and half the shadow.'],
			['Fixes:', 'Your colors stay exact, and QuickTime no longer plays them washed out.'],
		],
	},
	{
		version: '0.27',
		date: '2026-10-26',
		title: 'Press the shortcut, and Grip is already there',
		notes: [
			['Ready at login.', 'Grip waits in the menu bar, so the picker is up in a frame or two.'],
			['Instant picker.', 'It shows at once, over a frozen screen.'],
			['Faster launch.', 'You never see a half-drawn toolbar.'],
		],
	},
	{
		version: '0.25',
		date: '2026-10-26',
		title: 'Pick your own record shortcut',
		notes: 'Choose the keys that open Grip from any app as you set it up. macOS’s screenshot keys work too.',
	},
	{
		version: '0.24',
		date: '2026-10-24',
		title: 'You sound clearer, and zooms glide',
		notes: [
			['Clearer voice.', 'No background noise, softer S sounds, and an even volume, all on your Mac.'],
			['Gliding zooms.', 'Back-to-back zooms glide to the next framing instead of jumping.'],
		],
	},
	{
		version: '0.23',
		date: '2026-10-24',
		title: 'Share stays out of your way',
		notes: 'You hear from it only when a share is refused: why, and when you can upload again.',
	},
	{
		version: '0.22',
		date: '2026-10-24',
		title: 'Trim to the exact frame, and try a look before you keep it',
		clip: 'Dragging a clip’s edge in the timeline opens a lens over it, and moving up into the lens trims frame by frame.',
		notes: [
			['Trim lens.', 'Drag a clip edge and a lens magnifies it. Move up into it to trim by the frame.'],
			['Presets tab.', 'Try a preset on your own frame before you apply it. Make one your default.'],
			['A new look.', 'Every window matches the other Bestboy apps.'],
		],
	},
	{
		version: '0.21',
		date: '2026-10-23',
		title: 'Frame your area by the thirds',
		notes: 'Dashed rule-of-thirds lines show while you size the area.',
	},
	{
		version: '0.19',
		date: '2026-10-22',
		title: 'Blur in one key, and cut with the keys you know',
		notes: [
			['Blur.', 'Press `B` to hide a name or an email.'],
			['Cut keys.', '`⌘B` or `C` cuts at the playhead. `Q` and `W` delete before or after it.'],
			['Recent projects.', 'Open one from the menu bar or the toolbar, by its thumbnail.'],
		],
	},
	{
		version: '0.18',
		date: '2026-10-22',
		title: 'See the frame you trim to',
		notes: 'As you drag a clip edge, the preview shows that frame, even for footage you bring back.',
	},
	{
		version: '0.17',
		date: '2026-10-20',
		title: 'See what a setting does before you turn it on',
		notes: [
			['Setting previews.', 'Each recording option plays a small preview of what it does.'],
			['Fresh area picks.', 'The picker opens empty, so a quick `↩` never records last time’s spot.'],
			['macOS’s keys.', 'Record on `⇧⌘5`. Grip hands it back when you quit.'],
		],
	},
	{
		version: '0.16',
		date: '2026-10-19',
		title: 'Your quiet words stay audible',
		notes: [
			['Even voice.', 'Quiet phrases stay audible, at the loudness of online video.'],
			['Honest waveform.', 'The waveform draws the voice you hear.'],
		],
	},
	{
		version: '0.15',
		date: '2026-10-18',
		title: 'Share a link anyone can watch',
		notes: [
			['Hosted links.', 'Sign in once with Google or an email code, and your links live on bestboy.dev.'],
			['Free to watch.', 'Viewers and commenters need no account.'],
		],
	},
	{
		version: '0.14',
		date: '2026-10-18',
		title: 'Your zooms land sooner',
		notes: 'A stiffer spring lands every zoom sooner, and the inspector sits on the left.',
	},
	{
		version: '0.13',
		date: '2026-10-18',
		title: 'Export again in one click',
		notes: [
			['Repeat export.', 'Your last settings and destination, in one click. `▾` changes them.'],
			['Progress rings.', 'Watch it on the button or the menu bar, and get a notification when it’s done.'],
		],
	},
	{
		version: '0.12',
		date: '2026-10-18',
		title: 'Stack zooms, and pick how clicks look',
		notes: [
			['Combined zooms.', 'Overlapping zooms stack in rows, and chained loupes glide as one.'],
			['Click effects.', 'Pick a swell through the screen, a lit wave, a soft circle, or a focus ring.'],
		],
	},
	{
		version: '0.11',
		date: '2026-10-16',
		title: 'Magnify one spot, and keep the whole screen',
		clip: 'A glass loupe follows the cursor along a revenue chart, then a click on Export CSV ripples through the screen.',
		notes: [
			['Glass loupe.', 'Magnify one spot and keep the whole screen in view.'],
			['Click ripple.', 'Each click ripples through the screen.'],
			['Calmer timeline.', 'Lanes for zooms, layouts, and masks show up once you use them.'],
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
		title: 'Crop to what matters',
		notes: [
			['Crop.', 'Keep the part that matters. Zooms aim inside it.'],
			['Auto-zoom on the countdown.', 'Press `Z` to flip it before you record.'],
			['Per-clip control.', 'Mute system audio, hide the cursor, or stop smoothing for one clip.'],
		],
	},
	{
		version: '0.8',
		date: '2026-10-08',
		title: 'The picker opens the way you left it',
		notes: 'However you open it, the picker starts in your last mode, even after a restart.',
	},
	{
		version: '0.7',
		date: '2026-10-08',
		title: 'You decide on auto-zoom',
		notes: 'Choose in Settings whether new recordings get auto zooms.',
	},
	{
		version: '0.6',
		date: '2026-10-08',
		title: 'Updates never interrupt a take',
		notes: [
			['Quiet updates.', 'They install while you’re away, never during a recording or an export.'],
			['Recent captures.', 'Your last five, with thumbnails, in the menu bar.'],
			['Faster picker.', 'It opens in about half the time.'],
		],
	},
	{
		version: '0.5',
		date: '2026-10-07',
		title: 'More room for your timeline',
		notes: 'Clips drop their titles, so the clip lane takes less room.',
	},
	{
		version: '0.4',
		date: '2026-10-07',
		title: 'Your recording, edge to edge',
		notes: [
			['Plain by default.', 'Recordings show edge to edge. A background brings its own padding.'],
			['Freeze, then mark up.', 'The screen freezes as the picker opens. Ink thins with speed.'],
			['One permission less.', 'Grant Accessibility and you’re set. Input Monitoring is gone.'],
		],
	},
	{
		version: '0.3',
		date: '2026-10-06',
		title: 'Pick an area, then copy it or record it',
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
		title: 'See when an update is ready',
		notes: 'A downloaded update waits on the recording toolbar, ready to restart into.',
	},
	{
		version: '0.1',
		date: '2026-10-05',
		title: 'Record your screen, get a polished video',
		notes: [
			['Auto-zoom.', 'Your clicks and typing become zooms that follow your cursor.'],
			['A redrawn cursor.', 'Smoothed, exact on every click, hidden when idle.'],
			['Captions on your Mac.', '25 languages, word by word. Delete a word and the video follows.'],
			['Export and share.', 'MP4 up to 4K at 60 fps, GIF, subtitles, or a link.'],
		],
	},
];
