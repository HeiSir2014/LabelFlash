import { describe, expect, test } from 'bun:test';
import type { BatchPlan } from '../core/batch/batch-model';
import {
  MAX_IPC_STRING_LENGTH,
  MAX_RAW_INPUT_LENGTH,
  requireApiKeyId,
  requireApiKeyName,
  requireBatchId,
  requireBatchPlan,
  requireBoolean,
  requireBytes,
  requireIndex,
  requireJobQuery,
  requireLibraryTemplateId,
  requireLookupTableId,
  requireMobilePhoneId,
  requirePaperKey,
  requirePositiveInteger,
  requirePrintOptions,
  requireRaw,
  requireRuleId,
  requireRuleIds,
  requireRuleKind,
  requireSecretName,
  requireString,
  requireTemplateId,
  requireVoiceCue,
  requireWebhookId,
  requireWebOrigin,
} from './ipc-validators';

describe('ipc validators', () => {
  test('requireString rejects non-strings and oversized input', () => {
    expect(requireString('CL1-红-36', 'raw')).toBe('CL1-红-36');
    expect(() => requireString(42, 'raw')).toThrow('Invalid raw');
    expect(() => requireString('x'.repeat(MAX_IPC_STRING_LENGTH + 1), 'raw')).toThrow(TypeError);
  });

  test('requireRaw leaves room for multi-line scans before normalising', () => {
    const multiLine = 'x\r\n'.repeat(MAX_IPC_STRING_LENGTH);
    expect(requireRaw(multiLine)).toBe(multiLine);
    expect(() => requireRaw('x'.repeat(MAX_RAW_INPUT_LENGTH + 1))).toThrow(TypeError);
  });

  test('rule ids, id lists and kinds are checked', () => {
    expect(requireRuleId('custom:abc-1')).toBe('custom:abc-1');
    expect(() => requireRuleId('other:x')).toThrow(TypeError);
    expect(requireRuleIds(['builtin:raw', 'custom:a'])).toEqual(['builtin:raw', 'custom:a']);
    expect(() => requireRuleIds(['builtin:raw', 3])).toThrow(TypeError);
    expect(() => requireRuleIds(Array.from({ length: 101 }, () => 'custom:a'))).toThrow(TypeError);
    expect(requireRuleKind('regex')).toBe('regex');
    expect(() => requireRuleKind('script')).toThrow(TypeError);
  });

  test('requirePositiveInteger and requireWebhookId reject anything else', () => {
    expect(requirePositiveInteger(3, 'id')).toBe(3);
    for (const bad of [0, -1, 1.5, '3', null]) {
      expect(() => requirePositiveInteger(bad, 'id')).toThrow(TypeError);
    }
    expect(requireWebhookId('w-1')).toBe('w-1');
    expect(() => requireWebhookId('a/b')).toThrow(TypeError);
  });

  test('requireLookupTableId accepts generated ids only', () => {
    expect(requireLookupTableId('3f2c9a1e-0b4d-4c55-9b0e-7d8f1a2b3c4d')).toBe('3f2c9a1e-0b4d-4c55-9b0e-7d8f1a2b3c4d');
    expect(() => requireLookupTableId('../x')).toThrow(TypeError);
    expect(() => requireLookupTableId(null)).toThrow(TypeError);
  });

  test('requirePrintOptions only allows renderer sources', () => {
    expect(requirePrintOptions({ source: 'history', force: true })).toEqual({ source: 'history', force: true });
    expect(() => requirePrintOptions({ source: 'mobile', force: false })).toThrow(TypeError);
    expect(() => requirePrintOptions({ source: 'desktop' })).toThrow(TypeError);
    expect(() => requirePrintOptions(null)).toThrow(TypeError);
  });

  test('requireJobQuery bounds the page size and checks optional fields', () => {
    expect(requireJobQuery({ limit: 100, search: 'CL', before: 7 })).toEqual({ limit: 100, search: 'CL', before: 7 });
    expect(requireJobQuery({ limit: 1 })).toEqual({ limit: 1, search: undefined, before: undefined });
    expect(() => requireJobQuery({ limit: 0 })).toThrow(TypeError);
    expect(() => requireJobQuery({ limit: 501 })).toThrow(TypeError);
    expect(() => requireJobQuery({ limit: 10, before: 1.5 })).toThrow(TypeError);
    expect(() => requireJobQuery({ limit: 10, search: 3 })).toThrow(TypeError);
    expect(requireJobQuery({ limit: 10, batchId: '20261002-143501-a1b2' }).batchId).toBe('20261002-143501-a1b2');
    expect(() => requireJobQuery({ limit: 10, batchId: 'x' })).toThrow('Invalid job query batch');
  });

  test('requirePaperKey accepts width x height keys only, in their normal form', () => {
    expect(requirePaperKey('100x180')).toBe('100x180');
    expect(() => requirePaperKey('100×180')).toThrow(TypeError);
    expect(() => requirePaperKey('0x40')).toThrow(TypeError);
    expect(() => requirePaperKey(60)).toThrow(TypeError);
  });

  test('requireTemplateId accepts built-in and custom ids only', () => {
    expect(requireTemplateId('builtin:generic')).toBe('builtin:generic');
    expect(requireTemplateId('custom:3f2c9a1e-0b4d-4c55-9b0e-7d8f1a2b3c4d')).toBe(
      'custom:3f2c9a1e-0b4d-4c55-9b0e-7d8f1a2b3c4d',
    );
    expect(() => requireTemplateId('../../etc')).toThrow(TypeError);
    expect(() => requireTemplateId('custom:')).toThrow(TypeError);
  });

  test('requireLibraryTemplateId accepts library ids only', () => {
    expect(requireLibraryTemplateId('library:price-simple')).toBe('library:price-simple');
    expect(() => requireLibraryTemplateId('custom:abc')).toThrow(TypeError);
    expect(() => requireLibraryTemplateId('library:../x')).toThrow(TypeError);
    expect(() => requireLibraryTemplateId(42)).toThrow(TypeError);
  });

  test('requireVoiceCue accepts known cues only', () => {
    expect(requireVoiceCue('printed')).toBe('printed');
    expect(() => requireVoiceCue('rm -rf')).toThrow(TypeError);
    expect(() => requireVoiceCue(1)).toThrow(TypeError);
  });

  test('requireBoolean accepts true and false only', () => {
    expect(requireBoolean(false, 'locked')).toBe(false);
    expect(() => requireBoolean('false', 'locked')).toThrow('Invalid locked');
  });

  test('requireMobilePhoneId accepts the random ids the desktop hands out only', () => {
    expect(requireMobilePhoneId('PhonePhonePhonePhone01')).toBe('PhonePhonePhonePhone01');
    expect(() => requireMobilePhoneId('p1')).toThrow(TypeError);
    expect(() => requireMobilePhoneId(1)).toThrow(TypeError);
  });

  test('requireSecretName accepts names that fit in a {密钥:名称} reference only', () => {
    expect(requireSecretName('仓库接口')).toBe('仓库接口');
    expect(() => requireSecretName('')).toThrow(TypeError);
    expect(() => requireSecretName('a}b')).toThrow(TypeError);
    expect(() => requireSecretName(1)).toThrow(TypeError);
  });

  test('requireApiKeyId accepts the UUIDs keys are created with only', () => {
    expect(requireApiKeyId('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
    expect(() => requireApiKeyId('k1')).toThrow(TypeError);
    expect(() => requireApiKeyId(1)).toThrow(TypeError);
  });

  test('requireApiKeyName trims a name and rejects empty or control-character names', () => {
    expect(requireApiKeyName(' ERP ')).toBe('ERP');
    expect(() => requireApiKeyName('  ')).toThrow(TypeError);
    expect(() => requireApiKeyName('a\nb')).toThrow(TypeError);
  });

  test('requireWebOrigin accepts http and https origins only', () => {
    expect(requireWebOrigin('https://erp.example.com')).toBe('https://erp.example.com');
    expect(() => requireWebOrigin('null')).toThrow(TypeError);
    expect(() => requireWebOrigin(7)).toThrow(TypeError);
  });

  test('batch plans, ids, byte arrays and row indexes are checked', () => {
    const plan: BatchPlan = {
      templateId: 'builtin:generic',
      data: { kind: 'serial-only', count: 3 },
      mapping: {},
      serial: { enabled: true, prefix: '', start: 1, step: 1, digits: 0, suffix: '', column: null },
      copies: { kind: 'fixed', count: 1 },
      rows: null,
    };
    expect(requireBatchPlan(plan)).toEqual(plan);
    expect(() => requireBatchPlan({ ...plan, templateId: 'x' })).toThrow('Invalid batch plan');
    expect(requireBatchId('20261002-143501-a1b2')).toBe('20261002-143501-a1b2');
    expect(() => requireBatchId('20261002')).toThrow('Invalid batch id');
    expect(requireBytes(new Uint8Array(2), 'file', 2)).toHaveLength(2);
    expect(() => requireBytes(new Uint8Array(3), 'file', 2)).toThrow('Invalid file');
    expect(() => requireBytes('abc', 'file', 2)).toThrow('Invalid file');
    expect(requireIndex(0, 'row index')).toBe(0);
    expect(() => requireIndex(-1, 'row index')).toThrow('Invalid row index');
    expect(() => requireIndex(1.5, 'row index')).toThrow('Invalid row index');
  });
});
