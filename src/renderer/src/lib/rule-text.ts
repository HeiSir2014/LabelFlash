import type { EnrichResult, StepTrace } from '../../../core/scan/enrich';
import type { EnrichStep, StepKind } from '../../../core/scan/enrich-model';
import type { RuleKind, ScanRule, WholeCharset } from '../../../core/scan/rule-model';
import type { ScanField } from '../../../core/scan/scan-result';
import { describeArea } from './image-text-area';

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  delimited: '分隔符拆分',
  keyValue: '多行键值',
  whole: '整段匹配',
  regex: '正则',
};

export const RULE_KIND_HINTS: Record<RuleKind, string> = {
  delimited: '按分隔符拆成固定顺序的几段，例如 编码-颜色-尺码',
  keyValue: '每行一个「名称：值」，名称可以有多种写法',
  whole: '整段内容就是一个字段，例如纯数字订单号',
  regex: '用正则的命名分组取字段，适合格式复杂的码',
};

export const STEP_KIND_LABELS: Record<StepKind, string> = {
  template: '文本拼接',
  regexReplace: '正则替换',
  lookup: '查找表',
  http: 'HTTP 查询',
  imageText: '图中文字识别',
};

const CHARSET_LABELS: Record<WholeCharset, string> = {
  digits: '纯数字',
  alphanumeric: '字母和数字',
  any: '不限',
};

/** 显示用的分隔符：换行、制表符、空格看不见，写成文字。 */
export function describeDelimiter(delimiter: string): string {
  return delimiter.replace(/\n/g, '换行').replace(/\t/g, '制表符').replace(/ /g, '空格');
}

/** 规则列表里的一行摘要，例如「分隔符 - · 编码 / 颜色 / 尺码」。 */
export function ruleSummary(rule: ScanRule): string {
  switch (rule.kind) {
    case 'delimited':
      return `分隔符 ${describeDelimiter(rule.delimiter)} · ${rule.fields.join(' / ')}`;
    case 'keyValue':
      return `键值 · ${rule.fields.map((field) => field.name).join(' / ')}${rule.keepUnknown ? ' 等' : ''}`;
    case 'whole':
      return `${CHARSET_LABELS[rule.charset]} ${rule.minLength}–${rule.maxLength} 位 · ${rule.field}`;
    case 'regex':
      return `正则 /${rule.pattern}/${rule.flags}`;
  }
}

/** 加工步骤的一行摘要。 */
export function stepSummary(step: EnrichStep): string {
  switch (step.kind) {
    case 'template':
      return `${step.output} = ${step.text}`;
    case 'regexReplace':
      return `${step.output} = ${step.input ?? '完整内容'} 替换 /${step.pattern}/${step.flags}`;
    case 'lookup':
      return `按「${step.input ?? '完整内容'}」查表 → ${step.outputs.map((output) => output.field).join('、')}`;
    case 'http':
      return `${step.method} ${hostOf(step.url)} → ${step.outputs.map((output) => output.field).join('、')}`;
    case 'imageText':
      return `${step.output} = 标签上 /${step.pattern}/${step.flags}（${describeArea(step.preferredArea)}）`;
  }
}

/** 「试一试」里一个步骤的执行情况：完成、跳过的原因或失败的原因。 */
export function describeTrace(trace: StepTrace): string {
  const outcome = trace.skipped ? (trace.detail ?? '跳过') : trace.ok ? '完成' : (trace.detail ?? '失败');
  return `${STEP_KIND_LABELS[trace.kind]}：${outcome}（${Math.round(trace.durationMs)} 毫秒）`;
}

/** 设为「不打印」的步骤失败时，「试一试」里的提示。 */
export function describeBlocked(blocked: NonNullable<EnrichResult['blocked']>): string {
  const what = blocked.reason === 'TEXT_NOT_FOUND' ? '没认出' : '查询失败';
  return `${what}且设为不打印：${blocked.detail}`;
}

/** 识别结果的字段摘要：「编码 CL5640 · 颜色 红」，多行值合成一行。 */
export function fieldsSummary(fields: readonly ScanField[]): string {
  return fields.map((field) => `${field.name} ${field.value.replace(/\n/g, ' / ') || '（空）'}`).join(' · ');
}

function hostOf(url: string): string {
  return /^https?:\/\/[^/?#]+/i.exec(url)?.[0] ?? url;
}
