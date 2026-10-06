import { describe, expect, test } from 'bun:test';
import { TEMPLATE_ID_PATTERN } from '../template-model';
import { LIBRARY_SAMPLE_RULE, LIBRARY_TEMPLATE_ID_PATTERN, libraryEntry, librarySampleScan } from './library-model';

const SPEC = {
  category: 'price',
  slug: 'price-simple',
  name: '简洁价签',
  description: '品名、大号价格、EAN-13',
  paper: { widthMm: 40, heightMm: 30 },
  elements: [],
  sample: { content: '6901234567892', fields: { 品名: '纯棉袜子', 价格: '12.80' } },
} as const;

describe('libraryEntry', () => {
  test('builds a canvas template with a library id and keeps the sample fields in order', () => {
    const entry = libraryEntry({ ...SPEC, elements: [] });
    expect(entry.template).toEqual({
      kind: 'canvas',
      id: 'library:price-simple',
      name: '简洁价签',
      paper: { widthMm: 40, heightMm: 30 },
      printer: null,
      elements: [],
    });
    expect(entry.sample).toEqual({
      content: '6901234567892',
      fields: [
        { name: '品名', value: '纯棉袜子' },
        { name: '价格', value: '12.80' },
      ],
    });
  });

  // 模板库的编号进不了模板列表：TEMPLATE_ID_PATTERN 只认 builtin: 和 custom:。
  test('uses ids the template list does not accept', () => {
    const { id } = libraryEntry({ ...SPEC, elements: [] }).template;
    expect(LIBRARY_TEMPLATE_ID_PATTERN.test(id)).toBe(true);
    expect(TEMPLATE_ID_PATTERN.test(id)).toBe(false);
  });

  test('fails fast on a slug that is not lowercase letters, digits and hyphens', () => {
    expect(() => libraryEntry({ ...SPEC, slug: 'Price Tag', elements: [] })).toThrow('library template slug');
  });
});

describe('librarySampleScan', () => {
  test('treats the sample as a scan by the library sample rule, on a copy of the fields', () => {
    const { sample } = libraryEntry({ ...SPEC, elements: [] });
    const scan = librarySampleScan(sample);
    expect(scan).toEqual({
      raw: '6901234567892',
      ruleId: LIBRARY_SAMPLE_RULE.id,
      ruleName: '模板库示例',
      fields: [
        { name: '品名', value: '纯棉袜子' },
        { name: '价格', value: '12.80' },
      ],
    });
    scan.fields[0] = { name: '品名', value: '改了' };
    expect(sample.fields[0]?.value).toBe('纯棉袜子');
  });
});
