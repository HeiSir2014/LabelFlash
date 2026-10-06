import { charsetAttr, languageAttr, uriAttr } from '../ipp-attributes';
import type { IppAttribute, IppGroup, IppMessage, IppVersion } from '../ipp-codec';
import { GROUP_TAGS } from '../ipp-constants';
import type { SharedPrinter } from '../shared-printer';

/** 测试里的共享打印机网址（按 192.168.1.10 这台电脑、默认端口拼）。 */
export const TEST_PRINTER_URI = 'ipp://192.168.1.10:8631/printers/60x40';
export const TEST_MORE_INFO_URI = 'http://192.168.1.10:8631/printers/60x40';
/** 最小的「PDF」：只有文件头，够 sniffFormat 认出来；渲染交给假的渲染页。 */
export const MINIMAL_PDF = new TextEncoder().encode('%PDF-1.7\n%test\n');

/** 60×40 标签纸的共享打印机，203dpi，空闲。 */
export function testPrinter(overrides: Partial<SharedPrinter> = {}): SharedPrinter {
  return {
    key: '60x40',
    paper: { widthMm: 60, heightMm: 40 },
    name: '60×40 标签',
    info: '60×40 标签（前台上的热敏标签机）',
    makeAndModel: 'CDL-云签速印 共享热敏标签机',
    deviceId: 'MFG:CDL-LabelFlash;MDL:Label 60x40;CMD:PDF,PWGRaster,URF,JPEG,PNG;CLS:PRINTER;',
    location: '前台',
    dpi: 203,
    uuid: 'urn:uuid:3f2504e0-4f89-51d3-9a0c-0305e82c3301',
    state: { state: 'idle', reasons: ['none'], message: '可以打印' },
    queuedJobCount: 0,
    ...overrides,
  };
}

/** ippRequest 的可选部分。 */
export interface RequestOptions {
  /** null = 不带 printer-uri。 */
  printerUri?: string | null;
  operation?: IppAttribute[];
  job?: IppAttribute[];
  requestId?: number;
  version?: IppVersion;
}

/** 一个合规的 IPP 请求：字符集、语言打头，再加 printer-uri 和给的属性。 */
export function ippRequest(code: number, options: RequestOptions = {}): IppMessage {
  const printerUri = options.printerUri === undefined ? TEST_PRINTER_URI : options.printerUri;
  const operation: IppAttribute[] = [
    charsetAttr('attributes-charset', 'utf-8'),
    languageAttr('attributes-natural-language', 'en'),
    ...(printerUri === null ? [] : [uriAttr('printer-uri', printerUri)]),
    ...(options.operation ?? []),
  ];
  const groups: IppGroup[] = [{ tag: GROUP_TAGS.operation, attributes: operation }];
  if (options.job !== undefined) {
    groups.push({ tag: GROUP_TAGS.job, attributes: options.job });
  }
  return { version: options.version ?? { major: 2, minor: 0 }, code, requestId: options.requestId ?? 1, groups };
}

/** 回复里某一组（第一个这种组）的某个属性。 */
export function attributeIn(message: IppMessage, groupTag: number, name: string): IppAttribute | undefined {
  return message.groups.find((group) => group.tag === groupTag)?.attributes.find((item) => item.name === name);
}
