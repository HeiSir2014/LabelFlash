import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rotateLogFile } from './log-rotation';

const ARCHIVES = 3;

describe('rotateLogFile', () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cdl-log-rotation-'));
    logPath = join(dir, 'main.log');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('moves the current log to the first archive', async () => {
    await writeFile(logPath, 'current');
    rotateLogFile(logPath, ARCHIVES);
    expect(await readdir(dir)).toEqual(['main.1.log']);
    expect(await readFile(join(dir, 'main.1.log'), 'utf8')).toBe('current');
  });

  test('shifts older archives and drops the oldest beyond the limit', async () => {
    await writeFile(logPath, 'current');
    await writeFile(join(dir, 'main.1.log'), 'one');
    await writeFile(join(dir, 'main.2.log'), 'two');
    await writeFile(join(dir, 'main.3.log'), 'three');
    rotateLogFile(logPath, ARCHIVES);
    expect((await readdir(dir)).sort()).toEqual(['main.1.log', 'main.2.log', 'main.3.log']);
    expect(await readFile(join(dir, 'main.1.log'), 'utf8')).toBe('current');
    expect(await readFile(join(dir, 'main.2.log'), 'utf8')).toBe('one');
    expect(await readFile(join(dir, 'main.3.log'), 'utf8')).toBe('two');
  });

  test('fills gaps without failing on missing archives', async () => {
    await writeFile(logPath, 'current');
    await writeFile(join(dir, 'main.2.log'), 'two');
    rotateLogFile(logPath, ARCHIVES);
    expect((await readdir(dir)).sort()).toEqual(['main.1.log', 'main.3.log']);
  });
});
