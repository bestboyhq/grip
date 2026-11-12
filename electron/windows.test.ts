import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// windows.ts runs in Electron's main process: stand in for Electron (a window that emits "resize" on
// every frame change, in the same turn, as AppKit does), the native addon, and settings.
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`
const electron = `import { EventEmitter } from 'node:events'
  export class BrowserWindow extends EventEmitter {
    static getAllWindows() { return [] }
    constructor(o) { super(); globalThis.dockLog?.push('window'); this.bounds = { x: o.x, y: o.y, width: o.width, height: o.height }; this.resizable = o.resizable ?? true }
    getBounds() { return { ...this.bounds } }
    setBounds(b) { this.bounds = { ...this.bounds, ...b }; this.emit('resize') }
    isResizable() { return this.resizable }
    setResizable(on) { this.resizable = on }
    loadURL() {}
    loadFile() {}
  }
  const display = { id: 1, workArea: { x: 0, y: 39, width: 2056, height: 1290 } }
  export const screen = { getDisplayMatching: () => display, getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }) }
  const log = (what) => () => globalThis.dockLog?.push(what)
  export const app = { dock: { show: log('dock.show'), hide: log('dock.hide') }, setActivationPolicy: (p) => globalThis.dockLog?.push(p) }`
register(
  stub(`export async function resolve(specifier, context, next) {
    const to = { electron: ${JSON.stringify(stub(electron))}, './native.ts': ${JSON.stringify(stub('export const native = {}'))},
      './shell/settings.ts': ${JSON.stringify(stub('export const settings = () => ({ windows: {} }), setSettings = () => {}'))} }[specifier]
    return to ? { url: to, shortCircuit: true } : next(specifier, context)
  }`),
)
const { openWindow } = await import('./windows.ts')

test('a normal window turns Grip regular before it shows, never through dock.show()', () => {
  const log: string[] = ((globalThis as { dockLog?: string[] }).dockLog = [])
  openWindow('editor?project=x')
  // dock.show() with Grip active brings the Dock forward, and leaves Finder highlighted in it.
  assert.deepEqual(log, ['regular', 'window'])
  delete (globalThis as { dockLog?: string[] }).dockLog
})

test('a fixed-size window the first screen capture grows goes back as it was', () => {
  const win = openWindow('recorder', { x: 587, y: 1245, width: 882, height: 64, resizable: false }) as unknown as { resizable: boolean } & Electron.BrowserWindow
  win.setBounds({ x: 587, y: 1200 }) // moved by Grip: where it stays
  // ReplayKit re-sets its style mask: resizable, and a 32-point title bar taller, the bottom edge kept.
  win.resizable = true
  win.setBounds({ y: 1168, height: 96 })
  assert.deepEqual(win.getBounds(), { x: 587, y: 1200, width: 882, height: 64 })
  assert.equal(win.isResizable(), false)
})
