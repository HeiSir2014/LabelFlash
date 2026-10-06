/**
 * IPP 的编号：RFC 8010（编码）、RFC 8011（语义）和 IANA 的 IPP 注册表。只列本程序用到的。
 * 局域网共享的设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 8.1 节。
 */

/** 属性组的开始标记（RFC 8010 §3.5.1）。 */
export const GROUP_TAGS = {
  operation: 0x01,
  job: 0x02,
  end: 0x03,
  printer: 0x04,
  unsupported: 0x05,
} as const;

/** 不小于它的标记是值的类型，小于它的是属性组标记（RFC 8010 §3.5）。 */
export const FIRST_VALUE_TAG = 0x10;
/** 0x10–0x1F 是「带外」值：没有值本身，只说明「不支持」「未知」「没有值」。 */
export const LAST_OUT_OF_BAND_TAG = 0x1f;
/** 扩展标记：后面跟 4 字节的真正标记（RFC 8010 §3.5.2）。没见过客户端用它，见到就拒绝。 */
export const EXTENSION_TAG = 0x7f;

/** 值的类型（RFC 8010 §3.5.2）。 */
export const VALUE_TAGS = {
  unsupported: 0x10,
  unknown: 0x12,
  noValue: 0x13,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  textWithoutLanguage: 0x41,
  nameWithoutLanguage: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

/** 支持的操作（RFC 8011 §4.2、§4.3）。 */
export const OPERATIONS = {
  printJob: 0x0002,
  validateJob: 0x0004,
  cancelJob: 0x0008,
  getJobAttributes: 0x0009,
  getJobs: 0x000a,
  getPrinterAttributes: 0x000b,
} as const;

/** 状态码（RFC 8011 附录 B）。 */
export const STATUS = {
  ok: 0x0000,
  okIgnoredOrSubstituted: 0x0001,
  badRequest: 0x0400,
  forbidden: 0x0401,
  notAuthorized: 0x0403,
  notPossible: 0x0404,
  notFound: 0x0406,
  documentFormatNotSupported: 0x040a,
  attributesOrValuesNotSupported: 0x040b,
  charsetNotSupported: 0x040d,
  compressionNotSupported: 0x040f,
  documentFormatError: 0x0411,
  operationNotSupported: 0x0501,
  versionNotSupported: 0x0503,
  busy: 0x0507,
} as const;

/** printer-state（RFC 8011 §5.4.11）。 */
export const PRINTER_STATE = { idle: 3, processing: 4, stopped: 5 } as const;
/** job-state（RFC 8011 §5.3.7）。 */
export const JOB_STATE = {
  pending: 3,
  'pending-held': 4,
  processing: 5,
  canceled: 7,
  aborted: 8,
  completed: 9,
} as const;
/** orientation-requested：3 = 竖、4 = 横。 */
export const ORIENTATION = { portrait: 3, landscape: 4 } as const;
/** print-quality：4 = 普通。 */
export const PRINT_QUALITY_NORMAL = 4;
/** finishings：3 = 不做后处理。 */
export const FINISHINGS_NONE = 3;
/** 分辨率的单位：3 = 每英寸点数（RFC 8011 §5.1.16）。 */
export const RESOLUTION_DPI = 3;
/** 回复用的字符集和语言：程序只说 UTF-8 的中文。 */
export const IPP_CHARSET = 'utf-8';
export const IPP_LANGUAGE = 'zh-cn';
