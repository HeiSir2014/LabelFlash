import { describe, expect, test } from 'bun:test';
import { TEMPLATE_LIBRARY } from '../../core/templates/library/template-library';
import { renderLibraryPreviews } from './library-previews';

const PRINTED_AT = new Date(2026, 9, 2, 9, 5).getTime();

describe('renderLibraryPreviews', () => {
  test('lists every library template in order with its sample laid out', () => {
    const previews = renderLibraryPreviews(TEMPLATE_LIBRARY, PRINTED_AT);
    expect(previews.map((preview) => preview.id)).toEqual(TEMPLATE_LIBRARY.map((entry) => entry.template.id));
    const [first] = previews;
    expect(first).toMatchObject({
      id: 'library:garment-sample-tag',
      category: 'garment',
      name: '样衣吊牌',
      paper: { widthMm: 60, heightMm: 40 },
      sampleContent: 'CL5640-TK-图片色-XL',
    });
    expect(first?.html).toContain('CL5640-TK');
    expect(first?.html).toContain('shape-rendering="crispEdges"');
  });

  test('hands out copies of the paper, not the library objects', () => {
    const [entry] = TEMPLATE_LIBRARY;
    const [preview] = renderLibraryPreviews(TEMPLATE_LIBRARY, PRINTED_AT);
    expect(preview?.paper).toEqual(entry?.template.paper);
    expect(preview?.paper).not.toBe(entry?.template.paper);
  });
});
