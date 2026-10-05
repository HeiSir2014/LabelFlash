import { describe, expect, test } from 'bun:test';
import {
  MAX_IPC_STRING_LENGTH,
  MAX_RAW_INPUT_LENGTH,
  requireApiKeyId,
  requireApiKeyName,
  requireBoolean,
  requireDriverDeviceKey,
  requireJobQuery,
  requireLookupTableId,
  requireMobilePhoneId,
  requirePaperKey,
  requirePositiveInteger,
  requirePrinterAction,
  requirePrinterCommandConfig,
  requirePrintOptions,
  requireRaw,
  requireRuleId,
  requireRuleIds,
  requireRuleKind,
  requireSecretName,
  requireSettingsPatch,
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

  test('requirePrinterCommandConfig accepts only a complete, valid config', () => {
    const config = {
      commandSet: 'zpl',
      density: 30,
      speed: 6,
      media: null,
      orientation: 'normal',
      finish: 'peel',
      dpi: 300,
    } as const;
    expect(requirePrinterCommandConfig(config)).toEqual(config);
    expect(() => requirePrinterCommandConfig({ ...config, density: 31 })).toThrow('Invalid printer command config');
    expect(() => requirePrinterCommandConfig({ commandSet: 'zpl' })).toThrow('Invalid printer command config');
    expect(() => requirePrinterCommandConfig('zpl')).toThrow('Invalid printer command config');
  });

  test('requirePrinterAction accepts the four actions only', () => {
    expect(requirePrinterAction('factoryReset')).toBe('factoryReset');
    expect(() => requirePrinterAction('raw')).toThrow('Invalid printer action');
  });

  // printerCommands 只能经 printer:commands-apply 的严格校验写入；settings:update 要把它挡在外面，
  // 不然界面可以绕过指令集范围检查、绕过「只发给系统里有的打印机」的核对，直接把任意内容写进设置表。
  test('requireSettingsPatch strips printerCommands but keeps other keys', () => {
    const patch = { autoPrint: false, printerCommands: { 标签机A: { commandSet: 'tspl' } } };
    expect(requireSettingsPatch(patch)).toEqual({ autoPrint: false });
    expect(() => requireSettingsPatch('x')).toThrow(TypeError);
  });
});

describe('requireDriverDeviceKey', () => {
  test('accepts device keys and rejects anything else', () => {
    expect(requireDriverDeviceKey('usb-1234-abcd-0a1b2c3d')).toBe('usb-1234-abcd-0a1b2c3d');
    expect(() => requireDriverDeviceKey('https://example.invalid/x.exe')).toThrow();
    expect(() => requireDriverDeviceKey(7)).toThrow();
  });
});
