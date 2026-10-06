import { describe, expect, test } from 'bun:test';
import { runCommand } from './command-runner';

// 用 Bun 自己当被调用的程序：两个平台的 CI 上都有。
const BUN = process.execPath;
const OPTIONS = { timeoutMs: 5_000, maxOutputBytes: 1_024 };

describe('runCommand', () => {
  test('returns the exit code and output without a shell', async () => {
    const run = await runCommand(BUN, ['-e', 'console.log("$HOME;x"); process.exit(3)'], OPTIONS, process.env);
    expect(run).toMatchObject({ exitCode: 3, stdout: '$HOME;x\n', timedOut: false });
  });

  test('kills a command that runs too long', async () => {
    const run = await runCommand(
      BUN,
      ['-e', 'setTimeout(() => {}, 10_000)'],
      { ...OPTIONS, timeoutMs: 100 },
      process.env,
    );
    expect(run.timedOut).toBe(true);
  });

  test('drops output beyond the limit and reports it', async () => {
    const run = await runCommand(BUN, ['-e', 'process.stdout.write("x".repeat(5000))'], OPTIONS, process.env);
    expect(run).toMatchObject({ exitCode: null, stdout: '' });
    expect(run.stderr).toContain('exceeded');
  });
});
