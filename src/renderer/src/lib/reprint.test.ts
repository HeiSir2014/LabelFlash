import { describe, expect, test } from 'bun:test';
import { templateFingerprint } from '../../../core/api/template-fields';
import { PDF_PIECE_RETENTION_MS } from '../../../core/pdf/pdf-model';
import { PICK_TEMPLATE } from '../../../core/testing/templates';
import type { JobRecord } from '../../../core/types';
import { canReprint, reprintMode } from './reprint';

const NOW = 1_800_000_000_000;
const BASE: JobRecord = {
  id: 'j',
  createdAt: 1,
  raw: 'A001',
  printerName: 'P',
  source: 'desktop',
  status: 'printed',
  forced: false,
};
const API_JOB: JobRecord = {
  ...BASE,
  source: 'api',
  templateId: 'custom:t',
  fields: [{ name: 'a', value: 'b' }],
  templateFingerprint: templateFingerprint(PICK_TEMPLATE),
};
const allTemplates = () => PICK_TEMPLATE;

describe('reprintMode', () => {
  // 本机接口的记录没有识别规则可用：按当时的模板和字段预览、重打。
  test('uses the stored template and fields for api jobs', () => {
    expect(reprintMode(API_JOB, allTemplates, NOW)).toBe('stored');
  });

  test('re-recognises scans, as before', () => {
    expect(
      reprintMode({ ...BASE, templateId: 'builtin:generic', fields: [{ name: 'a', value: 'b' }] }, allTemplates, NOW),
    ).toBe('rescan');
  });

  // 从本机接口记录重打出来的那一张（来源是记录重打）同样按字段重打。
  test('treats a reprint of an api job like the api job', () => {
    expect(reprintMode({ ...API_JOB, source: 'history', caller: 'key:k1' }, allTemplates, NOW)).toBe('stored');
  });

  test('cannot reprint an api job whose template was deleted', () => {
    expect(reprintMode(API_JOB, (id) => (id === 'custom:t' ? undefined : PICK_TEMPLATE), NOW)).toBe('unavailable');
  });

  // 编号没变、字段或纸张改过：不按旧样子重打，说明原因。
  test('refuses a stored reprint when the template changed since the record', () => {
    const changed = { ...PICK_TEMPLATE, paper: { widthMm: 100, heightMm: 150 } };
    expect(reprintMode(API_JOB, () => changed, NOW)).toBe('template-changed');
    expect(canReprint('template-changed')).toBe(false);
  });

  test('reprints records written before fingerprints were stored with the current template', () => {
    const { templateFingerprint: _omitted, ...older } = API_JOB;
    const changed = { ...PICK_TEMPLATE, paper: { widthMm: 100, heightMm: 150 } };
    expect(reprintMode(older, () => changed, NOW)).toBe('stored');
  });

  test('cannot reprint an api job that has no stored fields', () => {
    expect(reprintMode({ ...BASE, source: 'api' }, allTemplates, NOW)).toBe('unavailable');
  });

  test('cannot reprint content no rule recognised', () => {
    expect(reprintMode({ ...BASE, status: 'invalid' }, allTemplates, NOW)).toBe('unavailable');
  });

  // 批量打的记录没有识别规则可用，和本机接口一样按当时的模板和字段。
  test('uses the stored template and fields for batch jobs', () => {
    const batchJob: JobRecord = {
      ...API_JOB,
      source: 'batch',
      batch: { id: '20261002-143501-a1b2', row: 1, copy: 1 },
    };
    expect(reprintMode(batchJob, allTemplates, NOW)).toBe('stored');
    expect(reprintMode({ ...batchJob, source: 'history' }, allTemplates, NOW)).toBe('stored');
  });

  test('reprints PDF pieces from the cached bitmap for a week, then explains they expired', () => {
    const pdfJob: JobRecord = {
      id: 'p1',
      createdAt: NOW,
      raw: '面单.pdf 第 1 页第 1 张',
      printerName: 'P',
      source: 'pdf',
      status: 'printed',
      forced: false,
      paper: '100x150',
      templateId: 'builtin:pdf-piece',
      fields: [],
      pdf: { file: '面单.pdf', page: 1, piece: 1, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    };
    const noTemplates = () => undefined;
    expect(reprintMode(pdfJob, noTemplates, NOW + 1)).toBe('stored');
    expect(reprintMode({ ...pdfJob, source: 'history' }, noTemplates, NOW + 1)).toBe('stored');
    expect(reprintMode(pdfJob, noTemplates, NOW + PDF_PIECE_RETENTION_MS)).toBe('expired');
    expect(reprintMode({ ...pdfJob, status: 'invalid' }, noTemplates, NOW)).toBe('unavailable');
  });

  test('offers the reprint buttons only when a reprint can happen', () => {
    expect(canReprint('rescan')).toBe(true);
    expect(canReprint('stored')).toBe(true);
    expect(canReprint('expired')).toBe(false);
    expect(canReprint('unavailable')).toBe(false);
  });
});
