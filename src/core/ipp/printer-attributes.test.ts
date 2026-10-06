import { describe, expect, test } from 'bun:test';
import { findAttribute, integerValue, stringValue, stringValues } from './ipp-attributes';
import { OPERATIONS } from './ipp-constants';
import { type PrinterContext, printerAttributes, selectAttributes, urfSupported } from './printer-attributes';
import { TEST_MORE_INFO_URI, TEST_PRINTER_URI, testPrinter } from './testing/ipp-requests';

const CONTEXT: PrinterContext = {
  printerUri: TEST_PRINTER_URI,
  moreInfoUri: TEST_MORE_INFO_URI,
  authentication: 'none',
  upTimeSeconds: 42,
  nowMs: Date.UTC(2026, 9, 2),
};

/** RFC 8011 §5.4 要求每台打印机都有的属性。 */
const RFC_8011_REQUIRED = [
  'charset-configured',
  'charset-supported',
  'compression-supported',
  'document-format-default',
  'document-format-supported',
  'generated-natural-language-supported',
  'ipp-versions-supported',
  'natural-language-configured',
  'operations-supported',
  'pdl-override-supported',
  'printer-is-accepting-jobs',
  'printer-name',
  'printer-state',
  'printer-state-reasons',
  'printer-up-time',
  'printer-uri-supported',
  'queued-job-count',
  'uri-authentication-supported',
  'uri-security-supported',
];

/** 免驱添加（Windows 的 IPP 类驱动、系统自带的打印）要看的。 */
const DRIVERLESS = [
  'ipp-features-supported',
  'media-col-default',
  'media-col-ready',
  'media-size-supported',
  'printer-device-id',
  'printer-uuid',
  'pwg-raster-document-resolution-supported',
  'pwg-raster-document-sheet-back',
  'pwg-raster-document-type-supported',
  'urf-supported',
  'print-color-mode-supported',
  'sides-supported',
];

describe('printerAttributes', () => {
  const all = printerAttributes(testPrinter(), CONTEXT);

  test('has every attribute RFC 8011 requires and those driverless clients look for', () => {
    const names = all.map((attribute) => attribute.name);
    for (const name of [...RFC_8011_REQUIRED, ...DRIVERLESS]) {
      expect(names).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  test('describes the shared paper, formats and operations', () => {
    expect(stringValue(findAttribute(all, 'printer-name'))).toBe('60×40 标签');
    expect(stringValue(findAttribute(all, 'media-default'))).toBe('om_label-60x40_60x40mm');
    expect(stringValues(findAttribute(all, 'document-format-supported'))).toEqual([
      'application/octet-stream',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/pwg-raster',
      'image/urf',
    ]);
    expect(findAttribute(all, 'operations-supported')?.values).toHaveLength(Object.keys(OPERATIONS).length);
    expect(stringValues(findAttribute(all, 'urf-supported'))).toEqual(urfSupported(203));
    expect(stringValue(findAttribute(all, 'printer-uri-supported'))).toBe(TEST_PRINTER_URI);
    expect(integerValue(findAttribute(all, 'printer-up-time'))).toBe(42);
  });

  test('describes the paper size in hundredths of a millimetre with no margins', () => {
    const [mediaCol] = findAttribute(all, 'media-col-default')?.values ?? [];
    expect(mediaCol?.kind === 'collection' ? mediaCol.members.map((member) => member.name) : []).toEqual([
      'media-size',
      'media-bottom-margin',
      'media-left-margin',
      'media-right-margin',
      'media-top-margin',
      'media-source',
      'media-type',
    ]);
    const [size] = findAttribute(all, 'media-size-supported')?.values ?? [];
    expect(size).toEqual({
      kind: 'collection',
      members: [
        { name: 'x-dimension', values: [{ kind: 'integer', value: 6000 }] },
        { name: 'y-dimension', values: [{ kind: 'integer', value: 4000 }] },
      ],
    });
  });

  test('asks for the share password once one is set', () => {
    const basic = printerAttributes(testPrinter(), { ...CONTEXT, authentication: 'basic' });
    expect(stringValue(findAttribute(basic, 'uri-authentication-supported'))).toBe('basic');
  });

  test('reports a stopped printer and its reasons', () => {
    const stopped = printerAttributes(
      testPrinter({ state: { state: 'stopped', reasons: ['media-empty-error'], message: '缺纸' } }),
      CONTEXT,
    );
    expect(integerValue(findAttribute(stopped, 'printer-state'))).toBe(5);
    expect(stringValues(findAttribute(stopped, 'printer-state-reasons'))).toEqual(['media-empty-error']);
  });
});

describe('selectAttributes', () => {
  const all = printerAttributes(testPrinter(), CONTEXT);
  const names = (requested: string[] | null) => selectAttributes(all, requested).map((attribute) => attribute.name);

  test('returns everything but the media database by default', () => {
    expect(names(null)).not.toContain('media-col-database');
    expect(names(null)).toHaveLength(all.length - 1);
    expect(names(['all', 'media-col-database'])).toHaveLength(all.length);
  });

  test('returns only job template attributes for job-template', () => {
    const template = names(['job-template']);
    expect(template).toContain('copies-supported');
    expect(template).toContain('media-col-default');
    expect(template).not.toContain('printer-name');
  });

  test('returns named attributes', () => {
    expect(names(['printer-name', 'printer-state'])).toEqual(['printer-name', 'printer-state']);
  });
});
