import { describe, expect, test } from 'bun:test';
import {
  MAX_IPC_STRING_LENGTH,
  requireJobQuery,
  requirePrintOptions,
  requireString,
  requireTemplateId,
  requireVoiceCue,
} from './ipc-validators';

describe('ipc validators', () => {
  test('requireString rejects non-strings and oversized input', () => {
    expect(requireString('CL1-红-36', 'raw')).toBe('CL1-红-36');
    expect(() => requireString(42, 'raw')).toThrow('Invalid raw');
    expect(() => requireString('x'.repeat(MAX_IPC_STRING_LENGTH + 1), 'raw')).toThrow(TypeError);
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
  });

  test('requireTemplateId accepts built-in and custom ids only', () => {
    expect(requireTemplateId('builtin:standard')).toBe('builtin:standard');
    expect(requireTemplateId('custom:3f2c9a1e-0b4d-4c55-9b0e-7d8f1a2b3c4d')).toBe(
      'custom:3f2c9a1e-0b4d-4c55-9b0e-7d8f1a2b3c4d',
    );
    expect(() => requireTemplateId('../../etc')).toThrow(TypeError);
    expect(() => requireTemplateId('custom:')).toThrow(TypeError);
  });

  test('requireVoiceCue accepts known cues only', () => {
    expect(requireVoiceCue('printed')).toBe('printed');
    expect(() => requireVoiceCue('rm -rf')).toThrow(TypeError);
    expect(() => requireVoiceCue(1)).toThrow(TypeError);
  });
});
