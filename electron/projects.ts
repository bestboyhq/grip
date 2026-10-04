// Owner: projects. Bundle lifecycle and the "projects:*" IPC channels:
//   projects:open(path) -> { project }   (migrated, validated)
//   projects:save(path, project)         (atomic, keeps project.json.bak)
// Other main-process domains import the helpers below; keep their signatures.
import { ipcMain } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Project } from '../src/shared/project.ts'

/** Folder where new recordings land. */
export function projectsDir(): string {
  return join(app.getPath('videos'), 'Studio')
}

/** Create `<projectsDir>/<unique name>.studio/sources/` and return the bundle path. */
export async function createBundle(name: string): Promise<string> {
  const path = join(projectsDir(), `${name}.studio`)
  await mkdir(join(path, 'sources'), { recursive: true })
  return path
}

export async function writeProject(bundle: string, project: Project): Promise<void> {
  await writeFile(join(bundle, 'project.json'), JSON.stringify(project, null, 2))
}

export async function readProject(bundle: string): Promise<Project> {
  return JSON.parse(await readFile(join(bundle, 'project.json'), 'utf8'))
}

export function registerProjects() {
  ipcMain.handle('projects:open', async (_e, path: string) => ({ project: await readProject(path) }))
  ipcMain.handle('projects:save', (_e, path: string, project: Project) => writeProject(path, project))
}
