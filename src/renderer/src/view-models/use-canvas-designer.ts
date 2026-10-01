import { useMemo, useState } from 'react';
import {
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasElementKind,
  type CanvasTemplate,
} from '../../../core/templates/canvas-model';
import {
  type Alignment,
  addElement,
  alignElements,
  bringToFront,
  copyElements,
  type DistributeAxis,
  deleteElements,
  distributeElements,
  MIN_DISTRIBUTE_COUNT,
  moveBy,
  type Point,
  pasteElements,
  sendToBack,
} from '../lib/canvas-edit';
import {
  emptyHistory,
  endMerge as endHistoryMerge,
  type History,
  record,
  redo as redoStep,
  type Stepped,
  undo as undoStep,
} from '../lib/canvas-history';
import type { DesignerCommand } from '../lib/canvas-view';
import { deepEqual } from '../lib/deep-equal';
import { megabytes } from '../lib/gray-image';
import { notices } from '../lib/notices';

/** 缩放：「适合窗口」随窗口大小变，或者固定的倍数。 */
export type ZoomSetting = 'fit' | number;

interface CanvasDesignerOptions {
  /** 模板页的草稿（use-templates）：设计器不另存一份。 */
  draft: CanvasTemplate;
  onChange: (next: CanvasTemplate) => void;
}

/** 元素到上限时的提示：说清上限和下一步。 */
const ELEMENT_LIMIT_NOTICE = `一个模板最多 ${CANVAS_LIMITS.elements} 个元素：先删掉不用的再加`;

/** 粘贴时有图片因为超出模板图片总量被跳过：和元素数到上限分开说，下一步不一样（删图 vs 删元素）。 */
function imageLimitNotice(skippedImages: number): string {
  return `有 ${skippedImages} 张图片超出图片总量上限（一个模板最多 ${megabytes(CANVAS_LIMITS.templateImageBytes)}MB），未粘贴：先删掉一张图片再粘贴`;
}

/**
 * 设计器的状态：选中的元素、撤销历史、设计器自己的剪贴板、缩放、网格和吸附开关。
 * 每次修改都经 commit：先记历史，再交给草稿。剪贴板只在内存里：页面的剪贴板权限一律被拒绝，
 * 也不需要跨程序粘贴元素。
 */
export function useCanvasDesigner({ draft, onChange }: CanvasDesignerOptions) {
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [history, setHistory] = useState<History<CanvasTemplate>>(emptyHistory);
  const [clipboard, setClipboard] = useState<readonly CanvasElement[]>([]);
  const [zoom, setZoom] = useState<ZoomSetting>('fit');
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);

  // 撤销、删除之后，选中的元素可能已经不在了：只留还在的。
  const liveSelection = useMemo(
    () => selection.filter((id) => draft.elements.some((element) => element.id === id)),
    [selection, draft.elements],
  );
  const movableCount = draft.elements.filter((element) => liveSelection.includes(element.id) && !element.locked).length;

  /**
   * 每一次修改都经过这里：先记下改之前的样子（撤销用），再交给草稿；没有变化的不记。
   * mergeKey 非空时（同一个输入框连续打字、同一组元素连续按方向键）和上一步相同就合并成一步；
   * 焦点离开正在连续输入的文字框时要调用 endMerge，不然焦点挪回来接着打字会被并进失焦前的那一步。
   */
  const commit = (next: CanvasTemplate, mergeKey: string | null = null) => {
    if (deepEqual(next, draft)) {
      return;
    }
    setHistory((current) => record(current, draft, mergeKey));
    onChange(next);
  };
  /** 结束当前的合并：属性栏（Task 14）的文字框失焦时调用。 */
  const endMerge = () => setHistory((current) => endHistoryMerge(current));
  const apply = (stepped: Stepped<CanvasTemplate> | null) => {
    if (stepped !== null) {
      setHistory(stepped.history);
      onChange(stepped.present);
    }
  };
  const undo = () => apply(undoStep(history, draft));
  const redo = () => apply(redoStep(history, draft));

  const add = (kind: CanvasElementKind, center?: Point) => {
    const added = addElement(draft, kind, center);
    if (added === null) {
      notices.push('warning', ELEMENT_LIMIT_NOTICE);
      return;
    }
    commit(added.template);
    setSelection(added.ids);
  };
  const copy = () => {
    if (liveSelection.length > 0) {
      setClipboard(copyElements(draft, liveSelection));
    }
  };
  const paste = () => {
    if (clipboard.length === 0) {
      return;
    }
    const pasted = pasteElements(draft, clipboard);
    // 两种跳过的原因分开提示：图片超出模板图片总量，和元素数到了上限，下一步不一样。
    if (pasted.skippedImages > 0) {
      notices.push('warning', imageLimitNotice(pasted.skippedImages));
    }
    if (pasted.ids.length + pasted.skippedImages < clipboard.length) {
      notices.push('warning', ELEMENT_LIMIT_NOTICE);
    }
    if (pasted.ids.length === 0) {
      return;
    }
    commit(pasted.template);
    setSelection(pasted.ids);
    // 只有整批都贴成功才把剪贴板换成这一批（下次再粘贴从这几个往下错开，不和它们叠在一起）；
    // 有跳过的（图片超量、或者碰到元素数上限）剪贴板保持原样不动，再粘贴一次还能贴出跳过的那些。
    if (pasted.ids.length === clipboard.length) {
      setClipboard(pasted.template.elements.filter((element) => pasted.ids.includes(element.id)));
    }
  };
  const remove = () => commit(deleteElements(draft, liveSelection));
  // 连续按方向键挪同一组元素算一步撤销。
  const nudge = (dx: number, dy: number) =>
    commit(moveBy(draft, liveSelection, dx, dy), `nudge:${liveSelection.join(',')}`);

  /** 画布上的按键：用掉了返回 true（调用方拦下这个按键）；没用掉（没选中时的方向键、Esc）返回 false。 */
  const runCommand = (command: DesignerCommand): boolean => {
    const hasSelection = liveSelection.length > 0;
    switch (command.kind) {
      case 'undo':
        undo();
        return true;
      case 'redo':
        redo();
        return true;
      case 'paste':
        paste();
        return true;
      case 'copy':
        copy();
        return hasSelection;
      case 'delete':
        remove();
        return hasSelection;
      case 'nudge':
        nudge(command.dx, command.dy);
        return hasSelection;
      case 'deselect':
        setSelection([]);
        return hasSelection;
    }
  };

  return {
    selection: liveSelection,
    select: setSelection,
    commit,
    endMerge,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    hasSelection: liveSelection.length > 0,
    canPaste: clipboard.length > 0,
    canDistribute: movableCount >= MIN_DISTRIBUTE_COUNT,
    add,
    copy,
    paste,
    remove,
    align: (alignment: Alignment) => commit(alignElements(draft, liveSelection, alignment)),
    distribute: (axis: DistributeAxis) => commit(distributeElements(draft, liveSelection, axis)),
    toFront: () => commit(bringToFront(draft, liveSelection)),
    toBack: () => commit(sendToBack(draft, liveSelection)),
    runCommand,
    zoom,
    setZoom,
    showGrid,
    setShowGrid,
    snap,
    setSnap,
  };
}

export type CanvasDesignerViewModel = ReturnType<typeof useCanvasDesigner>;
