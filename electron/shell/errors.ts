// Plain-language messages for system errors. Errors reach the shell as Error objects (main
// process) or as strings from IPC ("Error invoking remote method 'recording:start': Error: ...").
// We read the errno name, the macOS status code, or a known phrase, and say what happened and
// what to do in one line. Pure: no electron imports.

/** Same names as the capture engine's permissions (recording:permissions). */
export type Permission = 'screen' | 'accessibility' | 'inputMonitoring' | 'microphone' | 'camera'

export interface PlainError {
  message: string
  /** Set when the fix is a privacy permission: the shell opens onboarding at that step. */
  permission?: Permission
}

const FULL = 'Your disk is full. Free up some space, then try again.'
const DENIED = 'Studio is not allowed to use this file or folder. Check its permissions in Finder.'
const SCREEN = 'Screen recording is turned off for Studio. Turn it on in System Settings to record.'

// errno names (Node), POSIX codes inside NSError, and macOS OSStatus / framework codes.
const CODES: Record<string, PlainError> = {
  ENOSPC: { message: FULL },
  EDQUOT: { message: FULL },
  '-34': { message: FULL }, // dskFulErr
  '-11807': { message: FULL }, // AVErrorDiskFull
  EACCES: { message: DENIED },
  EPERM: { message: DENIED },
  '-54': { message: DENIED }, // permErr
  '-61': { message: DENIED }, // wrPermErr
  '-5000': { message: DENIED }, // afpAccessDenied
  EROFS: { message: 'This disk is read-only. Choose another place to save.' },
  ENOENT: { message: 'The file or folder is no longer there. It may have been moved or deleted.' },
  '-43': { message: 'The file or folder is no longer there. It may have been moved or deleted.' }, // fnfErr
  EEXIST: { message: 'Something with that name already exists. Pick another name.' },
  EBUSY: { message: 'Another app is using this file. Close it there, then try again.' },
  EMFILE: { message: 'Too many files are open. Quit a few apps, then try again.' },
  ENFILE: { message: 'Too many files are open. Quit a few apps, then try again.' },
  ENAMETOOLONG: { message: 'The name is too long. Pick a shorter one.' },
  EIO: { message: 'The disk reported a read or write error. Check the disk, then try again.' },
  ENOTCONN: { message: 'The disk was disconnected. Reconnect it, then try again.' },
  ENOTFOUND: { message: 'You seem to be offline. Check your internet connection.' },
  ECONNREFUSED: { message: 'The server is not responding. Try again in a moment.' },
  ETIMEDOUT: { message: 'The connection timed out. Check your internet connection.' },
  '-3801': { message: SCREEN, permission: 'screen' }, // SCStreamErrorUserDeclined
  '-3815': { message: 'The display or window you picked is gone. Pick it again.' }, // SCStreamErrorNoCaptureSource
  '-3821': { message: 'macOS stopped the recording. Your recording up to that point is saved.' }, // SCStreamErrorSystemStoppedStream
  '-11801': { message: 'Your Mac ran out of memory. Quit a few apps, then try again.' }, // AVErrorOutOfMemory
  '-11804': { message: 'Another app is using this camera or microphone. Quit it, then try again.' }, // AVErrorDeviceInUseByAnotherApplication
  '-11814': { message: 'The camera or microphone was disconnected. Reconnect it or pick another one.' }, // AVErrorDeviceNotConnected
}

// Phrases in messages from Node, the OS, and the native addon.
const PHRASES: Array<[RegExp, PlainError]> = [
  [/no space left|disk (is )?full|not enough (free )?(disk )?space/i, { message: FULL }],
  [/read-only file system/i, CODES.EROFS],
  // "The user declined TCCs for application, window, display capture" is ScreenCaptureKit's -3801 text.
  [/declined TCC|screen ?(capture|recording)[^.]*(denied|not (allowed|authori[sz]ed|permitted)|permission)/i, { message: SCREEN, permission: 'screen' }],
  [/microphone[^.]*(denied|not (allowed|authori[sz]ed)|permission)/i, { message: 'Microphone access is turned off for Studio. Turn it on in System Settings.', permission: 'microphone' }],
  [/camera[^.]*(denied|not (allowed|authori[sz]ed)|permission)/i, { message: 'Camera access is turned off for Studio. Turn it on in System Settings.', permission: 'camera' }],
  [/accessibility[^.]*(denied|not (allowed|trusted|authori[sz]ed)|permission)/i, { message: 'Accessibility is turned off for Studio. Turn it on in System Settings.', permission: 'accessibility' }],
  [/operation not permitted|permission denied/i, { message: DENIED }],
  [/no such file or directory/i, CODES.ENOENT],
]

export function plainError(err: unknown): PlainError {
  const code = (err as { code?: unknown } | null)?.code
  if ((typeof code === 'string' || typeof code === 'number') && CODES[String(code)]) return CODES[String(code)]
  const raw = err instanceof Error ? err.message : String(err ?? '')
  for (const [re, plain] of PHRASES) if (re.test(raw)) return plain
  for (const m of raw.matchAll(/\b(E[A-Z]{2,})\b|(?<![\w.])(-\d{2,5})\b/g)) {
    const hit = CODES[m[1] ?? m[2]]
    if (hit) return hit
  }
  // Unknown: keep the original text, minus Electron's IPC wrapper and "Error:" prefixes.
  const text = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(\w*Error:\s*)+/, '').trim()
  return { message: text ? text.replace(/([^.!?])$/, '$1.') : 'Something went wrong. Try again.' }
}
