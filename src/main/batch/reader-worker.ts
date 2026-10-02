import { readSheet } from 'read-excel-file/node';
import { readTableBytes } from './table-file';

/**
 * 读表格的子进程（Electron utilityProcess）入口，由 index.ts 按 `?modulePath` 打包、fork。
 * 收一条消息（文件类型 + 字节）、回一条消息（文字的二维数组或原因），之后由主进程结束这个进程。
 * readTableBytes 不会抛错：库的错误放在回复的 detail 里，由主进程写日志（子进程的 console 不进日志文件）。
 */
process.parentPort.once('message', (event) => {
  void readTableBytes(event.data, (bytes) => readSheet(bytes)).then((reply) => process.parentPort.postMessage(reply));
});
