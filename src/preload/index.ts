import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { IpcChannel, type LabelFlashApi, type WindowControlsApi } from '../shared/ipc-contract';

const api: LabelFlashApi = {
  preview: (raw) => ipcRenderer.invoke(IpcChannel.Preview, raw),
  previewTemplate: (raw, template) => ipcRenderer.invoke(IpcChannel.PreviewTemplate, raw, template),
  print: (raw, printerName, options) => ipcRenderer.invoke(IpcChannel.Print, raw, printerName, options),
  printTest: (printerName) => ipcRenderer.invoke(IpcChannel.PrintTest, printerName),
  listPrinters: () => ipcRenderer.invoke(IpcChannel.ListPrinters),
  printerStatus: (printerName) => ipcRenderer.invoke(IpcChannel.PrinterStatus, printerName),
  listJobs: (query) => ipcRenderer.invoke(IpcChannel.ListJobs, query),
  getSettings: () => ipcRenderer.invoke(IpcChannel.GetSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannel.UpdateSettings, patch),
  listTemplates: () => ipcRenderer.invoke(IpcChannel.ListTemplates),
  duplicateTemplate: (sourceId) => ipcRenderer.invoke(IpcChannel.DuplicateTemplate, sourceId),
  saveTemplate: (template) => ipcRenderer.invoke(IpcChannel.SaveTemplate, template),
  deleteTemplate: (id) => ipcRenderer.invoke(IpcChannel.DeleteTemplate, id),
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.GetAppInfo),
  openLogFolder: () => ipcRenderer.invoke(IpcChannel.OpenLogFolder),
};

const windowControls: WindowControlsApi = {
  minimize: () => ipcRenderer.send(IpcChannel.WindowMinimize),
  toggleMaximize: () => ipcRenderer.send(IpcChannel.WindowToggleMaximize),
  close: () => ipcRenderer.send(IpcChannel.WindowClose),
  onMaximizedChange: (listener) => {
    const handler = (_event: IpcRendererEvent, isMaximized: boolean) => listener(isMaximized);
    ipcRenderer.on(IpcChannel.WindowMaximizedChanged, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannel.WindowMaximizedChanged, handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('windowControls', windowControls);
