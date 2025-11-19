const { contextBridge, ipcMain } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: () => ipcMain.invoke('get-status'),
});
