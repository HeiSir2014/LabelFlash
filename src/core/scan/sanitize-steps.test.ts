import { describe, expect, test } from 'bun:test';
import { STEP_LIMITS } from './enrich-model';
import { isStepIssue, sanitizeSteps } from './sanitize-steps';

const HTTP = {
  kind: 'http',
  method: 'GET',
  url: 'https://example.com/shelf?code={编码}',
  headers: [{ name: 'Authorization', value: 'Bearer {密钥:仓库}' }],
  body: '',
  timeoutMs: 1_500,
  cacheSeconds: 60,
  outputs: [{ path: 'data.shelf', field: '货架号' }],
  onError: 'empty',
};

const SHELF = {
  kind: 'imageText',
  pattern: '\\b[A-Z]{1,2}-\\d{1,3}-\\d{1,3}-\\d{1,3}\\b',
  flags: '',
  preferredArea: { left: -0.1, top: 1, right: 1.1, bottom: 1.6 },
  whenMissing: 'block',
  output: '货架号',
};

function issueOf(steps: unknown): string {
  const result = sanitizeSteps(steps);
  return isStepIssue(result) ? result.issue : '';
}

describe('sanitizeSteps', () => {
  test('treats a missing list as no steps', () => {
    expect(sanitizeSteps(undefined)).toEqual([]);
  });

  test('accepts every kind of step', () => {
    const steps: unknown[] = [
      { kind: 'template', text: 'https://example.com/o/{订单号}', output: '链接' },
      { kind: 'regexReplace', input: null, pattern: '^SO-', flags: 'gi', replacement: '', output: '编号' },
      {
        kind: 'lookup',
        input: '编码',
        tableId: 'a1b2',
        keyColumn: '编码',
        ignoreCase: false,
        outputs: [{ column: '货架', field: '货架号' }],
      },
      HTTP,
      SHELF,
      { ...SHELF, preferredArea: null, whenMissing: 'empty', flags: 'iu' },
    ];
    expect(sanitizeSteps(steps) as unknown[]).toEqual(steps);
  });

  test('reports which step is wrong and why', () => {
    expect(issueOf([{ kind: 'template', text: 'x', output: '好' }, { kind: 'script' }])).toBe(
      '第 2 个加工步骤：类型不对，只能是文本拼接、正则替换、查找表、HTTP 查询或图中文字识别',
    );
    expect(issueOf([{ kind: 'template', text: '', output: '链接' }])).toContain('文本要有');
    expect(issueOf([{ kind: 'template', text: 'x', output: '{坏}' }])).toContain('字段名');
    expect(issueOf([{ kind: 'regexReplace', pattern: '(', output: 'a' }])).toContain('正则写法不对');
    expect(issueOf([{ kind: 'regexReplace', pattern: 'a', flags: 'y', output: 'a' }])).toContain('正则标志');
  });

  test('limits the number of steps', () => {
    const steps = Array.from({ length: STEP_LIMITS.steps + 1 }, () => ({ kind: 'template', text: 'x', output: 'a' }));
    expect(issueOf(steps)).toContain(`最多 ${STEP_LIMITS.steps} 个`);
  });

  test('requires a fixed http(s) host and rejects variables in it', () => {
    expect(issueOf([{ ...HTTP, url: 'file:///etc/passwd' }])).toContain('http:// 或 https://');
    expect(issueOf([{ ...HTTP, url: 'https://{主机}/x' }])).toContain('主机名里不能用变量');
    expect(issueOf([{ ...HTTP, url: 'javascript:alert(1)' }])).toContain('http:// 或 https://');
  });

  test('rejects header injection, bad JSON paths, duplicate outputs and out-of-range numbers', () => {
    expect(issueOf([{ ...HTTP, headers: [{ name: 'X-A', value: 'a\r\nX-B: b' }] }])).toContain('不能换行');
    expect(issueOf([{ ...HTTP, headers: [{ name: 'X A', value: 'a' }] }])).toContain('请求头名称');
    expect(issueOf([{ ...HTTP, outputs: [{ path: 'a..b', field: 'x' }] }])).toContain('取值路径');
    expect(
      issueOf([
        {
          ...HTTP,
          outputs: [
            { path: 'a', field: 'x' },
            { path: 'b', field: 'x' },
          ],
        },
      ]),
    ).toContain('产出的字段重复');
    expect(issueOf([{ ...HTTP, timeoutMs: 60_000 }])).toContain('超时');
    expect(issueOf([{ ...HTTP, onError: 'retry' }])).toContain('失败时怎么办');
  });

  test('refuses image text flags that make no sense for a single match', () => {
    expect(issueOf([{ ...SHELF, flags: 'g' }])).toContain('正则标志只能是 i m s u');
  });

  test('refuses a preferred area that is empty or too far from the code', () => {
    expect(issueOf([{ ...SHELF, preferredArea: { left: 1, top: 1, right: 1, bottom: 2 } }])).toContain('优先区域');
    expect(issueOf([{ ...SHELF, preferredArea: { left: -11, top: 1, right: 1, bottom: 2 } }])).toContain('优先区域');
    expect(issueOf([{ ...SHELF, preferredArea: { left: 'a', top: 1, right: 2, bottom: 2 } }])).toContain('优先区域');
  });

  test('refuses a pattern that cannot be wrapped for a whole match', () => {
    expect(issueOf([{ ...SHELF, pattern: '(?<imageTextMatch>A)' }])).toContain('正则写法不对');
    expect(issueOf([{ ...SHELF, pattern: '(' }])).toContain('正则写法不对');
  });

  test('requires a policy for text that cannot be found', () => {
    expect(issueOf([{ ...SHELF, whenMissing: 'maybe' }])).toContain('认不出时怎么办');
  });
});
