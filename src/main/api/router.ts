import { contentOf } from '../../core/api/api-model';
import { PrintJobError, type PrintJobService } from '../../core/api/print-job-service';
import { templateIdFromName } from '../../core/api/template-names';
import type { ScanField } from '../../core/scan/scan-result';
import type { LabelTemplate } from '../../core/templates/template-model';
import { BRAND } from '../../shared/brand';
import { ApiError, errorBody } from './api-error';
import type { Caller } from './authenticator';
import { openApiDocument } from './openapi';
import { parseBatchRequest, parseCreateRequest, parseRenderRequest } from './request-schema';
import {
  type ApiPrinter,
  printerResource,
  printJobIdFromName,
  printJobName,
  printJobResource,
  templateResource,
} from './resources';

export const API_VERSION = 'v1';
/** AIP-158：不给 pageSize 时一页 50 条，最多 1000 条（和一次批量的上限一致）。 */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 1000;

/** 路由处理需要的能力；主进程接真实的实现，测试接假的。 */
export interface ApiContext {
  jobs: PrintJobService;
  listTemplates: () => LabelTemplate[];
  /** 按编号精确查找，找不到为 null。 */
  findTemplate: (templateId: string) => LabelTemplate | null;
  listPrinters: () => Promise<ApiPrinter[]>;
  /** 按模板的纸张排版出 PDF（Electron 的 printToPDF，见 pdf-render.ts）。 */
  renderPdf: (template: LabelTemplate, fields: ScanField[], content: string) => Promise<Uint8Array>;
  service: { version: string; port: () => number };
}

export interface ApiRequest {
  method: string;
  /** 路径加查询串，例如 /v1/printJobs?pageSize=2。 */
  url: string;
  /** 解析好的 JSON 请求体；GET 为 undefined。 */
  body: unknown;
  /** 已经通过授权的调用方；不需要授权的路由为 null。 */
  caller: Caller | null;
}

export interface ApiResponse {
  status: number;
  contentType: 'application/json' | 'application/pdf';
  body: unknown;
}

interface Handled {
  params: readonly string[];
  query: URLSearchParams;
  body: unknown;
  caller: Caller;
}

interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  /** OpenAPI 描述里的路径；有测试核对两边一致。 */
  openApiPath: string;
  needsCaller: boolean;
  handle: (context: ApiContext, request: Handled) => Promise<ApiResponse> | ApiResponse;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, contentType: 'application/json', body });

/** 路径参数里不能有斜杠和冒号：冒号留给自定义方法（AIP-136）。 */
const SEGMENT = '([^/:]+)';

export const ROUTES: readonly Route[] = [
  {
    method: 'GET',
    pattern: /^\/v1\/service$/,
    openApiPath: '/v1/service',
    needsCaller: false,
    handle: (context) =>
      ok({
        product: BRAND.productNameAscii,
        apiVersion: API_VERSION,
        appVersion: context.service.version,
        port: context.service.port(),
      }),
  },
  {
    method: 'GET',
    pattern: /^\/v1\/openapi\.json$/,
    openApiPath: '/v1/openapi.json',
    needsCaller: false,
    handle: (context) => ok(openApiDocument(context.service.port())),
  },
  {
    method: 'GET',
    pattern: /^\/v1\/templates$/,
    openApiPath: '/v1/templates',
    needsCaller: true,
    handle: (context) => ok({ templates: context.listTemplates().map(templateResource) }),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/v1/templates/${SEGMENT}$`),
    openApiPath: '/v1/templates/{template}',
    needsCaller: true,
    handle: (context, { params }) => ok(templateResource(requireTemplate(context, params[0]))),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/v1/templates/${SEGMENT}:render$`),
    openApiPath: '/v1/templates/{template}:render',
    needsCaller: true,
    handle: async (context, { params, body }) => {
      const template = requireTemplate(context, params[0]);
      const { fields, content } = parseRenderRequest(body);
      const pdf = await context.renderPdf(template, fields, contentOf({ fields, content }));
      return { status: 200, contentType: 'application/pdf', body: pdf };
    },
  },
  {
    method: 'GET',
    pattern: /^\/v1\/printers$/,
    openApiPath: '/v1/printers',
    needsCaller: true,
    handle: async (context) => ok({ printers: (await context.listPrinters()).map(printerResource) }),
  },
  {
    method: 'POST',
    pattern: /^\/v1\/printJobs$/,
    openApiPath: '/v1/printJobs',
    needsCaller: true,
    handle: async (context, { body, caller }) => {
      const input = parseCreateRequest(body);
      try {
        return ok(printJobResource(await context.jobs.create(caller.id, input)));
      } catch (error) {
        throw fromPrintJobError(error, () => '');
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/v1\/printJobs:batchCreate$/,
    openApiPath: '/v1/printJobs:batchCreate',
    needsCaller: true,
    handle: async (context, { body, caller }) => {
      const inputs = parseBatchRequest(body);
      try {
        const jobs = await context.jobs.createBatch(caller.id, inputs);
        return ok({ printJobs: jobs.map(printJobResource) });
      } catch (error) {
        throw fromPrintJobError(error, (index) => `requests[${index}].`);
      }
    },
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/v1/printJobs/${SEGMENT}$`),
    openApiPath: '/v1/printJobs/{printJob}',
    needsCaller: true,
    handle: (context, { params, caller }) => {
      const id = printJobIdFromName(params[0] ?? '');
      const job = id === null ? null : context.jobs.get(id);
      // 别的调用方的任务按不存在处理：不透露它存在与否。
      if (job === null || job.caller !== caller.id) {
        throw new ApiError(
          'NOT_FOUND',
          'PRINT_JOB_NOT_FOUND',
          `找不到任务 ${printJobName(params[0] ?? '')}：任务保留 7 天`,
        );
      }
      return ok(printJobResource(job));
    },
  },
  {
    method: 'GET',
    pattern: /^\/v1\/printJobs$/,
    openApiPath: '/v1/printJobs',
    needsCaller: true,
    handle: (context, { query, caller }) => {
      const page = context.jobs.list(caller.id, readPageSize(query), readPageToken(query));
      return ok({
        printJobs: page.jobs.map(printJobResource),
        nextPageToken: page.nextCursor === null ? '' : encodePageToken(page.nextCursor),
      });
    },
  },
];

interface Match {
  route: Route;
  params: string[];
  query: URLSearchParams;
}

function match(method: string, url: string): Match | null {
  // 解析不了的路径（例如 //x）当作没有这个接口，不当作程序出错。
  const parsed = URL.parse(url, 'http://localhost');
  if (parsed === null) {
    return null;
  }
  for (const route of ROUTES) {
    const found = route.method === method ? route.pattern.exec(parsed.pathname) : null;
    if (found) {
      const params = found.slice(1).map(decodeSegment);
      return params.includes(null) ? null : { route, params: params as string[], query: parsed.searchParams };
    }
  }
  return null;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** 这个请求要不要先授权；找不到路由的也要（没授权的探测只得到 401）。 */
export function requiresCaller(method: string, url: string): boolean {
  return match(method, url)?.route.needsCaller ?? true;
}

/** 分发请求；接口错误转成 AIP-193 的响应，其他错误原样抛出（由服务记日志并回 INTERNAL）。 */
export async function route(context: ApiContext, request: ApiRequest): Promise<ApiResponse> {
  try {
    const found = match(request.method, request.url);
    if (found === null) {
      throw new ApiError(
        'NOT_FOUND',
        'NOT_FOUND',
        `没有这个接口：${request.method} ${request.url}（见 /v1/openapi.json）`,
      );
    }
    const caller = request.caller ?? { id: '', label: '' };
    if (found.route.needsCaller && request.caller === null) {
      throw new Error(`Route ${found.route.openApiPath} needs an authenticated caller`);
    }
    return await found.route.handle(context, { params: found.params, query: found.query, body: request.body, caller });
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: error.httpStatus, contentType: 'application/json', body: errorBody(error) };
    }
    throw error;
  }
}

function requireTemplate(context: ApiContext, name: string | undefined): LabelTemplate {
  const id = templateIdFromName(name ?? '');
  const template = id === null ? null : context.findTemplate(id);
  if (template === null) {
    throw new ApiError(
      'NOT_FOUND',
      'TEMPLATE_NOT_FOUND',
      `找不到模板 ${name ?? ''}：请先用 GET /v1/templates 查看可用的模板`,
    );
  }
  return template;
}

/** 任务服务的错误 → 接口错误；pathOf 给出批量里第几个请求的字段路径前缀。 */
function fromPrintJobError(error: unknown, pathOf: (index: number) => string): unknown {
  if (!(error instanceof PrintJobError)) {
    return error;
  }
  const prefix = error.index === null ? '' : pathOf(error.index);
  switch (error.code) {
    case 'TEMPLATE_NOT_FOUND':
      return new ApiError('NOT_FOUND', 'TEMPLATE_NOT_FOUND', `${error.message}：请先用 GET /v1/templates 查看`, [
        { field: `${prefix}template`, description: '可用的模板见 GET /v1/templates' },
      ]);
    case 'PRINTER_NOT_FOUND':
      return new ApiError(
        'FAILED_PRECONDITION',
        'PRINTER_NOT_FOUND',
        `${error.message}：请先用 GET /v1/printers 查看`,
        [{ field: `${prefix}printer`, description: '可用的打印机见 GET /v1/printers' }],
      );
    case 'QUEUE_FULL':
      return new ApiError('RESOURCE_EXHAUSTED', 'QUEUE_FULL', error.message);
  }
}

function readPageSize(query: URLSearchParams): number {
  const text = query.get('pageSize');
  if (text === null || text === '') {
    return DEFAULT_PAGE_SIZE;
  }
  const size = Number(text);
  if (!Number.isInteger(size) || size < 0) {
    throw ApiError.invalidArgument('pageSize 要是不小于 0 的整数', [
      { field: 'pageSize', description: `0–${MAX_PAGE_SIZE}，0 表示默认 ${DEFAULT_PAGE_SIZE}` },
    ]);
  }
  // AIP-158：0 用默认值，超过上限按上限。
  return size === 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
}

function encodePageToken(cursor: number): string {
  return Buffer.from(JSON.stringify({ c: cursor }), 'utf8').toString('base64url');
}

function readPageToken(query: URLSearchParams): number | null {
  const token = query.get('pageToken');
  if (token === null || token === '') {
    return null;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    const cursor = typeof value === 'object' && value !== null && 'c' in value ? value.c : undefined;
    if (typeof cursor === 'number' && Number.isInteger(cursor)) {
      return cursor;
    }
  } catch {
    // 落到下面报参数错误。
  }
  throw ApiError.invalidArgument('pageToken 不对：请原样使用上一页返回的 nextPageToken', [
    { field: 'pageToken', description: '上一页返回的 nextPageToken' },
  ]);
}
