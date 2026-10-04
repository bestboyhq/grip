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

export const invoke = (channel: string, ...args: unknown[]) => window.studio.invoke(channel, ...args)
export const on = (channel: string, cb: (...args: any[]) => void) => window.studio.on(channel, cb)
