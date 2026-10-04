// Owner: projects. Untrusted project and style JSON (from disk, IPC, or a preset file) -> a valid,
// current document. migrate() steps older versions forward, fills fields added since with their
// defaults, and validates; an older app refuses a newer project instead of guessing.

import { PROJECT_VERSION, createProject, defaultStyle, type Project, type Style } from './project.ts'

/** MIGRATIONS[v] turns a version-v document into version v + 1. Add one with every PROJECT_VERSION
 *  bump. Purely additive changes need no step: missing fields are filled from the defaults. */
export const MIGRATIONS: Record<number, (p: any) => any> = {}

export function migrate(json: unknown, steps = MIGRATIONS, latest = PROJECT_VERSION): Project {
  if (!isObj(json) || !Number.isInteger(json.version) || json.version < 1) throw new Error('This is not a Studio project file.')
  if (json.version > latest) throw newerError(typeof json.name === 'string' ? json.name : '')
  let p: any = json
  for (let v = p.version; v < latest; v++) {
    if (!steps[v]) throw new Error(`Studio can't upgrade projects from format ${v}.`)
    p = { ...steps[v](p), version: v + 1 }
  }
  if (isObj(p.sources)) fill(p, createProject('', p.sources as Project['sources']))
  return validateProject(p, latest)
}

/** The refusal an older app gives a project saved by a newer one (code ENEWER). */
export function newerError(name: string) {
  const what = name ? `“${name}”` : 'This project'
  return Object.assign(new Error(`${what} was saved by a newer version of Studio. Update Studio to open it.`), { code: 'ENEWER' })
}

/** A preset or older style: missing fields get their defaults, then the whole style is checked. */
export function normalizeStyle(x: unknown): Style {
  if (!isObj(x)) fail('style')
  fill(x, defaultStyle())
  checkStyle(x)
  return x as unknown as Style
}

/** Strict check of a complete, current project (the IPC save boundary). Extra fields pass through. */
export function validateProject(x: unknown, version = PROJECT_VERSION): Project {
  if (!isObj(x)) return fail('not an object')
  const p = x as any
  if (p.version !== version) fail(`version ${p.version}`)
  if (typeof p.name !== 'string' || typeof p.createdAt !== 'string') fail('name')
  const s = p.sources
  if (!isObj(s) || !(num(s.duration) && s.duration >= 0)) fail('sources.duration')
  for (const k of ['screen', 'camera']) {
    const v = s[k]
    if (v !== undefined && !(isObj(v) && rel(v.file) && pos(v.width) && pos(v.height) && pos(v.fps) && pos(v.scale))) fail(`sources.${k}`)
  }
  for (const k of ['matte', 'faces']) if (s.camera?.[k] !== undefined && !rel(s.camera[k])) fail(`sources.camera.${k}`)
  for (const k of ['mic', 'system']) {
    const v = s[k]
    if (v !== undefined && !(isObj(v) && rel(v.file) && pos(v.channels) && pos(v.sampleRate))) fail(`sources.${k}`)
  }
  for (const k of ['events', 'transcript']) if (s[k] !== undefined && !rel(s[k])) fail(`sources.${k}`)

  timed(p.clips, 'clips', (c) => c.end > c.start && pos(c.speed) && num(c.volume) && c.volume >= 0)
  timed(p.zooms, 'zooms', (z) => pos(z.level) && typeof z.enabled === 'boolean' && isObj(z.target) &&
    (z.target.kind === 'cursor' || (z.target.kind === 'point' && num(z.target.x) && num(z.target.y))))
  timed(p.layouts, 'layouts', (l) => typeof l.kind === 'string')
  timed(p.masks, 'masks', (m) => typeof m.kind === 'string' && isObj(m.rect) && ['x', 'y', 'w', 'h'].every((k) => num(m.rect[k])))
  if (!isObj(p.captionEdits) || !Object.values(p.captionEdits).every((v) => typeof v === 'string')) fail('captionEdits')
  checkStyle(p.style)
  shape(p.audio, createProject('', { duration: 0 }).audio, 'audio.')
  if (p.audio.music !== undefined && !(isObj(p.audio.music) && rel(p.audio.music.file) && num(p.audio.music.volume))) fail('audio.music')
  if (!num(p.playhead)) fail('playhead')
  return p
}

// Enum-like strings (device, cursor.click, layout kind...) are checked as strings only, so a value
// another domain adds to a union never makes a project unsaveable.
function checkStyle(st: any) {
  if (!isObj(st)) fail('style')
  const { aspect: _a, background: _b, ...def } = defaultStyle()
  shape(st, def, 'style.')
  const a = st.aspect
  if (!(a === 'auto' || (typeof a === 'string' && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(a)) || (isObj(a) && pos(a.w) && pos(a.h)))) fail('style.aspect')
  const b = st.background
  const ok = isObj(b) && typeof b.kind === 'string' && (
    b.kind === 'image' ? rel(b.file)
    : b.kind === 'wallpaper' ? typeof b.id === 'string'
    : b.kind === 'gradient' ? Array.isArray(b.stops) && b.stops.every((c: unknown) => typeof c === 'string') && num(b.angle)
    : b.kind === 'color' ? typeof b.color === 'string'
    : true)
  if (!ok) fail('style.background')
  if (st.camera.lut !== undefined && !rel(st.camera.lut)) fail('style.camera.lut')
}

/** Every key of `def` must exist in `v` with the same JSON type (numbers finite). Extra keys pass. */
function shape(v: unknown, def: object, at: string) {
  if (!isObj(v)) fail(at.slice(0, -1))
  for (const [k, d] of Object.entries(def)) {
    const x = (v as any)[k]
    if (isObj(d)) shape(x, d, `${at}${k}.`)
    else if (typeof d === 'number' ? !num(x) : typeof x !== typeof d) fail(at + k)
  }
}

/** Adds the keys missing from `target` with their default values. Objects with a `kind` are unions
 *  (background, zoom target) and are never merged field by field. */
function fill(target: Record<string, any>, def: Record<string, any>) {
  for (const k in def) {
    if (target[k] === undefined) target[k] = def[k]
    else if (isObj(def[k]) && isObj(target[k]) && !('kind' in def[k])) fill(target[k], def[k])
  }
}

function timed(list: unknown, at: string, ok: (x: any) => boolean) {
  if (!Array.isArray(list)) fail(at)
  ;(list as unknown[]).forEach((x: any, i) => {
    if (!(isObj(x) && typeof x.id === 'string' && num(x.start) && num(x.end) && x.end >= x.start && ok(x))) fail(`${at}[${i}]`)
  })
}

function fail(what: string): never {
  throw new Error(`Invalid project: ${what}.`)
}
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pos = (v: unknown) => num(v) && v > 0
/** A path inside the bundle: relative, no `..`, no NUL. */
const rel = (v: unknown) => typeof v === 'string' && v !== '' && !v.startsWith('/') && !v.includes('\0') && !v.split('/').includes('..')
