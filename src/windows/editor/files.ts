// File picking for the editor: the native open panel via <input type=file>, real paths via the preload.
import { invoke } from '../../lib/ipc.ts'
import { doc } from '../../lib/doc.svelte.ts'
import { reason } from './helpers.ts'

/** Show the open panel; resolves to the chosen file's absolute path, or null when cancelled. */
export function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept })
    input.addEventListener('cancel', () => resolve(null))
    input.addEventListener('change', () => {
      const f = input.files?.[0]
      resolve(f ? window.studio.pathForFile(f) : null)
    })
    input.click()
  })
}

/** Pick a file and copy it into the open bundle. Resolves to its bundle-relative path, or null when
 *  cancelled; rejects with a plain-language reason. */
export async function importFile(kind: 'image' | 'lut' | 'audio', accept: string): Promise<string | null> {
  const path = await pickFile(accept)
  if (!path) return null
  try {
    return await invoke('editor:importAsset', doc.path, path, kind)
  } catch (e) {
    throw new Error(reason(e))
  }
}
