import { describe, expect, test } from 'bun:test';
import { GENERIC_TEMPLATE } from '../../core/templates/builtin-templates';
import { apiPrinters } from './api-printers';

describe('apiPrinters', () => {
  test('describes each installed printer with the papers and templates it serves and its state', () => {
    const printers = apiPrinters({
      installed: [
        { name: 'P1', displayName: '标签机' },
        { name: 'P2', displayName: '面单机' },
      ],
      paperPrinters: { '60x40': 'P1', '100x180': 'P2', '70x50': 'Gone' },
      templates: [
        { ...GENERIC_TEMPLATE, id: 'custom:w', printer: 'P2' },
        { ...GENERIC_TEMPLATE, printer: null },
      ],
      readinessOf: (name) => (name === 'P2' ? { ready: false, detail: '缺纸', issue: 'paperOut' } : null),
    });
    expect(printers).toEqual([
      { name: 'P1', displayName: '标签机', papers: [{ widthMm: 60, heightMm: 40 }], templateIds: [], readiness: null },
      {
        name: 'P2',
        displayName: '面单机',
        papers: [{ widthMm: 100, heightMm: 180 }],
        templateIds: ['custom:w'],
        readiness: { ready: false, detail: '缺纸', issue: 'paperOut' },
      },
    ]);
  });
});
