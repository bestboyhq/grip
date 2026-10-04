// Crash-safety of saving: a child process saves a large project in a loop and gets kill -9'd at a
// random instant, over and over. After every kill, project.json must parse and validate as either
// the last version that finished saving or the one being saved; project.json.bak, once written, must parse.
// HAMMER_ROUNDS=1000 npm test -- for a longer run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createProject, type Project } from '../src/shared/project.ts'
import { validateProject } from '../src/shared/migrate.ts'
import { createBundle, writeProject } from './projects.ts'

const { HAMMER_BUNDLE, HAMMER_LOG } = process.env

if (HAMMER_BUNDLE && HAMMER_LOG) {
  // Child: save versions n+1, n+2, ... forever, logging each before and after (synchronously, so the
  // log is exact at the moment of the kill). The version number is the project name.
  const log = openSync(HAMMER_LOG, 'a')
  const base: Project = JSON.parse(readFileSync(join(HAMMER_BUNDLE, 'project.json'), 'utf8'))
  let n = Number(base.name)
  process.stdout.write('ready\n')
  for (;;) {
    n++
    writeSync(log, `start ${n}\n`)
    await writeProject(HAMMER_BUNDLE, { ...base, name: String(n), playhead: n % 100 })
    writeSync(log, `done ${n}\n`)
  }
} else {
  test('kill -9 at any instant during save leaves project.json as the old or the new version', { timeout: 600_000 }, async () => {
    const rounds = Number(process.env.HAMMER_ROUNDS ?? 100)
    const root = mkdtempSync(join(tmpdir(), 'studio save-crash #✨ '))
    const bundle = await createBundle('Hammer #1 ✨ café', root)
    const log = join(root, 'log.txt')
    const p = createProject('0', { duration: 7200 })
    p.clips = Array.from({ length: 20000 }, (_, i) => ({ id: `c${i}`, start: i * 2, end: i * 2 + 1.5, speed: 1 + (i % 3), volume: 1 }))
    await writeProject(bundle, p) // ~2 MB, so a save takes long enough to be interrupted
    const env: NodeJS.ProcessEnv = { ...process.env, HAMMER_BUNDLE: bundle, HAMMER_LOG: log }
    delete env.NODE_TEST_CONTEXT
    let prev = 0
    let midSave = 0
    for (let i = 0; i < rounds; i++) {
      writeFileSync(log, '')
      const child = spawn(process.execPath, [import.meta.filename], { env, stdio: ['ignore', 'pipe', 'inherit'] })
      await once(child.stdout, 'data')
      await sleep(Math.random() * 60)
      child.kill('SIGKILL')
      await once(child, 'exit')

      const last = (what: string) => {
        const m = [...readFileSync(log, 'utf8').matchAll(new RegExp(`^${what} (\\d+)$`, 'gm'))].at(-1)
        return m ? Number(m[1]) : undefined
      }
      const started = last('start')
      const done = last('done') ?? prev
      const json = readFileSync(join(bundle, 'project.json'), 'utf8')
      const v = Number(validateProject(JSON.parse(json)).name)
      assert.ok(v === done || v === started, `round ${i}: project.json is version ${v}, expected ${done} or ${started}`)
      const bak = join(bundle, 'project.json.bak') // written by the second save
      if (existsSync(bak)) validateProject(JSON.parse(readFileSync(bak, 'utf8')))
      if (started !== undefined && started !== last('done')) midSave++
      prev = v
    }
    console.log(`${rounds} kills, ${midSave} mid-save, last version ${prev}`)
    assert.ok(midSave >= rounds / 4, `only ${midSave} of ${rounds} kills landed mid-save`)
    rmSync(root, { recursive: true, force: true })
  })
}
