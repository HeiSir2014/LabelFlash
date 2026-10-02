import { BATCH_LIMITS } from '../../core/batch/batch-model';
import type { TableReadReply, TableReadRequest } from './table-file';

/** 读表格的子进程：index.ts 用 utilityProcess.fork 实现，测试里换成假的。 */
export interface ReaderProcess {
  postMessage(request: TableReadRequest): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export interface TableReaderHostDeps {
  fork: () => ReaderProcess;
  timeoutMs: number;
  schedule: (run: () => void, delayMs: number) => () => void;
  log: (line: string) => void;
}

export const READ_TIMEOUT_ISSUE = '读表格超时：文件太大或已损坏。可以在 Excel 里「另存为」CSV 再试';
export const READER_FAILED_ISSUE = '读表格时出错：文件太大或已损坏。可以在 Excel 里「另存为」CSV 再试';
/** 又导入了一个新文件，上一个还没读完就被结束：这是正常操作，不是出错。 */
export const READ_SUPERSEDED_ISSUE = '已经开始读取另一个文件，这次导入被取消';
/** 子进程给的原因的长度上限：只显示一句话，更长的说明子进程出了问题。 */
const MAX_ISSUE_LENGTH = 200;
/** 写日志时 detail 最多留这么多字：它是库的原始错误（可能是一整段堆栈），完整内容对排查没有额外帮助。 */
const MAX_LOGGED_DETAIL_LENGTH = 500;

/**
 * 每读一个文件起一个子进程（Chromium 两条法则：不可信的输入 + 第三方解析库，不放在高权限的主进程里）。
 * 读完、超时、出错都结束它，不复用：坏文件把子进程弄坏了也不影响下一次。
 * 同一时间只读一个文件：新的一次 read() 直接结束上一次还没读完的子进程，不等它超时。
 */
export class TableReaderHost {
  private current: { cancel: () => void } | null = null;

  constructor(private readonly deps: TableReaderHostDeps) {}

  read(request: TableReadRequest): Promise<TableReadReply> {
    const previous = this.current;
    return new Promise((resolve) => {
      let isSettled = false;
      let child: ReaderProcess | null = null;
      let cancelTimer: () => void = () => undefined;
      const token: { cancel: () => void } = { cancel: () => undefined };
      const finish = (reply: TableReadReply) => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        cancelTimer();
        child?.kill();
        if (this.current === token) {
          this.current = null;
        }
        resolve(reply);
      };
      token.cancel = () => finish({ ok: false, issue: READ_SUPERSEDED_ISSUE });
      this.current = token;
      // 先登记好这一次、再结束上一次：万一上一次的结束回调是同步触发的，也不会把这一次顶掉。
      previous?.cancel();
      cancelTimer = this.deps.schedule(() => {
        this.deps.log(`[batch] table reader timed out after ${this.deps.timeoutMs}ms`);
        finish({ ok: false, issue: READ_TIMEOUT_ISSUE });
      }, this.deps.timeoutMs);
      try {
        child = this.deps.fork();
      } catch (error) {
        this.deps.log(`[batch] cannot start the table reader: ${String(error)}`);
        finish({ ok: false, issue: READER_FAILED_ISSUE });
        return;
      }
      child.onMessage((message) => {
        const reply = readReply(message);
        if (!reply.ok && reply.detail !== undefined) {
          this.deps.log(`[batch] table reader refused the file: ${reply.detail.slice(0, MAX_LOGGED_DETAIL_LENGTH)}`);
        }
        finish(reply.ok ? reply : { ok: false, issue: reply.issue });
      });
      child.onExit((code) => {
        if (!isSettled) {
          this.deps.log(`[batch] table reader exited with code ${code} before answering`);
        }
        finish({ ok: false, issue: READER_FAILED_ISSUE });
      });
      child.postMessage(request);
    });
  }
}

/** 子进程的回复也不全信：形状、类型、行数、列数、总字数都再核对一遍，不对就按读不出处理。 */
export function readReply(message: unknown): TableReadReply {
  if (typeof message !== 'object' || message === null) {
    return { ok: false, issue: READER_FAILED_ISSUE, detail: 'reply is not an object' };
  }
  const reply = message as Record<string, unknown>;
  const issue = reply['issue'];
  const detail = reply['detail'];
  if (reply['ok'] === false && typeof issue === 'string' && issue.length <= MAX_ISSUE_LENGTH) {
    return typeof detail === 'string' ? { ok: false, issue, detail } : { ok: false, issue };
  }
  const records = reply['records'];
  if (reply['ok'] !== true || !Array.isArray(records) || records.length > BATCH_LIMITS.rows + 1) {
    return { ok: false, issue: READER_FAILED_ISSUE, detail: 'reply has no valid records' };
  }
  let chars = 0;
  for (const record of records) {
    if (!Array.isArray(record) || record.length > BATCH_LIMITS.columns) {
      return { ok: false, issue: READER_FAILED_ISSUE, detail: 'record is not a bounded array' };
    }
    for (const cell of record) {
      if (typeof cell !== 'string') {
        return { ok: false, issue: READER_FAILED_ISSUE, detail: 'cell is not text' };
      }
      chars += cell.length;
    }
    if (chars > BATCH_LIMITS.totalChars) {
      return { ok: false, issue: READER_FAILED_ISSUE, detail: 'records exceed the size limit' };
    }
  }
  return { ok: true, records: records as string[][] };
}
