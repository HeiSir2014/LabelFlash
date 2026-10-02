import { readSheet } from 'read-excel-file/node';
import { readTableBytes, UNREADABLE_ISSUE } from './table-file';

/**
 * 读表格的子进程（Electron utilityProcess）入口，由 index.ts 按 `?modulePath` 打包、fork。
 * 收一条消息（文件类型 + 字节）、回一条消息（文字的二维数组或原因），之后由主进程结束这个进程。
 * readTableBytes 本身不会抛错（库的错误放在回复的 detail 里），但 postMessage 本身也可能失败
 * （例如回复里混进了结构化克隆不了的东西）：这里兜一层，尽量还是回一条读不出的消息，
 * 而不是让主进程只能靠超时才发现子进程没反应。
 */
process.parentPort.once('message', (event) => {
  void readTableBytes(event.data, (bytes) => readSheet(bytes))
    .then((reply) => process.parentPort.postMessage(reply))
    .catch((error) => {
      try {
        process.parentPort.postMessage({ ok: false, issue: UNREADABLE_ISSUE, detail: String(error) });
      } catch {
        // postMessage 本身也失败了：没有别的办法，主进程的超时会接管。
      }
    });
});
