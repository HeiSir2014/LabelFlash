import { describe, expect, test } from 'bun:test';
import {
  basicsMergeKey,
  emptyHistory,
  endMerge,
  HISTORY_LIMIT,
  type History,
  historyMergeKey,
  record,
  redo,
  type Stepped,
  undo,
} from './canvas-history';

/** 撤销 / 重做应当有结果：没有时让用例失败，而不是带着 null 往下走。 */
function must<T>(stepped: Stepped<T> | null): Stepped<T> {
  if (stepped === null) {
    throw new Error('expected a step');
  }
  return stepped;
}

describe('canvas history', () => {
  test('undoes the recorded steps in order and stops at the start', () => {
    let history: History<string> = emptyHistory();
    history = record(history, 'a');
    history = record(history, 'ab');
    const first = must(undo(history, 'abc'));
    expect(first.present).toBe('ab');
    const second = must(undo(first.history, first.present));
    expect(second.present).toBe('a');
    expect(undo(second.history, second.present)).toBeNull();
  });

  test('redoes what was undone, and a new change drops the redo steps', () => {
    const history = record(record(emptyHistory<string>(), 'a'), 'ab');
    const back = must(undo(history, 'abc'));
    expect(must(redo(back.history, back.present)).present).toBe('abc');
    const changed = record(back.history, back.present);
    expect(redo(changed, 'abX')).toBeNull();
  });

  test('merges consecutive changes with the same key into one step', () => {
    let history = record(emptyHistory<string>(), '', 'e1:text');
    history = record(history, 'a', 'e1:text');
    history = record(history, 'ab', 'e1:text');
    expect(history.past).toEqual(['']);
    expect(must(undo(history, 'abc')).present).toBe('');
    expect(record(history, 'abc', 'e1:fontSizeMm').past).toEqual(['', 'abc']);
  });

  test('starts a new step after an undo even with the same key', () => {
    const history = record(record(emptyHistory<string>(), '', 'e1:text'), 'a', 'e1:text');
    const back = must(undo(history, 'ab'));
    expect(back.history.past).toEqual([]);
    expect(record(back.history, back.present, 'e1:text').past).toEqual(['']);
  });

  test('keeps at most the history limit', () => {
    let history = emptyHistory<number>();
    for (let step = 0; step < HISTORY_LIMIT + 50; step += 1) {
      history = record(history, step);
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(50);
  });

  test('redoing after many undos stays within the history limit', () => {
    let history = emptyHistory<number>();
    for (let step = 0; step < HISTORY_LIMIT + 50; step += 1) {
      history = record(history, step);
    }
    let present = HISTORY_LIMIT + 50;
    for (let stepped = undo(history, present); stepped !== null; stepped = undo(history, present)) {
      history = stepped.history;
      present = stepped.present;
    }
    expect(history.future).toHaveLength(HISTORY_LIMIT);
    expect(present).toBe(50);
  });

  test('starts a new step after a redo even with the same key', () => {
    const history = record(record(emptyHistory<string>(), '', 'e1:text'), 'a', 'e1:text');
    const back = must(undo(history, 'ab'));
    const forward = must(redo(back.history, back.present));
    expect(forward.history.mergeKey).toBeNull();
    expect(record(forward.history, forward.present, 'e1:text').past).toEqual(['', 'ab']);
  });

  test('endMerge clears the merge key so the next change does not merge with it', () => {
    const history = record(emptyHistory<string>(), '', 'e1:text');
    const ended = endMerge(history);
    expect(record(ended, 'a', 'e1:text').past).toEqual(['', 'a']);
  });

  test('endMerge leaves a history without a pending merge unchanged', () => {
    const history = emptyHistory<string>();
    expect(endMerge(history)).toBe(history);
  });

  describe('historyMergeKey', () => {
    test('combines the id and field for a continuous edit', () => {
      expect(historyMergeKey('e1', 'x')).toBe('e1:x');
      expect(historyMergeKey('cell:1:2', 'text')).toBe('cell:1:2:text');
    });

    test('passes a null field through as null, for one-shot edits that never merge', () => {
      expect(historyMergeKey('e1', null)).toBeNull();
    });
  });

  describe('basicsMergeKey', () => {
    test('merges consecutive name edits, but not a change to anything else', () => {
      const base = { id: 't1', name: 'a', widthMm: 60 };
      // 连续打字改名称：同一个合并键，才能撤销一次回到开始打字之前。
      expect(basicsMergeKey(base, { ...base, name: 'ab' })).toBe('t1:name');
      // 纸张、打印机这类一次选择就改完的字段：各自成一步，不合并。
      expect(basicsMergeKey(base, { ...base, widthMm: 80 })).toBeNull();
      // 同一步里名称和别的字段一起变了（理论上不会发生，但不能悄悄把它当纯改名合并掉）。
      expect(basicsMergeKey(base, { ...base, name: 'ab', widthMm: 80 })).toBeNull();
      // 什么都没变：不算一步。
      expect(basicsMergeKey(base, { ...base })).toBeNull();
    });
  });
});
