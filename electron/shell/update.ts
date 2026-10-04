// In-app auto-update through electron-updater. Off until releases are hosted: set FEED to a
// generic-provider URL that serves latest-mac.yml, and ship Developer ID-signed builds
// (Squirrel.Mac refuses to install unsigned updates).
import { app } from 'electron'

// ponytail: no release feed yet; updates stay off until one exists.
const FEED = ''

export async function checkForUpdates() {
  if (!FEED || !app.isPackaged) return
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.setFeedURL({ provider: 'generic', url: FEED })
  await autoUpdater.checkForUpdatesAndNotify().catch(() => null) // offline is normal, not an error
}
