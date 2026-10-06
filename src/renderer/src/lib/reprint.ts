import { storedTemplateIssue } from '../../../core/api/template-fields';
import { PDF_PIECE_RETENTION_MS } from '../../../core/pdf/pdf-model';
import type { LabelTemplate } from '../../../core/templates/template-model';
import type { JobRecord } from '../../../core/types';

/**
 * 打印记录的「预览」「重打」怎么做：
 * - rescan：扫码来的，照旧按内容重新识别（规则、加工步骤按现在的）；
 * - stored：本机接口、批量打印、PDF 打印来的，没有识别规则可用，按当时的模板和字段（PDF 按缓存的黑白位图）；
 * - expired：PDF 打印的，缓存的位图只留 7 天，已经过期；
 * - template-changed：按当时的模板和字段重打的，模板编号没变但字段或纸张改过（core 的 TEMPLATE_CHANGED_ISSUE）；
 * - unavailable：做不了（识别不了的内容，或记录缺了模板、字段，或模板删了）。
 */
export type ReprintMode = 'rescan' | 'stored' | 'expired' | 'template-changed' | 'unavailable';

/**
 * 本机接口打的记录都带调用方，批量打的都带批次，PDF 打的都带位图编号；从它们重打出来的那一张来源是「记录重打」，
 * 也带着这些，同样按原样重打。templateOf 按编号取现在的模板（删掉了为 undefined），用来核对模板有没有改过。
 * now 是现在的时间（毫秒）。主进程（ipc.ts 的 storedLabelOf）按同一个核对拒绝。
 */
export function reprintMode(
  job: JobRecord,
  templateOf: (templateId: string) => LabelTemplate | undefined,
  now: number,
): ReprintMode {
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
  const template = job.templateId === undefined ? undefined : templateOf(job.templateId);
  if (template === undefined || job.fields === undefined) {
    return 'unavailable';
  }
  return storedTemplateIssue(template, job.templateFingerprint) === null ? 'stored' : 'template-changed';
}

/** 显示「预览」「重打」按钮。 */
export function canReprint(mode: ReprintMode): boolean {
  return mode === 'rescan' || mode === 'stored';
}
