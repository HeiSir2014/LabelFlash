import { beforeEach, describe, expect, test } from 'bun:test';
import { SCANNED_FREQUENCY_HZ } from './scan-sound';
import { SoundPlayer } from './sound-player';

/** 只实现 SoundPlayer 用到的几项：记下起振的频率，resume 由测试决定什么时候完成。 */
class FakeAudioContext {
  state: 'suspended' | 'running' = 'suspended';
  readonly currentTime = 0;
  readonly destination = {};
  readonly started: number[] = [];
  resumeCalls = 0;
  private finishResume: (() => void) | null = null;

  resume(): Promise<void> {
    this.resumeCalls += 1;
    return new Promise((resolve) => {
      this.finishResume = () => {
        this.state = 'running';
        resolve();
      };
    });
  }

  /** 浏览器真的恢复了音频。 */
  async resumed(): Promise<void> {
    this.finishResume?.();
    await Promise.resolve();
  }

  createOscillator() {
    const oscillator = {
      type: '',
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: () => this.started.push(oscillator.frequency.value),
      stop: () => {},
    };
    return oscillator;
  }

  createGain() {
    const param = { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} };
    return { gain: param, connect: (node: unknown) => node };
  }
}

let context: FakeAudioContext;
let created: number;

function createPlayer(isOn = true): SoundPlayer {
  return new SoundPlayer(
    isOn,
    () => {},
    () => {
      created += 1;
      return context as unknown as AudioContext;
    },
  );
}

beforeEach(() => {
  context = new FakeAudioContext();
  created = 0;
});

describe('SoundPlayer', () => {
  test('stays silent and creates no audio before the first tap', () => {
    createPlayer().play('scanned');
    expect(created).toBe(0);
  });

  test('plays a beep that arrives before the tap-started resume finishes', async () => {
    const player = createPlayer();
    player.unlock();
    player.play('scanned');
    expect(context.started).toEqual([]);
    await context.resumed();
    expect(context.started).toEqual([SCANNED_FREQUENCY_HZ]);
  });

  test('resumes audio suspended while in the background before playing', async () => {
    const player = createPlayer();
    player.unlock();
    await context.resumed();
    context.state = 'suspended';
    player.play('scanned');
    await context.resumed();
    expect(context.started).toEqual([SCANNED_FREQUENCY_HZ]);
  });

  test('plays at once while audio is running', async () => {
    const player = createPlayer();
    player.unlock();
    await context.resumed();
    player.play('scanned');
    expect(context.started).toEqual([SCANNED_FREQUENCY_HZ]);
  });

  test('stays silent when switched off', async () => {
    const player = createPlayer(false);
    player.unlock();
    await context.resumed();
    player.play('scanned');
    expect(context.started).toEqual([]);
  });
});
