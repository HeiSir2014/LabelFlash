import { TEMPLATE_ID_PATTERN } from '../core/templates/template-model';
import type { PrintOptions, RendererPrintSource } from '../shared/ipc-contract';
import { type JobQuery, MAX_JOB_PAGE_SIZE } from '../shared/job-history';
import { isRecord } from '../shared/settings';

/** 渲染进程不可信：IPC 参数在进入业务层之前逐一校验，不合法直接抛错（fail loudly）。 */
export const MAX_IPC_STRING_LENGTH = 1_024;
const RENDERER_PRINT_SOURCES: ReadonlySet<string> = new Set<RendererPrintSource>(['desktop', 'history']);

export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_IPC_STRING_LENGTH) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

export function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

export function requireTemplateId(value: unknown): string {
  if (typeof value !== 'string' || !TEMPLATE_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid template id');
  }
  return value;
}

export function requirePrintOptions(value: unknown): PrintOptions {
  const options = requireRecord(value, 'print options');
  const source = options['source'];
  const force = options['force'];
  if (typeof source !== 'string' || !RENDERER_PRINT_SOURCES.has(source) || typeof force !== 'boolean') {
    throw new TypeError('Invalid print options');
  }
  return { source: source as RendererPrintSource, force };
}

export function requireJobQuery(value: unknown): JobQuery {
  const query = requireRecord(value, 'job query');
  const limit = query['limit'];
  const search = query['search'];
  const before = query['before'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_PAGE_SIZE) {
    throw new TypeError('Invalid job query limit');
  }
  if (search !== undefined && (typeof search !== 'string' || search.length > MAX_IPC_STRING_LENGTH)) {
    throw new TypeError('Invalid job query search');
  }
  if (before !== undefined && (typeof before !== 'number' || !Number.isInteger(before))) {
    throw new TypeError('Invalid job query cursor');
  }
  return { limit, search, before };
}
