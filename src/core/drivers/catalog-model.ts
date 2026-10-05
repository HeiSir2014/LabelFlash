import type { CatalogCommandSet } from './driver-hints';
import type { UsbId } from './usb-id';

/** 这个版本的程序认得的清单格式。不兼容的改动加 1，旧程序据此提示更新。 */
export const CATALOG_SCHEMA = 1;

const BYTES_PER_MB = 1024 * 1024;

export const CATALOG_LIMITS = {
  /** 型号数：一家出品方用到的标签机是几十种，留两个数量级的余量；也限住清单的解析量。 */
  models: 2_000,
  /** 同一型号的 USB 编号：换过主板、不同批次的产品号，十几个足够。 */
  usbIdsPerModel: 16,
  /** 装完以后系统里的驱动名（不同语言、不同版本的驱动名不同）。 */
  driverNamesPerModel: 8,
  brandLength: 40,
  modelLength: 80,
  driverNameLength: 128,
  urlLength: 2_048,
  /** 证书 Subject 一般一两百个字符。 */
  signerLength: 512,
  silentArgs: 8,
  successExitCodes: 8,
  /** 安装包最大 512MB：标签机驱动通常 5–100MB，带全套语言的也不到 300MB。下载时按清单写的大小截断。 */
  installerBytes: 512 * BYTES_PER_MB,
} as const;

const MS_PER_DAY = 86_400_000;
/**
 * 清单的有效期（expiresAt - issuedAt）最长 400 天：签名脚本按这个上限签发，但程序不只信任签名脚本——
 * 私钥一旦泄露，攻击者能签出一份有效期任意长的清单，客户端这边也要卡住这个上限，泄露期间能被重放的
 * 时间才是有限的（见 catalog-freshness.ts 的 checkCatalogFreshness）。和签名脚本的 MAX_VALID_DAYS 同一个数。
 */
export const MAX_CATALOG_VALIDITY_MS = 400 * MS_PER_DAY;

/** 型号编号：日志、5b 的重装、界面都用它。只用小写字母、数字和横杠。 */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/**
 * 静默安装参数：每个参数只能有字母、数字和 _ . / : = + -。不能有空格、引号、& | ; < > % ^ 和反斜杠，
 * 拼进命令行也不会变成别的命令或别的参数；要写路径的参数（例如 NSIS 的 /D=）不支持，用安装程序的默认目录。
 */
export const SILENT_ARG_PATTERN = /^[A-Za-z0-9_./:=+-]{1,64}$/;

export const WINDOWS_PACKAGE_KINDS = ['exe', 'msi'] as const;
export type WindowsPackageKind = (typeof WINDOWS_PACKAGE_KINDS)[number];

/** 没写 successExitCodes 时只有 0 算成功（3010、1641 另按「装好了、要重启」处理）。 */
export const DEFAULT_SUCCESS_EXIT_CODES: readonly number[] = [0];

/** 要下载的文件：地址只能是 https，大小和 SHA-256 都钉死。 */
export interface DownloadSpec {
  url: string;
  sizeBytes: number;
  /** 64 位小写十六进制。 */
  sha256: string;
}

export interface WindowsPackage extends DownloadSpec {
  kind: WindowsPackageKind;
  /** exe 的静默参数；msi 由程序加 /qn /norestart，这里写额外的属性（例如 ALLUSERS=1）。 */
  silentArgs: string[];
  /**
   * Authenticode 签名证书的 Subject，必须逐字相同（用 bun run driver-catalog:describe 读出来）。
   * 不另外钉签发者（Issuer）或证书指纹：真正防篡改的是上面钉死的 sha256——装的字节必须和它逐位相同，
   * 这件事不依赖签名链，哈希不可能被「换一个签发者」绕过。signer 只是第二层核对（装的确实是这家厂商签过的
   * 东西，而不是哪个人凑巧用同一个哈希覆盖了文件），Authenticode 状态必须是 Valid（证书链本身已经验过
   * 签发者可信），再加 Issuer 钉死只能防「另一家可信 CA 签发了同名 Subject 的证书」这种要先骗过那家 CA
   * 的组织验证的场景，收益很小；加证书指纹则要求厂商每次续证书都重签清单，运营成本不划算。
   */
  signer: string;
  successExitCodes: number[];
}

export interface MacPkg extends DownloadSpec {
  /**
   * pkgutil --check-signature 证书链第一行的名字（Developer ID Installer: …），必须逐字相同。
   * 不钉签发者：苹果的开发者证书链固定两层，所有开发者的 Developer ID Installer 证书都是同一个
   * 「Developer ID Certification Authority」签发的，钉这一项对区分厂商没有任何帮助（见 WindowsPackage.signer
   * 的说明，sha256 才是真正防篡改的那一层）。
   */
  signer: string;
}

export interface MacDriver {
  pkg: MacPkg | null;
  /** 没有 pkg 时打开的官方下载页（https）。 */
  downloadPage: string | null;
}

export interface CatalogModel {
  id: string;
  brand: string;
  model: string;
  usb: UsbId[];
  driverNames: string[];
  commandSet: CatalogCommandSet | null;
  windows: WindowsPackage | null;
  macos: MacDriver | null;
}

/** 校验过的清单；时间都是毫秒。 */
export interface DriverCatalog {
  schema: number;
  /** 签名时刻的 Unix 秒数：越新越大，程序不用比见过的最高版本低的清单。 */
  version: number;
  issuedAt: number;
  expiresAt: number;
  models: CatalogModel[];
}
