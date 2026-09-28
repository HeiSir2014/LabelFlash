import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { IpcChannel, type LabelFlashApi, type WindowControlsApi } from '../shared/ipc-contract';
import { windowChromeFor } from '../shared/window-chrome';

/** 订阅主进程推送：只把数据转给回调，不把 IpcRendererEvent（含 sender）暴露给页面。 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: LabelFlashApi = {
  preview: (raw) => ipcRenderer.invoke(IpcChannel.Preview, raw),
  previewTemplate: (raw, template) => ipcRenderer.invoke(IpcChannel.PreviewTemplate, raw, template),
  print: (raw, printerName, options) => ipcRenderer.invoke(IpcChannel.Print, raw, printerName, options),
  printTest: (printerName) => ipcRenderer.invoke(IpcChannel.PrintTest, printerName),
  listPrinters: () => ipcRenderer.invoke(IpcChannel.ListPrinters),
  printerStatus: (printerName) => ipcRenderer.invoke(IpcChannel.PrinterStatus, printerName),
  checkDriverPaper: (printerName) => ipcRenderer.invoke(IpcChannel.CheckDriverPaper, printerName),
  openPrinterPreferences: (printerName) => ipcRenderer.invoke(IpcChannel.OpenPrinterPreferences, printerName),
  listJobs: (query) => ipcRenderer.invoke(IpcChannel.ListJobs, query),
  getSettings: () => ipcRenderer.invoke(IpcChannel.GetSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannel.UpdateSettings, patch),
  listTemplates: () => ipcRenderer.invoke(IpcChannel.ListTemplates),
  duplicateTemplate: (sourceId) => ipcRenderer.invoke(IpcChannel.DuplicateTemplate, sourceId),
  saveTemplate: (template) => ipcRenderer.invoke(IpcChannel.SaveTemplate, template),
  deleteTemplate: (id) => ipcRenderer.invoke(IpcChannel.DeleteTemplate, id),
  listRules: () => ipcRenderer.invoke(IpcChannel.ListRules),
  createRule: (kind) => ipcRenderer.invoke(IpcChannel.CreateRule, kind),
  duplicateRule: (id) => ipcRenderer.invoke(IpcChannel.DuplicateRule, id),
  saveRule: (rule) => ipcRenderer.invoke(IpcChannel.SaveRule, rule),
  deleteRule: (id) => ipcRenderer.invoke(IpcChannel.DeleteRule, id),
  saveRuleSettings: (settings) => ipcRenderer.invoke(IpcChannel.SaveRuleSettings, settings),
  testRule: (raw, draft) => ipcRenderer.invoke(IpcChannel.TestRule, raw, draft),
  exportRules: (ids) => ipcRenderer.invoke(IpcChannel.ExportRules, ids),
  importRules: () => ipcRenderer.invoke(IpcChannel.ImportRules),
  listLookupTables: () => ipcRenderer.invoke(IpcChannel.ListLookupTables),
  importLookupTable: (replaceId) => ipcRenderer.invoke(IpcChannel.ImportLookupTable, replaceId),
  deleteLookupTable: (id) => ipcRenderer.invoke(IpcChannel.DeleteLookupTable, id),
  listLookupRows: (id) => ipcRenderer.invoke(IpcChannel.ListLookupRows, id),
  listSecrets: () => ipcRenderer.invoke(IpcChannel.ListSecrets),
  setSecret: (name, value) => ipcRenderer.invoke(IpcChannel.SetSecret, name, value),
  deleteSecret: (name) => ipcRenderer.invoke(IpcChannel.DeleteSecret, name),
  copySecretReference: (name) => ipcRenderer.invoke(IpcChannel.CopySecretReference, name),
  listWebhookDeliveries: () => ipcRenderer.invoke(IpcChannel.ListWebhookDeliveries),
  retryWebhookDelivery: (id) => ipcRenderer.invoke(IpcChannel.RetryWebhookDelivery, id),
  sendTestWebhook: (endpointId) => ipcRenderer.invoke(IpcChannel.SendTestWebhook, endpointId),
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.GetAppInfo),
  openLogFolder: () => ipcRenderer.invoke(IpcChannel.OpenLogFolder),
  openShop: () => ipcRenderer.invoke(IpcChannel.OpenShop),
  getUpdateStatus: () => ipcRenderer.invoke(IpcChannel.GetUpdateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannel.CheckForUpdates),
  installUpdate: () => ipcRenderer.invoke(IpcChannel.InstallUpdate),
  onUpdateStatus: (listener) => subscribe(IpcChannel.UpdateStatusChanged, listener),
  getVoiceClip: (cue) => ipcRenderer.invoke(IpcChannel.VoiceClip, cue),
};

const windowControls: WindowControlsApi = {
  chrome: windowChromeFor(process.platform),
  minimize: () => ipcRenderer.send(IpcChannel.WindowMinimize),
  toggleMaximize: () => ipcRenderer.send(IpcChannel.WindowToggleMaximize),
  close: () => ipcRenderer.send(IpcChannel.WindowClose),
  onMaximizedChange: (listener) => subscribe(IpcChannel.WindowMaximizedChanged, listener),
  onFullScreenChange: (listener) => subscribe(IpcChannel.WindowFullScreenChanged, listener),
};

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('windowControls', windowControls);
