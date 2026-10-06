import type { PaperSize } from '../../shared/paper-sizes';
import { PDF_LIMITS } from '../pdf/pdf-model';
import { AUTO_FORMAT, SUPPORTED_FORMATS } from './document-format';
import {
  booleanAttr,
  charsetAttr,
  collectionAttr,
  dateTimeAttr,
  enumAttr,
  integerAttr,
  keywordAttr,
  languageAttr,
  mimeTypeAttr,
  nameAttr,
  outOfBandAttr,
  rangeAttr,
  resolutionAttr,
  textAttr,
  uriAttr,
} from './ipp-attributes';
import type { IppAttribute } from './ipp-codec';
import {
  FINISHINGS_NONE,
  IPP_CHARSET,
  IPP_LANGUAGE,
  OPERATIONS,
  ORIENTATION,
  PRINT_QUALITY_NORMAL,
  PRINTER_STATE,
  VALUE_TAGS,
} from './ipp-constants';
import { mediaName, type SharedPrinter } from './shared-printer';

/** 每张最多 99 份：和 PDF 打印的份数上限一致。 */
export const IPP_COPIES_MAX = PDF_LIMITS.copies;
/** 纸的尺寸按 1/100 毫米写（PWG 5100.7 的 media-size）。 */
const HUNDREDTHS_PER_MM = 100;
/** 标签纸铺满打印：四边边距 0。 */
const NO_MARGIN = 0;
/** 只在明确要时才给（PWG 5100.7：requested-attributes 为 all 时不含它）。 */
const EXPLICIT_ONLY: ReadonlySet<string> = new Set(['media-col-database']);
/** 这些前缀的属性属于 job-template 组（RFC 8011 §5.2 的 xxx-default、xxx-supported、xxx-ready）。 */
const JOB_TEMPLATE_PREFIXES = [
  'copies-',
  'finishings-',
  'media-',
  'orientation-requested-',
  'output-bin-',
  'print-color-mode-',
  'print-quality-',
  'printer-resolution-',
  'sides-',
] as const;

/** 回复 Get-Printer-Attributes 时按这次请求算的部分。 */
export interface PrinterContext {
  /** 按对方请求时用的主机拼的 ipp:// 网址。 */
  printerUri: string;
  /** 浏览器能打开的说明页（http://）。 */
  moreInfoUri: string;
  /** basic = 设了共享密码。 */
  authentication: 'none' | 'basic';
  upTimeSeconds: number;
  nowMs: number;
}

/**
 * urf-supported（DNS-SD 的 URF= 同一份，系统自带的打印按它认光栅能力）：
 * 版本 1.4、份数由打印机做、8 位灰度和 24 位 sRGB、这台打印机的分辨率。
 */
export function urfSupported(dpi: number): string[] {
  return ['V1.4', 'CP1', 'W8', 'SRGB24', `RS${dpi}`];
}

/** 一种纸的 media-col（PWG 5100.7）：尺寸、四边边距 0、主纸盒、标签纸。 */
export function mediaCollection(paper: PaperSize): IppAttribute[] {
  return [
    collectionAttr('media-size', mediaSize(paper)),
    integerAttr('media-bottom-margin', NO_MARGIN),
    integerAttr('media-left-margin', NO_MARGIN),
    integerAttr('media-right-margin', NO_MARGIN),
    integerAttr('media-top-margin', NO_MARGIN),
    keywordAttr('media-source', 'main'),
    keywordAttr('media-type', 'labels'),
  ];
}

function mediaSize(paper: PaperSize): IppAttribute[] {
  return [
    integerAttr('x-dimension', Math.round(paper.widthMm * HUNDREDTHS_PER_MM)),
    integerAttr('y-dimension', Math.round(paper.heightMm * HUNDREDTHS_PER_MM)),
  ];
}

/** 一台共享打印机的全部属性（RFC 8011 + PWG 5100.12 / 5100.14 / 5100.7 + urf-supported），按名字排好。 */
export function printerAttributes(printer: SharedPrinter, context: PrinterContext): IppAttribute[] {
  const media = mediaName(printer.key);
  const mediaCol = mediaCollection(printer.paper);
  const reasons = printer.state.reasons.length > 0 ? printer.state.reasons : ['none'];
  return [
    charsetAttr('charset-configured', IPP_CHARSET),
    charsetAttr('charset-supported', IPP_CHARSET),
    booleanAttr('color-supported', false),
    keywordAttr('compression-supported', 'none'),
    integerAttr('copies-default', 1),
    rangeAttr('copies-supported', 1, IPP_COPIES_MAX),
    mimeTypeAttr('document-format-default', AUTO_FORMAT),
    mimeTypeAttr('document-format-supported', ...SUPPORTED_FORMATS),
    enumAttr('finishings-default', FINISHINGS_NONE),
    enumAttr('finishings-supported', FINISHINGS_NONE),
    languageAttr('generated-natural-language-supported', IPP_LANGUAGE),
    keywordAttr('ipp-features-supported', 'ipp-everywhere'),
    keywordAttr('ipp-versions-supported', '1.1', '2.0'),
    keywordAttr(
      'job-creation-attributes-supported',
      'copies',
      'media',
      'media-col',
      'orientation-requested',
      'print-color-mode',
      'print-quality',
      'printer-resolution',
      'sides',
    ),
    booleanAttr('job-ids-supported', true),
    integerAttr('media-bottom-margin-supported', NO_MARGIN),
    collectionAttr('media-col-database', mediaCol),
    collectionAttr('media-col-default', mediaCol),
    collectionAttr('media-col-ready', mediaCol),
    keywordAttr(
      'media-col-supported',
      'media-size',
      'media-bottom-margin',
      'media-left-margin',
      'media-right-margin',
      'media-top-margin',
      'media-source',
      'media-type',
    ),
    keywordAttr('media-default', media),
    integerAttr('media-left-margin-supported', NO_MARGIN),
    keywordAttr('media-ready', media),
    integerAttr('media-right-margin-supported', NO_MARGIN),
    collectionAttr('media-size-supported', mediaSize(printer.paper)),
    keywordAttr('media-source-supported', 'main'),
    keywordAttr('media-supported', media),
    integerAttr('media-top-margin-supported', NO_MARGIN),
    keywordAttr('media-type-supported', 'labels'),
    languageAttr('natural-language-configured', IPP_LANGUAGE),
    enumAttr('operations-supported', ...Object.values(OPERATIONS)),
    enumAttr('orientation-requested-default', ORIENTATION.portrait),
    enumAttr('orientation-requested-supported', ORIENTATION.portrait, ORIENTATION.landscape),
    keywordAttr('output-bin-default', 'face-up'),
    keywordAttr('output-bin-supported', 'face-up'),
    keywordAttr('pdl-override-supported', 'attempted'),
    keywordAttr('print-color-mode-default', 'monochrome'),
    keywordAttr('print-color-mode-supported', 'auto', 'monochrome'),
    enumAttr('print-quality-default', PRINT_QUALITY_NORMAL),
    enumAttr('print-quality-supported', PRINT_QUALITY_NORMAL),
    dateTimeAttr('printer-current-time', context.nowMs),
    textAttr('printer-device-id', printer.deviceId),
    outOfBandAttr('printer-geo-location', VALUE_TAGS.unknown),
    textAttr('printer-info', printer.info),
    booleanAttr('printer-is-accepting-jobs', true),
    keywordAttr('printer-kind', 'labels'),
    textAttr('printer-location', printer.location),
    textAttr('printer-make-and-model', printer.makeAndModel),
    uriAttr('printer-more-info', context.moreInfoUri),
    nameAttr('printer-name', printer.name),
    resolutionAttr('printer-resolution-default', printer.dpi),
    resolutionAttr('printer-resolution-supported', printer.dpi),
    enumAttr('printer-state', PRINTER_STATE[printer.state.state]),
    textAttr('printer-state-message', printer.state.message),
    keywordAttr('printer-state-reasons', ...reasons),
    integerAttr('printer-up-time', context.upTimeSeconds),
    uriAttr('printer-uri-supported', context.printerUri),
    uriAttr('printer-uuid', printer.uuid),
    resolutionAttr('pwg-raster-document-resolution-supported', printer.dpi),
    keywordAttr('pwg-raster-document-sheet-back', 'normal'),
    keywordAttr('pwg-raster-document-type-supported', 'sgray_8', 'srgb_8'),
    integerAttr('queued-job-count', printer.queuedJobCount),
    keywordAttr('sides-default', 'one-sided'),
    keywordAttr('sides-supported', 'one-sided'),
    keywordAttr('uri-authentication-supported', context.authentication),
    keywordAttr('uri-security-supported', 'none'),
    keywordAttr('urf-supported', ...urfSupported(printer.dpi)),
    keywordAttr('which-jobs-supported', 'completed', 'not-completed'),
  ];
}

function isJobTemplate(name: string): boolean {
  return JOB_TEMPLATE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * 按 requested-attributes 挑（RFC 8011 §4.2.5.1）：没给或 all = 全部（media-col-database 除外）；
 * printer-description、job-template 是两组；其余按名字。不认识的名字忽略。
 */
export function selectAttributes(
  attributes: readonly IppAttribute[],
  requested: readonly string[] | null,
): IppAttribute[] {
  const names = requested ?? ['all'];
  const wantsAll = names.includes('all');
  const wantsDescription = wantsAll || names.includes('printer-description');
  const wantsTemplate = wantsAll || names.includes('job-template');
  return attributes.filter(
    ({ name }) =>
      names.includes(name) || (!EXPLICIT_ONLY.has(name) && (isJobTemplate(name) ? wantsTemplate : wantsDescription)),
  );
}
