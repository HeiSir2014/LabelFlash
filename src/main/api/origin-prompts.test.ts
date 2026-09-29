import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { DENIAL_COOLDOWN_MS, MAX_PENDING_ORIGINS, OriginPrompts, PENDING_EXPIRY_MS } from './origin-prompts';

const SITE = 'https://a.example.com';

function createPrompts() {
  const clock = new FakeClock();
  const notified: string[] = [];
  const granted: string[] = [];
  let changes = 0;
  const prompts = new OriginPrompts({
    clock,
    notify: (origin) => notified.push(origin),
    grant: (origin) => granted.push(origin),
    onChange: () => {
      changes += 1;
    },
  });
  return { clock, notified, granted, prompts, changes: () => changes };
}

describe('OriginPrompts', () => {
  test('lists a new website as waiting and notifies the operator once', () => {
    const { prompts, notified, changes } = createPrompts();
    expect(prompts.request(SITE)).toBe('pending');
    expect(prompts.request(SITE)).toBe('pending');
    expect(prompts.pending()).toEqual([SITE]);
    expect(notified).toEqual([SITE]);
    expect(changes()).toBe(1);
  });

  test('remembers an allowed website', () => {
    const { prompts, granted } = createPrompts();
    prompts.request(SITE);
    prompts.decide(SITE, true);
    expect(granted).toEqual([SITE]);
    expect(prompts.pending()).toEqual([]);
  });

  // 网页多半会自动重试：拒绝后一段时间内直接答复「已拒绝」，不再打扰操作员。
  test('answers denied for a while after a refusal', () => {
    const { prompts, clock, notified } = createPrompts();
    prompts.request(SITE);
    prompts.decide(SITE, false);
    clock.advance(DENIAL_COOLDOWN_MS - 1);
    expect(prompts.request(SITE)).toBe('denied');
    clock.advance(1);
    expect(prompts.request(SITE)).toBe('pending');
    expect(notified).toHaveLength(2);
  });

  // 一个网页可以换着子域名请求：同时等确认的网站有上限，满了就不再列出、不再通知。
  test('keeps only a few websites waiting at once', () => {
    const { prompts, notified } = createPrompts();
    for (let index = 0; index < MAX_PENDING_ORIGINS + 3; index += 1) {
      prompts.request(`https://a${index}.example.com`);
    }
    expect(prompts.pending()).toHaveLength(MAX_PENDING_ORIGINS);
    expect(notified).toHaveLength(MAX_PENDING_ORIGINS);
    expect(prompts.request('https://late.example.com')).toBe('busy');
  });

  test('drops a request nobody answered after a while', () => {
    const { prompts, clock } = createPrompts();
    prompts.request(SITE);
    clock.advance(PENDING_EXPIRY_MS);
    expect(prompts.pending()).toEqual([]);
  });

  test('ignores a decision for a website that is not waiting', () => {
    const { prompts, granted } = createPrompts();
    prompts.decide(SITE, true);
    expect(granted).toEqual([]);
  });
});
