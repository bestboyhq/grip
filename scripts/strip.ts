// `node scripts/strip.ts`, run by `npm run build`: the main process as JavaScript for packaging, so a packaged
// launch never loads Node's type stripper (swc as wasm: ~30 ms before main runs, ~30 MB resident for good).
// Every module electron/main.ts imports lands in dist-main/ at its own path as .js, its types blanked in place
// the way Node strips them at run time, so lines, columns, and stack traces match the source.
// Packaged builds have no .ts files: a .ts path the script can not point at JavaScript (a worker URL, a
// computed import()) fails the build.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'

/** `entry` (a path relative to `root`) and every module it imports, stripped, keyed by the .js path each lands at. */
export function strip(root: string, entry: string): Map<string, string> {
  const out = new Map<string, string>()
  const modules = new Set([entry])
  for (const file of modules) {
    const js = stripTypeScriptTypes(readFileSync(join(root, file), 'utf8'))
    const fail = (why: string) => {
      throw new Error(`${file}: ${why}`)
    }
    const exts: number[] = [] // where each relative import's ".ts" starts
    const visit = (node: ts.Node): void => {
      const spec =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0]
        : undefined
      if (spec) {
        if (!ts.isStringLiteralLike(spec)) return fail(`import(${spec.getText()}) is computed; import a literal path`)
        if (!/^\.\.?\//.test(spec.text)) return // a package or a node: builtin
        if (!spec.text.endsWith('.ts') || spec.getText().slice(1, -1) !== spec.text) return fail(`'${spec.text}' is not a plain .ts path`)
        exts.push(spec.end - 4)
        modules.add(join(dirname(file), spec.text))
      } else if (ts.isStringLiteralLike(node) && /^\.\.?\/.*\.ts$/.test(node.text)) fail(`'${node.text}' names a .ts file outside an import`)
      else ts.forEachChild(node, visit)
    }
    visit(ts.createSourceFile(file, js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS))
    out.set(file.replace(/\.ts$/, '.js'), exts.reduce((s, at) => s.slice(0, at) + '.js' + s.slice(at + 3), js))
  }
  return out
}

if (import.meta.main) {
  const out = join(import.meta.dirname, '../dist-main')
  rmSync(out, { recursive: true, force: true })
  for (const [file, js] of strip(join(import.meta.dirname, '..'), 'electron/main.ts')) {
    mkdirSync(dirname(join(out, file)), { recursive: true })
    writeFileSync(join(out, file), js)
  }
}
