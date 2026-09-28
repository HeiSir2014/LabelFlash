/** 识别出的一个字段：字段名由识别规则决定（例如「订单号」「款号」「尺码」）。 */
export interface ScanField {
  name: string;
  value: string;
}

/** 一次扫码的识别结果。 */
export interface ScanResult {
  /** 规范化后的原始内容，也是防重复的依据。 */
  raw: string;
  ruleId: string;
  ruleName: string;
  /** 有序；同一结果里字段名唯一。 */
  fields: ScanField[];
}

export function fieldValue(scan: ScanResult, name: string): string | undefined {
  return scan.fields.find((field) => field.name === name)?.value;
}
