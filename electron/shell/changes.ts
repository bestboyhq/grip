// What's new in an update, for the update card: the feature, fix, and speed titles of every release since
// the running one. electron-updater hands over GitHub's release notes as HTML, one per release, newest
// first; each lists its pull requests as "<type>(<scope>): <title> by @<user> in #<n>".
type Notes = string | Array<{ version: string; note?: string | null }> | null | undefined

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] !== '#' ? (NAMED[e.toLowerCase()] ?? m) : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))))

/** Up to `max` titles, newest first, each as it reads to a user: no type, scope, author, or link. */
export function whatsNew(notes: Notes, max = 5): string[] {
  const html = Array.isArray(notes) ? notes.map((n) => n?.note ?? '').join('\n') : (notes ?? '')
  const titles = new Set<string>()
  for (const [, item] of html.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const text = decode(item.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
    const title = /^(?:feat|fix|perf)(?:\([^)]*\))?!?:\s*(.+?)(?:\s+by @\S+ in \S+)?(?:\s+\(#\d+\))?$/i.exec(text)?.[1]
    if (title) titles.add(title[0].toUpperCase() + title.slice(1))
  }
  return [...titles].slice(0, max)
}
