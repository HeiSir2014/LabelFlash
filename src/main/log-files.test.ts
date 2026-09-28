import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailyLogFileName, findExpiredLogFiles, rollOverLogFile } from './log-files';

describe('dailyLogFileName', () => {
  test('names the file after the app and the local calendar day', () => {
    expect(dailyLogFileName(new Date(2026, 8, 28, 23, 59))).toBe('labelflash-2026-09-28.log');
    expect(dailyLogFileName(new Date(2026, 0, 5, 0, 0))).toBe('labelflash-2026-01-05.log');
  });
});

describe('findExpiredLogFiles', () => {
  const NOW = new Date(2026, 8, 28, 9, 0);
  const RETENTION_DAYS = 14;

  test('keeps the last retention days, today included, and expires older days with their roll-overs', () => {
    const files = [
      'labelflash-2026-09-28.log',
      'labelflash-2026-09-15.log',
      'labelflash-2026-09-14.log',
      'labelflash-2026-09-14.1.log',
      'labelflash-2025-12-31.log',
    ];
    expect(findExpiredLogFiles(files, NOW, RETENTION_DAYS)).toEqual([
      'labelflash-2026-09-14.log',
      'labelflash-2026-09-14.1.log',
      'labelflash-2025-12-31.log',
    ]);
  });

  test('never touches files it does not own', () => {
    const files = ['crash.dmp', 'labelflash-latest.log', 'other-2020-01-01.log', 'labelflash-2020-13-45.log'];
    expect(findExpiredLogFiles(files, NOW, RETENTION_DAYS)).toEqual([]);
  });
});

describe('rollOverLogFile', () => {
  const ROLLS = 3;
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cdl-log-files-'));
    logPath = join(dir, 'labelflash-2026-09-28.log');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('moves a full file of the day to its first roll-over', async () => {
    await writeFile(logPath, 'current');
    rollOverLogFile(logPath, ROLLS);
    expect(await readdir(dir)).toEqual(['labelflash-2026-09-28.1.log']);
    expect(await readFile(join(dir, 'labelflash-2026-09-28.1.log'), 'utf8')).toBe('current');
  });

  test('shifts earlier roll-overs and drops the oldest beyond the limit', async () => {
    await writeFile(logPath, 'current');
    await writeFile(join(dir, 'labelflash-2026-09-28.1.log'), 'one');
    await writeFile(join(dir, 'labelflash-2026-09-28.2.log'), 'two');
    await writeFile(join(dir, 'labelflash-2026-09-28.3.log'), 'three');
    rollOverLogFile(logPath, ROLLS);
    expect(await readFile(join(dir, 'labelflash-2026-09-28.1.log'), 'utf8')).toBe('current');
    expect(await readFile(join(dir, 'labelflash-2026-09-28.2.log'), 'utf8')).toBe('one');
    expect(await readFile(join(dir, 'labelflash-2026-09-28.3.log'), 'utf8')).toBe('two');
    expect(await readdir(dir)).toHaveLength(ROLLS);
  });
});
