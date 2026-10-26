import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { strip } from './strip.ts'

test('the packaged main process is its source, types blanked, importing only the .js files packaged with it', () => {
  // A module the package misses loads in dev and kills the built app at launch.
  const root = join(import.meta.dirname, '..')
  const out = strip(root, 'electron/main.ts')
  assert.ok(out.has(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build.extraMetadata.main), 'the packaged entry')
  for (const [file, js] of out) {
    assert.equal(js.length, readFileSync(join(root, file.replace(/\.js$/, '.ts')), 'utf8').length, `${file}: stack traces point at the wrong columns`)
    for (const [, spec] of js.matchAll(/(?:from |import\()'(\.\.?\/[^']*)'/g)) assert.ok(out.has(join(dirname(file), spec)), `${file}: '${spec}' is not packaged`)
  }
})

test('a path the packaged app could not load fails the build', () => {
  const root = mkdtempSync(join(tmpdir(), 'strip-'))
  for (const code of ["new Worker(new URL('./worker.ts', import.meta.url))", "const name = 'a'\nimport(`./${name}.ts`)", "import data from './data.json' with { type: 'json' }"]) {
    writeFileSync(join(root, 'main.ts'), code)
    assert.throws(() => strip(root, 'main.ts'), /^Error: main\.ts: /, code)
  }
  rmSync(root, { recursive: true })
})
