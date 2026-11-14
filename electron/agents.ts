// Owner: agents. Grip's tools for AI agents, as an MCP server: JSON-RPC 2.0, one message per line, on a
// Unix socket only this user can open, one session per connection. An agent app runs grip-mcp
// (build/grip-mcp; Contents/Resources/grip-mcp in Grip.app), which pipes its stdin and stdout to the
// socket, and first starts Grip in the menu bar (--background) when nothing listens there. A shell runs
// grip (build/grip; Contents/Resources/grip), which makes one tool call on the socket the same way.
//
//   Socket: Grip.sock in the user's temporary folder; a dev checkout's is Grip-<md5 of its path, 12 hex>.sock,
//   well under the 104 bytes a socket path may take. grip-mcp works out the same path.
//   Tools (TOOLS below): list_projects, get_project, get_transcript, transcribe_project, edit_project,
//   get_frame, export_project, share_project, export_status, open_project, get_feedback, reply_feedback
//   (electron/feedback.ts: a share link's comment threads, and replies to them), record_demo (electron/demo.ts:
//   a web page recorded while an agent's steps run on it, then exported and shared). Every time is in output
//   seconds: the edited video. Grip does the craft, so any model gets the same video: cut_fillers and
//   shorten_pauses cut what the Transcript tab cuts, a cut never clips a word, match_captions turns a
//   script into caption fixes, and every project answer lists its problems (zoomProblems) with the
//   edit_project call that fixes each.
//
// A project open in an editor is read and edited through that editor, so the user sees an agent's edits
// as they land, as one undo step saved before the reply; a closed one is edited on disk under the bundle lock.
//   event agents:request(id, { edits?, time?, frame? })   to the editor (Editor.svelte); frame: { t, height }
//   agents:reply(id, { project, frame? } | { error })      its answer; frame: JPEG bytes
//   agents:ready()                                 its page listens for requests (again after each load)
//   agents:setup() -> { command, config }          how to add Grip to an agent app (Settings)
import { app, ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, existsSync, realpathSync, rmSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { bundleArg, projectsDir, readProject, recentProjects, updateProject } from './projects.ts'
import { exportListeners, exportWithoutAsking } from './export.ts'
import { loadSpoken, runTranscript, type Progress as Heard } from './transcript.ts'
import { editorFor, openProject } from './shell/recorder.ts'
import { settings } from './shell/settings.ts'
import { plainError } from './shell/errors.ts'
import { hidden } from './windows.ts'
import { getFeedback, LINK, MAX_REPLIES, replyFeedback, THREADS } from './feedback.ts'
import { demoStatus, recordDemo } from './demo.ts'
import { DEMO_INPUT } from '../src/shared/demo.ts'
import { applyEdits, LIMITS, parseEdits, type Edit } from '../src/shared/edits.ts'
import { CAPTION_FONTS, type Project, type Transcript } from '../src/shared/project.ts'
import { parseEvents, type InputEvent } from '../src/shared/events.ts'
import { cuts, mapRange, timeMap, toOutput, toSource, type TimeMap } from '../src/shared/timemap.ts'
import { outputWords, PAUSE_KEEP, PAUSE_MIN, resolveWordEdits } from '../src/engine/transcript/index.ts'
import { lookOf, zoomProblems } from '../src/engine/zoom/index.ts'
import { layoutOf } from '../src/engine/scene.ts'
import { cleanOptions, defaultOptions, formatBytes, QUALITIES, RATES, SIZES, type ExportOptions, type ExportRequest, type JobInfo } from '../src/engine/export/options.ts'

/** Protocol versions this server speaks, newest first: a client gets its own, or the newest. */
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const WAIT_MS = 45_000 // an export call returns by then: clients give up on a call after about 60 s
const ASK_MS = 30_000 // an editor answers by then, even one still opening a 2-hour project
// Pages: some agent apps hand the model structuredContent, as JSON, so a page stays near 8k tokens there.
const MAX_WORDS = 500 // words a get_transcript answer lists
const MAX_ITEMS = 100 // clips, zooms, clicks, cuts, and problems a get_project answer lists
const FRAME_SIZES = [360, 540, 720, 1080] // px tall: get_frame's sizes
const MAX_LINE = 8 << 20 // bytes in one message

const INSTRUCTIONS = `Grip records the screen and turns recordings into polished videos. These tools read, edit, export, and share Grip projects (.grip bundles) on this Mac.
- Name a project by the absolute path of its .grip bundle, or by its name as list_projects shows it.
- Every time is in output seconds: the video as it plays, after its cuts and speed changes. get_project shows each clip's output and recording times, and when and where each click lands.
- Captions and get_transcript need a transcript: transcribe_project makes one on this Mac.
- edit_project applies a list of edits together, or none of them when one is wrong. Every time in the list refers to the video as it was before the list. In a project open in Grip's editor, the list is one undo step.
- Edits never change the recording: cuts, zooms, and caption fixes sit on top of it, and the user can undo them. restore_cut brings back what a cut removed.
- Let Grip do the editing craft: cut_fillers and shorten_pauses cut filler words and dead air the way Grip's Transcript tab does, a cut that would clip a word moves to the word's edge, and match_captions makes the captions read a script you give it. When you know what is said, give the whole script to match_captions instead of fixing words one by one: it also catches the case and punctuation a word-by-word read misses.
- Zoom on what the narration talks about while it does: get_project lists each click's time and x, y for add_zoom.
- get_project and every edit_project answer list the video's problems (a zoom too short to read, or one the camera glides to and leaves before it holds still, the camera moving while a cut jumps the picture, the video ending mid zoom-out), each with the exact call that fixes it. Fix them all before export_project.
- get_frame shows a frame as the export renders it, to check a zoom's framing or the captions.
- record_demo films a web page while it runs your steps on it (click, hover, type, press, scroll, wait), with no person in the loop: to show a UI change, it makes a new project, as polished as a recording, exported as an MP4 and a GIF, and shared when asked.
- export_project, share_project, and record_demo wait up to 45 s. A longer one returns its id, and export_status waits for it again.
- Review loop on a share link: get_feedback reads what teammates said, each thread at a moment and spot of the video; fix what they asked, record or share again (record_demo with link puts the new video behind the same link), then reply_feedback answers each thread with what changed and resolves it.`

type Args = Record<string, unknown>
type Result = { text: string; data: Record<string, unknown>; image?: { data: string; mimeType: string }; images?: Array<{ data: string; mimeType: string }>; failed?: boolean }
type Progress = (percent: number, message: string) => void
type Reply = { project?: Project; frame?: Uint8Array; error?: string }
type Request = { edits?: Edit[]; time?: number; frame?: { t: number; height: number } }
type Opened = { path: string; project: Project; open: boolean }

class RpcError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}
/** A closed project was opened in an editor meanwhile: the edit goes through the editor instead. */
class Reroute extends Error {}

const r3 = (t: number) => Math.round(t * 1000) / 1000
const sec = (t: number) => `${Math.round(t * 100) / 100} s`
const quoted = (path: string) => `“${basename(path, '.grip')}”`
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

// ---- Tools ----

const PROJECT = { type: 'string', minLength: 1, description: 'The project: the absolute path of its .grip bundle, or its name as list_projects shows it.' }
const AT = (what: string) => ({ type: 'number', minimum: 0, description: `${what}, in output seconds.` })
const RANGE = { start: AT('Start'), end: AT('End, after start') }
const ZOOM_ID = { type: 'string', minLength: 1, description: 'The zoom’s id, as get_project lists it.' }
const LEVEL = { type: 'number', minimum: LIMITS.level[0], maximum: LIMITS.level[1], description: 'How far in: 2 shows a quarter of the screen. Default: the project’s auto zoom level.' }
const X = { type: 'number', minimum: 0, maximum: 1, description: 'The point to zoom on, across the recording: 0 left, 1 right. Give y too.' }
const Y = { type: 'number', minimum: 0, maximum: 1, description: 'The point to zoom on, down the recording: 0 top, 1 bottom. Give x too.' }
const variant = (type: Edit['type'], description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  description,
  properties: { type: { type: 'string', enum: [type] }, ...properties },
  required: ['type', ...required],
  additionalProperties: false,
})
const EDIT = {
  anyOf: [
    variant('cut', 'Cut start..end out of the video; what follows moves up. An end inside a spoken word moves to the word’s edge, so no word plays clipped.', RANGE, ['start', 'end']),
    variant('restore_cut', 'Bring back what a cut removed: the cut at this output time, as get_project lists it.', { at: AT('The cut') }, ['at']),
    variant('cut_fillers', 'Cut every filler word the video still plays (um, uh, and the like), each with the pause around it, as Grip’s Transcript tab does. Needs a transcript.', {}, []),
    variant('shorten_pauses', `Shorten every pause over ${PAUSE_MIN} s between spoken words to ${PAUSE_KEEP} s, as Grip’s Transcript tab does. Pauses with clicks, typing, or scrolling stay: they show the demo. Needs a transcript.`, {}, []),
    variant('set_speed', 'Play start..end at a speed.', { ...RANGE, speed: { type: 'number', minimum: LIMITS.speed[0], maximum: LIMITS.speed[1], description: '2 plays twice as fast, 0.5 at half speed.' } }, ['start', 'end', 'speed']),
    variant(
      'add_zoom',
      'Zoom in over start..end: on the point x, y, or following the cursor without them.',
      {
        ...RANGE,
        look: { type: 'string', enum: ['zoom', 'loupe'], description: 'zoom: the camera moves in on the screen. loupe: a round glass lens magnifies the spot, and the rest of the screen stays in view. Default: the look last picked in Grip.' },
        level: LEVEL,
        x: X,
        y: Y,
      },
      ['start', 'end'],
    ),
    variant('set_zoom', 'Change a zoom: its start, end, level, or point. What is left out stays as it is.', { id: ZOOM_ID, start: AT('Its new start'), end: AT('Its new end'), level: { ...LEVEL, description: 'How far in: 2 shows a quarter of the screen.' }, x: X, y: Y }, ['id']),
    variant('remove_zoom', 'Remove a zoom.', { id: ZOOM_ID }, ['id']),
    variant(
      'set_caption_text',
      'Fix one word in the captions; the recording and its transcript stay as they are. With the script at hand, match_captions fixes every word at once.',
      {
        index: { type: 'integer', minimum: 0, description: 'The word’s index, as get_transcript lists it.' },
        text: { type: 'string', maxLength: 200, description: 'What the captions show for it. An empty string hides the word.' },
      },
      ['index', 'text'],
    ),
    variant(
      'match_captions',
      'Make the captions read a script: the words said, as they should read. Grip lines its words up with the spoken ones and fixes each that differs (case, punctuation, a misheard word, “0.3” for “zero point three”), hiding spoken words the script leaves out. Needs a transcript.',
      {
        text: { type: 'string', minLength: 1, maxLength: 20000, description: 'The script of what is said over start..end.' },
        start: AT('Where the script starts, when it covers only part of the video'),
        end: AT('Where it ends'),
      },
      ['text'],
    ),
    {
      ...variant(
        'set_captions',
        'Show or hide the captions, and set their look. Give at least one field.',
        {
          visible: { type: 'boolean' },
          mode: { type: 'string', enum: ['line', 'word'], description: 'line: a line at a time; word: one word at a time.' },
          position: { type: 'string', enum: ['bottom', 'top'] },
          size: { type: 'number', minimum: LIMITS.captionSize[0], maximum: LIMITS.captionSize[1], description: 'Text size in px at 1080p.' },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'Text color, like #ffffff.' },
          font: { type: 'string', enum: CAPTION_FONTS.map((f) => f.value) },
          animation: { type: 'string', enum: ['appear', 'fade', 'slide'], description: 'How each line or word comes in.' },
        },
        [],
      ),
      minProperties: 2,
    },
  ],
}

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  annotations: Record<string, boolean>
  /** `client`: the agent app calling, as its initialize named it. */
  run(a: Args, progress: Progress, client?: string): Promise<Result>
}
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'List Grip’s projects, the ones in its projects folder and the ones opened lately, last edited first: each one’s length (output seconds), last edit, and whether it is open in the editor.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: listProjects,
  },
  {
    name: 'get_project',
    title: 'Get project',
    description: `A project’s timeline: clips (output and recording times, speed, volume), zooms (id, output times, level, target, look), clicks (output time, and where on the recording as the x, y add_zoom takes), cuts (output time, for restore_cut), the caption settings, whether it has a transcript, and its problems, each with the call that fixes it. A project open in the editor reads as the editor shows it. Give start and end for the clips, zooms, clicks, and cuts playing then. At most ${MAX_ITEMS} of each a call: next, when there, is the start to ask again with.`,
    inputSchema: { type: 'object', properties: { project: PROJECT, ...RANGE }, required: ['project'] },
    annotations: { readOnlyHint: true },
    run: async (a) => describe(await current(await locate(a.project)), '', range(a)),
  },
  {
    name: 'get_transcript',
    title: 'Get transcript',
    description: `A project’s transcript as the video plays it, word by word: each word’s index (for set_caption_text), the text the captions show (empty when hidden), and its output start and end. original is what was said, when the captions show a fix; filler marks a filler word, which the captions leave out unless it is fixed. Give start and end for the words playing then. At most ${MAX_WORDS} words a call: next, when there, is the start to ask again with.`,
    inputSchema: { type: 'object', properties: { project: PROJECT, ...RANGE }, required: ['project'] },
    annotations: { readOnlyHint: true },
    run: getTranscript,
  },
  {
    name: 'transcribe_project',
    title: 'Transcribe project',
    description: 'Transcribe what a project’s recording says, on this Mac, so get_transcript reads its words and the captions show them. The first run downloads the speech model once. Waits up to 45 s; when it is still going, ask again to keep waiting. A project that has a transcript keeps it.',
    inputSchema: { type: 'object', properties: { project: PROJECT }, required: ['project'] },
    annotations: { ...WRITES, idempotentHint: true },
    run: transcribeProject,
  },
  {
    name: 'edit_project',
    title: 'Edit project',
    description: 'Edit a project: cut or restore a cut, cut filler words and long pauses, change speed, add, change, or remove zooms, fix caption words, set the captions’ look. The edits apply together or not at all, and every time refers to the video as it was before this call, as get_project showed it. In an open editor they are one undo step. Returns what Grip adjusted, then the project as get_project does, problems included.',
    inputSchema: { type: 'object', properties: { project: PROJECT, edits: { type: 'array', minItems: 1, maxItems: 1000, items: EDIT, description: 'The edits, applied together.' } }, required: ['project', 'edits'] },
    annotations: WRITES,
    run: editProject,
  },
  {
    name: 'get_frame',
    title: 'Get frame',
    description: 'A frame of the edited video as a JPEG, rendered as the export renders it: to check a zoom’s framing, the captions, or what plays after a cut. A project that is not open opens in the editor to render it.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT, time: AT('The frame'), size: { type: 'integer', enum: FRAME_SIZES, description: 'The image’s height in px. Default: 720.' } },
      required: ['project', 'time'],
    },
    annotations: { readOnlyHint: true },
    run: getFrame,
  },
  {
    name: 'export_project',
    title: 'Export project',
    description: 'Export a project as a video file without any dialog: to path, or under the project’s name into the folder Grip last exported to (the Desktop at first). It never replaces a file: a taken name gets a number. Waits up to 45 s; a longer export returns its id for export_status.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        format: { type: 'string', enum: ['mp4', 'gif'], description: 'Default: what path ends in, else mp4.' },
        size: { type: 'integer', enum: [...new Set([...SIZES.gif, ...SIZES.mp4])], description: `The short side in px. mp4: ${SIZES.mp4.join(', ')} (default 1080). gif: ${SIZES.gif.join(', ')} (default 720).` },
        fps: { type: 'integer', enum: [...new Set([...RATES.gif, ...RATES.mp4])], description: `Frames a second. mp4: ${RATES.mp4.join(' or ')} (default 60). gif: ${RATES.gif.join(', ')} (default 15).` },
        quality: { type: 'string', enum: QUALITIES, description: 'mp4 only, the largest file first. Default: social.' },
        path: { type: 'string', description: 'The absolute path of the file to write, ending in .mp4 or .gif, in a folder that exists.' },
      },
      required: ['project'],
    },
    annotations: WRITES,
    run: exportProject,
  },
  {
    name: 'share_project',
    title: 'Share project',
    description: 'Upload a project as a video and return its share link on bestboy.dev; the user’s clipboard stays as it is. Needs Grip signed in to a Bestboy account. Waits up to 45 s; a longer export returns its id for export_status.',
    inputSchema: { type: 'object', properties: { project: PROJECT, private: { type: 'boolean', description: 'Only the user’s team, and people sent this exact link, can watch. Default: false.' } }, required: ['project'] },
    annotations: { ...WRITES, openWorldHint: true },
    run: shareProject,
  },
  {
    name: 'export_status',
    title: 'Export status',
    description: 'How an export or a share from export_project or share_project, or a demo from record_demo, stands. Waits up to 45 s for it to finish, then returns its state, progress, and file or link; a finished demo answers as record_demo does.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, description: 'The id export_project, share_project, or record_demo returned.' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
    run: (a, progress) => demoStatus(a.id, progress) ?? exportStatus(a, progress),
  },
  {
    name: 'open_project',
    title: 'Open project',
    description: 'Open a project in Grip’s editor, or bring its window forward, optionally with the playhead at an output time.',
    inputSchema: { type: 'object', properties: { project: PROJECT, time: AT('Where the playhead goes') }, required: ['project'] },
    annotations: { ...WRITES, idempotentHint: true },
    run: openInEditor,
  },
  {
    name: 'get_feedback',
    title: 'Get feedback',
    description: `What teammates said on a share link: its comment threads, open ones first, then resolved. Each has its id, its moment of the video (t in seconds, and time as m:ss), the spot on the frame it points at when it does (x, y from 0 to 1 from the left and top), its writer (author; guest when they had no account), text, when it was written (at), and its replies in order, each with the reply it answers when not the thread itself. Reactions are only counted. When this Mac shared the link from a project, each open thread comes with an image: that project's frame at the thread's time, as get_frame renders it (the editor opens for it), with the spot ringed. At most ${THREADS} threads a call: next, when there, is the start to ask again with. reply_feedback answers threads by their ids.`,
    inputSchema: { type: 'object', properties: { link: LINK, start: { type: 'number', minimum: 0, description: 'Where the page starts, in seconds of the shared video: next from the last answer.' } }, required: ['link'] },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: (a) => getFeedback(a, getFrame),
  },
  {
    name: 'reply_feedback',
    title: 'Reply to feedback',
    description: 'Reply on a share link’s comment threads as the Bestboy account Grip is signed in to, and resolve the threads that are done: say what changed, or why not. Each reply goes under the comment or reply it names by get_feedback’s id; resolve: true then resolves its thread. Grip posts them in order, applies what it can, and says how each went. Needs Grip signed in.',
    inputSchema: {
      type: 'object',
      properties: {
        link: LINK,
        replies: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_REPLIES,
          description: 'The replies, posted in order.',
          items: {
            type: 'object',
            properties: {
              comment: { type: 'string', minLength: 1, description: 'The id of the thread, or of the reply in it, to answer, as get_feedback lists it.' },
              text: { type: 'string', minLength: 1, maxLength: 2000, description: 'What to say.' },
              resolve: { type: 'boolean', description: 'Also resolve the thread. Default: false.' },
            },
            required: ['comment', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['link', 'replies'],
    },
    annotations: { ...WRITES, openWorldHint: true },
    run: (a, _, client) => replyFeedback(a, client),
  },
  {
    name: 'record_demo',
    title: 'Record demo',
    description:
      'Film a web page while Grip runs steps on it, to show a UI change with no person in the loop. Grip opens the page where nobody sees it (no Screen Recording permission), moves the pointer to each target as a hand would, clicks, types, presses keys, and scrolls with real input (the page’s alerts and confirms never show, and a confirm answers no), and keeps it as a new project made like a recording: auto zooms on the clicks and typing, the smooth cursor, and click effects. Then it exports an MP4 and a GIF into the folder export_project uses, and with share uploads them for a link; with link, the video becomes the next version behind an earlier demo’s link, so the places it was posted show the fix. It answers with the project, the files, the link and its version, the length, and each step: its label, whether it worked, and its output time, with an image of each step as it ended, as get_frame renders it. A step whose element does not show within 10 s, or a page that fails to load, stops the demo: the answer names the step and why, with an image of the page, and keeps no project. Waits up to 45 s; a longer one returns its id for export_status.',
    inputSchema: DEMO_INPUT,
    annotations: { ...WRITES, openWorldHint: true },
    run: (a, progress) => recordDemo(a, progress, getFrame),
  },
]

// ponytail: every project in one answer, about 40 tokens each; page it like get_project once a library
// runs to hundreds.
async function listProjects(): Promise<Result> {
  const rows = await Promise.all(
    (await known()).map(async (path) => {
      try {
        const [p, s] = await Promise.all([readProject(path), stat(join(path, 'project.json'))])
        return { name: basename(path, '.grip'), path, duration: r3(timeMap(p.clips).duration), modified: new Date(s.mtimeMs).toISOString(), open: !!editorFor(path) }
      } catch {
        return null // no project yet (a recording in progress), or damaged beyond its backup
      }
    }),
  )
  const projects = rows.filter((r) => r !== null).sort((a, b) => b.modified.localeCompare(a.modified))
  const lines = projects.map((p) => `- ${quoted(p.path)}: ${sec(p.duration)}, edited ${p.modified}${p.open ? ', open in the editor' : ''}\n  ${p.path}`)
  return { text: projects.length ? `${count(projects.length, 'project')}, last edited first:\n${lines.join('\n')}` : `No projects yet. Recordings land in ${projectsDir()}.`, data: { projects } }
}

async function getTranscript(a: Args): Promise<Result> {
  const path = await locate(a.project)
  const [from, to] = range(a)
  const { project } = await current(path)
  const t = await loadSpoken(path, project)
  if (!t) throw new Error(`${quoted(path)} has no transcript yet. transcribe_project makes one; then ask again.`)
  // Every play of a word, in output order: pages by output time hold up even when clips repeat or move.
  const plays = outputWords(t, timeMap(project.clips), project.captionEdits)
  const matching = plays.filter((o) => o.end > from && o.start < to)
  const words = matching.slice(0, MAX_WORDS).map((o) => {
    const w = t.words[o.i]
    return { index: o.i, text: o.text, start: r3(o.start), end: r3(o.end), ...(project.captionEdits[w.key ?? o.i] !== undefined && { original: w.text }), ...(w.filler && { filler: true }) }
  })
  const next = matching.length > MAX_WORDS ? r3(matching[MAX_WORDS].start) : undefined
  const cut = t.words.length - new Set(plays.map((o) => o.i)).size
  // Readable lines of consecutive words, each after its output time and its first word's index: a line
  // ends with a sentence, at a pause over 1 s, where the video jumps, or at 14 words.
  const lines: string[] = []
  let line: typeof words = []
  const flush = () => {
    if (!line.length) return
    const shown = line.map((w) => (w.text && !(w.filler && w.original === undefined) ? w.text : `~~${w.original ?? w.text}~~`))
    lines.push(`${sec(line[0].start)}  #${line[0].index}  ${shown.join(' ')}`)
    line = []
  }
  for (const w of words) {
    const prev = line.at(-1)
    if (prev && (w.index !== prev.index + 1 || w.start - prev.end > 1 || line.length >= 14)) flush()
    line.push(w)
    if (/[.!?…]["'”’)\]]*$/.test(w.text)) flush()
  }
  flush()
  const between = from > 0 || to < Infinity ? `, ${matching.length} playing from ${sec(from)}${to < Infinity ? ` to ${sec(to)}` : ''}` : ''
  const head = `${quoted(path)}: ${count(t.words.length, 'word')}${cut ? `, ${cut} cut from the video` : ''}${between}. Each line: its output time, #index of its first word, its words. ~~word~~ is not in the captions (hidden, or a filler word).`
  const rest = next === undefined ? '' : `\n${words.length} of ${matching.length} shown. Ask again with start ${next} for the rest.`
  return { text: `${head}\n${lines.join('\n')}${rest}`, data: { language: t.language, count: t.words.length, cut, words, ...(next !== undefined && { next, more: matching.length - words.length }) } }
}

async function transcribeProject(a: Args, progress: Progress): Promise<Result> {
  const path = await locate(a.project)
  const words = async (note: string) => {
    const t = await loadSpoken(path, (await current(path)).project)
    const text = `${note} ${quoted(path)}: ${count(t?.words.length ?? 0, 'word')}. get_transcript reads them, and set_captions shows them.`
    return { text, data: { message: text, state: 'done', language: t?.language, words: t?.words.length ?? 0 } }
  }
  if ((await readProject(path)).sources.transcript) return words('Already transcribed')
  let at: Heard = { phase: 'queued', progress: 0 }
  const step = (h: Heard) => (h.phase === 'download' ? `downloading the speech model, ${Math.floor(h.progress * 100)}%` : h.phase === 'transcribe' ? `transcribing, ${Math.floor(h.progress * 100)}%` : 'waiting to start')
  const run = runTranscript(path, (h) => {
    at = h
    progress(h.phase === 'download' ? Math.floor(h.progress * 50) : h.phase === 'transcribe' ? 50 + Math.floor(h.progress * 50) : 0, step(h)) // the download, then the words
  })
  const t = await Promise.race([run, new Promise<undefined>((r) => setTimeout(r, WAIT_MS))])
  if (t === undefined) {
    const text = `Still working on ${quoted(path)}: ${step(at)}. transcribe_project again waits for it.`
    return { text, data: { message: text, state: 'running', phase: at.phase, progress: Math.round(at.progress * 100) / 100 } }
  }
  if (!t && !(await readProject(path)).sources.takes?.length) {
    const text = `The transcription of ${quoted(path)} was canceled in Grip.`
    return { text, data: { message: text, state: 'canceled' }, failed: true }
  }
  return words('Transcribed')
}

async function editProject(a: Args): Promise<Result> {
  const path = await locate(a.project)
  const parsed = parseEdits(a.edits)
  const n = count(parsed.length, 'edit')
  for (let tries = 0; ; tries++) {
    const { project, open } = await current(path)
    const { edits, notes } = await byWords(path, project, parsed)
    const said = notes.map((x) => `\n${x}`).join('')
    // ponytail: the cuts are worked out on the project as read just now; an edit landing in between
    // (the user, another agent) shifts them. Send the clips with the request if that ever bites.
    const win = open && editorFor(path)
    if (win) return describe({ path, project: (await ask(win, { edits })).project, open: true }, `Applied ${n} in the open editor, as one undo step, and saved.${said}`)
    try {
      return describe({ path, project: await editOnDisk(path, edits), open: false }, `Applied ${n} and saved.${said}`)
    } catch (e) {
      if (!(e instanceof Reroute) || tries) throw e
    }
  }
}

/** The edits with their transcript edits worked out (resolveWordEdits): filler words and long pauses
 *  as ranges, a script as caption fixes, and cut ends out of words. */
async function byWords(path: string, p: Project, edits: Edit[]) {
  if (!edits.some((e) => e.type === 'cut' || e.type === 'cut_fillers' || e.type === 'shorten_pauses' || e.type === 'match_captions')) return { edits, notes: [] }
  const t = await loadSpoken(path, p).catch(() => null)
  const activity = edits.some((e) => e.type === 'shorten_pauses') ? (await recorded(path, p)).activity : []
  return resolveWordEdits(edits, t, timeMap(p.clips), activity, p.captionEdits)
}

async function editOnDisk(path: string, edits: Edit[]): Promise<Project> {
  const transcript = edits.some((e) => e.type === 'set_caption_text' || e.type === 'match_captions') ? await loadSpoken(path, await readProject(path)) : null
  return updateProject(path, (p) => {
    if (editorFor(path)) throw new Reroute() // its copy would save over this one
    applyEdits(p, edits, lookOf(settings().zoomLook), transcript)
  })
}

async function getFrame(a: Args): Promise<Result> {
  const path = await locate(a.project)
  const at = time(a.time, 'time')!
  const height = a.size ?? 720
  if (!FRAME_SIZES.includes(height as number)) throw new Error(`size must be one of ${FRAME_SIZES.join(', ')}.`)
  if (!editorFor(path)) openProject(path, { focus: false }) // the user keeps typing where they are
  const win = editorFor(path)
  if (!win) throw new Error(`Grip could not open ${quoted(path)}.`)
  const { frame } = await ask(win, { frame: { t: at, height: height as number } })
  if (!frame) throw new Error(`Grip could not render ${quoted(path)} at ${sec(at)}.`)
  const text = `${quoted(path)} at ${sec(at)}, ${height} px tall, as the export renders it.`
  return { text, data: { message: text, time: at, height }, image: { data: Buffer.from(frame).toString('base64'), mimeType: 'image/jpeg' } }
}

async function exportProject(a: Args, progress: Progress): Promise<Result> {
  const path = await locate(a.project)
  const out = a.path as string | undefined
  if (out !== undefined && (typeof out !== 'string' || !isAbsolute(out) || !/\.(mp4|gif)$/i.test(out))) throw new Error('path must be an absolute path ending in .mp4 or .gif.')
  const format = a.format ?? (out ? extname(out).slice(1).toLowerCase() : 'mp4')
  if (format !== 'mp4' && format !== 'gif') throw new Error('format must be mp4 or gif.')
  if (out && extname(out).slice(1).toLowerCase() !== format) throw new Error(`path ends in ${extname(out)}, but format is ${format}.`)
  if (format === 'gif' && a.quality !== undefined) throw new Error('quality is for mp4 only.')
  for (const [k, list] of [['size', SIZES[format]], ['fps', RATES[format]], ['quality', QUALITIES]] as const) {
    if (a[k] !== undefined && !(list as readonly unknown[]).includes(a[k])) throw new Error(`${k} must be one of ${list.join(', ')}${k === 'quality' ? '' : ` for ${format}`}.`)
  }
  const options = cleanOptions({ format, size: a.size, fps: a.fps, quality: a.quality } as Partial<ExportOptions>) // the rest: defaults
  const r = report(await settle(await queue({ bundle: path, options, dest: 'file', path: out }), progress))
  const left = await problemsIn(await current(path))
  if (!left.length || r.failed) return r
  const warn = `${count(left.length, 'problem')} left, each with its fix in get_project: ${left.map((x) => x.message).join(' ')}`
  return { ...r, text: `${r.text}\n${warn}`, data: { ...r.data, problems: left } }
}

async function shareProject(a: Args, progress: Progress): Promise<Result> {
  const path = await locate(a.project)
  if (a.private !== undefined && typeof a.private !== 'boolean') throw new Error('private must be true or false.')
  return report(await settle(await queue({ bundle: path, options: defaultOptions(), dest: 'share', private: a.private === true }), progress))
}

async function exportStatus(a: Args, progress: Progress): Promise<Result> {
  if (typeof a.id !== 'string' || !ours.has(a.id)) throw new Error(`No export has the id “${String(a.id)}” since Grip started. export_project and share_project return the ids.`)
  return report(await settle(a.id, progress))
}

async function openInEditor(a: Args): Promise<Result> {
  const path = await locate(a.project)
  const at = time(a.time, 'time')
  const was = !!editorFor(path)
  if (at !== undefined) {
    const length = timeMap((await current(path)).project.clips).duration
    if (at > length) throw new Error(`time is past the end of the ${sec(length)} video.`)
  }
  // A closed project opens at its saved playhead: put that at the time first.
  const onDisk =
    !was &&
    at !== undefined &&
    (await updateProject(path, (p) => {
      if (editorFor(path)) throw new Reroute()
      p.playhead = toSource(timeMap(p.clips), at)
    }).then(
      () => true,
      (e) => {
        if (e instanceof Reroute) return false
        throw e
      },
    ))
  openProject(path)
  const win = editorFor(path)
  if (!win) throw new Error(`Grip could not open ${quoted(path)}.`)
  if (!hidden) app.focus({ steal: true }) // the user asked their agent for it: Grip comes forward
  const { project } = await ask(win, at !== undefined && !onDisk ? { time: at } : {}) // answers once it has loaded
  return describe({ path, project, open: true }, `${was ? 'Brought forward' : 'Opened'} ${quoted(path)} in the editor${at !== undefined ? ` at ${sec(at)}` : ''}.`)
}

// ---- Projects ----

/** Every project Grip knows: the recent list, then the projects folder. One path a bundle, whatever
 *  Unicode form of an accented name each list holds. */
async function known(): Promise<string[]> {
  const dir = projectsDir()
  const inFolder = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.grip')).map((f) => join(dir, f))
  const paths = new Map<string, string>()
  for (const p of [...(await recentProjects()).map((r) => r.path), ...inFolder]) if (!paths.has(p.normalize('NFC'))) paths.set(p.normalize('NFC'), p)
  return [...paths.values()]
}

/** The bundle `x` names: an absolute .grip path, or the name of a project Grip knows (exactly, else
 *  ignoring case). */
async function locate(x: unknown): Promise<string> {
  if (typeof x !== 'string' || !x.trim()) throw new Error('project must be the absolute path of a .grip project, or its name as list_projects shows it.')
  if (isAbsolute(x)) {
    const path = bundleArg(x) // follows in-app renames
    if (!(await stat(path).catch(() => null))?.isDirectory()) throw new Error(`No project at “${path}”. It may have been moved or deleted; list_projects shows the projects Grip knows.`)
    return path
  }
  const name = x.trim().replace(/\.grip$/i, '').normalize('NFC')
  const all = await known()
  const named = (same: (a: string) => boolean) => all.filter((p) => same(basename(p, '.grip').normalize('NFC')))
  let hits = named((a) => a === name)
  if (!hits.length) hits = named((a) => a.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (hits.length === 1) return hits[0]
  if (hits.length) throw new Error(`${hits.length} projects are named “${name}”:\n${hits.join('\n')}\nGive the path of the one you mean.`)
  throw new Error(`No project is named “${name}”. list_projects shows the projects Grip knows.`)
}

/** The project as the user sees it: an open editor's, unsaved edits included, else the saved one. */
async function current(path: string): Promise<Opened> {
  const win = editorFor(path)
  return { path, project: win ? (await ask(win, {})).project : await readProject(path), open: !!win }
}

/** A time argument in seconds, or undefined when not given. */
function time(v: unknown, what: string): number | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${what} must be a number of seconds, 0 or more.`)
  return v
}

/** The start and end arguments, the whole video without them. */
function range(a: Args): [number, number] {
  const from = time(a.start, 'start') ?? 0
  const to = time(a.end, 'end') ?? Infinity
  if (to <= from) throw new Error('end must come after start.')
  return [from, to]
}

// ponytail: the last project's input, read once: a 2-hour recording's events run to a million lines,
// and an agent reads the same project call after call. A map by bundle if agents juggle projects.
type Press = Extract<InputEvent, { type: 'down' | 'up' }>
type Recorded = { downs: Press[]; activity: number[] }
let input: { file: string; stamp: string; value: Recorded } | null = null
/** The recording's mouse presses, as the editor's click effects take them (parseEvents drops the pen's),
 *  and the source seconds of its clicks, key presses, and scrolls, as the Transcript tab's pauses take them. */
async function recorded(path: string, p: Project): Promise<Recorded> {
  const none = { downs: [], activity: [] }
  if (!p.sources.events) return none
  const file = join(path, p.sources.events)
  const s = await stat(file).catch(() => null)
  if (!s) return none
  const stamp = `${s.size}:${s.mtimeMs}`
  if (input?.file !== file || input.stamp !== stamp) {
    // Presses and key presses ("down"), scrolls, and the pen strokes that are not clicks.
    const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l.includes('"down"') || l.includes('"scroll"') || l.includes('"draw"'))
    const events = parseEvents(lines.join('\n'))
    const activity = events.flatMap((e) => (e.type === 'down' || e.type === 'scroll' || (e.type === 'key' && e.down) ? [e.t] : []))
    input = { file, stamp, value: { downs: events.filter((e): e is Press => e.type === 'down'), activity } }
  }
  return input.value
}

type Problem = { message: string; zoom?: string; fix: { tool: string; arguments: Args } }
/** What would look wrong in the video, each with the call that fixes it. */
function problems(p: Project, m: TimeMap, t: Transcript | null): Problem[] {
  return [
    ...zoomProblems(p, m, layoutOf(p, m, t)).map((z) => ({ message: z.message, zoom: z.id, fix: { tool: 'edit_project', arguments: { edits: z.fix } } })),
    ...(p.style.captions.visible && !t ? [{ message: 'The captions are on, but the project has no transcript, so they show nothing.', fix: { tool: 'transcribe_project', arguments: {} } }] : []),
  ]
}
const problemsIn = async ({ path, project: p }: Opened) => problems(p, timeMap(p.clips), await loadSpoken(path, p).catch(() => null))
const callText = (f: Problem['fix']) => `${f.tool}${'edits' in f.arguments ? ` with edits ${JSON.stringify(f.arguments.edits)}` : ''}`

/** get_project's answer: the timeline in output seconds, with the recording time each clip plays. It
 *  lists the clips, zooms, and clicks playing from `from` to `to`, MAX_ITEMS of each at most. */
async function describe({ path, project: p, open }: Opened, note: string, [from, to] = [0, Infinity]): Promise<Result> {
  const m = timeMap(p.clips)
  const t: Transcript | null = await loadSpoken(path, p).catch(() => null)
  const screen = p.sources.screen
  const playing = (x: { start: number; end: number }) => x.end > from && x.start < to
  const allClips = p.clips
    .map((c, i) => ({
      id: c.id,
      start: r3(m.outStarts[i]),
      end: r3(m.outStarts[i] + (c.end - c.start) / c.speed),
      source: { start: r3(c.start), end: r3(c.end) },
      speed: c.speed,
      volume: c.volume,
      ...(c.muted && { muted: true }),
    }))
    .filter(playing)
  const allZooms = p.zooms
    .flatMap((z) => {
      const spans = mapRange(m, z.start, z.end)
      if (!spans.length) return [] // cut out: it never plays
      const target = z.target.kind === 'point' ? { x: z.target.x, y: z.target.y } : ('cursor' as const)
      return [{ id: z.id, start: r3(Math.min(...spans.map((s) => s[0]))), end: r3(Math.max(...spans.map((s) => s[1]))), level: z.level, target, look: z.mode === 'loupe' ? 'loupe' : 'zoom', enabled: z.enabled, ...(z.auto && { auto: true }) }]
    })
    .filter(playing)
    .sort((a, b) => a.start - b.start)
  // Presses on the recorded screen that play (one inside a cut never shows), at their first play.
  const allClicks = (screen ? (await recorded(path, p)).downs : [])
    .flatMap((e) => {
      const [at, x, y] = [toOutput(m, e.t), e.x / screen!.width, e.y / screen!.height]
      return at === null || at < from || at >= to || x < 0 || y < 0 || x > 1 || y > 1 ? [] : [{ t: r3(at), x: r3(x), y: r3(y) }]
    })
    .sort((a, b) => a.t - b.t)
  const allCuts = cuts(m, p.sources.duration)
    .filter((c) => c.t >= from && c.t < to)
    .map((c) => ({ t: r3(c.t), removed: r3(c.removed) }))
  // A page ends where the clip, the zoom, the click, or the cut past MAX_ITEMS starts.
  const next = Math.min(allClips[MAX_ITEMS]?.start ?? Infinity, allZooms[MAX_ITEMS]?.start ?? Infinity, allClicks[MAX_ITEMS]?.t ?? Infinity, allCuts[MAX_ITEMS]?.t ?? Infinity)
  const clips = allClips.filter((c) => c.start < next)
  const zooms = allZooms.filter((z) => z.start < next)
  const clicks = allClicks.filter((c) => c.t < next)
  const cutList = allCuts.filter((c) => c.t < next)
  // Problems are the whole video's, whatever the page.
  const found = problems(p, m, t).slice(0, MAX_ITEMS)
  const edits = found.flatMap((x) => (x.fix.tool === 'edit_project' ? (x.fix.arguments.edits as Edit[]) : []))
  const between = from > 0 || to < Infinity ? ` playing from ${sec(from)}${to < Infinity ? ` to ${sec(to)}` : ''}` : ''
  const { visible, mode, position, size, color, font, animation } = p.style.captions
  const text = [
    ...(note ? [note] : []),
    `${quoted(path)}: ${sec(m.duration)} long (${sec(p.sources.duration)} recorded)${open ? ', open in the editor' : ''}`,
    path,
    `${count(clips.length, 'clip')}${between}, output ← recording:`,
    ...clips.map((c) => `  ${c.start}-${c.end} s ← ${c.source.start}-${c.source.end} s${c.speed !== 1 ? `, ${c.speed}×` : ''}${c.volume !== 1 ? `, volume ${Math.round(c.volume * 100)}%` : ''}${c.muted ? ', muted' : ''}`),
    `${count(zooms.length, 'zoom')}${between}${zooms.length ? ':' : ''}`,
    ...zooms.map((z) => `  ${z.id}: ${z.start}-${z.end} s, ${z.level}×, ${z.target === 'cursor' ? 'follows the cursor' : `at ${z.target.x}, ${z.target.y}`}${z.look === 'loupe' ? ', loupe' : ''}${z.enabled ? '' : ', off'}${z.auto ? ', auto' : ''}`),
    `${count(clicks.length, 'click')}${between}${clicks.length ? ', at output time, on the recording at x, y:' : ''}`,
    ...(clicks.length ? [`  ${clicks.map((c) => `${c.t} s at ${c.x}, ${c.y}`).join('; ')}`] : []),
    `${count(cutList.length, 'cut')}${between}${cutList.length ? ', at output time, with the recording each removed (restore_cut brings one back):' : ''}`,
    ...(cutList.length ? [`  ${cutList.map((c) => `${c.t} s (${sec(c.removed)})`).join('; ')}`] : []),
    ...(next < Infinity ? [`More clips, zooms, clicks, and cuts play from ${sec(next)}: get_project with start ${next} lists them.`] : []),
    `Captions: ${visible ? 'shown' : 'hidden'}, ${mode}, ${position}, size ${size}, ${color}, ${font}, ${animation}`,
    t ? `Transcript: ${count(t.words.length, 'word')} (get_transcript reads them)` : 'Transcript: none yet (transcribe_project makes one)',
    found.length ? `${count(found.length, 'problem')} to fix before export:` : 'Problems: none.',
    ...found.map((x) => `  - ${x.message} Fix: ${callText(x.fix)}`),
    ...(edits.length > 1 && found.filter((x) => x.fix.tool === 'edit_project').length > 1 ? [`  All the zoom fixes in one call: edit_project with edits ${JSON.stringify(edits)}`] : []),
  ]
  const data = {
    ...(note && { message: note }), // what the text says first, for agent apps that only pass this on
    name: basename(path, '.grip'),
    path,
    open,
    duration: r3(m.duration),
    recorded: r3(p.sources.duration),
    clips,
    zooms,
    clicks,
    cuts: cutList,
    ...(next < Infinity && { next }),
    captions: { visible, mode, position, size, color, font, animation },
    transcript: { exists: !!t, words: t?.words.length ?? 0 },
    problems: found,
  }
  return { text: text.join('\n'), data }
}

// ---- Exports ----

const ours = new Map<string, JobInfo>() // agents' exports, as they last stood
const waiting = new Map<string, Set<(j: JobInfo) => void>>()
const ended = (j: JobInfo) => j.state === 'done' || j.state === 'failed' || j.state === 'canceled'

/** Queue an export of what the user sees: an open editor's project, unsaved edits included. */
async function queue(r: ExportRequest): Promise<string> {
  const win = editorFor(r.bundle)
  const job = await exportWithoutAsking({ ...r, project: win ? (await ask(win, {})).project : undefined })
  ours.set(job.id, job)
  if (ours.size > 200) ours.delete(ours.keys().next().value!)
  return job.id
}

/** The job once it ends, or as it stands after WAIT_MS; its progress meanwhile. */
function settle(id: string, progress: Progress): Promise<JobInfo> {
  return new Promise((resolve) => {
    const listeners = waiting.get(id) ?? waiting.set(id, new Set()).get(id)!
    const done = () => {
      clearTimeout(timer)
      listeners.delete(seen)
      if (!listeners.size) waiting.delete(id)
      resolve(ours.get(id)!)
    }
    const seen = (j: JobInfo) => {
      if (!listeners.has(seen)) return // done already: nothing may follow the answer
      if (ended(j)) return done()
      progress(Math.floor(j.progress * 100), `${j.phase}, ${Math.floor(j.progress * 100)}%`)
    }
    const timer = setTimeout(done, WAIT_MS)
    listeners.add(seen)
    seen(ours.get(id)!)
  })
}

function report(j: JobInfo): Result {
  const text =
    j.state === 'done'
      ? j.url
        ? `The link to “${j.name}” works now: ${j.url}\nThe video keeps uploading in the background.`
        : `Exported “${j.name}”: ${j.path}${j.bytes ? ` (${formatBytes(j.bytes)})` : ''}.`
      : j.state === 'failed'
        ? `The export of “${j.name}” failed. ${j.error ?? ''}`.trim()
        : j.state === 'canceled'
          ? `The export of “${j.name}” was canceled in Grip.`
          : `Still exporting “${j.name}”: ${j.phase}, ${Math.floor(j.progress * 100)}%. export_status with the id ${j.id} waits for it.`
  const data = { message: text, id: j.id, state: j.state, progress: Math.round(j.progress * 100) / 100, phase: j.phase, ...(j.dest === 'file' && { path: j.path }), ...(j.bytes !== undefined && { bytes: j.bytes }), ...(j.url && { url: j.url }), ...(j.error && { error: j.error }) }
  return { text, data, failed: j.state === 'failed' || j.state === 'canceled' }
}

// ---- Editors ----

const listening = new WeakSet<WebContents>()
const queued = new WeakMap<WebContents, Array<() => void>>() // requests for a page that does not listen yet
const asked = new Map<string, { from: WebContents; answer: (r: Reply) => void }>()

/** Send `request` to an editor's page (Editor.svelte), and wait for its project (and frame) or its error. */
function ask(win: BrowserWindow, request: Request): Promise<{ project: Project; frame?: Uint8Array }> {
  const wc = win.webContents
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const answer = (r: Reply) => {
      clearTimeout(timer)
      asked.delete(id)
      wc.off('destroyed', gone)
      if (r.project) resolve({ project: r.project, frame: r.frame })
      else reject(new Error(r.error || 'The editor could not do that.'))
    }
    const gone = () => answer({ error: 'The editor closed before it answered. get_project shows where the project stands.' })
    const timer = setTimeout(() => answer({ error: `The editor did not answer within ${ASK_MS / 1000} s. Try again.` }), ASK_MS)
    asked.set(id, { from: wc, answer })
    wc.once('destroyed', gone)
    const send = () => wc.isDestroyed() || wc.send('agents:request', id, request)
    if (listening.has(wc)) send()
    else queued.set(wc, [...(queued.get(wc) ?? []), send])
  })
}

/** An editor's page listens: send what waited for it. A new page (a reload) says so again. */
function ready(wc: WebContents) {
  if (!listening.has(wc)) {
    const reload = (d: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (!d.isMainFrame || d.isSameDocument) return // a rename moves the URL within the page
      wc.off('did-start-navigation', reload)
      listening.delete(wc)
      for (const a of asked.values()) if (a.from === wc) a.answer({ error: 'The editor reloaded before it answered. get_project shows where the project stands.' })
    }
    wc.on('did-start-navigation', reload)
  }
  listening.add(wc)
  for (const send of queued.get(wc)?.splice(0) ?? []) send()
}

// ---- Protocol ----

/** Each session's agent app, by the send of its socket, as its initialize names it (up to 40 characters). */
const clients = new WeakMap<(m: unknown) => void, string>()

async function call(params: Args, send: (m: unknown) => void): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === params.name)
  if (!tool) throw new RpcError(-32602, `Unknown tool: ${String(params.name)}. tools/list lists Grip’s tools.`)
  const token = (params._meta as { progressToken?: unknown } | null | undefined)?.progressToken
  let last = -1
  const progress: Progress = (percent, message) => {
    if ((typeof token !== 'string' && typeof token !== 'number') || percent <= last) return // it only goes up
    last = percent
    send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: percent, total: 100, message } })
  }
  try {
    const given = params.arguments ?? {}
    if (typeof given !== 'object' || Array.isArray(given)) throw new Error('arguments must be an object.')
    const a = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== null)) // some models send null for what they leave out
    const names = Object.keys(tool.inputSchema.properties)
    for (const k of Object.keys(a)) if (!names.includes(k)) throw new Error(`${tool.name} has no argument “${k}”. It takes ${names.join(', ') || 'none'}.`)
    for (const k of tool.inputSchema.required ?? []) if ((a as Args)[k] === undefined) throw new Error(`${tool.name} needs ${k}.`)
    const r = await tool.run(a as Args, progress, clients.get(send))
    return { content: [{ type: 'text', text: r.text }, ...[r.image, ...(r.images ?? [])].flatMap((i) => (i ? [{ type: 'image', ...i }] : []))], structuredContent: r.data, ...(r.failed && { isError: true }) }
  } catch (e) {
    if (!(e instanceof Error) || e.constructor !== Error) console.error(`[agents] ${tool.name}:`, e) // a bug, not a bad request
    return { content: [{ type: 'text', text: plainError(e).message }], isError: true }
  }
}

async function handle(method: string, params: Args, send: (m: unknown) => void): Promise<unknown> {
  if (method === 'initialize') {
    const info = (params.clientInfo ?? {}) as { name?: unknown; title?: unknown }
    const client = [info.title, info.name].find((s): s is string => typeof s === 'string' && !!s.trim())
    if (client) clients.set(send, client.trim().slice(0, 40))
    const v = params.protocolVersion
    return {
      protocolVersion: VERSIONS.includes(v as string) ? v : VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'grip', title: 'Grip', version: app.getVersion() },
      instructions: INSTRUCTIONS,
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOLS.map(({ run: _, ...t }) => t) }
  if (method === 'tools/call') return call(params, send)
  throw new RpcError(-32601, `Method not found: ${method}. Grip serves tools: tools/list and tools/call.`)
}

const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

/** The response to one message: none to a notification, or to a response (Grip asks clients nothing). */
async function answer(m: unknown, send: (m: unknown) => void): Promise<unknown> {
  const msg = (m && typeof m === 'object' && !Array.isArray(m) ? m : {}) as Args
  const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg.jsonrpc === '2.0' && ('result' in msg || 'error' in msg)) return
    return failure(id, -32600, 'Invalid request: expected a JSON-RPC 2.0 message with a method.')
  }
  if (!('id' in msg)) return // notifications/initialized, notifications/cancelled: nothing to do
  if (id === null) return failure(null, -32600, 'Invalid request: id must be a string or a number.')
  const params = msg.params ?? {}
  if (typeof params !== 'object' || Array.isArray(params)) return failure(id, -32602, 'Invalid params: params must be an object.')
  try {
    return { jsonrpc: '2.0', id, result: await handle(msg.method, params as Args, send) }
  } catch (e) {
    if (e instanceof RpcError) return failure(id, e.code, e.message)
    console.error('[agents]', e)
    return failure(id, -32603, `Internal error: ${plainError(e).message}`)
  }
}

async function message(line: string, send: (m: unknown) => void) {
  let m: unknown
  try {
    m = JSON.parse(line)
  } catch {
    return send(failure(null, -32700, 'Parse error: each line must be one JSON-RPC message.'))
  }
  if (!Array.isArray(m)) {
    const r = await answer(m, send)
    return r === undefined || send(r)
  }
  // A batch, which protocol 2025-03-26 allows: its responses in one array.
  if (!m.length) return send(failure(null, -32600, 'Invalid request: an empty batch.'))
  const rs = (await Promise.all(m.map((x) => answer(x, send)))).filter((r) => r !== undefined)
  if (rs.length) send(rs)
}

const sessions = new Set<Socket>()

/** One client, newline-delimited JSON both ways. Requests run side by side, each answered when done;
 *  once the client stops sending, the session ends after the last answer. */
function session(sock: Socket) {
  sessions.add(sock)
  sock.setEncoding('utf8')
  const send = (m: unknown) => sock.writable && sock.write(JSON.stringify(m) + '\n')
  let buf = ''
  let running = 0
  let ending = false
  const settled = () => ending && !running && sock.end()
  sock.on('data', (chunk: string) => {
    const lines = (buf + chunk).split('\n')
    buf = lines.pop()!
    if (buf.length > MAX_LINE) {
      sock.removeAllListeners('data')
      buf = ''
      return sock.end(JSON.stringify(failure(null, -32700, `Parse error: a message takes at most ${MAX_LINE >> 20} MB.`)) + '\n')
    }
    for (const line of lines) {
      if (!line.trim()) continue
      running++
      void message(line, send).finally(() => {
        running--
        settled()
      })
    }
  })
  sock.on('end', () => {
    ending = true
    settled()
  })
  sock.on('error', () => {}) // the client went away mid-answer
  sock.on('close', () => sessions.delete(sock))
}

/** The socket's path in the temporary folder `tmp`; grip-mcp works out the same one. */
function socketPath(tmp: string): string {
  const checkout = app.isPackaged ? '' : `-${createHash('md5').update(realpathSync(dirname(import.meta.dirname))).digest('hex').slice(0, 12)}`
  return join(tmp.trim(), `Grip${checkout}.sock`)
}

/** What Settings shows: the command that adds Grip to Claude Code, and the config other agent apps take. */
function setup() {
  const launcher = app.isPackaged ? join(process.resourcesPath, 'grip-mcp') : join(dirname(import.meta.dirname), 'build', 'grip-mcp')
  const arg = /^[\w@%+=:,./-]+$/.test(launcher) ? launcher : `'${launcher.replaceAll("'", `'\\''`)}'`
  // User scope: Grip's tools work in every folder the agent runs in, not only the one it was added in.
  return { command: `claude mcp add --scope user grip -- ${arg}`, config: JSON.stringify({ mcpServers: { grip: { command: launcher } } }, null, 2) }
}

export function registerAgents() {
  let path = ''
  let server: Server | undefined
  const listen = () => {
    server?.close()
    rmSync(path, { force: true }) // a crashed run's: this one holds the single-instance lock
    server = createServer({ allowHalfOpen: true }, session).on('error', (e) => console.error('[agents] socket:', e))
    server.listen(path, () => chmod(path, 0o600, () => {}))
  }
  // The temporary folder getconf names, as in grip-mcp, whose environment may lack TMPDIR. Asked
  // without blocking: the launch waits for nothing of this.
  execFile('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }, (err, tmp) => {
    if (err) return console.error('[agents] socket:', err)
    path = socketPath(tmp)
    listen()
  })
  // grip-mcp starts Grip when it finds no socket. A Grip already running whose socket went (the system
  // empties the temporary folder) gets that start as a second instance, and listens again.
  app.on('second-instance', () => !path || existsSync(path) || listen())
  app.on('will-quit', () => {
    server?.close()
    for (const s of sessions) s.destroy()
    if (path) rmSync(path, { force: true })
  })
  exportListeners.push((j) => {
    if (!ours.has(j.id)) return
    ours.set(j.id, j)
    for (const f of [...(waiting.get(j.id) ?? [])]) f(j)
  })
  ipcMain.handle('agents:ready', (e) => ready(e.sender))
  ipcMain.handle('agents:reply', (e, id: unknown, r: unknown) => {
    const a = typeof id === 'string' ? asked.get(id) : undefined
    if (!a || a.from !== e.sender) return
    const reply = (r && typeof r === 'object' ? r : {}) as Reply
    const frame = reply.frame instanceof Uint8Array ? reply.frame : (reply.frame as unknown) instanceof ArrayBuffer ? new Uint8Array(reply.frame as unknown as ArrayBuffer) : undefined
    a.answer({ project: reply.project && typeof reply.project === 'object' ? reply.project : undefined, frame, error: typeof reply.error === 'string' ? reply.error : undefined })
  })
  ipcMain.handle('agents:setup', setup)
}
