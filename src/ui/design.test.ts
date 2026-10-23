// Every window's styles keep to the Bestboy platform's rules (its docs/design.md), which theme.css copies: colors come
// from tokens, motion eases on the shared curves, and a hover switches its color instead of fading it.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..')
// A raw color belongs only on media: these draw over the desktop or a video frame, or mock one.
const ON_MEDIA = ['windows/area/Area.svelte', 'windows/area/Countdown.svelte', 'windows/editor/CropDialog.svelte', 'windows/editor/Preview.svelte', 'windows/onboarding/SettingPreview.svelte']

const styleFiles = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(svelte|css)$/.test(f) && f !== join('ui', 'theme.css') && !f.includes(join('dev', 'labs')))
  .map((file) => ({ file, css: stylesOf(file, readFileSync(join(root, file), 'utf8')) }))

// A stylesheet, or a component's style blocks and style attributes; comments dropped.
function stylesOf(file: string, src: string) {
  const parts = file.endsWith('.css') ? [src] : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|\sstyle(?::[\w-]+)?="([^"]*)"/g)].map((m) => m[1] ?? m[2])
  return parts.join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
}

function find(pattern: RegExp, skip: string[] = []) {
  return styleFiles.filter(({ file }) => !skip.includes(file)).flatMap(({ file, css }) => [...css.matchAll(pattern)].map((m) => `${file}: ${m[0]}`))
}

test('colors come from theme.css tokens; black stays free for shadows, scrims, and masks', () => {
  const raw = /#(?!0{3}\b|0{6}\b)[0-9a-f]{3,8}\b|\brgba?\((?!\s*0[\s,]+0[\s,]+0\b)[^)]*\)|\b(?:hsla?|oklch|oklab)\(/gi
  assert.deepEqual(find(raw, ON_MEDIA), [])
})

test('motion eases on the shared curves', () => {
  assert.deepEqual(find(/cubic-bezier\([^)]*\)/g, ['windows/onboarding/SettingPreview.svelte']), [])
})

test('a hover switches its color: no transition fades a color', () => {
  assert.deepEqual(find(/transition(?:-property)?\s*:[^;}]*(?<![\w-])(?:all|background(?:-color)?|color|border-color|fill|stroke|outline-color)(?![\w-])/g), [])
})
