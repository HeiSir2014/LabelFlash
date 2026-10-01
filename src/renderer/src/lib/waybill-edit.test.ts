import { describe, expect, test } from 'bun:test';
import { PLATFORM_TWO_PART } from '../../../core/templates/builtin-waybills';
import { isSplit, type WaybillNode, type WaybillTemplate } from '../../../core/templates/waybill-model';
import {
  describeNode,
  insertAfter,
  moveNode,
  nodeAt,
  nodeExtents,
  outline,
  pathKey,
  removeNode,
  splitNode,
} from './waybill-edit';

function text(sizeMm: number, value: string): WaybillNode {
  return {
    sizeMm,
    ruleAfter: 'solid',
    body: {
      content: {
        kind: 'text',
        paragraphs: [{ text: value, fontSizeMm: 3, bold: false, wrap: true }],
        align: 'left',
        valign: 'middle',
        inverse: false,
        showIf: '',
      },
    },
  };
}

/** 100×100 的版面，三行：20、30、剩下的 50。 */
const THREE_ROWS: WaybillTemplate = {
  ...PLATFORM_TWO_PART,
  paper: { widthMm: 100, heightMm: 100 },
  marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
  root: {
    sizeMm: 0,
    ruleAfter: 'none',
    body: { split: 'rows', children: [text(20, 'a'), text(30, 'b'), text(0, 'c')] },
  },
};

function heights(template: WaybillTemplate): number[] {
  const extents = nodeExtents(template);
  return template.root.body.children.map((_, index) => extents.get(pathKey([index]))?.height ?? -1);
}

function labelAt(template: WaybillTemplate, path: number[]): string {
  const node = nodeAt(template.root, path);
  return node ? describeNode(node) : '';
}

describe('outline', () => {
  test('lists every cell with its size; the last of a group is automatic', () => {
    const items = outline(THREE_ROWS);
    expect(items.map((item) => item.size)).toEqual(['高 20mm', '高 30mm', '高 自动 50mm']);
    expect(items.map((item) => item.label)).toEqual(['文字 a', '文字 b', '文字 c']);
  });

  test('indents nested cells under their row', () => {
    const items = outline(PLATFORM_TWO_PART);
    expect(items[0]).toMatchObject({ depth: 1, label: '左右分 3 格' });
    expect(items[1]).toMatchObject({ depth: 2, label: '文字 {快递公司}', size: '宽 40mm' });
  });
});

describe('editing', () => {
  test('splitting a cell keeps its size and halves it between the two new cells', () => {
    const split = splitNode(THREE_ROWS, [1], 'columns');
    const node = nodeAt(split.root, [1]);
    expect(node?.sizeMm).toBe(30);
    expect(node && isSplit(node.body) ? node.body.children.map((child) => child.sizeMm) : []).toEqual([50, 0]);
    expect(labelAt(split, [1, 0])).toBe('文字 b');
    expect(labelAt(split, [1, 1])).toBe('空白');
  });

  test('adding a cell takes half of the current one and leaves the others in place', () => {
    const added = insertAfter(THREE_ROWS, [0]);
    expect(heights(added)).toEqual([10, 10, 30, 50]);
  });

  test('adding after the last cell makes the new one the automatic last', () => {
    const added = insertAfter(THREE_ROWS, [2]);
    expect(heights(added)).toEqual([20, 30, 25, 25]);
    expect(added.root.body.children.at(-1)?.sizeMm).toBe(0);
  });

  test('removing a cell gives its space to the next one', () => {
    expect(heights(removeNode(THREE_ROWS, [0]))).toEqual([50, 50]);
  });

  test('removing the last cell makes the previous one automatic', () => {
    const removed = removeNode(THREE_ROWS, [2]);
    expect(heights(removed)).toEqual([20, 80]);
    expect(removed.root.body.children.at(-1)?.sizeMm).toBe(0);
  });

  test('a split left with one child collapses into it', () => {
    const split = splitNode(THREE_ROWS, [1], 'columns');
    const collapsed = removeNode(split, [1, 1]);
    expect(labelAt(collapsed, [1])).toBe('文字 b');
    expect(nodeAt(collapsed.root, [1])?.sizeMm).toBe(30);
  });

  test('never removes the only row', () => {
    const one: WaybillTemplate = {
      ...THREE_ROWS,
      root: { ...THREE_ROWS.root, body: { split: 'rows', children: [text(0, 'a')] } },
    };
    expect(removeNode(one, [0])).toBe(one);
  });

  test('moving a cell keeps every cell its own size', () => {
    const moved = moveNode(THREE_ROWS, [2], -1);
    expect(heights(moved)).toEqual([20, 50, 30]);
    expect(moved.root.body.children.map((child) => describeNode(child))).toEqual(['文字 a', '文字 c', '文字 b']);
  });

  test('does not change the original template', () => {
    const before = structuredClone(THREE_ROWS);
    splitNode(THREE_ROWS, [0], 'rows');
    insertAfter(THREE_ROWS, [1]);
    removeNode(THREE_ROWS, [1]);
    moveNode(THREE_ROWS, [0], 1);
    expect(THREE_ROWS).toEqual(before);
  });
});
