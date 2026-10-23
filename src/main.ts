// Renderer entry. One bundle, one window component per hash route (see electron/windows.ts).
import { mount, type Component } from 'svelte'
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/jetbrains-mono'
import './ui/theme.css'
import { installPress } from './ui/motion.ts'

const routes: Record<string, () => Promise<{ default: Component<{ params: URLSearchParams }> }>> = {
  editor: () => import('./windows/editor/Editor.svelte'),
  recorder: () => import('./windows/recorder/Recorder.svelte'),
  widget: () => import('./windows/widget/Widget.svelte'),
  area: () => import('./windows/area/Area.svelte'),
  camera: () => import('./windows/camera/Camera.svelte'),
  notes: () => import('./windows/notes/Notes.svelte'),
  onboarding: () => import('./windows/onboarding/Onboarding.svelte'),
  export: () => import('./windows/export/Export.svelte'),
  result: () => import('./windows/result/Result.svelte'),
  grant: () => import('./windows/grant/Grant.svelte'),
  dev: () => import('./windows/dev/Dev.svelte'),
}

const [name, query = ''] = location.hash.replace(/^#\/?/, '').split('?')
const load = routes[name] ?? routes.recorder
const { default: Window } = await load()
document.documentElement.dataset.window = name
await document.fonts.load('13px "Inter Variable"').catch(() => {}) // the first frame, canvases included, draws in Inter
installPress()
mount(Window, { target: document.body, props: { params: new URLSearchParams(query) } })
