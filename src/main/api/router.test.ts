import { describe, expect, test } from 'bun:test';
import { PrintJobService } from '../../core/api/print-job-service';
import type { ScanField } from '../../core/scan/scan-result';
import { BUILT_IN_TEMPLATES, GENERIC_TEMPLATE } from '../../core/templates/builtin-templates';
import type { LabelTemplate } from '../../core/templates/template-model';
import { FakeClock } from '../../core/testing/fake-clock';
import { InMemoryApiJobStore } from '../../core/testing/in-memory-api-job-store';
import type { Caller } from './authenticator';
import { type ApiContext, type ApiResponse, route } from './router';

const CALLER: Caller = { id: 'key:k1', label: 'ERP' };
const OTHER: Caller = { id: 'key:k2', label: '仓库' };
const PORT = 17631;
const INSTANCE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const VALID_REQUEST = { template: 'templates/builtin-generic', fields: [{ name: '订单号', value: 'A001' }] };

function createContext() {
  const rendered: Array<{ template: LabelTemplate; fields: ScanField[]; content: string }> = [];
  let nextId = 0;
  const jobs = new PrintJobService({
    store: new InMemoryApiJobStore(),
    clock: new FakeClock(),
    createId: () => `pj-${++nextId}`,
    findTemplate: (id) => BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null,
    installedPrinters: async () => ['面单机B'],
    // 路由测试不关心出纸：任务一直排着。
    printFields: () => new Promise(() => {}),
    queueLimit: 5000,
  });
  const context: ApiContext = {
    jobs,
    listTemplates: () => [...BUILT_IN_TEMPLATES],
    findTemplate: (id) => BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null,
    listPrinters: async () => [
      {
        name: '面单机B',
        displayName: '面单机B',
        papers: [{ widthMm: 100, heightMm: 180 }],
        templateIds: [],
        readiness: { ready: false, detail: '缺纸', issue: 'paperOut' },
      },
    ],
    renderPdf: async (template, fields, content) => {
      rendered.push({ template, fields, content });
      return new TextEncoder().encode('%PDF-1.7');
    },
    service: { version: '1.1.0', port: () => PORT, instanceId: () => INSTANCE_ID },
  };
  return { context, rendered };
}

const get = (context: ApiContext, path: string, caller: Caller | null = CALLER): Promise<ApiResponse> =>
  route(context, { method: 'GET', url: path, body: undefined, caller });
const post = (context: ApiContext, path: string, body: unknown, caller: Caller = CALLER): Promise<ApiResponse> =>
  route(context, { method: 'POST', url: path, body, caller });

function bodyOf<T>(response: ApiResponse): T {
  return response.body as T;
}

describe('route', () => {
  test('describes the service', async () => {
    const { context } = createContext();
    expect(await get(context, '/v1/service', null)).toEqual({
      status: 200,
      contentType: 'application/json',
      body: { product: 'CDL-LabelFlash', apiVersion: 'v1', appVersion: '1.1.0', port: PORT, instanceId: INSTANCE_ID },
    });
  });

  test('serves the OpenAPI description with the actual address', async () => {
    const { context } = createContext();
    const body = bodyOf<{ openapi: string; servers: Array<{ url: string }> }>(
      await get(context, '/v1/openapi.json', null),
    );
    expect(body.openapi).toBe('3.1.0');
    expect(body.servers[0]?.url).toBe(`http://127.0.0.1:${PORT}`);
  });

  test('lists templates with API names, paper and fields', async () => {
    const { context } = createContext();
    const body = bodyOf<{ templates: unknown[] }>(await get(context, '/v1/templates'));
    expect(body.templates).toHaveLength(BUILT_IN_TEMPLATES.length);
    expect(body.templates).toContainEqual(
      expect.objectContaining({ name: 'templates/builtin-generic', paper: { widthMm: 60, heightMm: 40 } }),
    );
  });

  test('gets one template and reports a missing one', async () => {
    const { context } = createContext();
    expect(bodyOf<{ displayName: string }>(await get(context, '/v1/templates/builtin-generic')).displayName).toBe(
      GENERIC_TEMPLATE.name,
    );
    expect(await get(context, '/v1/templates/custom-gone')).toMatchObject({
      status: 404,
      body: { error: { status: 'NOT_FOUND', details: [expect.objectContaining({ reason: 'TEMPLATE_NOT_FOUND' })] } },
    });
  });

  test('lists printers with their papers and state', async () => {
    const { context } = createContext();
    expect(bodyOf<{ printers: unknown[] }>(await get(context, '/v1/printers')).printers).toEqual([
      {
        name: `printers/${encodeURIComponent('面单机B')}`,
        printer: '面单机B',
        displayName: '面单机B',
        papers: [{ widthMm: 100, heightMm: 180 }],
        templates: [],
        state: 'NOT_READY',
        stateMessage: '缺纸',
      },
    ]);
  });

  test('creates a print job and returns it QUEUED', async () => {
    const { context } = createContext();
    const response = await post(context, '/v1/printJobs', VALID_REQUEST);
    expect(response).toMatchObject({
      status: 200,
      body: { state: 'QUEUED', template: 'templates/builtin-generic', copies: 1, sentCopies: 0 },
    });
  });

  test('creates a batch and returns the jobs in order', async () => {
    const { context } = createContext();
    const response = await post(context, '/v1/printJobs:batchCreate', {
      requests: [VALID_REQUEST, { ...VALID_REQUEST, content: 'second' }],
    });
    const { printJobs } = bodyOf<{ printJobs: Array<{ content: string | null }> }>(response);
    expect(printJobs.map((job) => job.content)).toEqual([null, 'second']);
  });

  test('turns service errors into AIP errors that point at the request', async () => {
    const { context } = createContext();
    expect(await post(context, '/v1/printJobs', { ...VALID_REQUEST, template: 'templates/custom-gone' })).toMatchObject(
      {
        status: 404,
        body: { error: { status: 'NOT_FOUND' } },
      },
    );
    const response = await post(context, '/v1/printJobs:batchCreate', {
      requests: [VALID_REQUEST, { ...VALID_REQUEST, printer: '没有这台' }],
    });
    expect(response).toMatchObject({
      status: 400,
      body: {
        error: {
          status: 'FAILED_PRECONDITION',
          details: [
            expect.objectContaining({ reason: 'PRINTER_NOT_FOUND' }),
            expect.objectContaining({ fieldViolations: [expect.objectContaining({ field: 'requests[1].printer' })] }),
          ],
        },
      },
    });
  });

  test('reports bad requests with field violations', async () => {
    const { context } = createContext();
    expect(await post(context, '/v1/printJobs', { template: 'x' })).toMatchObject({
      status: 400,
      body: { error: { status: 'INVALID_ARGUMENT' } },
    });
  });

  test('gets a job and hides other callers’ jobs', async () => {
    const { context } = createContext();
    const { name } = bodyOf<{ name: string }>(await post(context, '/v1/printJobs', VALID_REQUEST));
    expect((await get(context, `/v1/${name}`)).status).toBe(200);
    expect((await get(context, `/v1/${name}`, OTHER)).status).toBe(404);
  });

  test('pages through jobs with a page token', async () => {
    const { context } = createContext();
    for (let i = 0; i < 3; i += 1) {
      await post(context, '/v1/printJobs', VALID_REQUEST);
    }
    const first = bodyOf<{ printJobs: unknown[]; nextPageToken: string }>(
      await get(context, '/v1/printJobs?pageSize=2'),
    );
    expect(first.printJobs).toHaveLength(2);
    const second = bodyOf<{ printJobs: unknown[]; nextPageToken: string }>(
      await get(context, `/v1/printJobs?pageSize=2&pageToken=${first.nextPageToken}`),
    );
    expect(second).toEqual({ printJobs: [expect.anything()], nextPageToken: '' });
  });

  test('rejects a bad page size or page token', async () => {
    const { context } = createContext();
    expect((await get(context, '/v1/printJobs?pageSize=-1')).status).toBe(400);
    expect((await get(context, '/v1/printJobs?pageToken=garbage')).status).toBe(400);
  });

  test('renders a PDF on the template paper', async () => {
    const { context, rendered } = createContext();
    const response = await post(context, '/v1/templates/builtin-generic:render', { fields: VALID_REQUEST.fields });
    expect(response.contentType).toBe('application/pdf');
    expect(rendered).toEqual([{ template: GENERIC_TEMPLATE, fields: VALID_REQUEST.fields, content: '订单号：A001' }]);
  });

  test('answers unknown paths and methods with NOT_FOUND', async () => {
    const { context } = createContext();
    expect((await get(context, '/v1/nothing')).status).toBe(404);
    expect((await post(context, '/v1/templates', {})).status).toBe(404);
  });
});
