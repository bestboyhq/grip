// `npm run dev [-- --open <bundle.grip>]`: Vite dev server + Electron.
// Env: VITE_PORT (default: any free port), STUDIO_CDP_PORT (exposes renderers over CDP for agent-browser).
import { createServer } from 'vite'
import { spawn } from 'node:child_process'

const server = await createServer({ configFile: 'vite.config.ts' })
await server.listen()
const url = server.resolvedUrls!.local[0]
const electron = spawn('npx', ['electron', '.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } })
electron.on('exit', (code) => {
  server.close()
  process.exit(code ?? 0)
})
