import { describe, expect, test } from 'bun:test';
import type { BatchPlan } from '../core/batch/batch-model';
import type { PdfLayout } from '../core/pdf/pdf-model';
import { TEMPLATE_LIMITS } from '../core/templates/template-model';
import {
  driverInstallBlocksUpdate,
  MAX_IPC_STRING_LENGTH,
  MAX_RAW_INPUT_LENGTH,
  requireApiKeyId,
  requireApiKeyName,
  requireBatchId,
  requireBatchPlan,
  requireBoolean,
  requireBytes,
  requireDiagnosisCheck,
  requireDiagnosisFixRequest,
  requireDriverDeviceKey,
  requireIndex,
  requireJobQuery,
  requireLibraryTemplateId,
  requireLookupTableId,
  requireMobilePhoneId,
  requirePaperKey,
  requirePdfLayout,
  requirePdfPrintRequest,
  requirePieceId,
  requirePositiveInteger,
  requirePrinterAction,
  requirePrinterCommandConfig,
  requirePrintOptions,
  requireRaw,
  requireRuleId,
  requireRuleIds,
  requireRuleKind,
  requireRunId,
  requireSecretName,
  requireSettingsPatch,
  requireString,
  requireTemplateId,
  requireUnsavedTemplateName,
  requireVoiceCue,
  requireWebhookId,
  requireWebOrigin,
} from './ipc-validators';
import { UNSAVED_TEMPLATE_FALLBACK_NAME } from './template-quit';

describe('requireUnsavedTemplateName', () => {
  test('accepts null (nothing unsaved) or a template name within the name limit', () => {
    expect(requireUnsavedTemplateName(null)).toBeNull();
    expect(requireUnsavedTemplateName('吊牌')).toBe('吊牌');
    expect(requireUnsavedTemplateName('')).toBe('');
  });

  // 宁可多问一次，也不能因为名字不合规就当作「没有没保存的修改」，退出时悄悄丢掉。
  test('treats anything else, including an over-long name, as unsaved under a fallback name', () => {
    expect(requireUnsavedTemplateName(undefined)).toBe(UNSAVED_TEMPLATE_FALLBACK_NAME);
    expect(requireUnsavedTemplateName(3)).toBe(UNSAVED_TEMPLATE_FALLBACK_NAME);
    expect(requireUnsavedTemplateName('长'.repeat(TEMPLATE_LIMITS.nameLength + 1))).toBe(
      UNSAVED_TEMPLATE_FALLBACK_NAME,
    );
  });
});

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

  test('PDF layouts, print requests, run ids and piece ids are checked', () => {
    const layout: PdfLayout = { paperKey: '100x150', crop: 'split', boxes: [], mono: 'threshold', threshold: 128 };
    expect(requirePdfLayout(layout)).toEqual(layout);
    expect(() => requirePdfLayout({ ...layout, crop: 'x' })).toThrow('Invalid PDF layout');
    const runId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(requirePdfPrintRequest({ runId, pieceIds: ['1-1'], copies: 1 })).toEqual({
      runId,
      pieceIds: ['1-1'],
      copies: 1,
    });
    expect(() => requirePdfPrintRequest({ runId, pieceIds: [], copies: 1 })).toThrow('Invalid PDF print request');
    expect(requireRunId(runId)).toBe(runId);
    expect(() => requireRunId('x')).toThrow('Invalid PDF run id');
    expect(requirePieceId('2-3')).toBe('2-3');
    expect(() => requirePieceId('../x')).toThrow('Invalid PDF piece id');
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

describe('driverInstallBlocksUpdate', () => {
  test('blocks installing an update while a driver install is running', () => {
    expect(driverInstallBlocksUpdate(true)).toContain('正在安装驱动');
  });

  test('allows installing an update when no driver install is running', () => {
    expect(driverInstallBlocksUpdate(false)).toBeNull();
  });
});

describe('diagnosis validators', () => {
  test('accepts only known checks', () => {
    expect(requireDiagnosisCheck('queue')).toBe('queue');
    expect(() => requireDiagnosisCheck('rm -rf')).toThrow('Invalid diagnosis check');
  });

  // M2：纸张不是请求的一部分（主进程自己按设置和模板查），渲染进程传了也不会被读取。
  test('parses a fix request without reading any paper from it, and rejects anything else', () => {
    expect(requireDiagnosisFixRequest({ printerName: '标签机A', fix: 'set-driver-paper', admin: true })).toEqual({
      printerName: '标签机A',
      fix: 'set-driver-paper',
      admin: true,
    });
    expect(requireDiagnosisFixRequest({ printerName: null, fix: 'restart-spooler', admin: true })).toEqual({
      printerName: null,
      fix: 'restart-spooler',
      admin: true,
    });
    expect(() => requireDiagnosisFixRequest({ printerName: 'A', fix: 'change-command-set', admin: false })).toThrow(
      'Invalid diagnosis fix',
    );
    expect(() => requireDiagnosisFixRequest({ printerName: 'A', fix: 'feed', admin: 'yes' })).toThrow();
    expect(() => requireDiagnosisFixRequest([])).toThrow();
    // 多传的 paperKey 被忽略，不是校验错误，也不会出现在结果里。
    expect(
      requireDiagnosisFixRequest({ printerName: 'A', fix: 'feed', admin: false, paperKey: '60x40' }),
    ).not.toHaveProperty('paper');
  });
});
