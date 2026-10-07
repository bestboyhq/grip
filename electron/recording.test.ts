import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// recording.ts runs in Electron's main process: stand in for Electron, the native addon (a fake TCC
// that counts prompts and Settings panes), and the modules that touch projects.
const dir = mkdtempSync(join(tmpdir(), 'studio recording #1 ✨ '))
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`
const electron = `const h = globalThis.handlers = {}
  export const ipcMain = { handle: (c, f) => (h[c] = f) }, BrowserWindow = { getAllWindows: () => [] }
  export const app = { on() {}, getPath: () => ${JSON.stringify(dir)} }; export default { app }`
const native = `const tcc = globalThis.tcc = { status: {}, prompts: [], panes: [] }
  export const native = {
    permissionStatus: (k) => tcc.status[k],
    requestPermission: async (k) => (tcc.prompts.push(k), tcc.status[k]),
    openPermissionSettings: (k) => tcc.panes.push(k),
  }`
const projects = 'export const projectEvents = { on() {} }, createBundle = 0, projectsDir = 0, readProject = 0, writeNewRecording = 0'
register(
  stub(`export async function resolve(specifier, context, next) {
    const to = { electron: ${JSON.stringify(stub(electron))}, './native.ts': ${JSON.stringify(stub(native))},
      './projects.ts': ${JSON.stringify(stub(projects))}, './camera.ts': ${JSON.stringify(stub('export const analyzeCamera = 0'))} }[specifier]
    return to ? { url: to, shortCircuit: true } : next(specifier, context)
  }`),
)
const { recordingEvents, registerRecording } = await import('./recording.ts')
registerRecording()
const opened: string[] = []
recordingEvents.on('settings', (k: string) => opened.push(k)) // the drag-to-allow panel follows it
const g = globalThis as any
const ask = (k: string) => g.handlers['recording:requestPermission']({}, k)
const status = () => g.handlers['recording:permissions']({})

test('asking for a permission shows the system prompt or System Settings, never both', async () => {
  try {
    const tcc = g.tcc
    tcc.status = { screen: 'denied', accessibility: 'denied', microphone: 'notDetermined', camera: 'granted' }
    // Screen Recording and Accessibility read "denied" before Grip ever asked: Grip knows better.
    assert.equal(status().screen, 'notDetermined')
    assert.equal(status().accessibility, 'notDetermined')
    for (const k of ['screen', 'accessibility', 'microphone']) await ask(k)
    assert.deepEqual([tcc.prompts, tcc.panes], [['screen', 'accessibility', 'microphone'], []], 'first asks: prompts only')
    assert.equal(status().screen, 'denied', 'asked once: macOS’s answer now stands')
    tcc.status.microphone = 'denied'
    for (const k of ['screen', 'accessibility', 'microphone', 'camera']) await ask(k)
    assert.deepEqual(tcc.prompts.length, 3, 'no prompt twice')
    assert.deepEqual(tcc.panes, ['screen', 'accessibility', 'microphone'], 'later asks: Settings only; granted: nothing')
    assert.deepEqual(opened, tcc.panes, 'every Settings pane is announced')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
