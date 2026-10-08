import type { JobRecord } from './types';

/**
 * 打印记录的「预览」「重打」按存下的模板和字段（不重新识别）：本机接口、批量打印、PDF 打印、局域网共享打的，
 * 以及从它们重打出来的那一张（来源是「记录重打」，靠调用方、批次、PDF 位图认出来）——它们没有识别规则可用。
 * 其余（扫码枪、手机扫码打的）按现在的规则重新识别，见 recordedFieldValues。
 * 界面（lib/reprint.ts）按它决定显示哪种按钮，主进程（ipc.ts）按它决定怎么预览、重打，两边必须一致。
 */
export function reprintsStoredLabel(job: JobRecord): boolean {
  return (
    job.pdf !== undefined ||
    job.source === 'api' ||
    job.source === 'batch' ||
    job.caller !== undefined ||
    job.batch !== undefined
  );
}

/**
 * 重新识别一条记录时带上的字段：当时打出来的值，按字段名（空值不带）。
 * 当作「手动输入的字段」交给加工步骤：只有「图中文字识别」会用（手动值优先），其余步骤照现在的设置重新算。
 * 手机拍的图不存，没有这一步的话，从记录预览、重打手机扫的一张，货架号就丢了。
 */
export function recordedFieldValues(job: JobRecord): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of job.fields ?? []) {
    if (field.value !== '') {
      values[field.name] = field.value;
    }
  }
  return values;
}
