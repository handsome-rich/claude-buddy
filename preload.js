const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
});
