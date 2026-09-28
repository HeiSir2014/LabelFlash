import { describe, expect, test } from 'bun:test';
import type { Delivery } from '../../core/notify/delivery';
import type { WebhookEndpoint } from '../../core/notify/webhook-model';
import { FakeClock } from '../../core/testing/fake-clock';
import type { JobRecord } from '../../core/types';
import { openDatabase } from '../storage/database';
import { SqliteWebhookStore } from '../storage/sqlite-webhook-store';
import { WebhookOutbox } from './webhook-outbox';
import type { SendOutcome } from './webhook-sender';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const ENDPOINT: WebhookEndpoint = {
  id: 'erp',
  name: 'ERP',
  url: 'https://erp.example.com/hooks',
  secretName: null,
  events: ['printed', 'failed'],
  enabled: true,
};

function job(id: string, status: JobRecord['status'] = 'printed'): JobRecord {
  return { id, createdAt: 0, raw: 'CL1-红-XL', printerName: 'P', source: 'desktop', status, forced: false };
}

function createOutbox(endpoints: WebhookEndpoint[] = [ENDPOINT]) {
  const clock = new FakeClock();
  const store = new SqliteWebhookStore(openDatabase(':memory:'));
  const sent: Array<{ endpointId: string; eventId: string }> = [];
  let respond: (delivery: Delivery) => SendOutcome = () => ({ status: 204, error: null });
  let scheduled: number | null = null;
  let nextId = 0;
  const outbox = new WebhookOutbox({
    store,
    send: async (endpoint, delivery) => {
      sent.push({ endpointId: endpoint.id, eventId: delivery.eventId });
      return respond(delivery);
    },
    endpoints: () => endpoints,
    clock,
    station: { name: 'station', app: '1.0.1' },
    createId: () => `${++nextId}`,
    schedule: (_run, delayMs) => {
      scheduled = delayMs;
      return () => {
        scheduled = null;
      };
    },
  });
  return {
    outbox,
    store,
    clock,
    sent,
    scheduled: () => scheduled,
    respondWith: (next: (delivery: Delivery) => SendOutcome) => {
      respond = next;
    },
  };
}

describe('WebhookOutbox', () => {
  test('queues only subscribed events for enabled endpoints and sends them', async () => {
    const disabled = { ...ENDPOINT, id: 'off', enabled: false };
    const { outbox, sent, store } = createOutbox([ENDPOINT, disabled]);
    outbox.enqueueResult(job('j1'), null);
    outbox.enqueueResult(job('j2', 'duplicate'), null);
    await outbox.processDue();
    expect(sent).toEqual([{ endpointId: 'erp', eventId: 'j1' }]);
    expect(store.recent(10).map((delivery) => delivery.state)).toEqual(['delivered']);
  });

  test('sends one endpoint in order, the next right after the previous succeeds', async () => {
    const { outbox, sent } = createOutbox();
    outbox.enqueueResult(job('j1'), null);
    outbox.enqueueResult(job('j2'), null);
    outbox.enqueueResult(job('j3'), null);
    await outbox.processDue();
    expect(sent.map((item) => item.eventId)).toEqual(['j1', 'j2', 'j3']);
  });

  test('retries with backoff and holds later events behind a failing one', async () => {
    const { outbox, sent, clock, store, scheduled, respondWith } = createOutbox();
    respondWith(() => ({ status: 503, error: '接口返回 503' }));
    outbox.enqueueResult(job('j1'), null);
    outbox.enqueueResult(job('j2'), null);
    await outbox.processDue();
    expect(sent.map((item) => item.eventId)).toEqual(['j1']);
    expect(scheduled()).toBe(MINUTE);
    expect(store.get(1)).toMatchObject({ state: 'pending', attempts: 1, lastStatus: 503 });

    respondWith(() => ({ status: 204, error: null }));
    clock.advance(MINUTE);
    await outbox.processDue();
    expect(sent.map((item) => item.eventId)).toEqual(['j1', 'j1', 'j2']);
  });

  test('gives up on configuration errors at once and after 24 hours otherwise', async () => {
    const { outbox, store, clock, respondWith } = createOutbox();
    respondWith(() => ({ status: 404, error: '接口返回 404' }));
    outbox.enqueueResult(job('j1'), null);
    await outbox.processDue();
    expect(store.get(1)).toMatchObject({ state: 'failed', attempts: 1, nextAttemptAt: null });

    respondWith(() => ({ status: null, error: '网络错误，连不上接口' }));
    outbox.enqueueResult(job('j2'), null);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await outbox.processDue();
      clock.advance(13 * HOUR);
    }
    expect(store.get(2)).toMatchObject({ state: 'failed' });
    expect(store.get(2)?.lastError).toContain('已放弃');
  });

  test('keeps pending events across a restart', async () => {
    const first = createOutbox();
    first.respondWith(() => ({ status: null, error: '网络错误，连不上接口' }));
    first.outbox.enqueueResult(job('j1'), null);
    await first.outbox.processDue();
    const restarted = new WebhookOutbox({
      store: first.store,
      send: async () => ({ status: 204, error: null }),
      endpoints: () => [ENDPOINT],
      clock: first.clock,
      station: { name: 'station', app: '1.0.1' },
      createId: () => 'x',
      schedule: () => () => {},
    });
    first.clock.advance(MINUTE);
    await restarted.processDue();
    expect(first.store.get(1)?.state).toBe('delivered');
  });

  test('marks events of a deleted endpoint as failed', async () => {
    const endpoints = [ENDPOINT];
    const { outbox, store, respondWith } = createOutbox(endpoints);
    respondWith(() => ({ status: null, error: '网络错误，连不上接口' }));
    outbox.enqueueResult(job('j1'), null);
    await outbox.processDue();
    endpoints.length = 0;
    await outbox.processDue();
    expect(store.get(1)).toMatchObject({ state: 'failed', lastError: '接口已删除' });
  });

  test('sends a test event even to a disabled endpoint, and retries a failed event on demand', async () => {
    const disabled = { ...ENDPOINT, enabled: false };
    const { outbox, sent, respondWith } = createOutbox([disabled]);
    expect(outbox.sendTest('erp')).toBe(true);
    expect(outbox.sendTest('missing')).toBe(false);
    await outbox.processDue();
    expect(sent.map((item) => item.eventId)).toEqual(['test-1']);

    respondWith(() => ({ status: 400, error: '接口返回 400' }));
    expect(outbox.sendTest('erp')).toBe(true);
    await outbox.processDue();
    respondWith(() => ({ status: 204, error: null }));
    expect(outbox.retryNow(2)).toBe(true);
    await outbox.processDue();
    expect(sent.map((item) => item.eventId)).toEqual(['test-1', 'test-2', 'test-2']);
  });

  test('never lets a queueing error reach the print path', () => {
    const broken = new WebhookOutbox({
      store: new SqliteWebhookStore(openDatabase(':memory:')),
      send: async () => ({ status: 204, error: null }),
      endpoints: () => {
        throw new Error('settings unavailable');
      },
      clock: new FakeClock(),
      station: { name: 'station', app: '1.0.1' },
      createId: () => 'x',
      schedule: () => () => {},
    });
    expect(() => broken.enqueueResult(job('j1'), null)).not.toThrow();
  });
});
