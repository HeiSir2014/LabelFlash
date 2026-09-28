import type { ScanRule } from './rule-model';

/**
 * 规则分享文件：`{ format, version, exportedAt, rules }`。
 * 只包含规则定义，不含 id（导入时生成新 id）、本机的顺序 / 启用 / 模板绑定、查找表数据和密钥。
 */
export const RULE_FILE_FORMAT = 'cdl-labelflash-rules';
export const RULE_FILE_VERSION = 1;
const BYTES_PER_KB = 1024;
export const MAX_RULE_FILE_BYTES = 256 * BYTES_PER_KB;
export const RULE_FILE_EXTENSION = 'labelflash-rules.json';

export type ParsedRuleFile = { ok: true; rules: unknown[] } | { ok: false; issue: string };

export function serializeRules(rules: readonly ScanRule[], exportedAt: number): string {
  const body = {
    format: RULE_FILE_FORMAT,
    version: RULE_FILE_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    rules: rules.map(({ id: _id, ...rule }) => rule),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** 只检查文件外壳；每条规则由 RuleCatalog.importRules 逐条校验。 */
export function parseRuleFile(text: string): ParsedRuleFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, issue: '文件不是有效的 JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, issue: '不是识别规则文件' };
  }
  const { format, version, rules } = value as Record<string, unknown>;
  if (format !== RULE_FILE_FORMAT) {
    return { ok: false, issue: '不是识别规则文件' };
  }
  if (version !== RULE_FILE_VERSION) {
    return { ok: false, issue: `文件版本 ${String(version)} 不受支持，请升级软件` };
  }
  if (!Array.isArray(rules)) {
    return { ok: false, issue: '文件里没有规则列表' };
  }
  return { ok: true, rules };
}

/** 规则会访问的 HTTP 主机（去重、排序），导入时请用户确认。 */
export function httpHostsOf(rules: readonly ScanRule[]): string[] {
  const hosts = new Set<string>();
  for (const rule of rules) {
    for (const step of rule.steps) {
      if (step.kind === 'http') {
        const origin = /^https?:\/\/[^/?#]+/i.exec(step.url)?.[0];
        if (origin) {
          hosts.add(origin.toLowerCase());
        }
      }
    }
  }
  return [...hosts].sort();
}

export function hasHttpStep(rule: ScanRule): boolean {
  return rule.steps.some((step) => step.kind === 'http');
}
