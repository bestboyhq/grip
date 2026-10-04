// The only bridge between renderers and the main process. Keep it generic: domains add IPC
// channels in electron/<domain>.ts and typed wrappers in src/lib, never here.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('studio', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    const listener = (_event, ...args) => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
})
