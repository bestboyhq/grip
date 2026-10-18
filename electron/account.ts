// Owner: sharing. The Bestboy account Grip shares links with. Sign-in happens in the browser (Google or an email
// code, no password); the platform then opens grip://auth?code=…&state=…, and the code plus this sign-in's PKCE
// verifier buys a token. The token is encrypted with the macOS keychain (safeStorage) in userData/account.json.
//
//   account:get -> Account | null        refreshed from the server; the last known account while offline
//   account:sign-in -> Account | null    opens the browser; null after 10 minutes or when a newer sign-in replaced it
//   account:sign-out                     account:changed (event to every window) -> Account | null
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, type MenuItemConstructorOptions } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { api } from './upload.ts'

/** The Bestboy platform: links, accounts, teams. STUDIO_SHARE_URL points a dev build at a local one. */
export const SERVER = (process.env.STUDIO_SHARE_URL ?? 'https://bestboy.dev').replace(/\/+$/, '')

export interface Account {
  user: { id: string; email: string; name: string; avatar: string | null }
  team: { id: string; name: string; plan: string }
  usage: { uploads: number; limit: number | null; resetsAt: string; maxFile: number | null; keepDays: number | null }
}

let file = ''
let token = ''
let known: Account | null = null
let pending: { verifier: string; state: string; done(a: Account | null): void } | null = null

/** The token uploads send, or '' when signed out. */
export const accountToken = () => token

function save() {
  const sealed = token ? safeStorage.encryptString(token).toString('base64') : ''
  writeFile(`${file}.tmp`, JSON.stringify({ token: sealed, account: known }))
    .then(() => rename(`${file}.tmp`, file))
    .catch((e) => console.error('account: could not save', e))
}

function emit() {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('account:changed', known)
}

/** Signed out, here or by the server (a revoked token answers 401). */
export function forget() {
  token = ''
  known = null
  save()
  emit()
}

async function refresh(): Promise<Account | null> {
  if (!token) return null
  try {
    known = await api(SERVER, token, 'GET', '/api/me', undefined, AbortSignal.timeout(8000))
    save()
    emit()
  } catch (e) {
    if ((e as { status?: number }).status === 401) forget()
    // offline: the last known account stays
  }
  return known
}

const b64url = (b: Buffer) => b.toString('base64url')

export function signIn(): Promise<Account | null> {
  pending?.done(null)
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), 10 * 60e3)
    const me = {
      verifier,
      state,
      done: (a: Account | null) => {
        clearTimeout(timer)
        resolve(a)
      },
    }
    const finish = (a: Account | null) => {
      if (pending === me) pending = null
      me.done(a)
    }
    pending = me
    shell.openExternal(`${SERVER}/login?app=grip&challenge=${challenge}&state=${state}`)
  })
}

/** grip://auth?code=…&state=…, routed here by the app shell. A state this run did not ask for is ignored. */
export async function completeSignIn(code: string, state: string) {
  const p = pending
  if (!p || p.state !== state) return
  pending = null
  try {
    const r = await api(SERVER, '', 'POST', '/api/auth/token', { code, verifier: p.verifier })
    token = r.token
    p.done(await refresh())
  } catch (e) {
    p.done(null)
    dialog.showErrorBox('Grip could not sign in', `${(e as Error).message} Try signing in again.`)
  }
}

export async function signOut() {
  if (token) await api(SERVER, token, 'POST', '/api/auth/logout', undefined, AbortSignal.timeout(5000)).catch(() => {})
  forget()
}

/** The menu bar's account items. */
export function accountMenuItems(): MenuItemConstructorOptions[] {
  if (!known) return [{ label: 'Sign In to Share Links…', click: () => void signIn() }]
  return [
    { label: `Signed In as ${known.user.name}`, enabled: false },
    { label: 'Sign Out', click: () => void signOut() },
  ]
}

export function registerAccount() {
  file = join(app.getPath('userData'), 'account.json')
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    token = saved.token ? safeStorage.decryptString(Buffer.from(saved.token, 'base64')) : ''
    known = token ? saved.account : null
  } catch {
    // first run, or unreadable: signed out
  }
  ipcMain.handle('account:get', () => refresh())
  ipcMain.handle('account:sign-in', () => signIn())
  ipcMain.handle('account:sign-out', () => signOut())
}
