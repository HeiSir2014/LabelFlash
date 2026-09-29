import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { DENIAL_COOLDOWN_MS, OriginPrompts } from './origin-prompts';

const SITE = 'https://a.example.com';

function createPrompts() {
  const clock = new FakeClock();
  const asked: string[] = [];
  const granted: string[] = [];
  let answer: (allowed: boolean) => void = () => {};
  const prompts = new OriginPrompts({
    clock,
    ask: (origin) => {
      asked.push(origin);
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
    grant: (origin) => granted.push(origin),
  });
  return { clock, asked, granted, prompts, answer: (allowed: boolean) => answer(allowed) };
}

describe('OriginPrompts', () => {
  test('shows one prompt per website at a time', () => {
    const { prompts, asked } = createPrompts();
    prompts.request(SITE);
    prompts.request(SITE);
    prompts.request('https://b.example.com');
    expect(asked).toEqual([SITE, 'https://b.example.com']);
  });

  test('remembers an allowed website', async () => {
    const { prompts, granted, answer } = createPrompts();
    prompts.request(SITE);
    answer(true);
    await prompts.idle();
    expect(granted).toEqual([SITE]);
  });

  // 网页多半会自动重试：拒绝后一段时间内不再弹框打扰。
  test('stays quiet for a while after a refusal', async () => {
    const { prompts, asked, clock, answer } = createPrompts();
    prompts.request(SITE);
    answer(false);
    await prompts.idle();
    clock.advance(DENIAL_COOLDOWN_MS - 1);
    prompts.request(SITE);
    expect(asked).toHaveLength(1);
    clock.advance(1);
    prompts.request(SITE);
    expect(asked).toHaveLength(2);
  });
});
