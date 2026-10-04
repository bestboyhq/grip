// Owner: camera. "camera:*" IPC channels, and post-recording analysis (background-removal matte,
// face track) that patches sources.camera in project.json when done.
export function registerCamera() {}

/** Called by recording.ts after a recording with a camera stops. Runs in the background. */
export async function analyzeCamera(_bundle: string): Promise<void> {}
