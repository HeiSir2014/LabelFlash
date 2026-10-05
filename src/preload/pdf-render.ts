import { contextBridge, ipcRenderer } from 'electron';
import { PDF_RENDER_CHANNELS, type PdfHostApi, type RenderRequest } from '../shared/pdf-render-protocol';

/**
 * PDF 渲染页的 preload：只暴露「收请求」「回结果」两个函数，不暴露 ipcRenderer 本身。
 * 跑着不可信 PDF 的这一页碰不到主窗口的任何通道（那些通道在主进程里也只认主窗口）。
 */
const host: PdfHostApi = {
  onRequest: (listener) => {
    ipcRenderer.on(PDF_RENDER_CHANNELS.request, (_event, request: RenderRequest) => listener(request));
  },
  reply: (reply) => ipcRenderer.send(PDF_RENDER_CHANNELS.reply, reply),
};

contextBridge.exposeInMainWorld('pdfHost', host);
