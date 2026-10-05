import { PDF_PIECE_RETENTION_MS } from '../../../core/pdf/pdf-model';
import type { JobRecord } from '../../../core/types';

/**
 * 打印记录的「预览」「重打」怎么做：
 * - rescan：扫码来的，照旧按内容重新识别（规则、加工步骤按现在的）；
 * - stored：本机接口、批量打印、PDF 打印来的，没有识别规则可用，按当时的模板和字段（PDF 按缓存的黑白位图）；
 * - expired：PDF 打印的，缓存的位图只留 7 天，已经过期；
 * - unavailable：做不了（识别不了的内容，或记录缺了模板、字段）。
 */
export type ReprintMode = 'rescan' | 'stored' | 'expired' | 'unavailable';

/**
 * 本机接口打的记录都带调用方，批量打的都带批次，PDF 打的都带位图编号；从它们重打出来的那一张来源是「记录重打」，
 * 也带着这些，同样按原样重打。hasTemplate 查模板是否还在：删掉了就不能按原样重打。now 是现在的时间（毫秒）。
 */
export function reprintMode(job: JobRecord, hasTemplate: (templateId: string) => boolean, now: number): ReprintMode {
  if (job.status === 'invalid') {
    return 'unavailable';
  }
  // PDF 的一块不在模板库里：按缓存的位图重打。主进程启动时才清理，这里按记录时间算，宁可早一点说过期。
  if (job.pdf !== undefined) {
    return now - job.createdAt < PDF_PIECE_RETENTION_MS ? 'stored' : 'expired';
  }
  if (job.source !== 'api' && job.source !== 'batch' && job.caller === undefined && job.batch === undefined) {
    return 'rescan';
  }
  return job.templateId !== undefined && job.fields !== undefined && hasTemplate(job.templateId)
    ? 'stored'
    : 'unavailable';
}

/** 显示「预览」「重打」按钮。 */
export function canReprint(mode: ReprintMode): boolean {
  return mode === 'rescan' || mode === 'stored';
}
