import { describe, expect, test } from 'bun:test';
import { MAX_REMEMBERED_CLIENTS } from '../ipp/client-approvals';
import { openDatabase } from './database';
import { SqliteIppStore } from './sqlite-ipp-store';

describe('SqliteIppStore', () => {
  test('remembers one decision per computer, newest first', () => {
    const store = new SqliteIppStore(openDatabase(':memory:'));
    store.saveDecision({ address: '192.168.1.23', decision: 'allow', lastUser: 'zhang', decidedAt: 1 });
    store.saveDecision({ address: '192.168.1.24', decision: 'deny', lastUser: '', decidedAt: 2 });
    store.saveDecision({ address: '192.168.1.23', decision: 'deny', lastUser: 'li', decidedAt: 3 });
    expect(store.decisionOf('192.168.1.23')).toBe('deny');
    expect(store.listDecisions().map((client) => client.address)).toEqual(['192.168.1.23', '192.168.1.24']);
    store.removeDecision('192.168.1.23');
    expect(store.decisionOf('192.168.1.23')).toBeNull();
  });

  test('keeps at most the newest remembered computers', () => {
    const store = new SqliteIppStore(openDatabase(':memory:'));
    for (let index = 0; index <= MAX_REMEMBERED_CLIENTS; index += 1) {
      store.saveDecision({
        address: `10.0.${Math.floor(index / 256)}.${index % 256}`,
        decision: 'allow',
        lastUser: '',
        decidedAt: index,
      });
    }
    expect(store.listDecisions()).toHaveLength(MAX_REMEMBERED_CLIENTS);
    expect(store.decisionOf('10.0.0.0')).toBeNull();
  });

  test('stores one password digest', () => {
    const store = new SqliteIppStore(openDatabase(':memory:'));
    expect(store.readPassword()).toBeNull();
    store.writePassword({ salt: Uint8Array.of(1, 2), hash: Uint8Array.of(3, 4) }, 10);
    store.writePassword({ salt: Uint8Array.of(5), hash: Uint8Array.of(6) }, 11);
    expect(store.readPassword()).toEqual({ salt: Uint8Array.of(5), hash: Uint8Array.of(6) });
    store.clearPassword();
    expect(store.readPassword()).toBeNull();
  });
});
