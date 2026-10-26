import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { choose, copyrights, inputs } from './notice.ts'

test('NOTICE lists the dependencies the app ships now', () => {
  const notice = readFileSync(join(import.meta.dirname, '../NOTICE'), 'utf8')
  assert.ok(notice.includes(`from dependencies ${inputs()}:`), 'dependencies changed: run `node scripts/notice.ts`')
})

test('a component is used under one license of each choice it offers', () => {
  assert.deepEqual(choose('MIT'), ['MIT'])
  assert.deepEqual(choose('Apache-2.0 OR MIT'), ['MIT'])
  assert.deepEqual(choose('MIT/Apache-2.0'), ['MIT'])
  assert.deepEqual(choose('Apache-2.0 / MIT'), ['MIT'])
  assert.deepEqual(choose('Zlib OR Apache-2.0 OR MIT'), ['MIT'])
  assert.deepEqual(choose('Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT'), ['MIT'])
  assert.deepEqual(choose('Apache-2.0 OR BSL-1.0'), ['Apache-2.0'])
  assert.deepEqual(choose('(MIT OR Apache-2.0) AND Unicode-3.0'), ['MIT', 'Unicode-3.0'])
  assert.deepEqual(choose('OFL-1.1'), ['OFL-1.1'])
})

test('copyright notices come out of a license file without its template lines', () => {
  const mit = 'MIT License\n\nCopyright (c) 2021 Jane Doe\n * Copyright 2020 Acme\n\nThe above copyright notice and this permission notice shall be included\nTHE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE'
  assert.deepEqual(copyrights(mit), ['Copyright (c) 2021 Jane Doe', 'Copyright 2020 Acme'])
  assert.deepEqual(copyrights('   Copyright [yyyy] [name of copyright owner]\nCopyright (c) <year> <copyright holders>\ncopyright in it.'), [])
})
