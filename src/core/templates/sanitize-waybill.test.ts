import { describe, expect, test } from 'bun:test';
import { GENERIC_TEMPLATE } from './builtin-templates';
import { PLATFORM_TWO_PART } from './builtin-waybills';
import { sanitizeTemplate } from './sanitize-template';
import { WAYBILL_LIMITS, type WaybillTemplate, walkNodes } from './waybill-model';

function sanitizeWaybill(value: unknown, fallback: WaybillTemplate = PLATFORM_TWO_PART): WaybillTemplate {
  const result = sanitizeTemplate(value, 'custom:w', fallback);
  if (result.kind !== 'waybill') {
    throw new Error('expected a waybill template');
  }
  return result;
}

function leaf(text: unknown) {
  return { sizeMm: 10, ruleAfter: 'solid', body: { content: { kind: 'text', paragraphs: [{ text, fontSizeMm: 3 }] } } };
}

describe('sanitizeTemplate for waybills', () => {
  test('reads a template without kind as a label template', () => {
    expect(sanitizeTemplate({ name: '旧模板' }, 'custom:old', GENERIC_TEMPLATE).kind).toBe('label');
  });

  test('keeps the kind of the input even when the fallback is the other kind', () => {
    expect(sanitizeTemplate({ kind: 'waybill', name: '面单' }, 'custom:w', GENERIC_TEMPLATE).kind).toBe('waybill');
    expect(sanitizeTemplate({ kind: 'label', name: '标签' }, 'custom:l', PLATFORM_TWO_PART).kind).toBe('label');
  });

  test('falls back to the built-in layout when the root is missing', () => {
    const result = sanitizeWaybill({ kind: 'waybill', name: '面单' });
    expect(result.root).toEqual(PLATFORM_TWO_PART.root);
    expect(result.root).not.toBe(PLATFORM_TWO_PART.root);
  });

  test('clamps margins, line width and font sizes', () => {
    const result = sanitizeWaybill({
      kind: 'waybill',
      marginsMm: { top: -3, right: 99, bottom: 'x', left: 2 },
      lineWidthMm: 5,
      root: {
        body: {
          split: 'rows',
          children: [
            { ...leaf('a'), body: { content: { kind: 'text', paragraphs: [{ text: 'a', fontSizeMm: 99 }] } } },
          ],
        },
      },
    });
    expect(result.marginsMm).toEqual({
      top: 0,
      right: WAYBILL_LIMITS.marginMm.max,
      bottom: PLATFORM_TWO_PART.marginsMm.bottom,
      left: 2,
    });
    expect(result.lineWidthMm).toBe(WAYBILL_LIMITS.lineWidthMm.max);
    const [only] = result.root.body.children;
    expect(only?.body).toMatchObject({ content: { paragraphs: [{ fontSizeMm: WAYBILL_LIMITS.fontSizeMm.max }] } });
  });

  test('does not store a size for the last child of a split', () => {
    const result = sanitizeWaybill({
      kind: 'waybill',
      root: { body: { split: 'rows', children: [leaf('a'), leaf('b')] } },
    });
    expect(result.root.body.children.map((child) => child.sizeMm)).toEqual([10, 0]);
  });

  test('strips control characters and line breaks from cell text', () => {
    const result = sanitizeWaybill({
      kind: 'waybill',
      root: { body: { split: 'rows', children: [leaf('a\nb\u0007c')] } },
    });
    expect(result.root.body.children[0]?.body).toMatchObject({ content: { paragraphs: [{ text: 'abc' }] } });
  });

  test('keeps a valid show-if field and drops an invalid one', () => {
    const cell = (showIf: unknown) => ({
      sizeMm: 10,
      body: { content: { kind: 'text', paragraphs: [{ text: '集' }], showIf } },
    });
    const result = sanitizeWaybill({
      kind: 'waybill',
      root: { body: { split: 'rows', children: [cell('集包地'), cell('{坏}'), cell(3)] } },
    });
    expect(
      result.root.body.children.map((child) => ('content' in child.body ? child.body.content : null)),
    ).toMatchObject([{ showIf: '集包地' }, { showIf: '' }, { showIf: '' }]);
  });

  test('turns unknown content into an empty cell', () => {
    const result = sanitizeWaybill({
      kind: 'waybill',
      root: { body: { split: 'rows', children: [{ sizeMm: 5, body: { content: { kind: 'image', src: 'x' } } }] } },
    });
    expect(result.root.body.children[0]?.body).toEqual({ content: { kind: 'empty' } });
  });

  test('cuts the tree at the depth and node limits', () => {
    let deep: unknown = leaf('x');
    for (let level = 0; level < WAYBILL_LIMITS.depth + 3; level += 1) {
      deep = { sizeMm: 10, body: { split: 'rows', children: [deep, leaf('y')] } };
    }
    const many = Array.from({ length: 200 }, () => leaf('z'));
    const result = sanitizeWaybill({ kind: 'waybill', root: { body: { split: 'rows', children: [deep, ...many] } } });
    let nodes = 0;
    let maxDepth = 0;
    walkNodes(result.root, (_, depth) => {
      nodes += 1;
      maxDepth = Math.max(maxDepth, depth);
    });
    expect(maxDepth).toBeLessThanOrEqual(WAYBILL_LIMITS.depth);
    expect(nodes).toBeLessThanOrEqual(WAYBILL_LIMITS.nodes + 1);
  });
});
