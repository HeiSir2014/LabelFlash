import { MAX_RAW_LENGTH } from '../scan/normalize-raw';
import type { ScanField } from '../scan/scan-result';

/** 任务状态（AIP-216）。SENT = 全部份数都已发送打印：驱动回调成功只代表进了打印队列，不说「已打印」。 */
export const PRINT_JOB_STATES = ['QUEUED', 'PRINTING', 'SENT', 'FAILED'] as const;
export type PrintJobState = (typeof PRINT_JOB_STATES)[number];

/** 任务失败的原因；INTERRUPTED = 程序在打完之前退出了（重启后不续打）。 */
export const PRINT_JOB_FAILURES = [
  'NO_PRINTER',
  'PRINTER_NOT_FOUND',
  'PRINTER_NOT_READY',
  'PRINT_TIMEOUT',
  'PRINT_ERROR',
  'INTERRUPTED',
] as const;
export type PrintJobFailureReason = (typeof PRINT_JOB_FAILURES)[number];

export interface PrintJobFailure {
  reason: PrintJobFailureReason;
  /** 给调用方看的中文说明。 */
  message: string;
}

/** 已经校验过的一个打印任务请求（templateId 是程序里的编号，带冒号）。 */
export interface PrintJobInput {
  templateId: string;
  fields: ScanField[];
  /** 完整内容；调用方没给时由字段拼成（见 contentOf）。 */
  content: string | null;
  copies: number;
  printer: string | null;
  requestId: string | null;
}

export interface PrintJob extends PrintJobInput {
  id: string;
  /** 谁提交的：key:<密钥编号> 或 origin:<网站>。 */
  caller: string;
  state: PrintJobState;
  sentCopies: number;
  failure: PrintJobFailure | null;
  createdAt: number;
  updatedAt: number;
}

/** 调用方没给完整内容时，字段拼成「名称：值」一行一个；和扫码内容一样最长 MAX_RAW_LENGTH 个字。 */
export function contentOf(input: Pick<PrintJobInput, 'fields' | 'content'>): string {
  return (
    input.content ??
    input.fields
      .map((field) => `${field.name}：${field.value}`)
      .join('\n')
      .slice(0, MAX_RAW_LENGTH)
  );
}
