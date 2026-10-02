import { describe, expect, test } from 'bun:test';
import { BATCH_LIMITS, type BatchPlan, DEFAULT_COPIES, DEFAULT_SERIAL } from './batch-model';
import { parseBatchPlan } from './parse-batch-plan';

const VALID: BatchPlan = {
  templateId: 'custom:tag',
  data: { kind: 'table', tableId: '00000000-0000-4000-8000-000000000001' },
  mapping: { 编码: { kind: 'column', column: '编码' }, 备注: { kind: 'fixed', value: '' }, 尺码: { kind: 'none' } },
  serial: { ...DEFAULT_SERIAL, enabled: true, digits: 3, column: null },
  copies: DEFAULT_COPIES,
  rows: [0, 2],
};

describe('parseBatchPlan', () => {
  test('accepts a well-formed plan', () => {
    expect(parseBatchPlan(structuredClone(VALID))).toEqual(VALID);
    expect(parseBatchPlan({ ...VALID, data: { kind: 'serial-only', count: 5 }, rows: null })).toMatchObject({
      data: { kind: 'serial-only', count: 5 },
      rows: null,
    });
  });

  test.each([
    ['template id', { templateId: 'evil' }],
    ['table id', { data: { kind: 'table', tableId: 'x' } }],
    ['serial-only count', { data: { kind: 'serial-only', count: BATCH_LIMITS.serialOnlyCount + 1 } }],
    ['mapping key', { mapping: { ['x'.repeat(21)]: { kind: 'none' } } }],
    ['mapping source', { mapping: { 编码: { kind: 'column', column: '' } } }],
    ['serial digits', { serial: { ...VALID.serial, digits: BATCH_LIMITS.serialDigits + 1 } }],
    ['serial step', { serial: { ...VALID.serial, step: 0 } }],
    ['copies', { copies: { kind: 'fixed', count: 0 } }],
    ['rows', { rows: [BATCH_LIMITS.rows] }],
    ['rows type', { rows: 'all' }],
    ['rows, empty selection', { rows: [] }],
  ])('rejects a bad %s', (_name, patch) => {
    expect(parseBatchPlan({ ...VALID, ...patch })).toBeNull();
  });

  test('rejects anything that is not an object', () => {
    expect(parseBatchPlan(null)).toBeNull();
    expect(parseBatchPlan([VALID])).toBeNull();
  });

  // 只按序号打时没有表格：份数取列、序号取列都没有列可取，这类设置本身就是错的，解析时直接拒绝，
  // 不要留到逐行展开时对着一张不存在的表格报一堆莫名其妙的问题。
  test('rejects serial-only data combined with a copies or serial column', () => {
    const serialOnly = { ...VALID, data: { kind: 'serial-only' as const, count: 5 } };
    expect(parseBatchPlan({ ...serialOnly, copies: { kind: 'column', column: '份数' } })).toBeNull();
    expect(parseBatchPlan({ ...serialOnly, serial: { ...VALID.serial, column: '货架号' } })).toBeNull();
  });

  test('rejects a mapping with more variables than the limit', () => {
    const mapping = Object.fromEntries(
      Array.from({ length: BATCH_LIMITS.variables + 1 }, (_, i) => [`v${i}`, { kind: 'none' }]),
    );
    expect(parseBatchPlan({ ...VALID, mapping })).toBeNull();
  });

  // 结构化克隆过来的对象可以带名为 __proto__ 的自有键：只当普通变量名，不能改到原型。
  test('keeps a __proto__ variable as a plain own key', () => {
    const mapping: unknown = JSON.parse('{"__proto__":{"kind":"none"}}');
    const parsed = parseBatchPlan({ ...VALID, mapping });
    expect(parsed === null ? null : Object.getPrototypeOf(parsed.mapping)).toBe(Object.prototype);
    expect(parsed === null ? false : Object.hasOwn(parsed.mapping, '__proto__')).toBe(true);
  });
});
