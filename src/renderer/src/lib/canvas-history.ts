/**
 * 设计器的撤销 / 重做。只记「改之前的样子」：现在的样子由调用方持有（模板页的草稿），
 * 这里只存过去和将来，草稿仍然只有一份，不会和历史里的副本走散。纯函数，不碰 React。
 */

/** 最多记 100 步：一张标签改 100 步已经很多；每步存一份整个模板，有图片时一份可达几 MB，再多占内存。 */
export const HISTORY_LIMIT = 100;

/** 一类状态 T 的撤销 / 重做历史：过去、将来和合并键三项；「现在的样子」不存在这里，由调用方持有。 */
export interface History<T> {
  /** 旧的在前；最后一项是上一步之前的样子。 */
  past: readonly T[];
  /** 撤销掉的步骤，最近撤销的在前。 */
  future: readonly T[];
  /** 上一步的合并键：连续在同一个输入框里打字只算一步。撤销、重做之后清空。 */
  mergeKey: string | null;
}

/** 撤销或重做一步的结果：新的历史和要显示的样子。 */
export interface Stepped<T> {
  history: History<T>;
  present: T;
}

/** 空历史：刚打开设计器，还没有可撤销、可重做的步骤。 */
export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], mergeKey: null };
}

/**
 * 记下一步：before 是改之前的样子。mergeKey 和上一步相同时不新增一步（撤销时一次回到开始打字之前）。
 * 做了新的修改，重做的记录就作废。
 */
export function record<T>(history: History<T>, before: T, mergeKey: string | null = null): History<T> {
  if (mergeKey !== null && mergeKey === history.mergeKey) {
    return { ...history, future: [] };
  }
  return { past: [...history.past, before].slice(-HISTORY_LIMIT), future: [], mergeKey };
}

/** 撤销：回到上一步之前的样子；没有可撤销的返回 null。 */
export function undo<T>(history: History<T>, present: T): Stepped<T> | null {
  if (history.past.length === 0) {
    return null;
  }
  const previous = history.past[history.past.length - 1] as T;
  return {
    history: { past: history.past.slice(0, -1), future: [present, ...history.future], mergeKey: null },
    present: previous,
  };
}

/** 重做：回到最近撤销掉的那一步；没有可重做的返回 null。 */
export function redo<T>(history: History<T>, present: T): Stepped<T> | null {
  if (history.future.length === 0) {
    return null;
  }
  const [next, ...rest] = history.future;
  return {
    history: { past: [...history.past, present].slice(-HISTORY_LIMIT), future: rest, mergeKey: null },
    present: next as T,
  };
}

/**
 * 清空合并键：输入框失焦时调用。不清空的话，焦点挪走又挪回来之后接着打字会被当成同一步合并掉，
 * 撤销一次就把失焦前后两次编辑都撤掉。
 */
export function endMerge<T>(history: History<T>): History<T> {
  return history.mergeKey === null ? history : { ...history, mergeKey: null };
}
