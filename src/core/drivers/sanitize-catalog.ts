import {
  CATALOG_LIMITS,
  CATALOG_SCHEMA,
  type CatalogModel,
  DEFAULT_SUCCESS_EXIT_CODES,
  type DownloadSpec,
  type DriverCatalog,
  type MacDriver,
  type MacPkg,
  MODEL_ID_PATTERN,
  SILENT_ARG_PATTERN,
  WINDOWS_PACKAGE_KINDS,
  type WindowsPackage,
  type WindowsPackageKind,
} from './catalog-model';
import { CATALOG_COMMAND_SETS, type CatalogCommandSet } from './driver-hints';
import { parseHexUsbId, type UsbId } from './usb-id';

/** dropped：跳过的型号和原因（写日志；签名脚本见到任何一条就不签）。 */
export type CatalogParse = { ok: true; catalog: DriverCatalog; dropped: string[] } | { ok: false; issue: string };

type Field<T> = { ok: true; value: T } | { ok: false; reason: string };

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
/** 退出码是 32 位有符号整数；负数只有出错的程序才会用，不作为成功的退出码。 */
const MAX_EXIT_CODE = 2 ** 31 - 1;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 清单里的文字不许有控制字符（会弄乱界面和日志）
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * 清单来自网络：验签之后仍然逐项校验。结构不对、格式比程序新时整份不用；
 * 单个型号不合格时跳过它（旧版程序遇到新增写法的型号不至于整份清单都用不了），原因放进 dropped。
 */
export function sanitizeCatalog(value: unknown): CatalogParse {
  const input = asRecord(value);
  if (input === null) {
    return { ok: false, issue: '驱动清单的内容不对' };
  }
  const schema = input['schema'];
  if (typeof schema === 'number' && schema > CATALOG_SCHEMA) {
    return { ok: false, issue: '驱动清单的格式比这个版本的程序新：请更新程序' };
  }
  if (schema !== CATALOG_SCHEMA) {
    return { ok: false, issue: '驱动清单的格式不对' };
  }
  const version = input['version'];
  if (!isPositiveInteger(version)) {
    return { ok: false, issue: '驱动清单没有合法的版本号' };
  }
  const issuedAt = parseUtc(input['issuedAt']);
  const expiresAt = parseUtc(input['expiresAt']);
  if (issuedAt === null || expiresAt === null || expiresAt <= issuedAt) {
    return { ok: false, issue: '驱动清单的签发时间或有效期不对' };
  }
  const rawModels = input['models'];
  if (!Array.isArray(rawModels)) {
    return { ok: false, issue: '驱动清单里没有型号列表' };
  }
  if (rawModels.length > CATALOG_LIMITS.models) {
    return { ok: false, issue: `驱动清单最多 ${CATALOG_LIMITS.models} 个型号` };
  }
  const models: CatalogModel[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawModels.entries()) {
    const label = `第 ${index + 1} 个型号`;
    const parsed = sanitizeModel(raw);
    if (!parsed.ok) {
      dropped.push(`${label}：${parsed.reason}`);
    } else if (seen.has(parsed.value.id)) {
      dropped.push(`${label}：编号「${parsed.value.id}」重复`);
    } else {
      seen.add(parsed.value.id);
      models.push(parsed.value);
    }
  }
  return { ok: true, catalog: { schema: CATALOG_SCHEMA, version, issuedAt, expiresAt, models }, dropped };
}

function sanitizeModel(value: unknown): Field<CatalogModel> {
  const input = asRecord(value);
  if (input === null) {
    return fail('不是一个对象');
  }
  const id = input['id'];
  if (typeof id !== 'string' || !MODEL_ID_PATTERN.test(id)) {
    return fail('编号只能用小写字母、数字和横杠，最长 64 个字符');
  }
  const brand = text(input['brand'], CATALOG_LIMITS.brandLength);
  const model = text(input['model'], CATALOG_LIMITS.modelLength);
  if (brand === null || model === null) {
    return fail('品牌或型号为空、太长或有控制字符');
  }
  const usb = usbIds(input['usb']);
  if (usb === null) {
    return fail(`USB 编号要有 1–${CATALOG_LIMITS.usbIdsPerModel} 个，每个是 4 位十六进制的 vendorId 和 productId`);
  }
  const driverNames = optionalTexts(
    input['driverNames'],
    CATALOG_LIMITS.driverNamesPerModel,
    CATALOG_LIMITS.driverNameLength,
  );
  if (driverNames === null) {
    return fail(
      `驱动名最多 ${CATALOG_LIMITS.driverNamesPerModel} 个，每个不超过 ${CATALOG_LIMITS.driverNameLength} 字`,
    );
  }
  const commandSet = optionalCommandSet(input['commandSet']);
  if (commandSet === undefined) {
    return fail('指令集只能是 tspl、zpl、epl');
  }
  const windows = isAbsent(input['windows']) ? ok(null) : windowsPackage(input['windows']);
  if (!windows.ok) {
    return fail(`Windows 驱动：${windows.reason}`);
  }
  const macos = isAbsent(input['macos']) ? ok(null) : macDriver(input['macos']);
  if (!macos.ok) {
    return fail(`macOS 驱动：${macos.reason}`);
  }
  return ok({ id, brand, model, usb, driverNames, commandSet, windows: windows.value, macos: macos.value });
}

function windowsPackage(value: unknown): Field<WindowsPackage> {
  const input = asRecord(value);
  if (input === null) {
    return fail('不是一个对象');
  }
  const download = downloadSpec(input);
  if (!download.ok) {
    return download;
  }
  const kind = input['kind'];
  if (!isWindowsKind(kind)) {
    return fail('kind 只能是 exe 或 msi');
  }
  const silentArgs = stringList(input['silentArgs'] ?? [], CATALOG_LIMITS.silentArgs, (arg) =>
    SILENT_ARG_PATTERN.test(arg),
  );
  if (silentArgs === null) {
    return fail(`静默安装参数最多 ${CATALOG_LIMITS.silentArgs} 个，每个只能有字母、数字和 _ . / : = + -`);
  }
  const signer = text(input['signer'], CATALOG_LIMITS.signerLength);
  if (signer === null) {
    return fail('没写要求的签名者（signer）');
  }
  const successExitCodes = exitCodes(input['successExitCodes']);
  if (successExitCodes === null) {
    return fail(`successExitCodes 最多 ${CATALOG_LIMITS.successExitCodes} 个非负整数`);
  }
  return ok({ ...download.value, kind, silentArgs, signer, successExitCodes });
}

function macDriver(value: unknown): Field<MacDriver> {
  const input = asRecord(value);
  if (input === null) {
    return fail('不是一个对象');
  }
  const pkg = isAbsent(input['pkg']) ? ok(null) : macPkg(input['pkg']);
  if (!pkg.ok) {
    return fail(`pkg：${pkg.reason}`);
  }
  const rawPage = input['downloadPage'];
  const downloadPage = isAbsent(rawPage) ? null : httpsUrl(rawPage);
  if (!isAbsent(rawPage) && downloadPage === null) {
    return fail('下载页只能是 https 地址');
  }
  if (pkg.value === null && downloadPage === null) {
    return fail('要有 pkg 或 downloadPage');
  }
  return ok({ pkg: pkg.value, downloadPage });
}

function macPkg(value: unknown): Field<MacPkg> {
  const input = asRecord(value);
  if (input === null) {
    return fail('不是一个对象');
  }
  const download = downloadSpec(input);
  if (!download.ok) {
    return download;
  }
  const signer = text(input['signer'], CATALOG_LIMITS.signerLength);
  return signer === null ? fail('没写要求的签名者（signer）') : ok({ ...download.value, signer });
}

function downloadSpec(input: Record<string, unknown>): Field<DownloadSpec> {
  const url = httpsUrl(input['url']);
  if (url === null) {
    return fail('下载地址只能是 https，不能带账号密码');
  }
  const sizeBytes = input['sizeBytes'];
  if (!isPositiveInteger(sizeBytes) || sizeBytes > CATALOG_LIMITS.installerBytes) {
    return fail(`文件大小（sizeBytes）要是 1 到 ${CATALOG_LIMITS.installerBytes} 之间的整数`);
  }
  const sha256 = input['sha256'];
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    return fail('SHA-256 要是 64 位十六进制');
  }
  return ok({ url, sizeBytes, sha256: sha256.toLowerCase() });
}

function usbIds(value: unknown): UsbId[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > CATALOG_LIMITS.usbIdsPerModel) {
    return null;
  }
  const ids: UsbId[] = [];
  for (const item of value) {
    const input = asRecord(item);
    const vendor = input?.['vendorId'];
    const product = input?.['productId'];
    const id = typeof vendor === 'string' && typeof product === 'string' ? parseHexUsbId(vendor, product) : null;
    if (id === null) {
      return null;
    }
    ids.push(id);
  }
  return ids;
}

function exitCodes(value: unknown): number[] | null {
  if (isAbsent(value)) {
    return [...DEFAULT_SUCCESS_EXIT_CODES];
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > CATALOG_LIMITS.successExitCodes) {
    return null;
  }
  return value.every((code) => Number.isInteger(code) && code >= 0 && code <= MAX_EXIT_CODE)
    ? (value as number[])
    : null;
}

function optionalCommandSet(value: unknown): CatalogCommandSet | null | undefined {
  if (isAbsent(value)) {
    return null;
  }
  return (CATALOG_COMMAND_SETS as readonly unknown[]).includes(value) ? (value as CatalogCommandSet) : undefined;
}

function optionalTexts(value: unknown, maxCount: number, maxLength: number): string[] | null {
  if (isAbsent(value)) {
    return [];
  }
  const items = stringList(value, maxCount, (item) => text(item, maxLength) === item);
  return items;
}

function stringList(value: unknown, maxCount: number, isValid: (item: string) => boolean): string[] | null {
  if (!Array.isArray(value) || value.length > maxCount) {
    return null;
  }
  return value.every((item): item is string => typeof item === 'string' && isValid(item)) ? value : null;
}

function isWindowsKind(value: unknown): value is WindowsPackageKind {
  return (WINDOWS_PACKAGE_KINDS as readonly unknown[]).includes(value);
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > CATALOG_LIMITS.urlLength) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.length <= maxLength && !CONTROL_CHARACTERS.test(trimmed) ? trimmed : null;
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ok<T>(value: T): Field<T> {
  return { ok: true, value };
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
