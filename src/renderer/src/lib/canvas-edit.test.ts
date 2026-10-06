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
  bringForward,
  bringToFront,
  clampAll,
  clampBox,
  copyElements,
  deleteElements,
  distributeElements,
  duplicateElements,
  elementsInRect,
  maxExtentMm,
  moveBy,
  moveLayer,
  newElementId,
  pasteElements,
  rectFromPoints,
  replaceElement,
  resizeBox,
  rotateElement,
  roundMm,
  roundTo,
  sendBackward,
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

  test('maxExtentMm rounds away floating point error so a value flush with the edge is accepted', () => {
    // 60 - 36.7 在浮点数里算出 23.299999999999997，直接拿去当 <input max> 会拒收用户刚好填的 23.3。
    expect(maxExtentMm(60, 36.7)).toBe(23.3);
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

  test('caps an element that is larger than the paper itself', () => {
    expect(clampBox({ x: 5, y: 5, width: 100, height: 100 }, PAPER)).toEqual({ x: 0, y: 0, width: 60, height: 40 });
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

  test('resizes from the ne, sw and s handles, and stops dragging n past the bottom', () => {
    expect(resizeBox(start, 'ne', -5, -3, PAPER)).toEqual({ x: 10, y: 7, width: 15, height: 13 });
    expect(resizeBox(start, 'sw', 5, -5, PAPER)).toEqual({ x: 15, y: 10, width: 15, height: 5 });
    expect(resizeBox(start, 's', 0, 10, PAPER)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(resizeBox(start, 'n', 0, 50, PAPER)).toEqual({ x: 10, y: 19.75, width: 20, height: 0.25 });
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

  test('keeps the box when turning from 90 to 270 (still a half turn)', () => {
    const template = canvas({ ...rect('a', 27, 5, 6, 30), rotation: 90 });
    expect(rotateElement(template, 'a', 270).elements[0]).toMatchObject({
      x: 27,
      y: 5,
      width: 6,
      height: 30,
      rotation: 270,
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

  test('keeps a meaningful trailing number instead of mistaking it for a copy suffix', () => {
    const named = [{ ...rect('a', 0, 0, 1, 1), name: '尺码 38' }];
    expect(uniqueName('尺码 38', named)).toBe('尺码 38 2');
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

  test('distributes by centres when the elements overlap, keeping their order', () => {
    const overlapping = canvas(rect('a', 0, 0, 10, 5), rect('b', 5, 0, 10, 5), rect('c', 12, 0, 10, 5));
    expect(boxes(distributeElements(overlapping, ['a', 'b', 'c'], 'horizontal')).map((box) => box.x)).toEqual([
      0, 6, 12,
    ]);
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

  test('brings the selection forward by one layer', () => {
    expect(order(bringForward(template, ['b']))).toEqual(['a', 'c', 'b', 'd']);
    expect(order(bringForward(template, ['a', 'b']))).toEqual(['c', 'a', 'b', 'd']);
  });

  test('sends the selection backward by one layer', () => {
    expect(order(sendBackward(template, ['c']))).toEqual(['a', 'c', 'b', 'd']);
    expect(order(sendBackward(template, ['c', 'd']))).toEqual(['a', 'c', 'd', 'b']);
  });

  test('leaves the order alone when the selection is already at that end', () => {
    expect(bringForward(template, ['d'])).toBe(template);
    expect(sendBackward(template, ['a'])).toBe(template);
  });

  test('moves one layer to an index in the element array (0 is the back)', () => {
    // 把 a（最下层）放到下标 3，就是放到最上层。
    expect(order(moveLayer(template, 'a', 3))).toEqual(['b', 'c', 'd', 'a']);
    expect(order(moveLayer(template, 'd', 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(moveLayer(template, 'b', 1)).toBe(template);
    expect(moveLayer(template, 'missing', 0)).toBe(template);
  });
});

describe('duplicateElements', () => {
  test('copies the selection in one step, offset and selected', () => {
    const template = canvas(rect('a', 10, 10, 10, 5));
    const duplicated = duplicateElements(template, ['a']);
    expect(duplicated.ids).toEqual(['e1']);
    expect(duplicated.template.elements[1]).toMatchObject({ x: 12, y: 12, name: '矩形 2' });
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

  test('keeps the spacing of a pasted group when it lands at the paper edge', () => {
    // 这组贴着纸的右边：单独把每个元素往回收会挤掉间距（旧 bug：a 挪到 42、b 被收回到 50，叠在一起）。
    const atEdge = canvas(rect('a', 40, 10, 10, 5), rect('b', 50, 10, 10, 5));
    const pasted = pasteElements(atEdge, copyElements(atEdge, ['a', 'b']));
    expect(boxes(pasted.template).slice(2)).toEqual([
      { id: 'e1', x: 40, y: 12, width: 10, height: 5 },
      { id: 'e2', x: 50, y: 12, width: 10, height: 5 },
    ]);
  });

  test('skips a pasted image that would push the template over the image budget, and counts it', () => {
    function image(id: string, bytes: number): CanvasElement {
      return { ...newCanvasElement('image', id, PAPER), pixelWidth: bytes, pixelHeight: 1 } as CanvasElement;
    }
    const template = canvas(image('a', CANVAS_LIMITS.templateImageBytes - 150));
    const clip = [image('b', 100), image('c', 100)];
    const pasted = pasteElements(template, clip);
    expect(pasted.ids).toHaveLength(1);
    expect(pasted.skippedImages).toBe(1);
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

  test('does not select an element that only touches the rectangle at the edge', () => {
    const template = canvas(rect('a', 10, 10, 10, 5));
    expect(elementsInRect(template, { x: 20, y: 10, width: 10, height: 5 })).toEqual([]);
  });
});

/** 递归冻结，用来确认编辑函数不会改动传进去的对象（它们应当只读输入、返回新的结构）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.values(value as Record<string, unknown>)) {
      deepFreeze(key);
    }
  }
  return value;
}

describe('inputs stay untouched', () => {
  test('editing functions do not mutate the template or clipboard they are given', () => {
    const template = deepFreeze(canvas(rect('a', 10, 10, 10, 5), rect('b', 30, 20, 10, 5)));
    expect(() => moveBy(template, ['a', 'b'], 5, 5)).not.toThrow();
    expect(() => rotateElement(template, 'a', 90)).not.toThrow();
    expect(() => addElement(template, 'text')).not.toThrow();
    expect(() => deleteElements(template, ['a'])).not.toThrow();
    expect(() => alignElements(template, ['a', 'b'], 'left')).not.toThrow();
    expect(() => distributeElements(template, ['a', 'b'], 'horizontal')).not.toThrow();
    expect(() => bringToFront(template, ['a'])).not.toThrow();
    expect(() => elementsInRect(template, { x: 0, y: 0, width: 60, height: 40 })).not.toThrow();
    const clip = deepFreeze(copyElements(template, ['a']));
    expect(() => pasteElements(template, clip)).not.toThrow();
  });
});
