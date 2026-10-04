// Closing editor windows without losing edits. A closing editor saves first: ask(win) sends
// "editor:close", and the page answers with why its save failed ('' once everything is on disk).
// Saved: the window closes, or the quit it interrupted resumes once every editor is done. Not saved,
// or no answer in time: the user picks Save Again, Discard Edits, or Cancel; Cancel keeps the window
// open and cancels the quit. Edits are never dropped without asking.
// Pure: no electron imports, so node:test can run it.

export type Choice = 'save' | 'discard' | 'cancel'

export interface Io<W> {
  ask(win: W): void
  prompt(win: W, error: string): Promise<Choice>
  close(win: W): void
  gone(win: W): boolean
  quitting(): boolean
  quit(): void // resume the quit
  stay(): void // cancel the quit
}

export const NO_ANSWER = 'The window didn’t respond, so Studio can’t tell whether they were saved.'

export function editorCloser<W extends object>(io: Io<W>, timeout = 5000) {
  let closable = new WeakSet<W>() // saved or discarded: its next close goes through
  const deciding = new Map<W, (error: string) => void>() // asked to save, until it closes or stays

  function request(win: W) {
    let settled = false
    const timer = setTimeout(() => answer(NO_ANSWER), timeout)
    async function answer(error: string) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const choice = error && !io.gone(win) ? await io.prompt(win, error) : 'close'
      if (choice === 'save' && !io.gone(win)) return request(win)
      deciding.delete(win)
      if (choice === 'cancel') {
        if (!io.quitting()) return
        io.stay()
        closable = new WeakSet() // editors that saved for this quit stay open: their next close saves again
        return
      }
      closable.add(win)
      if (io.quitting()) {
        if (!deciding.size) io.quit()
      } else if (!io.gone(win)) io.close(win)
    }
    deciding.set(win, answer)
    io.ask(win)
  }

  return {
    /** A close event: true lets the window close; otherwise it saves first, then closes or asks. */
    closing(win: W): boolean {
      if (closable.has(win)) return true
      if (!deciding.has(win)) request(win)
      return false
    },
    /** The page's answer to "editor:close". */
    answered: (win: W, error: string) => deciding.get(win)?.(error),
  }
}
