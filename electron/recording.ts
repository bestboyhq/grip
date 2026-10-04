// Owner: recording domain. Registers ipcMain handlers for "recording:*" channels.
import { EventEmitter } from 'node:events'

/** Main-process listeners (dock, quit prompt): 'state' (RecState), 'finished' and 'recovered' (bundle path). */
export const recordingEvents = new EventEmitter()

export function registerRecording() {}
