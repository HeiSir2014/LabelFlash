import { BATCH_LIMIT, COPIES_LIMIT, FIELDS_LIMIT } from './request-schema';

/**
 * 本机接口的 OpenAPI 3.1 描述，由 GET /v1/openapi.json 提供；第三方可以照着生成调用代码。
 * 路径和路由表必须一致（openapi.test.ts 核对）；字段说明和 docs/local-api.md 一致。
 */

/** 和扫码内容的上限一致（core/scan/normalize-raw 的 MAX_RAW_LENGTH）。 */
const TEXT_LIMIT = 1000;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ 'application/json': { schema } });
const errorResponses = {
  '400': {
    description: '参数不对（INVALID_ARGUMENT）或打印机不在（FAILED_PRECONDITION）',
    content: json(ref('Status')),
  },
  '401': { description: '没有程序密钥或密钥不对', content: json(ref('Status')) },
  '403': { description: '网站还没有授权，或 Host 不是本机', content: json(ref('Status')) },
  '404': { description: '找不到', content: json(ref('Status')) },
  '413': { description: '请求体超过 4MB', content: json(ref('Status')) },
  '429': { description: '请求太快，或排队中的标签太多', content: json(ref('Status')) },
  '500': { description: '程序内部错误', content: json(ref('Status')) },
};
const templateParameter = {
  name: 'template',
  in: 'path',
  required: true,
  description: '模板编号，例如 builtin-standard',
  schema: { type: 'string' },
};

const PATHS = {
  '/v1/service': {
    get: {
      operationId: 'getService',
      summary: '自报身份：确认连的是本程序（不需要授权）',
      security: [],
      responses: { '200': { description: '服务信息', content: json(ref('Service')) } },
    },
  },
  '/v1/openapi.json': {
    get: {
      operationId: 'getOpenApi',
      summary: '本接口的 OpenAPI 描述（不需要授权）',
      security: [],
      responses: { '200': { description: 'OpenAPI 3.1 文档', content: json({ type: 'object' }) } },
    },
  },
  '/v1/templates': {
    get: {
      operationId: 'listTemplates',
      summary: '可用的模板',
      responses: {
        '200': {
          description: '模板列表',
          content: json({ type: 'object', properties: { templates: { type: 'array', items: ref('Template') } } }),
        },
        ...errorResponses,
      },
    },
  },
  '/v1/templates/{template}': {
    get: {
      operationId: 'getTemplate',
      summary: '一个模板',
      parameters: [templateParameter],
      responses: { '200': { description: '模板', content: json(ref('Template')) }, ...errorResponses },
    },
  },
  '/v1/templates/{template}:render': {
    post: {
      operationId: 'renderTemplate',
      summary: '只排版：按模板的纸张返回 PDF，不打印',
      parameters: [templateParameter],
      requestBody: { required: true, content: json(ref('RenderRequest')) },
      responses: {
        '200': { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
        ...errorResponses,
      },
    },
  },
  '/v1/printers': {
    get: {
      operationId: 'listPrinters',
      summary: '这台电脑上的打印机、各自负责的纸张和状态',
      responses: {
        '200': {
          description: '打印机列表',
          content: json({ type: 'object', properties: { printers: { type: 'array', items: ref('Printer') } } }),
        },
        ...errorResponses,
      },
    },
  },
  '/v1/printJobs': {
    post: {
      operationId: 'createPrintJob',
      summary: '提交一个打印任务，返回排队中的任务',
      requestBody: { required: true, content: json(ref('PrintJobRequest')) },
      responses: { '200': { description: '任务（QUEUED）', content: json(ref('PrintJob')) }, ...errorResponses },
    },
    get: {
      operationId: 'listPrintJobs',
      summary: '本调用方的任务，新的在前（保留 7 天）',
      parameters: [
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 1000, default: 50 } },
        { name: 'pageToken', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: '任务列表',
          content: json({
            type: 'object',
            properties: {
              printJobs: { type: 'array', items: ref('PrintJob') },
              nextPageToken: { type: 'string', description: '空字符串表示没有更多' },
            },
          }),
        },
        ...errorResponses,
      },
    },
  },
  '/v1/printJobs:batchCreate': {
    post: {
      operationId: 'batchCreatePrintJobs',
      summary: `一次提交多个任务（最多 ${BATCH_LIMIT} 个）；整批先校验，有一个不对整批都不收`,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['requests'],
          properties: {
            requests: { type: 'array', minItems: 1, maxItems: BATCH_LIMIT, items: ref('PrintJobRequest') },
          },
        }),
      },
      responses: {
        '200': {
          description: '任务，顺序和请求一致',
          content: json({ type: 'object', properties: { printJobs: { type: 'array', items: ref('PrintJob') } } }),
        },
        ...errorResponses,
      },
    },
  },
  '/v1/printJobs/{printJob}': {
    get: {
      operationId: 'getPrintJob',
      summary: '任务状态',
      parameters: [{ name: 'printJob', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: '任务', content: json(ref('PrintJob')) }, ...errorResponses },
    },
  },
} as const;

const paper = {
  type: 'object',
  properties: { widthMm: { type: 'number' }, heightMm: { type: 'number' } },
};
const fields = {
  type: 'array',
  minItems: 1,
  maxItems: FIELDS_LIMIT,
  description: '有顺序；名称 1–20 个字，不能有花括号和控制字符，不能重名',
  items: {
    type: 'object',
    required: ['name', 'value'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 20 },
      value: { type: 'string', maxLength: TEXT_LIMIT },
    },
  },
};
const content = {
  type: ['string', 'null'],
  minLength: 1,
  maxLength: TEXT_LIMIT,
  description: '完整内容（二维码、底部整行、{完整内容}）；不给时由字段拼成「名称：值」一行一个',
};

const SCHEMAS = {
  Service: {
    type: 'object',
    properties: {
      product: { type: 'string', const: 'CDL-LabelFlash' },
      apiVersion: { type: 'string', const: 'v1' },
      appVersion: { type: 'string' },
      port: { type: 'integer' },
    },
  },
  Template: {
    type: 'object',
    properties: {
      name: { type: 'string', examples: ['templates/builtin-standard'] },
      displayName: { type: 'string' },
      paper,
      printer: { type: ['string', 'null'], description: '模板指定的打印机；null = 按纸张分配' },
      fieldsMode: { type: 'string', enum: ['ALL', 'PICKED'], description: 'ALL = 显示全部字段；PICKED = 只显示指定的' },
      fieldNames: { type: 'array', items: { type: 'string' }, description: '模板点名要的字段' },
    },
  },
  Printer: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      printer: { type: 'string', description: '系统里的打印机名，提交任务时 printer 填它' },
      displayName: { type: 'string' },
      papers: { type: 'array', items: paper, description: '分给它的纸' },
      templates: { type: 'array', items: { type: 'string' }, description: '指定了它的模板' },
      state: { type: 'string', enum: ['READY', 'NOT_READY', 'UNKNOWN'] },
      stateMessage: { type: ['string', 'null'] },
    },
  },
  RenderRequest: { type: 'object', required: ['fields'], properties: { fields, content } },
  PrintJobRequest: {
    type: 'object',
    required: ['template', 'fields'],
    properties: {
      template: { type: 'string', examples: ['templates/builtin-standard'] },
      fields,
      content,
      copies: { type: 'integer', minimum: 1, maximum: COPIES_LIMIT, default: 1 },
      printer: { type: ['string', 'null'], description: '指定打印机；不给时按模板决定（模板指定 → 纸张分配）' },
      requestId: {
        type: ['string', 'null'],
        format: 'uuid',
        description: '同一调用方 24 小时内重复提交同一个 requestId，返回已有的任务，不再打印',
      },
    },
  },
  PrintJob: {
    type: 'object',
    properties: {
      name: { type: 'string', examples: ['printJobs/3f1c…'] },
      template: { type: 'string' },
      fields,
      content,
      copies: { type: 'integer' },
      printer: { type: ['string', 'null'] },
      requestId: { type: ['string', 'null'] },
      state: {
        type: 'string',
        enum: ['QUEUED', 'PRINTING', 'SENT', 'FAILED'],
        description: 'SENT = 全部份数都已发送打印（进了打印队列）',
      },
      sentCopies: { type: 'integer' },
      failure: {
        type: ['object', 'null'],
        properties: {
          reason: {
            type: 'string',
            enum: [
              'NO_PRINTER',
              'PRINTER_NOT_FOUND',
              'PRINTER_NOT_READY',
              'PRINT_TIMEOUT',
              'PRINT_ERROR',
              'INTERRUPTED',
            ],
          },
          message: { type: 'string' },
        },
      },
      createTime: { type: 'string', format: 'date-time' },
      updateTime: { type: 'string', format: 'date-time' },
    },
  },
  Status: {
    type: 'object',
    description: 'google.rpc.Status（AIP-193）',
    properties: {
      error: {
        type: 'object',
        properties: {
          code: { type: 'integer' },
          status: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
};

export const OPENAPI_PATHS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = PATHS;

export function openApiDocument(port: number) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CDL-LabelFlash 本机接口',
      version: 'v1',
      description: '提交「模板 + 字段」打印标签，或只排版返回 PDF。说明见程序附带的 docs/local-api.md。',
    },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    security: [{ bearer: [] }],
    paths: PATHS,
    components: {
      schemas: SCHEMAS,
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: '程序密钥（lf_ 开头）' } },
    },
  };
}
