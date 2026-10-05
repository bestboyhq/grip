// Renderer entry. One bundle, one window component per hash route (see electron/windows.ts).
import { mount, type Component } from 'svelte'
import './ui/theme.css'

const routes: Record<string, () => Promise<{ default: Component<{ params: URLSearchParams }> }>> = {
  editor: () => import('./windows/editor/Editor.svelte'),
  recorder: () => import('./windows/recorder/Recorder.svelte'),
  widget: () => import('./windows/widget/Widget.svelte'),
  area: () => import('./windows/area/Area.svelte'),
  camera: () => import('./windows/camera/Camera.svelte'),
  notes: () => import('./windows/notes/Notes.svelte'),
  onboarding: () => import('./windows/onboarding/Onboarding.svelte'),
  export: () => import('./windows/export/Export.svelte'),
  dev: () => import('./windows/dev/Dev.svelte'),
}

const [name, query = ''] = location.hash.replace(/^#\/?/, '').split('?')
const load = routes[name] ?? routes.recorder
const { default: Window } = await load()
document.documentElement.dataset.window = name
mount(Window, { target: document.body, props: { params: new URLSearchParams(query) } })
