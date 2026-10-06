import { describe, expect, test } from 'bun:test';
import {
  FLOATING_CONTROL_COUNT,
  type FloatingTool,
  floatingToolbarPosition,
  floatingTools,
  nextTextAlign,
} from './canvas-float';

function controlCount(tools: readonly FloatingTool[]): number {
  return tools.reduce((sum, tool) => sum + FLOATING_CONTROL_COUNT[tool], 0);
}

describe('nextTextAlign', () => {
  // 工具条上的对齐是一个按钮：点一下换下一种，图标显示现在的。
  test('cycles left, centre, right', () => {
    expect(nextTextAlign('left')).toBe('center');
    expect(nextTextAlign('center')).toBe('right');
    expect(nextTextAlign('right')).toBe('left');
  });
});

describe('floatingTools', () => {
  // 工具条只放这一类最常用的几样（6–8 个按钮）；锁定、叠放、等距收在「⋯」里。
  test('gives text the font size, bold, alignment, edit, duplicate, delete and more', () => {
    const tools = floatingTools({ kinds: ['text'], canGrow: false });
    expect(tools).toEqual(['fontSize', 'bold', 'textAlign', 'editText', 'duplicate', 'delete', 'more']);
    expect(controlCount(tools)).toBe(8);
  });

  test('gives barcodes and QR codes the field binding, and the fix when they do not print', () => {
    expect(floatingTools({ kinds: ['barcode'], canGrow: false })).toEqual(['field', 'duplicate', 'delete', 'more']);
    expect(floatingTools({ kinds: ['qr'], canGrow: true })).toEqual(['field', 'grow', 'duplicate', 'delete', 'more']);
  });

  test('gives other elements duplicate, delete and more', () => {
    expect(floatingTools({ kinds: ['rect'], canGrow: false })).toEqual(['duplicate', 'delete', 'more']);
  });

  test('gives a multi-selection the alignment buttons, duplicate, delete and more', () => {
    expect(floatingTools({ kinds: ['text', 'qr'], canGrow: false })).toEqual([
      'alignElements',
      'duplicate',
      'delete',
      'more',
    ]);
  });
});

const BOUNDS = { left: -40, top: -60, right: 640, bottom: 460 };
const TOOLBAR = { width: 200, height: 40 };
const GAP = 16;

describe('floatingToolbarPosition', () => {
  test('sits centred above the selection, clear of its handles', () => {
    const position = floatingToolbarPosition({
      selection: { x: 100, y: 200, width: 100, height: 50 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(position).toEqual({ left: 50, top: 200 - GAP - 40, placement: 'above' });
  });

  test('goes below the selection when there is no room above', () => {
    const position = floatingToolbarPosition({
      selection: { x: 100, y: -30, width: 100, height: 50 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(position).toEqual({ left: 50, top: 20 + GAP, placement: 'below' });
  });

  test('keeps a larger gap below, where the rotation handle is', () => {
    const position = floatingToolbarPosition({
      selection: { x: 100, y: -30, width: 100, height: 50 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
      gapBelow: 40,
    });
    expect(position.top).toBe(20 + 40);
  });

  test('slides right past a floating control it would cover, such as the undo and redo buttons', () => {
    const history = { x: -30, y: -50, width: 100, height: 40 };
    const position = floatingToolbarPosition({
      selection: { x: 0, y: 30, width: 100, height: 20 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
      avoid: [history],
    });
    expect(position.left).toBe(history.x + history.width + 8);
  });

  // 工具条一行不折：右边放不下时往下让开，撤销重做按钮照样点得到。
  test('slides down past a control when there is no room to its right', () => {
    const history = { x: -30, y: -50, width: 100, height: 40 };
    const position = floatingToolbarPosition({
      selection: { x: 0, y: 30, width: 600, height: 20 },
      toolbar: { width: 660, height: 40 },
      bounds: BOUNDS,
      gap: GAP,
      avoid: [history],
    });
    expect(position.top).toBe(history.y + history.height + 8);
  });

  test('stays inside the area horizontally', () => {
    const atRight = floatingToolbarPosition({
      selection: { x: 600, y: 200, width: 30, height: 30 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(atRight.left).toBe(BOUNDS.right - TOOLBAR.width);
    const atLeft = floatingToolbarPosition({
      selection: { x: -20, y: 200, width: 10, height: 10 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(atLeft.left).toBe(BOUNDS.left);
  });

  test('pins to the top of the area when the selection fills it, rather than leaving the view', () => {
    const position = floatingToolbarPosition({
      selection: { x: 0, y: -50, width: 600, height: 500 },
      toolbar: TOOLBAR,
      bounds: BOUNDS,
      gap: GAP,
    });
    expect(position).toEqual({ left: 200, top: BOUNDS.top, placement: 'inside' });
  });
});
