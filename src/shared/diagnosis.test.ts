import { describe, expect, test } from 'bun:test';
import { DIAGNOSIS_CHECKS, DIAGNOSIS_FIXES, isDiagnosisCheckId, isDiagnosisFixId, RECHECK_AFTER } from './diagnosis';

describe('diagnosis ids', () => {
  // 后台打印服务停了，系统列不出打印机、读不到队列：先查它，后面几项的「查不到」才说得清原因。
  test('checks the print service first', () => {
    expect(DIAGNOSIS_CHECKS[0]).toBe('spooler');
  });

  test('accepts only known checks and fixes', () => {
    expect(isDiagnosisCheckId('queue')).toBe(true);
    expect(isDiagnosisCheckId('__proto__')).toBe(false);
    expect(isDiagnosisFixId('cancel-all-jobs')).toBe(true);
    // 「改指令集」只在界面里发生，主进程的修复通道不收它。
    expect(isDiagnosisFixId('change-command-set')).toBe(false);
    expect(isDiagnosisFixId(1)).toBe(false);
  });

  test('rechecks only existing checks after a fix', () => {
    for (const fix of DIAGNOSIS_FIXES) {
      for (const check of RECHECK_AFTER[fix]) {
        expect(DIAGNOSIS_CHECKS).toContain(check);
      }
    }
  });
});
