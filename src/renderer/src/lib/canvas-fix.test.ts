import { describe, expect, test } from 'bun:test';
import { type CanvasElement, type CanvasTemplate, newCanvasElement } from '../../../core/templates/canvas-model';
import type { ElementWarning } from '../../../shared/render-warnings';
import { growToPrint } from './canvas-fix';

const PAPER = { widthMm: 60, heightMm: 40 };

function canvas(...elements: CanvasElement[]): CanvasTemplate {
  return { kind: 'canvas', id: 'custom:t', name: 't', paper: PAPER, printer: null, elements };
}

const barcode: CanvasElement = { ...newCanvasElement('barcode', 'b', PAPER), x: 2, y: 25, width: 38, height: 12 };

function warning(patch: Partial<ElementWarning>): ElementWarning {
  return {
    elementId: 'b',
    level: 'omitted',
    text: '条码「条码」不印',
    short: '条码不印：框不够宽',
    minWidthMm: null,
    minHeightMm: null,
    ...patch,
  };
}

describe('growToPrint', () => {
  test('widens the element to the minimum width, keeping its position', () => {
    const result = growToPrint(canvas(barcode), warning({ minWidthMm: 40.5 }));
    expect(result.status).toBe('grown');
    expect(result.status === 'grown' && result.template.elements[0]).toMatchObject({ x: 2, width: 40.5, height: 12 });
  });

  test('raises the height when the minimum is a height', () => {
    const result = growToPrint(canvas(barcode), warning({ minHeightMm: 14.2 }));
    expect(result.status === 'grown' && result.template.elements[0]).toMatchObject({ width: 38, height: 14.2 });
  });

  test('moves the element back onto the paper when growing would push it off the edge', () => {
    const atEdge = { ...barcode, x: 20 };
    const result = growToPrint(canvas(atEdge), warning({ minWidthMm: 45 }));
    expect(result.status === 'grown' && result.template.elements[0]).toMatchObject({ x: 15, width: 45 });
  });

  test('says the paper is too small when the minimum does not fit on it', () => {
    expect(growToPrint(canvas(barcode), warning({ minWidthMm: 61 })).status).toBe('paper-too-small');
  });

  test('has nothing to do without a minimum size or when the element is gone', () => {
    expect(growToPrint(canvas(barcode), warning({})).status).toBe('nothing-to-grow');
    expect(growToPrint(canvas(), warning({ minWidthMm: 40 })).status).toBe('nothing-to-grow');
  });

  test('never shrinks an element that is already larger than the minimum', () => {
    expect(growToPrint(canvas(barcode), warning({ minWidthMm: 30 })).status).toBe('nothing-to-grow');
  });
});
