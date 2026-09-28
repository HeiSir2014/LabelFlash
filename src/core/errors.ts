import type { PrinterIssue } from '../shared/printer-readiness';
import type { PrintFailureReason } from './types';

export interface PrintFailureInfo {
  /** 给操作员看的补充说明（中文），例如打印机报告的「缺纸」。 */
  detail?: string;
  /** 打印机没准备好时的原因分类，用来选语音播报。 */
  issue?: PrinterIssue;
}

export class PrintError extends Error {
  readonly reason: PrintFailureReason;
  readonly info: PrintFailureInfo;

  constructor(reason: PrintFailureReason, message: string = reason, info: PrintFailureInfo = {}) {
    super(message);
    this.name = 'PrintError';
    this.reason = reason;
    this.info = info;
  }
}

export interface PrintFailure extends PrintFailureInfo {
  reason: PrintFailureReason;
}

export function toPrintFailure(error: unknown): PrintFailure {
  if (!(error instanceof PrintError)) {
    return { reason: 'PRINT_ERROR' };
  }
  // 只带上有值的字段：结果会经 IPC 传给界面，也会被测试逐字段比较。
  const failure: PrintFailure = { reason: error.reason };
  if (error.info.detail !== undefined) {
    failure.detail = error.info.detail;
  }
  if (error.info.issue !== undefined) {
    failure.issue = error.info.issue;
  }
  return failure;
}
