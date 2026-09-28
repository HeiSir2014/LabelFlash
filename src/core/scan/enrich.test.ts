import { describe, expect, test } from 'bun:test';
import { type EnrichDeps, enrich, type HttpOutcome, type HttpRequest } from './enrich';
import type { EnrichStep, HttpStep } from './enrich-model';
import type { ScanResult } from './scan-result';

const SCAN: ScanResult = {
  raw: 'SO-1001-黑-XL',
  ruleId: 'custom:so',
  ruleName: '销售单',
  fields: [
    { name: '单号', value: 'SO-1001' },
    { name: '颜色', value: '黑' },
    { name: '尺码', value: 'XL' },
  ],
};
const PRINTED_AT = new Date(2026, 8, 28, 9, 5);
const SHELVES: Record<string, Record<string, string>> = {
  'SO-1001': { 单号: 'SO-1001', 货架: 'A-01', 仓库: '一号仓' },
};

function http(overrides: Partial<HttpStep> = {}): HttpStep {
  return {
    kind: 'http',
    method: 'GET',
    url: 'https://example.com/shelf?code={单号}',
    headers: [],
    body: '',
    timeoutMs: 1_500,
    cacheSeconds: 60,
    outputs: [{ path: 'data.shelf', field: '货架号' }],
    onError: 'empty',
    ...overrides,
  };
}

function createDeps(response: HttpOutcome = { ok: true, json: { data: { shelf: 'B-07' } } }) {
  const requests: HttpRequest[] = [];
  const deps: EnrichDeps = {
    replace: (pattern, flags, input, replacement) => input.replace(new RegExp(pattern, flags), replacement),
    lookup: (_tableId, keyColumn, key, ignoreCase) =>
      Object.values(SHELVES).find((row) =>
        ignoreCase ? row[keyColumn]?.toLowerCase() === key.toLowerCase() : row[keyColumn] === key,
      ) ?? null,
    http: async (request) => {
      requests.push(request);
      return response;
    },
    now: () => 0,
  };
  return { deps, requests };
}

async function run(steps: EnrichStep[], deps = createDeps().deps) {
  return enrich(SCAN, steps, deps, PRINTED_AT);
}

describe('enrich', () => {
  test('runs steps in order so later steps can use earlier outputs', async () => {
    const result = await run([
      { kind: 'regexReplace', input: '单号', pattern: '^SO-', flags: '', replacement: '', output: '编号' },
      { kind: 'template', text: 'https://example.com/o/{编号}', output: '链接' },
    ]);
    expect(result.scan.fields.slice(-2)).toEqual([
      { name: '编号', value: '1001' },
      { name: '链接', value: 'https://example.com/o/1001' },
    ]);
    expect(result.traces.map((trace) => trace.ok)).toEqual([true, true]);
    expect(result.blocked).toBeNull();
  });

  test('overwrites a field with the same name in place and keeps the raw content', async () => {
    const result = await run([{ kind: 'template', text: '{颜色}色', output: '颜色' }]);
    expect(result.scan.fields[1]).toEqual({ name: '颜色', value: '黑色' });
    expect(result.scan.raw).toBe(SCAN.raw);
  });

  test('regex replacement keeps the original value when the regex times out', async () => {
    const { deps } = createDeps();
    const result = await run(
      [{ kind: 'regexReplace', input: null, pattern: 'x', flags: '', replacement: '', output: '内容' }],
      { ...deps, replace: () => null },
    );
    expect(result.scan.fields.at(-1)).toEqual({ name: '内容', value: SCAN.raw });
    expect(result.traces[0]?.ok).toBe(false);
  });

  test('looks values up in a local table and leaves them empty when the key is missing', async () => {
    const step: EnrichStep = {
      kind: 'lookup',
      input: '单号',
      tableId: 'shelves',
      keyColumn: '单号',
      ignoreCase: true,
      outputs: [
        { column: '货架', field: '货架号' },
        { column: '仓库', field: '仓库' },
      ],
    };
    const found = await run([step]);
    expect(found.scan.fields.slice(-2)).toEqual([
      { name: '货架号', value: 'A-01' },
      { name: '仓库', value: '一号仓' },
    ]);
    const missing = await run([{ ...step, input: '颜色' }]);
    expect(missing.scan.fields.slice(-2).map((field) => field.value)).toEqual(['', '']);
    expect(missing.traces[0]?.detail).toContain('查找表里没有「黑」');
  });

  test('sends HTTP requests with URL-encoded variables and reads values from the JSON reply', async () => {
    const { deps, requests } = createDeps();
    const scan: ScanResult = { ...SCAN, fields: [{ name: '单号', value: 'SO 1/2' }] };
    const result = await enrich(
      scan,
      [
        http({
          method: 'POST',
          url: 'https://example.com/q/{单号}',
          headers: [{ name: 'Authorization', value: 'Bearer {密钥:仓库接口}' }],
          body: '{"code":"{单号}","note":"{完整内容}"}',
        }),
      ],
      deps,
      PRINTED_AT,
    );
    expect(requests[0]).toEqual({
      method: 'POST',
      url: 'https://example.com/q/SO%201%2F2',
      headers: [{ name: 'Authorization', value: 'Bearer {密钥:仓库接口}' }],
      body: `{"code":"SO 1/2","note":"${SCAN.raw}"}`,
      timeoutMs: 1_500,
      cacheSeconds: 60,
    });
    expect(result.scan.fields.at(-1)).toEqual({ name: '货架号', value: 'B-07' });
  });

  test('escapes quotes and line breaks inside a JSON body', async () => {
    const { deps, requests } = createDeps();
    const scan: ScanResult = { ...SCAN, fields: [{ name: '单号', value: 'a"b\nc' }] };
    await enrich(scan, [http({ method: 'POST', body: '{"code":"{单号}"}' })], deps, PRINTED_AT);
    expect(JSON.parse(requests[0]?.body ?? '')).toEqual({ code: 'a"b\nc' });
  });

  test('a failed HTTP lookup prints with empty fields by default', async () => {
    const result = await run([http()], createDeps({ ok: false, detail: '查询超时' }).deps);
    expect(result.blocked).toBeNull();
    expect(result.scan.fields.at(-1)).toEqual({ name: '货架号', value: '' });
    expect(result.traces[0]).toMatchObject({ ok: false, detail: '查询超时' });
  });

  test('a failed HTTP lookup set to block stops the remaining steps', async () => {
    const result = await run(
      [http({ onError: 'block' }), { kind: 'template', text: 'x', output: '之后' }],
      createDeps({ ok: true, json: { data: {} } }).deps,
    );
    expect(result.blocked).toEqual({ stepIndex: 0, detail: '返回内容里取不到 data.shelf' });
    expect(result.traces).toHaveLength(1);
    expect(result.scan.fields.some((field) => field.name === '之后')).toBe(false);
  });

  test('does nothing without steps', async () => {
    expect(await run([])).toEqual({ scan: SCAN, traces: [], blocked: null });
  });
});
