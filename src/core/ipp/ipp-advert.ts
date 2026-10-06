import { instanceLabel, MAX_INSTANCE_BYTES, type ServiceAdvert } from '../mdns/dns-sd';
import { DOCUMENT_FORMATS } from './document-format';
import { urfSupported } from './printer-attributes';
import type { SharedPrinter } from './shared-printer';

export const IPP_SERVICE_TYPE = ['_ipp', '_tcp', 'local'] as const;
/**
 * _universal：macOS、iOS 系统自带的打印只把带它的当成免驱打印机；_print：IPP Everywhere（PWG 5100.14 §4.2.2）。
 */
export const IPP_SUBTYPES = ['_universal', '_print'] as const;
/** DNS-SD 打印规范的默认优先级（0 最优先）。 */
const PRIORITY = '50';
/** 标签纸都比 A4 小（DNS-SD 打印规范的 PaperMax 取值）。 */
const PAPER_MAX = '<legal-A4';
const UUID_PREFIX = 'urn:uuid:';
const UTF8_ENCODER = new TextEncoder();

/** 拼广告要的、打印机之外的东西。 */
export interface AdvertContext {
  port: number;
  /** 程序在 mDNS 里的主机名，例如 labelflash-1a2b3c4d.local。 */
  hostName: string;
  computerName: string;
  productNameAscii: string;
  authentication: 'none' | 'basic';
  /** 名字冲突后加在实例名后面的序号；1 = 不加。 */
  serial: number;
}

/**
 * 一台共享打印机的 DNS-SD 服务：实例名「60×40 标签 @ 电脑名」，冲突后加「 (2)」，整体不超过 63 字节。
 * TXT 按 DNS-SD 打印规范 1.2.1 和 PWG 5100.14 §4.2.2.1；URF= 是系统自带的打印认免驱光栅能力用的。
 */
export function ippAdvert(printer: SharedPrinter, context: AdvertContext): ServiceAdvert {
  const suffix = context.serial > 1 ? ` (${context.serial})` : '';
  const base = instanceLabel(
    `${printer.name} @ ${context.computerName}`,
    MAX_INSTANCE_BYTES - UTF8_ENCODER.encode(suffix).length,
  );
  return {
    instance: `${base}${suffix}`,
    serviceType: [...IPP_SERVICE_TYPE],
    subtypes: [...IPP_SUBTYPES],
    port: context.port,
    txt: [
      ['txtvers', '1'],
      ['qtotal', '1'],
      ['rp', `printers/${printer.key}`],
      ['ty', printer.makeAndModel],
      ['product', `(${context.productNameAscii})`],
      ['note', printer.location],
      ['adminurl', `http://${context.hostName}:${context.port}/printers/${printer.key}`],
      ['priority', PRIORITY],
      ['pdl', DOCUMENT_FORMATS.join(',')],
      ['URF', urfSupported(printer.dpi).join(',')],
      ['UUID', printer.uuid.startsWith(UUID_PREFIX) ? printer.uuid.slice(UUID_PREFIX.length) : printer.uuid],
      ['Color', 'F'],
      ['Duplex', 'F'],
      ['kind', 'label'],
      ['PaperMax', PAPER_MAX],
      ['air', context.authentication === 'basic' ? 'username,password' : 'none'],
    ],
  };
}
