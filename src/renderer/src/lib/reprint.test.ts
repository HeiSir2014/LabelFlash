import { describe, expect, test } from 'bun:test';
import type { JobRecord } from '../../../core/types';
import { reprintMode } from './reprint';

const BASE: JobRecord = {
  id: 'j',
  createdAt: 1,
  raw: 'A001',
  printerName: 'P',
  source: 'desktop',
  status: 'printed',
  forced: false,
};
const API_JOB: JobRecord = { ...BASE, source: 'api', templateId: 'custom:t', fields: [{ name: 'a', value: 'b' }] };
const allTemplates = () => true;

describe('reprintMode', () => {
  // 本机接口的记录没有识别规则可用：按当时的模板和字段预览、重打。
  test('uses the stored template and fields for api jobs', () => {
    expect(reprintMode(API_JOB, allTemplates)).toBe('stored');
  });

  test('re-recognises scans, as before', () => {
    expect(
      reprintMode({ ...BASE, templateId: 'builtin:generic', fields: [{ name: 'a', value: 'b' }] }, allTemplates),
    ).toBe('rescan');
  });

  // 从本机接口记录重打出来的那一张（来源是记录重打）同样按字段重打。
  test('treats a reprint of an api job like the api job', () => {
    expect(reprintMode({ ...API_JOB, source: 'history', caller: 'key:k1' }, allTemplates)).toBe('stored');
  });

  test('cannot reprint an api job whose template was deleted', () => {
    expect(reprintMode(API_JOB, (id) => id !== 'custom:t')).toBe('unavailable');
  });

  test('cannot reprint an api job that has no stored fields', () => {
    expect(reprintMode({ ...BASE, source: 'api' }, allTemplates)).toBe('unavailable');
  });

  test('cannot reprint content no rule recognised', () => {
    expect(reprintMode({ ...BASE, status: 'invalid' }, allTemplates)).toBe('unavailable');
  });

  // 批量打的记录没有识别规则可用，和本机接口一样按当时的模板和字段。
  test('uses the stored template and fields for batch jobs', () => {
    const batchJob: JobRecord = {
      ...API_JOB,
      source: 'batch',
      batch: { id: '20261002-143501-a1b2', row: 1, copy: 1 },
    };
    expect(reprintMode(batchJob, allTemplates)).toBe('stored');
    expect(reprintMode({ ...batchJob, source: 'history' }, allTemplates)).toBe('stored');
  });
});
