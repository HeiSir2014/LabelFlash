import { describe, expect, test } from 'bun:test';
import { createGpuCrashHandler, PendingRelaunch, SOFTWARE_RENDERING_SWITCH } from './gpu-fallback';

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

describe('PendingRelaunch', () => {
  test('relaunches only once the quit is certain', () => {
    const pending = new PendingRelaunch();
    const relaunched: string[][] = [];
    pending.request(['.', SOFTWARE_RENDERING_SWITCH]);
    expect(relaunched).toEqual([]);
    pending.commit((args) => relaunched.push(args));
    pending.commit((args) => relaunched.push(args));
    expect(relaunched).toEqual([['.', SOFTWARE_RENDERING_SWITCH]]);
  });

  test('forgets the relaunch when the operator cancels the quit prompt', () => {
    const pending = new PendingRelaunch();
    const relaunched: string[][] = [];
    pending.request(['.', SOFTWARE_RENDERING_SWITCH]);
    pending.cancel();
    pending.commit((args) => relaunched.push(args));
    expect(relaunched).toEqual([]);
  });

  test('does nothing on a plain quit', () => {
    const relaunched: string[][] = [];
    new PendingRelaunch().commit((args) => relaunched.push(args));
    expect(relaunched).toEqual([]);
  });
});
