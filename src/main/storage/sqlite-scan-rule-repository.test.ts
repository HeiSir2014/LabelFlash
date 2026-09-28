import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ScanRule } from '../../core/scan/rule-model';
import { systemClock } from '../../core/types';
import { openDatabase } from './database';
import { SqliteScanRuleRepository } from './sqlite-scan-rule-repository';
import { createTempDir, removeTempDir } from './testing/temp-dir';

const RULE: ScanRule = {
  id: 'custom:underscore',
  name: '下划线',
  kind: 'delimited',
  delimiter: '_',
  fields: ['款号', '颜色', '尺码'],
  overflowIndex: 0,
};

describe('SqliteScanRuleRepository', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await createTempDir('labelflash-rules-');
    path = join(dir, 'labelflash.db');
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  test('keeps custom rules across reopen, in creation order', () => {
    const first = openDatabase(path);
    const repository = new SqliteScanRuleRepository(first, systemClock);
    repository.save(RULE);
    repository.save({ ...RULE, id: 'custom:second', name: '第二条' });
    first.close();
    const second = openDatabase(path);
    expect(new SqliteScanRuleRepository(second, systemClock).listCustom().map((rule) => rule.id)).toEqual([
      'custom:underscore',
      'custom:second',
    ]);
    second.close();
  });

  test('updates and removes a rule', () => {
    const db = openDatabase(path);
    const repository = new SqliteScanRuleRepository(db, systemClock);
    repository.save(RULE);
    repository.save({ ...RULE, name: '改名' });
    expect(repository.listCustom()).toEqual([{ ...RULE, name: '改名' }]);
    repository.remove(RULE.id);
    expect(repository.listCustom()).toEqual([]);
    db.close();
  });

  test('skips a stored rule that no longer passes validation', () => {
    const db = openDatabase(path);
    const insert = db.prepare(
      'INSERT INTO scan_rules (id, body, created_at, updated_at) VALUES (:id, :body, :at, :at)',
    );
    insert.run({ id: 'custom:bad', body: '{"kind":"script"}', at: 1 });
    insert.run({ id: 'custom:broken', body: '{oops', at: 2 });
    const repository = new SqliteScanRuleRepository(db, systemClock);
    repository.save(RULE);
    expect(repository.listCustom().map((rule) => rule.id)).toEqual([RULE.id]);
    db.close();
  });
});
