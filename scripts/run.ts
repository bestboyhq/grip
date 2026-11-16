// Runs a scratch Electron script with the argv it would get run bare, and turns any error into a printed stack and
// exit code 1. Run bare, a script that fails, even to parse, opens a modal dialog on the user's screen and stays up.
// Run: npx electron scripts/run.ts <script.ts> [args]
import { app } from 'electron'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fail = (error: unknown) => {
  console.error(error)
  app.exit(1)
}
process.on('uncaughtException', fail).on('unhandledRejection', fail) // a listener of ours keeps Electron's dialog away
process.argv.splice(1, 1)
await import(pathToFileURL(resolve(process.argv[1])).href)
