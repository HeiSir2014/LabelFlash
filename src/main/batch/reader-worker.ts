import { readSheet } from 'read-excel-file/node';
import { readTableBytes, UNREADABLE_ISSUE } from './table-file';

/** 内存看门狗多久查一次：频繁到能在内存失控时尽快发现，又不至于本身占用什么开销。 */
const MEMORY_CHECK_INTERVAL_MS = 100;
/**
 * 子进程的内存上限：本地文件头的检查（table-file.ts 的 zipBombIssue）拦住了声明大小离谱的压缩炸弹，
 * 但这只是静态核对——这是最后一道防线。Buffer / ArrayBuffer 分配在 V8 堆外，--max-old-space-size
 * （512MB，见 index.ts 的 TABLE_READER_HEAP_MB）管不住它们；600MB 比堆上限略宽裕，一旦连堆内堆外
 * 加起来都超过它，内存已经失控，直接退出。主进程把子进程意外退出统一按「文件太大或已损坏」处理
 * （见 table-reader-host.ts 的 onExit），不需要这里另外报告。
 */
const MAX_MEMORY_BYTES = 600 * 1024 * 1024;

const watchdog = setInterval(() => {
  const usage = process.memoryUsage();
  if (usage.heapUsed + usage.external + usage.arrayBuffers > MAX_MEMORY_BYTES) {
    process.exit(1);
  }
}, MEMORY_CHECK_INTERVAL_MS);

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
    })
    .finally(() => clearInterval(watchdog));
});
