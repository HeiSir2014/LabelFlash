import type { ScanField } from '../scan/scan-result';

/**
 * 序号变量的名字：模板里写 {序号}。它不是 {日期} 那样的固定变量：批量打印把序号作为名为「序号」的字段交给模板，
 * 标签、面单、自由设计展开变量时本来就按字段取值（note-text.ts 的 expandVariables），渲染代码不用改。
 */
export const SERIAL_FIELD = '序号';

/** 模板变量名的长度上限：和 note-text.ts 里变量的写法（花括号里 1–20 个字符）一致。 */
export const VARIABLE_NAME_MAX_LENGTH = 20;

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** 批量打印的上限，每项写取值依据。 */
export const BATCH_LIMITS = {
  /** 文件大小 20MB：和查找表一致；一万行的表格远小于它。 */
  fileBytes: 20 * BYTES_PER_MEGABYTE,
  /** 数据行数：一万行（设计第 5 节）。 */
  rows: 10_000,
  /** 列数：Excel 导出的宽表一般几十列，100 列留足余量。 */
  columns: 100,
  /** 列名长度：和查找表一致。 */
  columnNameLength: 50,
  /** 单元格长度：和查找表一致，标签上放不下更长的字。 */
  cellLength: 1_000,
  /**
   * 整张表的字符总数：一万行 × 100 列 × 1000 字理论上有 10 亿字，进程之间、界面里都放不下；
   * 500 万字（内存里约 10MB）够一万行 × 25 列 × 20 字。
   */
  totalChars: 5_000_000,
  /** 粘贴的文字：和整张表的总字数一致。 */
  pasteChars: 5_000_000,
  /** 每行最多几份：一行要打 100 张以上应该拆开或分批。 */
  copiesPerRow: 100,
  /** 一批最多几张：热敏标签机每秒 1–2 张，2 万张要 3–6 小时，再多应该分批。 */
  labels: 20_000,
  /** 「只按序号打」最多几张：和数据行数一致。 */
  serialOnlyCount: 10_000,
  /** 序号起始值：12 位，够箱号、流水号。 */
  serialStart: 999_999_999_999,
  /** 序号步长上限：再大就不像序号了。 */
  serialStep: 1_000_000,
  /** 序号补零的位数：和起始值的 12 位一致。 */
  serialDigits: 12,
  /** 序号前缀、后缀的长度。 */
  serialAffixLength: 20,
  /** 固定值长度：和单元格一致。 */
  fixedValueLength: 1_000,
  /** 一个模板最多有几个变量要对列：自由设计最多 100 个元素，表格每格都能有变量，200 足够。 */
  variables: 200,
} as const;

/** 文件太大时的说明（界面拖进来时先查一次，主进程再查一次）。 */
export const FILE_TOO_LARGE_ISSUE = `文件不能超过 ${BATCH_LIMITS.fileBytes / BYTES_PER_MEGABYTE}MB：可以拆成几个文件分批打`;

/** 批次号：开始时间（本地时间到秒）+ 4 位十六进制，例如 20261002-143501-a1b2。 */
export const BATCH_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
/** 主进程给读进来的表格的编号（UUID）。 */
export const TABLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 读进来的一张表：rows 的每一行长度都等于 columns。 */
export interface BatchTable {
  /** 主进程给的编号：开始打印时按它找回这张表，界面不用把整张表传回去。 */
  id: string;
  /** 文件名；粘贴的是「粘贴的数据」。 */
  name: string;
  columns: string[];
  rows: string[][];
}

/** 一个模板变量从哪取值：表格的一列、固定值，或不填（这一项不印）。 */
export type FieldSource = { kind: 'column'; column: string } | { kind: 'fixed'; value: string } | { kind: 'none' };

export const NO_SOURCE: FieldSource = { kind: 'none' };

/** 序号 {序号}：按规则生成，或取表格的一列（column 不为 null 时，前面几项不用）。 */
export interface SerialSettings {
  enabled: boolean;
  prefix: string;
  start: number;
  step: number;
  /** 补零到几位；0 = 不补。 */
  digits: number;
  suffix: string;
  column: string | null;
}

export const DEFAULT_SERIAL: SerialSettings = {
  enabled: false,
  prefix: '',
  start: 1,
  step: 1,
  digits: 0,
  suffix: '',
  column: null,
};

/** 份数：每行固定几份，或取表格的一列。 */
export type CopiesSettings = { kind: 'fixed'; count: number } | { kind: 'column'; column: string };

export const DEFAULT_COPIES: CopiesSettings = { kind: 'fixed', count: 1 };

/** 数据：主进程里存着的一张表，或不用数据、只按序号打几张。 */
export type BatchData = { kind: 'table'; tableId: string } | { kind: 'serial-only'; count: number };

/** 一次批量打印的全部设置（界面交给主进程，经 parseBatchPlan 校验）。 */
export interface BatchPlan {
  templateId: string;
  data: BatchData;
  /** 模板变量名 → 取值方式；序号不在这里（见 serial）。 */
  mapping: Record<string, FieldSource>;
  serial: SerialSettings;
  copies: CopiesSettings;
  /** 要打的行（0 起的下标）；null = 全部。 */
  rows: number[] | null;
}

/** 一张标签：row 是数据的第几行（从 1 数、不含表头；只按序号打时是第几张），copy 是这一行的第几份。 */
export interface BatchLabel {
  row: number;
  copy: number;
  fields: ScanField[];
  /** 完整内容：打印记录的 raw、二维码的「完整内容」、{完整内容}。 */
  content: string;
}

/** 有问题的一行（缺字段、份数不对、条码印不了……）：界面标黄，问题写在悬停提示和预览旁。 */
export interface RowProblem {
  /** 从 1 数，不含表头。 */
  row: number;
  texts: string[];
}

/** 只读自己的键：变量名可能是 __proto__ 这样的字，不能从原型上取到东西。 */
export function sourceOf(mapping: Readonly<Record<string, FieldSource>>, variable: string): FieldSource {
  return Object.hasOwn(mapping, variable) ? (mapping[variable] ?? NO_SOURCE) : NO_SOURCE;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 批次号：开始时间（本地时间到秒）加 4 位随机十六进制。界面和打印记录里显示它，比 UUID 好认；
 * 同一秒开两批（例如打完马上重打失败的）也不会撞。
 */
export function batchIdFor(date: Date, randomHex: string): string {
  if (!/^[0-9a-f]{4}$/.test(randomHex)) {
    throw new Error(`Invalid batch id suffix: ${randomHex}`);
  }
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${day}-${time}-${randomHex}`;
}
