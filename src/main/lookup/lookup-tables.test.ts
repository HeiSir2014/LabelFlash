import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOOKUP_PREVIEW_ROWS } from '../../core/lookup/lookup-model';
import { systemClock } from '../../core/types';
import { openDatabase } from '../storage/database';
import { SqliteLookupStore } from '../storage/sqlite-lookup-store';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import { LookupTables } from './lookup-tables';

describe('LookupTables', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir('labelflash-lookup-');
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  function createTables() {
    let next = 0;
    return new LookupTables(new SqliteLookupStore(openDatabase(':memory:'), systemClock), () => `t${++next}`);
  }

  async function file(name: string, content: string | Uint8Array): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  }

  test('imports a CSV named after the file and finds rows by key', async () => {
    const tables = createTables();
    const result = await tables.importFile(await file('货架表.csv', '编码,货架\nCL1,A-01\n'), null);
    expect(result).toMatchObject({ status: 'imported', table: { id: 't1', name: '货架表', rowCount: 1 } });
    expect(tables.find('t1', '编码', 'CL1', false)).toEqual({ 编码: 'CL1', 货架: 'A-01' });
  });

  test('reads a GBK file saved by Chinese Excel', async () => {
    const tables = createTables();
    // 「编码,货架\nCL1,A」的 GBK 编码。
    const header = [0xb1, 0xe0, 0xc2, 0xeb, 0x2c, 0xbb, 0xf5, 0xbc, 0xdc, 0x0a];
    const gbk = new Uint8Array([...header, 0x43, 0x4c, 0x31, 0x2c, 0x41]);
    await tables.importFile(await file('gbk.csv', gbk), null);
    expect(tables.find('t1', '编码', 'CL1', false)?.['货架']).toBe('A');
  });

  test('replacing a table refreshes lookups immediately', async () => {
    const tables = createTables();
    await tables.importFile(await file('a.csv', '编码,货架\nCL1,A-01\n'), null);
    expect(tables.find('t1', '编码', 'CL1', false)?.['货架']).toBe('A-01');
    await tables.importFile(await file('b.csv', '编码,货架\nCL1,B-02\n'), 't1');
    expect(tables.find('t1', '编码', 'CL1', false)?.['货架']).toBe('B-02');
    expect(tables.list().map((table) => table.name)).toEqual(['a']);
  });

  test('explains a bad file and a missing table to replace', async () => {
    const tables = createTables();
    expect(await tables.importFile(await file('bad.csv', '编码,编码\n'), null)).toEqual({
      status: 'invalid',
      issue: '列名重复：「编码」',
    });
    expect(await tables.importFile(await file('ok.csv', '编码\n1'), 'gone')).toMatchObject({ status: 'invalid' });
  });

  test('previews the first rows of a table', async () => {
    const tables = createTables();
    const body = Array.from({ length: LOOKUP_PREVIEW_ROWS + 5 }, (_, index) => `CL${index},A-${index}`).join('\n');
    await tables.importFile(await file('a.csv', `编码,货架\n${body}\n`), null);
    const preview = tables.rows('t1');
    expect(preview?.columns).toEqual(['编码', '货架']);
    expect(preview?.rows).toHaveLength(LOOKUP_PREVIEW_ROWS);
    expect(preview?.rows[0]).toEqual(['CL0', 'A-0']);
  });

  test('removing a table stops lookups', async () => {
    const tables = createTables();
    await tables.importFile(await file('a.csv', '编码,货架\nCL1,A-01\n'), null);
    tables.find('t1', '编码', 'CL1', false);
    tables.remove('t1');
    expect(tables.find('t1', '编码', 'CL1', false)).toBeNull();
  });
});
