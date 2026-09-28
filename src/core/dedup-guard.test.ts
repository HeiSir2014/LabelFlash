import { beforeEach, describe, expect, test } from 'bun:test';
import { DedupGuard, MAX_DEDUP_WINDOW_MS } from './dedup-guard';
import { FakeClock } from './testing/fake-clock';

const WINDOW_MS = 10 * 60_000;
const KEY = 'CL5640-TK-图片色-XL';

describe('DedupGuard', () => {
  let clock: FakeClock;
  let guard: DedupGuard;

  beforeEach(() => {
    clock = new FakeClock();
    guard = new DedupGuard(clock, WINDOW_MS);
  });

  function printOnce(): number {
    guard.tryReserve(KEY, false);
    guard.commit(KEY);
    return clock.now();
  }

  test('allows the first reservation', () => {
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('blocks a second reservation while the first is still printing', () => {
    const reservedAt = clock.now();
    guard.tryReserve(KEY, false);
    clock.advance(500);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printing', at: reservedAt } });
  });

  test('force does not bypass a print that is still in flight', () => {
    guard.tryReserve(KEY, false);
    expect(guard.tryReserve(KEY, true).ok).toBe(false);
  });

  test('blocks inside the window after a successful print', () => {
    const printedAt = printOnce();
    clock.advance(WINDOW_MS - 1);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: printedAt } });
  });

  test('allows again once the window has passed', () => {
    printOnce();
    clock.advance(WINDOW_MS);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('release after a failed print allows an immediate retry', () => {
    guard.tryReserve(KEY, false);
    guard.release(KEY);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('force bypasses the window after a successful print', () => {
    printOnce();
    expect(guard.tryReserve(KEY, true)).toEqual({ ok: true });
  });

  test('a zero window turns the threshold off', () => {
    guard.setWindowMs(0);
    printOnce();
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('shrinking the window takes effect immediately', () => {
    printOnce();
    clock.advance(2 * 60_000);
    guard.setWindowMs(60_000);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('clamps the window to the supported range', () => {
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS * 2);
    expect(guard.windowMs).toBe(MAX_DEDUP_WINDOW_MS);
    guard.setWindowMs(-1);
    expect(guard.windowMs).toBe(0);
  });

  test('rejects a non-finite window in the constructor', () => {
    // NaN/Infinity 会让 peek 里的窗口比较永远为 false，等于悄悄关掉去重
    expect(() => new DedupGuard(clock, Number.NaN)).toThrow(RangeError);
    expect(() => new DedupGuard(clock, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  test('rejects a non-finite window in setWindowMs and keeps the previous window', () => {
    expect(() => guard.setWindowMs(Number.NaN)).toThrow(RangeError);
    expect(guard.windowMs).toBe(WINDOW_MS);
  });

  test('peek distinguishes printing from printed and never reserves', () => {
    expect(guard.peek(KEY)).toBeNull();
    guard.tryReserve(KEY, false);
    expect(guard.peek(KEY)?.state).toBe('printing');
    guard.commit(KEY);
    expect(guard.peek(KEY)?.state).toBe('printed');
    expect(guard.peek('OTHER-红-1')).toBeNull();
    expect(guard.tryReserve('OTHER-红-1', false)).toEqual({ ok: true });
  });

  test('restore seeds the window after a restart and keeps the latest timestamp', () => {
    const latest = clock.now() - 1_000;
    guard.restore(KEY, latest);
    guard.restore(KEY, latest - 5_000);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: latest } });
  });

  test('restore clamps a future printedAt to now', () => {
    // 记录里的时间戳比当前时间还晚（时钟回拨/数据损坏），不应该让门限比窗口本身更长。
    const future = clock.now() + 5_000;
    guard.restore(KEY, future);
    expect(guard.peek(KEY)).toEqual({ state: 'printed', at: clock.now() });
  });

  test('restore skips records already older than the maximum window', () => {
    // 超过最大窗口的历史记录已经没有意义，恢复时应该直接丢弃，而不是先存进 Map 再等下一次
    // commit 触发 pruneExpired——否则窗口期内把时钟拨回去，就会看到它被错误地“救活”。
    const ancient = clock.now() - MAX_DEDUP_WINDOW_MS;
    guard.restore(KEY, ancient);
    clock.advance(-MAX_DEDUP_WINDOW_MS + 1); // 拨回 ancient 附近：若被错误存入，窗口检查会重新判定为「已打印」
    expect(guard.peek(KEY)).toBeNull();
  });

  test('forgets prints older than the maximum window once another commit prunes', () => {
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS);
    printOnce();
    clock.advance(MAX_DEDUP_WINDOW_MS); // 达到最大窗口，下一次 commit 应该把 KEY 的记录清掉
    guard.tryReserve('OTHER-红-1', false);
    guard.commit('OTHER-红-1'); // 触发 pruneExpired
    // 把时钟拨回去：如果记录没有被真正清理，仅凭窗口检查也会判定为「已打印」，
    // 这样才能确认下面的 null 是 pruneExpired 删除了记录，而不是窗口检查本身的副作用。
    clock.advance(-MAX_DEDUP_WINDOW_MS + 1);
    expect(guard.peek(KEY)).toBeNull();
  });

  test('a forced reservation that is released still leaves the earlier print blocking a normal scan', () => {
    const printedAt = printOnce();
    clock.advance(1_000);
    // force 只跳过窗口检查，不会抹掉已经打印过的记录
    expect(guard.tryReserve(KEY, true)).toEqual({ ok: true });
    guard.release(KEY); // 确认没出纸，释放这次占位（不是 commit）
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: printedAt } });
  });

  test('increasing the window re-blocks an older print', () => {
    const printedAt = printOnce();
    clock.advance(WINDOW_MS + 1); // 超出当前窗口，门限应该已经解除
    expect(guard.peek(KEY)).toBeNull(); // 用只读的 peek，避免额外产生占位
    guard.setWindowMs(WINDOW_MS * 3); // 调大窗口，重新覆盖这次打印
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: printedAt } });
  });

  test('a forced reprint that commits moves the window start forward', () => {
    printOnce(); // 初次打印，窗口起点是这一刻
    clock.advance(WINDOW_MS - 1); // 仍在旧窗口内，但已经很接近过期
    guard.tryReserve(KEY, true); // 强制补打，跳过窗口占位
    guard.commit(KEY); // 补打完成：窗口起点刷新为现在
    const reprintedAt = clock.now();
    clock.advance(2); // 如果起点还停在初次打印的时间，这时早该过期了
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: reprintedAt } });
  });

  test('restore during an in-flight reservation still reports printing', () => {
    const reservedAt = clock.now();
    guard.tryReserve(KEY, false); // 占位中，尚未 commit
    clock.advance(500);
    guard.restore(KEY, clock.now() - 100); // 从历史记录恢复，不应该盖过正在进行的占位
    expect(guard.peek(KEY)).toEqual({ state: 'printing', at: reservedAt });
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printing', at: reservedAt } });
  });
});
