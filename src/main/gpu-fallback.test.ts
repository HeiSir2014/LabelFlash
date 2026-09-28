import { describe, expect, test } from 'bun:test';
import { createGpuCrashHandler, SOFTWARE_RENDERING_SWITCH } from './gpu-fallback';

const GPU_CRASH = { type: 'GPU', reason: 'crashed', exitCode: 1 };

function harness(options: { isSoftwareRendering?: boolean; canRelaunch?: boolean } = {}) {
  const relaunched: string[][] = [];
  let quitCount = 0;
  const handle = createGpuCrashHandler({
    isSoftwareRendering: options.isSoftwareRendering ?? false,
    args: ['.', '--flag'],
    canRelaunch: () => options.canRelaunch ?? true,
    relaunch: (args) => relaunched.push(args),
    quit: () => {
      quitCount += 1;
    },
    warn: () => {},
  });
  return { handle, relaunched, quits: () => quitCount };
}

describe('createGpuCrashHandler', () => {
  test('restarts once in software rendering when the GPU process dies', () => {
    const { handle, relaunched, quits } = harness();
    handle(GPU_CRASH);
    handle(GPU_CRASH);
    expect(relaunched).toEqual([['.', '--flag', SOFTWARE_RENDERING_SWITCH]]);
    expect(quits()).toBe(1);
  });

  test('ignores clean exits and other process types', () => {
    const { handle, relaunched } = harness();
    handle({ type: 'GPU', reason: 'clean-exit', exitCode: 0 });
    handle({ type: 'Utility', reason: 'crashed', exitCode: 1 });
    expect(relaunched).toEqual([]);
  });

  test('never loops once already in software rendering', () => {
    const { handle, relaunched } = harness({ isSoftwareRendering: true });
    handle(GPU_CRASH);
    expect(relaunched).toEqual([]);
  });

  test('does not relaunch while the app is quitting', () => {
    const { handle, relaunched } = harness({ canRelaunch: false });
    handle(GPU_CRASH);
    expect(relaunched).toEqual([]);
  });
});
