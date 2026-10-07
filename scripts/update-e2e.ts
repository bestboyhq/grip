// `node scripts/update-e2e.ts`: in-app updates end to end, the way a user gets them. A signed build
// of 0.0.1 finds 0.0.2 on a local feed and downloads it; 0.0.3 ships while 0.0.2 waits and replaces
// it, and "Restart to Update" (clicked in the app menu) relaunches it as 0.0.3, the latest, in one
// restart. Then 0.0.4 ships and installs by itself while the user is away, and Grip comes back to the
// menu bar only: no window, no dock icon. Run it before publishing a release.
// Needs the Developer ID identity (Squirrel installs only signed updates) and Accessibility for the
// terminal (it clicks the menu). It builds under its own name and app id, so an installed Grip, its
// settings, and its update cache stay untouched.
import { execFileSync, spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'GripUpdateTest'
const ID = 'com.bestboyhq.grip.updatetest'
const PORT = 8765
const dir = join(import.meta.dirname, '../.context/update-e2e')
const app = join(dir, 'Applications', `${NAME}.app`) // in an Applications folder, so it never offers to move itself
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const menu = () => sh('osascript', ['-e', `tell application "System Events" to tell process "${NAME}" to get name of menu items of menu 1 of menu bar item "${NAME}" of menu bar 1`])
const quit = (signal: string) => spawn('pkill', [signal, '-f', `${app}/Contents/MacOS/${NAME}`])
function alive(pattern: string) {
  try {
    return sh('pgrep', ['-f', pattern]).length > 0
  } catch {
    return false // pgrep exits 1 when nothing matches
  }
}
const running = () => alive(`${app}/Contents/MacOS/${NAME}`)
const launch = (env: Record<string, string>, args: string[] = []) =>
  spawn(join(app, 'Contents/MacOS', NAME), args, { env: { ...process.env, ...env }, stdio: 'ignore', detached: true }).unref()
const windows = () => Number(sh('osascript', ['-e', `tell application "System Events" to count windows of process "${NAME}"`]))
/** "Foreground" with a dock icon, "UIElement" without. */
const appType = () => /type="(\w+)"/.exec(sh('lsappinfo', ['info', '-only', 'ApplicationType', sh('lsappinfo', ['find', `bundleid=${ID}`])]))?.[1]
const version = (bundle = app) => sh('defaults', ['read', join(bundle, 'Contents/Info.plist'), 'CFBundleShortVersionString'])
/** The version Squirrel staged, which ShipIt installs when the app quits. */
const staged = () => version(fileURLToPath(sh('plutil', ['-extract', 'updateBundleURL', 'raw', join(homedir(), `Library/Caches/${ID}.ShipIt/ShipItState.plist`)])))

async function until(what: string, test: () => boolean, ms = 180_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) {
    try {
      if (test()) return
    } catch {} // not there yet: no process, no menu
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function stop() {
  quit('-TERM')
  await until('the app to quit', () => !running(), 15_000).catch(() => quit('-KILL'))
  await until('the app to be killed', () => !running(), 5000)
  // A quit installs a staged update: ShipIt writes into its cache folder until it is done.
  await until('ShipIt to finish', () => !alive(`${ID}.ShipIt`), 60_000)
}

// The app must be gone before its files: deleting a starting app crashes it.
async function cleanup() {
  await stop()
  for (const p of [`Library/Application Support/${NAME}`, `Library/Logs/${NAME}`, `Library/Caches/${ID}.ShipIt`, `Library/Caches/${ID}`, `Library/Caches/${NAME.toLowerCase()}-updater`])
    rmSync(join(homedir(), p), { recursive: true, force: true })
  if (existsSync(app)) execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-u', app])
  rmSync(join(dir, 'Applications'), { recursive: true, force: true })
}

// Four signed builds: zip only, no notarization (Squirrel checks the signature, not the ticket), and no
// URL scheme or document types, so Finder and grip:// links keep going to the real Grip.
const base = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).build
const { CFBundleDocumentTypes, UTExportedTypeDeclarations, ...info } = base.mac.extendInfo
run('npm', ['run', 'build'])
for (const v of ['0.0.1', '0.0.2', '0.0.3', '0.0.4']) {
  const config = {
    ...base,
    appId: ID,
    productName: NAME,
    extraMetadata: { name: NAME.toLowerCase(), productName: NAME, version: v }, // own name: own updater cache
    directories: { ...base.directories, output: join(dir, v) },
    protocols: [],
    fileAssociations: [],
    mac: { ...base.mac, target: [{ target: 'zip', arch: 'arm64' }], extendInfo: info, notarize: false },
    publish: { provider: 'generic', url: `http://127.0.0.1:${PORT}` },
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${v}.json`), JSON.stringify(config))
  run('npx', ['electron-builder', '--mac', '--publish', 'never', '--config', join(dir, `${v}.json`)])
}

// The feed: the latest release's latest-mac.yml and zip.
let latest = '0.0.2'
const feed = createServer((req, res) => {
  const file = join(dir, latest, decodeURIComponent(new URL(req.url!, 'http://x').pathname))
  if (!existsSync(file)) return res.writeHead(404).end()
  createReadStream(file).pipe(res)
})
await new Promise<void>((resolve) => feed.listen(PORT, '127.0.0.1', resolve))

try {
  await cleanup()
  sh('ditto', ['-x', '-k', join(dir, '0.0.1', `${NAME}-0.0.1-arm64-mac.zip`), join(dir, 'Applications')])
  // Hidden: windows off screen, no prompts; it checks every 5 s instead of every few hours. The
  // relaunched app runs without either, like a user's. Its onboarding window, open though hidden,
  // keeps it from installing by itself while the user is away.
  launch({ STUDIO_HIDDEN: '1', STUDIO_UPDATE_EVERY: '5000' })
  await until('0.0.1 to start', running)
  await until('Restart to Update in the app menu', () => menu().includes('Restart to Update'))
  console.log(`menu: ${menu()}`)
  latest = '0.0.3' // a newer release ships while 0.0.2 waits for a restart
  await until('0.0.3 to replace the staged 0.0.2', () => staged() === '0.0.3')
  sh('osascript', ['-e', `tell application "System Events" to tell process "${NAME}" to click menu item "Restart to Update" of menu 1 of menu bar item "${NAME}" of menu bar 1`])
  await until('0.0.3 to be installed', () => version() === '0.0.3')
  await until('0.0.3 to relaunch', () => running() && menu().includes('Check for Updates…'))
  console.log(`ok: 0.0.1 updated itself to ${version()} and relaunched`)

  // Away: no window open (grip://stop finds nothing to stop, so neither picker nor onboarding opens),
  // and a second without input counts as away.
  await stop()
  latest = '0.0.4'
  launch({ STUDIO_HIDDEN: '1', STUDIO_UPDATE_EVERY: '5000', STUDIO_UPDATE_AWAY: '1' }, ['grip://stop'])
  await until('0.0.4 to be installed while away', () => version() === '0.0.4')
  await until('0.0.4 to relaunch', () => running() && appType() !== undefined)
  await sleep(5000) // a launch that opens onboarding has it on screen by now
  if (windows() || appType() !== 'UIElement') throw new Error(`0.0.4 came back with ${windows()} windows, as a ${appType()} app`)
  console.log(`ok: 0.0.3 updated itself to ${version()} while away and came back to the menu bar only`)
} finally {
  feed.close()
  // A failed cleanup must not hide why the run failed; the next run cleans up first anyway.
  await cleanup().catch((e) => console.error(`cleanup failed: ${e instanceof Error ? e.message : e}`))
}
