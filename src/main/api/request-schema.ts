import type { PrintJobInput } from '../../core/api/api-model';
import { templateIdFromName } from '../../core/api/template-names';
import { MAX_RAW_LENGTH } from '../../core/scan/normalize-raw';
import { isValidFieldName } from '../../core/scan/rule-model';
import type { ScanField } from '../../core/scan/scan-result';
import { ApiError, type FieldViolation } from './api-error';

/** 一次批量最多 1000 张：服装标签一次两三百张很常见，再多由调用方分批。 */
export const BATCH_LIMIT = 1000;
/** 一张标签最多 50 个字段：面单的字段最多二三十个，留出余量。 */
export const FIELDS_LIMIT = 50;
/** 份数上限：同一张标签打 100 份已经远超日常需要，更多多半是调用方写错了。 */
export const COPIES_LIMIT = 100;
/** 打印机名的长度上限，和模板里的打印机名一致（template-model 的 printerNameLength）。 */
const PRINTER_NAME_LENGTH = 256;
/** AIP-155：requestId 是 UUID。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Loose = Readonly<Record<string, unknown>>;

export interface RenderRequest {
  fields: ScanField[];
  content: string | null;
}

export function parseCreateRequest(body: unknown): PrintJobInput {
  const violations: FieldViolation[] = [];
  const input = readJob(body, '', violations);
  if (input === null) {
    throw ApiError.invalidArgument('请求参数不对，见 fieldViolations', violations);
  }
  return input;
}

/** 整批校验：有一个参数不对，整批都不收（AIP-233），错误里指出是第几个。 */
export function parseBatchRequest(body: unknown): PrintJobInput[] {
  const requests = isLoose(body) ? body['requests'] : undefined;
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > BATCH_LIMIT) {
    throw ApiError.invalidArgument(`requests 要有 1–${BATCH_LIMIT} 个请求，更多请分批提交`, [
      { field: 'requests', description: `1–${BATCH_LIMIT} 个` },
    ]);
  }
  const violations: FieldViolation[] = [];
  const inputs: PrintJobInput[] = [];
  requests.forEach((request, index) => {
    const input = readJob(request, `requests[${index}].`, violations);
    if (input !== null) {
      inputs.push(input);
    }
  });
  if (violations.length > 0) {
    throw ApiError.invalidArgument('有请求的参数不对，整批都没有收下，见 fieldViolations', violations);
  }
  return inputs;
}

export function parseRenderRequest(body: unknown): RenderRequest {
  const violations: FieldViolation[] = [];
  const input = isLoose(body) ? body : {};
  const fields = readFields(input['fields'], 'fields', violations);
  const content = readContent(input['content'], 'content', violations);
  if (violations.length > 0) {
    throw ApiError.invalidArgument('请求参数不对，见 fieldViolations', violations);
  }
  return { fields, content };
}

/** 读一个打印任务请求；有问题时把每一处都记进 violations（路径带 prefix）并返回 null。 */
function readJob(value: unknown, prefix: string, violations: FieldViolation[]): PrintJobInput | null {
  const input = isLoose(value) ? value : {};
  const before = violations.length;
  const templateValue = input['template'];
  const templateId = typeof templateValue === 'string' ? templateIdFromName(templateValue) : null;
  if (templateId === null) {
    violations.push({ field: `${prefix}template`, description: '模板名，例如 templates/builtin-standard' });
  }
  const fields = readFields(input['fields'], `${prefix}fields`, violations);
  const content = readContent(input['content'], `${prefix}content`, violations);
  const copies = input['copies'] ?? 1;
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > COPIES_LIMIT) {
    violations.push({ field: `${prefix}copies`, description: `1–${COPIES_LIMIT} 的整数` });
  }
  const printer = input['printer'] ?? null;
  if (printer !== null && (typeof printer !== 'string' || printer === '' || printer.length > PRINTER_NAME_LENGTH)) {
    violations.push({ field: `${prefix}printer`, description: '这台电脑上的打印机名（GET /v1/printers）' });
  }
  const requestId = input['requestId'] ?? null;
  if (requestId !== null && (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId))) {
    violations.push({ field: `${prefix}requestId`, description: 'UUID，例如 7c9e6679-7425-40de-944b-e07fc1f90ae7' });
  }
  if (
    violations.length > before ||
    templateId === null ||
    typeof copies !== 'number' ||
    (printer !== null && typeof printer !== 'string') ||
    (requestId !== null && typeof requestId !== 'string')
  ) {
    return null;
  }
  return { templateId, fields, content, copies, printer, requestId };
}

function readFields(value: unknown, path: string, violations: FieldViolation[]): ScanField[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > FIELDS_LIMIT) {
    violations.push({ field: path, description: `1–${FIELDS_LIMIT} 个 { name, value }` });
    return [];
  }
  const seen = new Set<string>();
  const fields: ScanField[] = [];
  value.forEach((item: unknown, index) => {
    const name = isLoose(item) ? item['name'] : undefined;
    const fieldValue = isLoose(item) ? item['value'] : undefined;
    if (typeof name !== 'string' || !isValidFieldName(name) || seen.has(name)) {
      violations.push({
        field: `${path}[${index}].name`,
        description: '1–20 个字，不能有花括号、换行和控制字符，不能重名',
      });
      return;
    }
    if (typeof fieldValue !== 'string' || fieldValue.length > MAX_RAW_LENGTH) {
      violations.push({ field: `${path}[${index}].value`, description: `字符串，最长 ${MAX_RAW_LENGTH} 个字` });
      return;
    }
    seen.add(name);
    fields.push({ name, value: fieldValue });
  });
  return fields;
}

function readContent(value: unknown, path: string, violations: FieldViolation[]): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value === '' || value.length > MAX_RAW_LENGTH) {
    violations.push({ field: path, description: `字符串，1–${MAX_RAW_LENGTH} 个字` });
    return null;
  }
  return value;
}

function isLoose(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
