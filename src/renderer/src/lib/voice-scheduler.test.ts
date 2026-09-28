import { describe, expect, test } from 'bun:test';
import { type Playback, VoiceScheduler } from './voice-scheduler';

/** 假播放器：记录开始、停止；finish(name) 模拟这句自然播完。 */
function createFakeSpeaker(options: { unavailable?: string[] } = {}) {
  const events: string[] = [];
  const finishers = new Map<string, () => void>();
  const start = async (name: string): Promise<Playback | null> => {
    if (options.unavailable?.includes(name)) {
      events.push(`beep ${name}`);
      return null;
    }
    events.push(`start ${name}`);
    let resolveFinished: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    finishers.set(name, resolveFinished);
    return {
      stop: () => {
        events.push(`stop ${name}`);
        resolveFinished();
      },
      finished,
    };
  };
  const finish = async (name: string) => {
    finishers.get(name)?.();
    await flush();
  };
  return { start, events, finish };
}

/** 让已排队的 Promise 回调都跑完（调度器内部最多串联几层 await）。 */
const FLUSH_ROUNDS = 5;
async function flush() {
  for (let i = 0; i < FLUSH_ROUNDS; i += 1) {
    await Promise.resolve();
  }
}

describe('VoiceScheduler', () => {
  test('a newer announcement of the same level interrupts the current one', async () => {
    const speaker = createFakeSpeaker();
    const scheduler = new VoiceScheduler(speaker.start);
    scheduler.announce('已发送打印#1', 'confirm');
    await flush();
    scheduler.announce('已发送打印#2', 'confirm');
    await flush();
    expect(speaker.events).toEqual(['start 已发送打印#1', 'stop 已发送打印#1', 'start 已发送打印#2']);
  });

  test('a higher level interrupts at once', async () => {
    const speaker = createFakeSpeaker();
    const scheduler = new VoiceScheduler(speaker.start);
    scheduler.announce('已扫描', 'confirm');
    await flush();
    scheduler.announce('打印机缺纸', 'alert');
    await flush();
    expect(speaker.events).toEqual(['start 已扫描', 'stop 已扫描', 'start 打印机缺纸']);
  });

  test('a lower level waits for the current one, and only the latest waiting one is kept', async () => {
    const speaker = createFakeSpeaker();
    const scheduler = new VoiceScheduler(speaker.start);
    scheduler.announce('打印机缺纸', 'alert');
    await flush();
    scheduler.announce('重复扫码', 'notice');
    scheduler.announce('已发送打印', 'confirm');
    await flush();
    expect(speaker.events).toEqual(['start 打印机缺纸']);
    await speaker.finish('打印机缺纸');
    expect(speaker.events).toEqual(['start 打印机缺纸', 'start 已发送打印']);
  });

  test('a waiting announcement is dropped when something at least as important interrupts', async () => {
    const speaker = createFakeSpeaker();
    const scheduler = new VoiceScheduler(speaker.start);
    scheduler.announce('重复扫码', 'notice');
    await flush();
    scheduler.announce('已发送打印', 'confirm');
    scheduler.announce('打印失败', 'alert');
    await flush();
    await speaker.finish('打印失败');
    expect(speaker.events).toEqual(['start 重复扫码', 'stop 重复扫码', 'start 打印失败']);
  });

  test('an announcement that could not be spoken counts as finished at once', async () => {
    const speaker = createFakeSpeaker({ unavailable: ['打印机缺纸'] });
    const scheduler = new VoiceScheduler(speaker.start);
    scheduler.announce('打印机缺纸', 'alert');
    scheduler.announce('已发送打印', 'confirm');
    await flush();
    expect(speaker.events).toEqual(['beep 打印机缺纸', 'start 已发送打印']);
  });

  test('stops a clip that finished loading after it was superseded', async () => {
    const events: string[] = [];
    let releaseFirst: (playback: Playback) => void = () => {};
    const scheduler = new VoiceScheduler<string>((name) => {
      if (name === 'slow') {
        return new Promise<Playback>((resolve) => {
          releaseFirst = resolve;
        });
      }
      events.push(`start ${name}`);
      return Promise.resolve({ stop: () => events.push(`stop ${name}`), finished: new Promise<void>(() => {}) });
    });
    scheduler.announce('slow', 'confirm');
    scheduler.announce('fast', 'confirm');
    await flush();
    releaseFirst({ stop: () => events.push('stop slow'), finished: new Promise<void>(() => {}) });
    await flush();
    expect(events).toEqual(['start fast', 'stop slow']);
  });

  test('keeps going after a playback fails to start', async () => {
    const events: string[] = [];
    const scheduler = new VoiceScheduler<string>(async (name) => {
      if (name === 'broken') {
        throw new Error('decode failed');
      }
      events.push(`start ${name}`);
      return null;
    });
    scheduler.announce('broken', 'alert');
    scheduler.announce('已发送打印', 'confirm');
    await flush();
    expect(events).toEqual(['start 已发送打印']);
  });
});
