import { describe, expect, test } from 'bun:test';
import { DIAGNOSIS_FIXES } from '../../shared/diagnosis';
import type { DiagnosisFixRequest } from './diagnosis-model';
import { adminPolicy, fixOutcome, offerFor } from './fixes';

const REQUEST: DiagnosisFixRequest = { printerName: '标签机A', fix: 'cancel-all-jobs', admin: true, paper: null };

describe('adminPolicy', () => {
  test('asks for admin rights exactly where the system requires them', () => {
    expect(adminPolicy('windows', 'restart-spooler')).toBe('always');
    expect(adminPolicy('windows', 'cancel-own-jobs')).toBe('never');
    expect(adminPolicy('mac', 'enable-printer')).toBe('optional');
    expect(adminPolicy('mac', 'set-driver-paper')).toBe('optional');
  });

  test('offers no fix the platform cannot do', () => {
    expect(adminPolicy('windows', 'enable-printer')).toBe('unsupported');
    expect(adminPolicy('mac', 'open-queue')).toBe('unsupported');
    for (const fix of DIAGNOSIS_FIXES) {
      expect(adminPolicy('other', fix)).toBe('unsupported');
    }
  });
});

describe('offerFor', () => {
  test('marks every admin button the same way on both platforms', () => {
    expect(offerFor('windows', 'cancel-all-jobs')).toEqual({
      id: 'cancel-all-jobs',
      label: '清除全部任务（需要管理员权限）',
      admin: true,
    });
    expect(offerFor('mac', 'cancel-all-jobs')?.label).toBe('清除全部任务（需要管理员权限）');
    expect(offerFor('mac', 'set-driver-paper')).toEqual({
      id: 'set-driver-paper',
      label: '自动设置驱动纸张',
      admin: false,
    });
    expect(offerFor('mac', 'set-driver-paper', true)?.label).toBe('自动设置驱动纸张（需要管理员权限）');
    expect(offerFor('mac', 'open-queue')).toBeNull();
    expect(offerFor('windows', 'change-command-set')).toEqual({
      id: 'change-command-set',
      label: '改指令集',
      admin: false,
    });
  });
});

describe('fixOutcome', () => {
  test('says what was done, not that the problem is solved', () => {
    expect(
      fixOutcome('windows', { ...REQUEST, fix: 'cancel-own-jobs', admin: false }, { kind: 'done', count: 2 }),
    ).toEqual({
      status: 'done',
      message: '已请求取消本程序的 2 个任务',
    });
    expect(
      fixOutcome(
        'windows',
        { ...REQUEST, fix: 'set-driver-paper', paper: { widthMm: 60, heightMm: 40 } },
        { kind: 'done' },
      ).message,
    ).toBe('驱动默认纸张已设为 60×40mm');
  });

  test('turns a refusal into an admin button to retry with', () => {
    const outcome = fixOutcome('mac', { ...REQUEST, fix: 'enable-printer', admin: false }, { kind: 'needs-admin' });
    expect(outcome).toMatchObject({
      status: 'needs-admin',
      retry: { id: 'enable-printer', label: '恢复这台打印机（需要管理员权限）', admin: true },
    });
  });

  test('explains a declined prompt and a missing paper size without technical detail', () => {
    expect(fixOutcome('windows', REQUEST, { kind: 'declined' }).message).toContain('没有拿到管理员权限');
    expect(
      fixOutcome(
        'windows',
        { ...REQUEST, fix: 'set-driver-paper', paper: { widthMm: 60, heightMm: 40 } },
        {
          kind: 'no-matching-paper',
        },
      ),
    ).toEqual({
      status: 'failed',
      message: '驱动里没有 60×40mm 这种纸，也不能自定义尺寸：打开打印首选项，新建这种纸再选上',
    });
  });

  // 「驱动已重新安装」只能在 5c 的接缝确认装完、装成功（ActionResult 的 done）之后才出现；
  // 5c 的适配器把「已经开始安装」误当「已经做完」时，这里不能替它圆谎。
  test('only says the driver was reinstalled on a confirmed done, not on a declined or failed install', () => {
    const request = { ...REQUEST, fix: 'reinstall-driver' as const };
    expect(fixOutcome('windows', request, { kind: 'done' })).toEqual({
      status: 'done',
      message: '驱动已重新安装，正在重新检查',
    });
    expect(fixOutcome('windows', request, { kind: 'declined' }).message).not.toContain('驱动已重新安装');
    expect(fixOutcome('windows', request, { kind: 'failed', detail: 'download failed: 404' }).message).not.toContain(
      '驱动已重新安装',
    );
  });
});
