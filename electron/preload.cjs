// The only bridge between renderers and the main process. Keep it generic: domains add IPC
// channels in electron/<domain>.ts and typed wrappers in src/lib, never here.
const { contextBridge, ipcRenderer, sharedTexture, webUtils } = require('electron')

contextBridge.exposeInMainWorld('studio', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    const listener = (_event, ...args) => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  // GPU frames main sends with sharedTexture.sendSharedTexture: cb gets each as a VideoFrame it closes, with
  // what main sent beside it; main's send resolves once cb does. One receiver a window.
  onFrame: (cb) =>
    sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, ...args) => {
      try {
        await cb(importedSharedTexture.getVideoFrame(), ...args)
      } finally {
        importedSharedTexture.release()
      }
    }),
})
