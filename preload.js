const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  petDragStart: () => ipcRenderer.send('pet-drag-start'),
  petDragMove: () => ipcRenderer.send('pet-drag-move'),
  petDragEnd: (moved) => ipcRenderer.send('pet-drag-end', !!moved),
  petFit: (height) => ipcRenderer.send('pet-fit', height),
  toggleDashboard: () => ipcRenderer.send('toggle-dashboard'),
});
