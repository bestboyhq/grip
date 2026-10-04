// Renderer side of IPC. Channels are "<domain>:<name>", handled in electron/<domain>.ts.

declare global {
  interface Window {
    studio: {
      invoke(channel: string, ...args: unknown[]): Promise<any>
      on(channel: string, cb: (...args: any[]) => void): () => void
      /** Absolute path of a dropped File. */
      pathForFile(file: File): string
    }
  }
}

/** Rejects with the handler's own message, without Electron's "Error invoking remote method" wrapper. */
export const invoke = (channel: string, ...args: unknown[]) =>
  window.studio.invoke(channel, ...args).catch((e: unknown) => {
    throw new Error(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''))
  })
/** Returns the unsubscribe function: return it from the component's $effect or onMount. */
export const on = (channel: string, cb: (...args: any[]) => void) => window.studio.on(channel, cb)

// Kept on globalThis, so it outlives a hot reload of this file too.
const live: Map<string, () => void> = ((globalThis as { studioListeners?: Map<string, () => void> }).studioListeners ??= new Map())

/** A listener at module scope, for the life of the window (state that outlives its components). A dev
 *  hot reload runs the module again: its listener replaces the previous run's instead of adding
 *  another. One per channel. */
export function listen(channel: string, cb: (...args: any[]) => void) {
  live.get(channel)?.()
  live.set(channel, on(channel, cb))
}

/** A window's drop handler: .studio bundles open, .mp4/.mov videos import as new projects. Rejects
 *  with a plain-language reason. */
export function dropFiles(e: DragEvent): Promise<void> {
  e.preventDefault()
  const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.studio.pathForFile(f)).filter(Boolean)
  return paths.length ? invoke('shell:open-files', paths) : Promise.resolve()
}
