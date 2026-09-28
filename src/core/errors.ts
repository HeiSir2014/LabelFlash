import type { PrintFailureReason } from './types';

export class PrintError extends Error {
  readonly reason: PrintFailureReason;
  /** 给操作员看的补充说明（中文），例如打印机报告的「缺纸」。 */
  readonly detail: string | undefined;

  constructor(reason: PrintFailureReason, message: string = reason, detail?: string) {
    super(message);
    this.name = 'PrintError';
    this.reason = reason;
    this.detail = detail;
  }
}

export interface PrintFailure {
  reason: PrintFailureReason;
  detail?: string;
}

export function toPrintFailure(error: unknown): PrintFailure {
  if (!(error instanceof PrintError)) {
    return { reason: 'PRINT_ERROR' };
  }
  return error.detail === undefined ? { reason: error.reason } : { reason: error.reason, detail: error.detail };
}
