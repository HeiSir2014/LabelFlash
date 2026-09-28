import { describe, expect, test } from 'bun:test';
import type { LookupTableData } from '../../core/lookup/lookup-model';
import { systemClock } from '../../core/types';
import { openDatabase } from './database';
import { SqliteLookupStore } from './sqlite-lookup-store';

const SHELVES: LookupTableData = {
  columns: ['编码', '货架'],
  rows: [
    ['CL1', 'A-01'],
    ['CL2', 'B-02'],
  ],
};

function createStore() {
  const db = openDatabase(':memory:');
  return { db, store: new SqliteLookupStore(db, systemClock) };
}

describe('SqliteLookupStore', () => {
  test('creates a table and loads its rows back in order', () => {
    const { store } = createStore();
    const info = store.create('shelves', '货架表', SHELVES);
    expect(info).toMatchObject({ id: 'shelves', name: '货架表', columns: ['编码', '货架'], rowCount: 2 });
    expect(store.list().map((table) => table.id)).toEqual(['shelves']);
    expect(store.load('shelves')).toEqual(SHELVES);
  });

  test('replaces the whole content but keeps the id and name', () => {
    const { store } = createStore();
    store.create('shelves', '货架表', SHELVES);
    const replaced = store.replace('shelves', { columns: ['编码', '货架', '仓库'], rows: [['CL9', 'C-03', '二号仓']] });
    expect(replaced).toMatchObject({ id: 'shelves', name: '货架表', rowCount: 1 });
    expect(store.load('shelves')?.rows).toEqual([['CL9', 'C-03', '二号仓']]);
  });

  test('removes a table with its rows', () => {
    const { db, store } = createStore();
    store.create('shelves', '货架表', SHELVES);
    store.remove('shelves');
    expect(store.list()).toEqual([]);
    expect(store.load('shelves')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM lookup_rows').get()?.['n']).toBe(0);
  });
});
