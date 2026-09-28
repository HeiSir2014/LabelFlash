import type { EnrichResult } from '../core/scan/enrich';
import type { ScanRule } from '../core/scan/rule-model';
import type { RuleSetting } from '../core/scan/rule-settings';
import type { ScanResult } from '../core/scan/scan-result';
import type { InvalidReason } from '../core/types';

/** 规则页需要的全部数据：规则定义 + 本机的顺序、启用、绑定（已和现有规则对齐）。 */
export interface RuleListing {
  rules: ScanRule[];
  settings: RuleSetting[];
}

/** 新建、复制、保存的结果：不合法或超过上限时给出原因（中文）。 */
export type RuleMutation = { ok: true; rule: ScanRule } | { ok: false; issue: string };

/** 「试一试」：识别结果和每个加工步骤的结果。 */
export type RuleTestResult =
  | { status: 'ok'; recognized: ScanResult; enriched: EnrichResult }
  | { status: 'invalid'; reason: InvalidReason }
  /** 正在编辑、还没保存的规则本身不合法。 */
  | { status: 'invalid-rule'; issue: string };

export type RuleImportResult =
  | { status: 'imported'; imported: number; skipped: { index: number; issue: string }[]; httpHosts: string[] }
  | { status: 'canceled' }
  | { status: 'invalid'; issue: string };

export type RuleExportResult = { status: 'saved'; count: number } | { status: 'canceled' };
