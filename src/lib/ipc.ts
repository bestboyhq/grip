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
export const on = (channel: string, cb: (...args: any[]) => void) => window.studio.on(channel, cb)

/** A window's drop handler: .studio bundles open, .mp4/.mov videos import as new projects. Rejects
 *  with a plain-language reason. */
export function dropFiles(e: DragEvent): Promise<void> {
  e.preventDefault()
  const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.studio.pathForFile(f)).filter(Boolean)
  return paths.length ? invoke('shell:open-files', paths) : Promise.resolve()
}
