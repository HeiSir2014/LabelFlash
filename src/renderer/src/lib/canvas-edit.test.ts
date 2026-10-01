import { describe, expect, test } from 'bun:test';
import {
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasTemplate,
  newCanvasElement,
} from '../../../core/templates/canvas-model';
import {
  type Alignment,
  addElement,
  alignElements,
  bringToFront,
  clampAll,
  clampBox,
  copyElements,
  deleteElements,
  distributeElements,
  elementsInRect,
  moveBy,
  newElementId,
  pasteElements,
  rectFromPoints,
  replaceElement,
  resizeBox,
  rotateElement,
  roundMm,
  roundTo,
  sendToBack,
  setBox,
  toggleId,
  uniqueName,
} from './canvas-edit';

const PAPER = { widthMm: 60, heightMm: 40 };

/** 一个矩形元素（其余属性取默认值）。 */
function rect(id: string, x: number, y: number, width: number, height: number, locked = false): CanvasElement {
  return { ...newCanvasElement('rect', id, PAPER), x, y, width, height, locked };
}

function canvas(...elements: CanvasElement[]): CanvasTemplate {
  return { kind: 'canvas', id: 'custom:t', name: '测试', paper: PAPER, printer: null, elements };
}

/** 只取位置和大小，断言时一目了然。 */
function boxes(template: CanvasTemplate) {
  return template.elements.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
}

describe('rounding', () => {
  test('keeps millimetres to two decimals and never shows minus zero', () => {
    expect(roundMm(12.3456)).toBe(12.35);
    expect(Object.is(roundMm(-0.001), 0)).toBe(true);
  });

  test('rounds to a step', () => {
    expect(roundTo(1.26, 0.1)).toBe(1.3);
    expect(roundTo(0.04, 0.1)).toBe(0);
  });
});

describe('clampBox', () => {
  test('keeps a box on the paper and at least the minimum size', () => {
    expect(clampBox({ x: 55, y: -3, width: 20, height: 0 }, PAPER)).toEqual({
      x: 40,
      y: 0,
      width: 20,
      height: CANVAS_LIMITS.minSizeMm,
    });
    expect(clampBox({ x: -5, y: 5, width: 80, height: 10 }, PAPER)).toEqual({ x: 0, y: 5, width: 60, height: 10 });
  });

  test('pulls every element back onto a smaller paper', () => {
    const template = { ...canvas(rect('a', 50, 30, 10, 5)), paper: { widthMm: 40, heightMm: 30 } };
    expect(boxes(clampAll(template))).toEqual([{ id: 'a', x: 30, y: 25, width: 10, height: 5 }]);
  });
});

describe('moveBy', () => {
  test('moves a group as far as the paper allows, keeping the spacing', () => {
    const template = canvas(rect('a', 10, 10, 10, 5), rect('b', 30, 20, 10, 5));
    expect(boxes(moveBy(template, ['a', 'b'], 25, 0))).toEqual([
      { id: 'a', x: 30, y: 10, width: 10, height: 5 },
      { id: 'b', x: 50, y: 20, width: 10, height: 5 },
    ]);
  });

  test('leaves locked elements where they are', () => {
    const template = canvas(rect('a', 10, 10, 10, 5, true), rect('b', 30, 20, 10, 5));
    expect(boxes(moveBy(template, ['a', 'b'], 5, 5))).toEqual([
      { id: 'a', x: 10, y: 10, width: 10, height: 5 },
      { id: 'b', x: 35, y: 25, width: 10, height: 5 },
    ]);
    expect(moveBy(template, ['a'], 5, 5)).toBe(template);
  });
});

describe('resizeBox', () => {
  const start = { x: 10, y: 10, width: 20, height: 10 };

  test('moves only the edges of the dragged handle', () => {
    expect(resizeBox(start, 'se', 5, 5, PAPER)).toEqual({ x: 10, y: 10, width: 25, height: 15 });
    expect(resizeBox(start, 'nw', 5, 2, PAPER)).toEqual({ x: 15, y: 12, width: 15, height: 8 });
    expect(resizeBox(start, 'e', 0, 9, PAPER)).toEqual(start);
  });

  test('stops at the minimum size and at the paper edge', () => {
    expect(resizeBox(start, 'w', 30, 0, PAPER)).toEqual({ x: 29.75, y: 10, width: 0.25, height: 10 });
    expect(resizeBox(start, 'e', 100, 0, PAPER)).toEqual({ x: 10, y: 10, width: 50, height: 10 });
    expect(resizeBox(start, 'n', 0, -50, PAPER)).toEqual({ x: 10, y: 0, width: 20, height: 20 });
  });
});

describe('setBox and replaceElement', () => {
  test('put a changed box back on the paper', () => {
    const template = canvas(rect('a', 10, 10, 10, 5));
    expect(boxes(setBox(template, 'a', { x: 50, y: 0, width: 20, height: 5 }))[0]).toMatchObject({ x: 40, width: 20 });
    const element = template.elements[0];
    if (element === undefined) {
      throw new Error('expected an element');
    }
    expect(replaceElement(template, { ...element, x: 100 }).elements[0]?.x).toBe(50);
  });

  test('do not resize a locked element', () => {
    const template = canvas(rect('a', 10, 10, 10, 5, true));
    expect(boxes(setBox(template, 'a', { x: 0, y: 0, width: 30, height: 30 }))).toEqual(boxes(template));
  });
});

describe('rotateElement', () => {
  test('swaps width and height around the centre on a quarter turn', () => {
    const rotated = rotateElement(canvas(rect('a', 15, 17, 30, 6)), 'a', 90);
    expect(rotated.elements[0]).toMatchObject({ x: 27, y: 5, width: 6, height: 30, rotation: 90 });
  });

  test('keeps the box on a half turn and keeps a turned box on the paper', () => {
    expect(rotateElement(canvas(rect('a', 15, 17, 30, 6)), 'a', 180).elements[0]).toMatchObject({
      x: 15,
      y: 17,
      width: 30,
      height: 6,
      rotation: 180,
    });
    expect(rotateElement(canvas(rect('a', 0, 0, 30, 6)), 'a', 270).elements[0]).toMatchObject({
      x: 12,
      y: 0,
      width: 6,
      height: 30,
    });
  });
});

describe('adding elements', () => {
  test('puts a new element in the middle of the paper, on top', () => {
    const added = addElement(canvas(rect('a', 0, 0, 5, 5)), 'text');
    expect(added?.ids).toEqual(['e1']);
    expect(added?.template.elements.at(-1)).toMatchObject({
      id: 'e1',
      kind: 'text',
      x: 15,
      y: 17,
      width: 30,
      height: 6,
    });
  });

  test('centres a dropped element on the drop point, inside the paper', () => {
    expect(addElement(canvas(), 'text', { x: 58, y: 2 })?.template.elements[0]).toMatchObject({ x: 30, y: 0 });
  });

  test('numbers the names of elements of the same kind', () => {
    const first = addElement(canvas(), 'text');
    const second = first && addElement(first.template, 'text');
    expect(second?.template.elements.map((element) => element.name)).toEqual(['文字', '文字 2']);
  });

  test('refuses to add past the element limit', () => {
    const full = canvas(...Array.from({ length: CANVAS_LIMITS.elements }, (_, index) => rect(`r${index}`, 0, 0, 1, 1)));
    expect(addElement(full, 'line')).toBeNull();
  });

  test('picks the first unused id and a free name', () => {
    expect(newElementId([rect('e1', 0, 0, 1, 1), rect('e3', 0, 0, 1, 1)])).toBe('e2');
    const named = [
      { ...rect('a', 0, 0, 1, 1), name: '文字' },
      { ...rect('b', 0, 0, 1, 1), name: '文字 2' },
    ];
    expect(uniqueName('文字', named)).toBe('文字 3');
    expect(uniqueName('文字 2', named)).toBe('文字 3');
    expect(uniqueName('条码', named)).toBe('条码');
    const long = 'x'.repeat(CANVAS_LIMITS.nameLength);
    expect(uniqueName(long, [{ ...rect('c', 0, 0, 1, 1), name: long }])).toBe(
      `${'x'.repeat(CANVAS_LIMITS.nameLength - 2)} 2`,
    );
  });
});

describe('deleteElements and toggleId', () => {
  test('deletes the selected elements except locked ones', () => {
    const template = canvas(rect('a', 0, 0, 5, 5), rect('b', 0, 0, 5, 5, true), rect('c', 0, 0, 5, 5));
    expect(deleteElements(template, ['a', 'b']).elements.map((element) => element.id)).toEqual(['b', 'c']);
    expect(deleteElements(template, ['b'])).toBe(template);
  });

  test('adds or removes one id from a selection', () => {
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleId(['a'], 'c')).toEqual(['a', 'c']);
  });
});

describe('alignElements', () => {
  test('aligns a single element to the safe area', () => {
    const template = canvas(rect('a', 10, 10, 20, 10));
    const x = (alignment: Alignment) => alignElements(template, ['a'], alignment).elements[0]?.x;
    const y = (alignment: Alignment) => alignElements(template, ['a'], alignment).elements[0]?.y;
    expect([x('left'), x('center'), x('right')]).toEqual([1.5, 20, 38.5]);
    expect([y('top'), y('middle'), y('bottom')]).toEqual([1.5, 15, 28.5]);
  });

  test('aligns several elements to their common bounds, leaving locked ones in place', () => {
    const template = canvas(rect('a', 10, 10, 10, 5), rect('b', 30, 20, 20, 5));
    expect(boxes(alignElements(template, ['a', 'b'], 'right')).map((box) => box.x)).toEqual([40, 30]);
    expect(boxes(alignElements(template, ['a', 'b'], 'middle')).map((box) => box.y)).toEqual([15, 15]);
    const locked = canvas(rect('a', 10, 10, 10, 5, true), rect('b', 30, 20, 20, 5));
    expect(boxes(alignElements(locked, ['a', 'b'], 'left')).map((box) => box.x)).toEqual([10, 10]);
  });
});

describe('distributeElements', () => {
  test('spaces the middle elements evenly between the first and the last', () => {
    const row = canvas(rect('a', 0, 0, 10, 5), rect('c', 50, 0, 10, 5), rect('b', 12, 0, 10, 5));
    expect(boxes(distributeElements(row, ['a', 'b', 'c'], 'horizontal')).map((box) => box.x)).toEqual([0, 50, 25]);
    const column = canvas(rect('a', 0, 0, 10, 4), rect('b', 0, 10, 10, 4), rect('c', 0, 30, 10, 4));
    expect(boxes(distributeElements(column, ['a', 'b', 'c'], 'vertical')).map((box) => box.y)).toEqual([0, 15, 30]);
  });

  test('needs at least three elements', () => {
    const template = canvas(rect('a', 0, 0, 10, 5), rect('b', 30, 0, 10, 5));
    expect(distributeElements(template, ['a', 'b'], 'horizontal')).toBe(template);
  });
});

describe('layer order', () => {
  const template = canvas(rect('a', 0, 0, 1, 1), rect('b', 0, 0, 1, 1), rect('c', 0, 0, 1, 1), rect('d', 0, 0, 1, 1));
  const order = (next: CanvasTemplate) => next.elements.map((element) => element.id);

  test('brings the selection to the front keeping its own order', () => {
    expect(order(bringToFront(template, ['b', 'a']))).toEqual(['c', 'd', 'a', 'b']);
  });

  test('sends the selection to the back keeping its own order', () => {
    expect(order(sendToBack(template, ['d', 'c']))).toEqual(['c', 'd', 'a', 'b']);
  });
});

describe('copy and paste', () => {
  test('copies deeply, so later edits do not change the clipboard', () => {
    const template = canvas(rect('a', 10, 10, 10, 5));
    const [copy] = copyElements(template, ['a']);
    if (copy === undefined) {
      throw new Error('expected a copy');
    }
    copy.x = 0;
    expect(template.elements[0]?.x).toBe(10);
  });

  test('pastes with new ids and names, offset and unlocked', () => {
    const template = canvas(rect('a', 10, 10, 10, 5, true));
    const pasted = pasteElements(template, copyElements(template, ['a']));
    expect(pasted.ids).toEqual(['e1']);
    expect(pasted.template.elements[1]).toMatchObject({ id: 'e1', name: '矩形 2', x: 12, y: 12, locked: false });
  });

  test('keeps pasted elements on the paper and within the element limit', () => {
    const edge = canvas(rect('a', 50, 35, 10, 5));
    expect(pasteElements(edge, copyElements(edge, ['a'])).template.elements[1]).toMatchObject({ x: 50, y: 35 });
    const almostFull = canvas(
      ...Array.from({ length: CANVAS_LIMITS.elements - 1 }, (_, index) => rect(`r${index}`, 0, 0, 1, 1)),
    );
    expect(pasteElements(almostFull, copyElements(almostFull, ['r0', 'r1'])).ids).toHaveLength(1);
  });
});

describe('marquee selection', () => {
  test('selects every element the rectangle touches', () => {
    const template = canvas(rect('a', 10, 10, 10, 5), rect('b', 40, 30, 10, 5), rect('c', 0, 20, 60, 0.25));
    expect(elementsInRect(template, { x: 5, y: 5, width: 20, height: 20 })).toEqual(['a', 'c']);
  });

  test('builds the rectangle from two corners in any order', () => {
    expect(rectFromPoints({ x: 20, y: 5 }, { x: 10, y: 15 })).toEqual({ x: 10, y: 5, width: 10, height: 10 });
  });
});
