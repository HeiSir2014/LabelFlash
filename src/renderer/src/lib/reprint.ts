import type { JobRecord } from '../../../core/types';

/**
 * 打印记录的「预览」「重打」怎么做：
 * - rescan：扫码来的，照旧按内容重新识别（规则、加工步骤按现在的）；
 * - stored：本机接口来的，没有识别规则可用，按当时的模板和字段；
 * - unavailable：做不了（识别不了的内容，或本机接口的记录缺了模板、字段）。
 */
export type ReprintMode = 'rescan' | 'stored' | 'unavailable';

/**
 * 本机接口打的记录都带调用方；从它重打出来的那一张来源是「记录重打」，也带着调用方，同样按字段重打。
 * hasTemplate 查模板是否还在：删掉了就不能按原样重打。
 */
export function reprintMode(job: JobRecord, hasTemplate: (templateId: string) => boolean): ReprintMode {
  if (job.status === 'invalid') {
    return 'unavailable';
  }
  if (job.source !== 'api' && job.caller === undefined) {
    return 'rescan';
  }
  return job.templateId !== undefined && job.fields !== undefined && hasTemplate(job.templateId)
    ? 'stored'
    : 'unavailable';
}
