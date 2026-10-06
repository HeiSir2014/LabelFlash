import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import {
  ClientApprovals,
  type ClientDecisionStore,
  IPP_APPROVAL,
  type PendingClient,
  type RememberedClient,
} from './client-approvals';

class MemoryDecisions implements ClientDecisionStore {
  readonly clients = new Map<string, RememberedClient>();

  decisionOf(address: string): 'allow' | 'deny' | null {
    return this.clients.get(address)?.decision ?? null;
  }

  saveDecision(client: RememberedClient): void {
    this.clients.set(client.address, client);
  }

  removeDecision(address: string): void {
    this.clients.delete(address);
  }

  listDecisions(): RememberedClient[] {
    return [...this.clients.values()];
  }
}

function createApprovals() {
  const store = new MemoryDecisions();
  const timers: Array<{ run: () => void; delayMs: number }> = [];
  const notified: PendingClient[] = [];
  let changes = 0;
  const approvals = new ClientApprovals({
    store,
    clock: new FakeClock(),
    schedule: (run, delayMs) => {
      const timer = { run, delayMs };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    notify: (client) => notified.push(client),
    onChange: () => {
      changes += 1;
    },
  });
  return { approvals, store, timers, notified, changes: () => changes };
}

describe('ClientApprovals', () => {
  test('asks about a new computer once and remembers the answer', async () => {
    const { approvals, store, notified } = createApprovals();
    expect(approvals.decisionFor('192.168.1.23')).toBe('ask');
    const first = approvals.waitFor('192.168.1.23', 'zhang', '60×40 标签');
    const second = approvals.waitFor('192.168.1.23', 'zhang', '60×40 标签');
    expect(notified).toHaveLength(1);
    expect(approvals.pending()).toMatchObject([{ address: '192.168.1.23', user: 'zhang', jobs: 2 }]);
    approvals.decide('192.168.1.23', true);
    expect(await first).toBe('allowed');
    expect(await second).toBe('allowed');
    expect(store.decisionOf('192.168.1.23')).toBe('allow');
    expect(approvals.decisionFor('192.168.1.23')).toBe('allowed');
    expect(await approvals.waitFor('192.168.1.23', 'zhang', '60×40 标签')).toBe('allowed');
  });

  test('remembers a refusal', async () => {
    const { approvals } = createApprovals();
    const waiting = approvals.waitFor('192.168.1.23', '', '60×40 标签');
    approvals.decide('192.168.1.23', false);
    expect(await waiting).toBe('denied');
    expect(approvals.decisionFor('192.168.1.23')).toBe('denied');
  });

  test('gives up after two minutes without remembering anything', async () => {
    const { approvals, timers } = createApprovals();
    const waiting = approvals.waitFor('192.168.1.23', '', '60×40 标签');
    expect(timers[0]?.delayMs).toBe(IPP_APPROVAL.timeoutMs);
    timers[0]?.run();
    expect(await waiting).toBe('timeout');
    expect(approvals.pending()).toEqual([]);
    expect(approvals.decisionFor('192.168.1.23')).toBe('ask');
  });

  test('lets at most three computers wait at once', async () => {
    const { approvals } = createApprovals();
    for (const address of ['192.168.1.1', '192.168.1.2', '192.168.1.3']) {
      void approvals.waitFor(address, '', 'P');
    }
    expect(await approvals.waitFor('192.168.1.4', '', 'P')).toBe('busy');
  });

  test('ignores answers for computers that are not waiting', () => {
    const { approvals, store } = createApprovals();
    approvals.decide('192.168.1.23', true);
    expect(store.decisionOf('192.168.1.23')).toBeNull();
  });

  test('forgets a decision and settles everyone waiting when sharing stops', async () => {
    const { approvals } = createApprovals();
    const waiting = approvals.waitFor('192.168.1.23', '', 'P');
    approvals.dispose();
    expect(await waiting).toBe('timeout');
    void approvals.waitFor('192.168.1.24', '', 'P');
    approvals.decide('192.168.1.24', false);
    approvals.forget('192.168.1.24');
    expect(approvals.decisionFor('192.168.1.24')).toBe('ask');
  });
});
