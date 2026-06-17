const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tailor', {
  loadMasterResume: () => ipcRenderer.invoke('load-master-resume'),
  tailorResume:  (data) => ipcRenderer.invoke('tailor-resume', data),
  generatePdf:   (html) => ipcRenderer.invoke('generate-pdf', html),
  openFile:      (file) => ipcRenderer.invoke('open-file', file),
})
