// `node scripts/notice.ts`: writes NOTICE, every third-party component Grip ships, links, or downloads,
// with its license and the copyright notices that license asks to keep, then the license texts.
// Run it after changing dependencies: scripts/notice.test.ts fails until NOTICE matches them.
// It reads node_modules and `cargo metadata` (after `npm ci`, with Rust installed) and fetches the
// license texts from SPDX and ONNX Runtime's third-party notices, both pinned.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(import.meta.dirname, '..')
const SPDX = 'https://raw.githubusercontent.com/spdx/license-list-data/v3.29.0/text'
// The ONNX Runtime ort-sys downloads and links statically, from its build/download/dist.tsv.
const ORT = { sys: '2.0.0-rc.13', version: '1.28.0' }
// Packages the renderer bundles from devDependencies; the rest of the app is `dependencies`.
// ponytail: hand-kept list, check `npx vite build --sourcemap` sources when the renderer imports a new package.
const BUNDLED = ['electron', 'svelte', 'clsx', '@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono']
// Where a component offers a choice, Grip takes it under the first of these it offers.
const PREFER = ['MIT', 'Apache-2.0', 'ISC', 'Zlib', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Unlicense', 'BSL-1.0', 'CC0-1.0']

interface Component {
  name: string
  version: string
  license: string
  url: string
  notices: string[]
  note?: string
}

/** What a component's license files miss: what it builds in or embeds, those parts' licenses, and
 *  notices the copyright scan cannot read. */
const EXTRA: Record<string, { note?: string; licenses?: string[]; notices?: string[] }> = {
  // Its license is Python's, whose notices span lines.
  argparse: {
    notices: [
      'Copyright (c) 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020 Python Software Foundation; All Rights Reserved',
      'Copyright (c) 1991 - 1995, Stichting Mathematisch Centrum Amsterdam, The Netherlands. All rights reserved.',
    ],
  },
  electron: { note: 'Includes Chromium and Node.js, whose own notices ship as LICENSES.chromium.html in Grip.app/Contents/Resources.' },
  mediabunny: { note: 'Unmodified; its MPL-2.0 source is at https://github.com/Vanilagy/mediabunny.' },
  'signalsmith-stretch': { note: 'The package has no license file; MIT per its package.json and upstream LICENSE.txt.' },
  'lazy-val': { note: 'The package has no license file; MIT per its package.json.' },
  deep_filter: { note: 'Embeds the DeepFilterNet3 model weights, under the same license.' },
  'ort-sys': { note: `Links ONNX Runtime ${ORT.version} (MIT), Copyright (c) Microsoft Corporation. Its third-party notices close this file.` },
  onig_sys: { note: 'Builds in Oniguruma (BSD-2-Clause), Copyright (c) 2002-2021 K.Kosako <kkosako0@gmail.com>.', licenses: ['BSD-2-Clause'] },
  'esaxx-rs': { note: 'Builds in esaxx (MIT), Copyright (c) 2010 Daisuke Okanohara, and sais-lite (MIT), Copyright (c) 2008-2009 Yuta Mori.', licenses: ['MIT'] },
}

const MODELS: Component[] = [
  {
    name: 'Silero VAD v5 (native/models/silero_vad_16k_op15.onnx)',
    version: '',
    license: 'MIT',
    url: 'https://github.com/snakers4/silero-vad',
    notices: ['Copyright (c) 2020-present Silero Team'],
  },
  {
    name: 'NVIDIA Parakeet TDT 0.6B v3, int8 ONNX export (downloaded on first transcription)',
    version: '',
    license: 'CC-BY-4.0',
    url: 'https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx',
    notices: ['parakeet-tdt-0.6b-v3 by NVIDIA (https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), licensed under CC BY 4.0, converted to ONNX and quantized to int8 by istupakov. Grip runs it unmodified.'],
  },
]

/** The licenses a component is used under: every part of an AND, one preferred alternative of an OR. */
export function choose(expr: string): string[] {
  const split = (e: string, op: string) => {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < e.length; i++) {
      if (e[i] === '(') depth++
      else if (e[i] === ')') depth--
      else if (!depth && e.startsWith(op, i)) {
        parts.push(e.slice(start, i))
        start = i + op.length
      }
    }
    return [...parts, e.slice(start)].map((p) => p.trim().replace(/^\((.*)\)$/, '$1'))
  }
  const all = split(expr.replace(/\s*\/\s*/g, ' OR '), ' AND ')
  if (all.length > 1) return all.flatMap(choose)
  const any = split(all[0], ' OR ')
  return [PREFER.find((l) => any.includes(l)) ?? any[0]]
}

/** The copyright lines in a license file, without the license's own wording and templates. */
export function copyrights(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[\s#*/-]+/, '').trim())
    .filter((l) => /^(Copyright|COPYRIGHT|©)/.test(l) && !/^copyright\s*(notice|holder|owner|and\b|law|statement|license|\[|<|\{|$)|\[yyyy\]|<year>|\{yyyy\}|\[year\]/i.test(l))
}

function licenseFiles(dir: string): string[] {
  const read = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).map((f) => join(d, f)) : [])
  const own = read(dir)
  return own.length ? own : read(dirname(dir)) // a crate in a git workspace keeps its license at the root
}

function component(name: string, version: string, license: string, url: string, dir: string, authors: string[]): Component {
  const notices = EXTRA[name]?.notices ?? [...new Set(licenseFiles(dir).flatMap((f) => copyrights(readFileSync(f, 'utf8'))))]
  return { name, version, license, url, notices: notices.length ? notices : authors.length ? [`Authors: ${authors.join(', ')}`] : [], note: EXTRA[name]?.note }
}

function npmComponents(): Component[] {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  return npmPaths(lock).map((path) => {
    const pkg = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'))
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    const url = (pkg.homepage ?? repo ?? '')
      .replace(/^git\+|\.git$|#readme$/g, '')
      .replace(/^(?:git|ssh):\/\/(?:git@)?/, 'https://')
      .replace(/^(?:git@github\.com:|github:)|^(?=[\w-]+\/[\w.-]+$)/, 'https://github.com/')
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
    return component(pkg.name, pkg.version, pkg.license, url, join(root, path), author ? [author.replace(/\s*[<(].*$/, '')] : [])
  })
}

/** The package-lock paths the app ships: production dependencies and what the renderer bundles. */
function npmPaths(lock: { packages: Record<string, { dev?: boolean }> }): string[] {
  return Object.entries(lock.packages)
    .filter(([path, p]) => path && (!p.dev || BUNDLED.includes(path.replace(/^node_modules\//, ''))))
    .map(([path]) => path)
}

function crateComponents(): Component[] {
  const meta = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--filter-platform', 'aarch64-apple-darwin', '--manifest-path', join(root, 'native/Cargo.toml')], { encoding: 'utf8', maxBuffer: 1 << 28 }),
  )
  const pkgs = new Map<string, any>(meta.packages.map((p: any) => [p.id, p]))
  const nodes = new Map<string, any>(meta.resolve.nodes.map((n: any) => [n.id, n]))
  // What links into the addon: normal dependencies, without proc macros (they run in the compiler only).
  const seen = new Set<string>()
  const walk = (id: string) => {
    if (seen.has(id) || pkgs.get(id).targets.some((t: any) => t.kind.includes('proc-macro'))) return
    seen.add(id)
    for (const d of nodes.get(id).deps) if (d.dep_kinds.some((k: any) => k.kind === null)) walk(d.pkg)
  }
  walk(meta.resolve.root)
  seen.delete(meta.resolve.root)
  return [...seen].map((id) => {
    const p = pkgs.get(id)
    if (!p.license) throw new Error(`${p.name} declares no SPDX license: add it to EXTRA with what its license file says`)
    if (p.name === 'ort-sys' && p.version !== ORT.sys) throw new Error(`ort-sys is ${p.version}: update ORT for the ONNX Runtime its dist.tsv downloads`)
    return component(p.name, p.version, p.license, p.repository ?? p.homepage ?? '', dirname(p.manifest_path), p.authors.map((a: string) => a.replace(/\s*<.*>/, '')))
  })
}

/** What NOTICE was made from: the shipped npm packages and every crate in Cargo.lock. */
export function inputs(): string {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const npm = npmPaths(lock).map((path) => `${path}@${lock.packages[path].version}`)
  const cargo = [...readFileSync(join(root, 'native/Cargo.lock'), 'utf8').matchAll(/name = "(.+)"\nversion = "(.+)"/g)].map((m) => `${m[1]}@${m[2]}`)
  return createHash('sha256').update([...npm, ...cargo].sort().join('\n')).digest('hex').slice(0, 16)
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return (await res.text()).trim()
}

const byName = (a: Component, b: Component) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)

function section(title: string, intro: string, items: Component[]): string {
  const entry = (c: Component) =>
    [`${c.name}${c.version && ' ' + c.version} (${choose(c.license).join(' AND ')})${c.url && ' ' + c.url}`, ...c.notices, ...(c.note ? [c.note] : [])].join('\n  ')
  return `${title}\n${'='.repeat(title.length)}\n\n${intro}\n\n${items.sort(byName).map(entry).join('\n\n')}\n`
}

if (import.meta.main) {
  const npm = npmComponents()
  const crates = crateComponents()
  const all = [...MODELS, ...npm, ...crates]
  const used = new Set([...all.flatMap((c) => choose(c.license)), ...all.flatMap((c) => EXTRA[c.name]?.licenses ?? [])])
  const texts = await Promise.all([...used].sort().map(async (id) => `${id}\n${'-'.repeat(id.length)}\n\n${await fetchText(`${SPDX}/${id}.txt`)}\n`))
  const ort = await fetchText(`https://raw.githubusercontent.com/microsoft/onnxruntime/v${ORT.version}/ThirdPartyNotices.txt`)
  const notice = `Grip
Copyright (C) 2026 Szymon Grącki and Grip contributors

Grip is free software: you can redistribute it and modify it under the terms of the GNU Affero
General Public License, version 3 only (AGPL-3.0-only), in LICENSE. It comes with no warranty.
Source code: https://github.com/bestboyhq/grip
As AGPL section 7(e) allows, the license grants no rights to the names Grip and Best Boy or their
logos: see TRADEMARKS.md.

Grip ships, links, or downloads the third-party components below. Each lists the license Grip uses
it under, MIT where it offers a choice, and the copyright notices that license asks to keep.
The full license texts follow the list.

Made by \`node scripts/notice.ts\` from dependencies ${inputs()}: change the script, not this file.


${section('Models', 'Run on this Mac; the speech model downloads on first use.', MODELS)}

${section('App: npm packages', 'In the app bundle (Grip.app/Contents/Resources/app.asar) and its renderer.', npm)}

${section('Native addon: Rust crates', 'Compiled into native/studio.darwin-arm64.node.', crates)}

Landing page
============

bestboy.dev/grip serves Inter and JetBrains Mono (OFL-1.1) and Svelte (MIT), listed above, and
SvelteKit (MIT), Copyright (c) 2020 [these people](https://github.com/sveltejs/kit/graphs/contributors).


License texts
=============

${texts.join('\n\n')}

ONNX Runtime third-party notices
================================

${ort}
`
  writeFileSync(join(root, 'NOTICE'), notice)
  console.log(`NOTICE: ${MODELS.length} models, ${npm.length} npm packages, ${crates.length} crates, ${used.size} licenses`)
}
