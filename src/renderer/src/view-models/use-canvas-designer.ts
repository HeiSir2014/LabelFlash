import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  bringForward,
  bringToFront,
  copyElements,
  type DistributeAxis,
  deleteElements,
  distributeElements,
  duplicateElements,
  MIN_DISTRIBUTE_COUNT,
  moveBy,
  moveLayer,
  type Point,
  pasteElements,
  replaceElement,
  sendBackward,
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
import type { DesignerCommand, LayerMove } from '../lib/canvas-view';
import { deepEqual } from '../lib/deep-equal';
import { megabytes } from '../lib/gray-image';
import { notices } from '../lib/notices';
import { useImageImport } from './use-image-import';

/** 缩放：「适合窗口」随窗口大小变，或者固定的倍数。 */
export type ZoomSetting = 'fit' | number;

interface CanvasDesignerOptions {
  /** 模板页的草稿（use-templates）：设计器不另存一份。 */
  draft: CanvasTemplate;
  onChange: (next: CanvasTemplate) => void;
}

/** Ctrl+1：实物大小（1 倍 = 屏幕上的毫米和纸上一样大）。 */
const ACTUAL_SIZE_ZOOM = 1;

const NO_IDS: ReadonlySet<string> = new Set();

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
  const [importingImageIds, setImportingImageIds] = useState<ReadonlySet<string>>(new Set());
  // 只在设计器里隐藏的元素（照常打印）：不存进模板，换模板（设计器重新挂载）就清空。
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NO_IDS);
  const [isShortcutSheetOpen, setIsShortcutSheetOpen] = useState(false);
  const importImagePixels = useImageImport();

  // 撤销、删除之后，选中的元素可能已经不在了：只留还在的。
  const liveSelection = useMemo(
    () => selection.filter((id) => draft.elements.some((element) => element.id === id)),
    [selection, draft.elements],
  );
  const movableCount = draft.elements.filter((element) => liveSelection.includes(element.id) && !element.locked).length;

  // 选图片要跨一次 await（解码、缩放可能要几百毫秒），这期间草稿可能已经变了——其它属性被改，
  // 甚至这个元素被删掉。commit 不能拿 await 之前闭包里的旧草稿当「改之前的样子」，必须用解码完成
  // 那一刻最新的草稿；按惯例用 ref 跟住，在 effect 里更新（不在渲染过程中改 ref）。
  // 用 useLayoutEffect 而不是 useEffect：useEffect 要等浏览器画完才跑（被调度为被动效果），如果
  // commit 紧跟着上一次渲染同步触发（例如程序化调用、测试里连续发事件，都来不及等一轮绘制），
  // ref 可能还没来得及更新成最新的 draft，commit 的「改之前的样子」就会读到上一轮的旧值。
  // useLayoutEffect 在浏览器画出来之前、提交 DOM 之后就同步跑完，仍然不是在渲染过程中改 ref，
  // 只是把更新的时机提前到比 useEffect 更早、但同样安全（已经提交，不会被中断重渲染打断）的地方。
  const draftRef = useRef(draft);
  // 跟住每个元素 id 的「续命代数」：这个 id 从元素列表里消失过一次（删除、撤销加入……），代数就加一。
  // importImage 解码完成时核对代数有没有变过——变过说明这期间删过这个 id，哪怕之后凑巧又有个新元素
  // 复用了同一个 id（`newElementId` 会回收删掉的号），解码结果也不该合并进这个不相干的新元素里。
  const idEpochRef = useRef(new Map<string, number>());
  // 上一次见到的 id 集合；undefined 表示还没有「上一次」（刚挂载）。和 draftRef 放进同一个
  // useLayoutEffect 一起更新：分开写的话，draftRef 已经指向新草稿、这里却还没来得及比对出
  // 「消失过」的 id，两者会短暂不一致。初始不在渲染时就地 new Set(...)：那样每次渲染都要新建
  // 一次集合，哪怕这次渲染根本用不上（只有草稿真的变了，下面的 effect 才会用到它）。
  const knownIdsRef = useRef<Set<string> | undefined>(undefined);
  useLayoutEffect(() => {
    draftRef.current = draft;
    const currentIds = new Set(draft.elements.map((element) => element.id));
    const previousIds = knownIdsRef.current;
    if (previousIds !== undefined) {
      for (const existingId of previousIds) {
        if (!currentIds.has(existingId)) {
          idEpochRef.current.set(existingId, (idEpochRef.current.get(existingId) ?? 0) + 1);
        }
      }
    }
    knownIdsRef.current = currentIds;
  }, [draft]);

  // 组件卸载后（切到别的模板、取消、保存关闭设计器）解码才完成：这份结果不再属于任何正在显示的画布，
  // 提交了也只是悄悄埋下一个看不见的脏改动，或者（配置页按 draft.id 给设计器建新实例时）错写进下一个
  // 打开的模板。用 ref 记"组件还挂着没有"：effect 里标记为挂载，卸载时的清理函数标记为未挂载。
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * 每一次修改都经过这里：先记下改之前的样子（撤销用），再交给草稿；没有变化的不记。
   * mergeKey 非空时（同一个输入框连续打字、同一组元素连续按方向键）和上一步相同就合并成一步；
   * 焦点离开正在连续输入的文字框时要调用 endMerge，不然焦点挪回来接着打字会被并进失焦前的那一步。
   * 「改之前的样子」读 draftRef 而不是闭包参数 draft：两者在同步调用里总是一致，但 importImage
   * 这类跨 await 的调用只有读 ref 才能拿到最新的，不会把 await 期间的改动当没发生过。
   */
  const commit = (next: CanvasTemplate, mergeKey: string | null = null) => {
    const before = draftRef.current;
    if (deepEqual(next, before)) {
      return;
    }
    setHistory((currentHistory) => record(currentHistory, before, mergeKey));
    onChange(next);
  };
  /** 结束当前的合并：属性栏的文字框失焦时调用。 */
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
  /** 复制一份（Ctrl+D）：不经剪贴板，剪贴板里原来的东西还在。 */
  const duplicate = () => {
    if (liveSelection.length === 0) {
      return;
    }
    const duplicated = duplicateElements(draft, liveSelection);
    if (duplicated.skippedImages > 0) {
      notices.push('warning', imageLimitNotice(duplicated.skippedImages));
    }
    if (duplicated.ids.length + duplicated.skippedImages < liveSelection.length) {
      notices.push('warning', ELEMENT_LIMIT_NOTICE);
    }
    if (duplicated.ids.length > 0) {
      commit(duplicated.template);
      setSelection(duplicated.ids);
    }
  };
  /** 全选（Ctrl+A）：和框选一样不选锁定、隐藏的元素——它们只能在图层列表里选。 */
  const selectAll = () =>
    setSelection(
      draft.elements.filter((element) => !element.locked && !hidden.has(element.id)).map((element) => element.id),
    );
  const moveLayers = (move: LayerMove) => {
    const moved = {
      forward: bringForward,
      backward: sendBackward,
      front: bringToFront,
      back: sendToBack,
    }[move](draft, liveSelection);
    commit(moved);
  };
  /** 改一个元素的一项（图层的锁定、改名）：一次点击、一次改名各是一步撤销。 */
  const updateElement = (id: string, patch: (element: CanvasElement) => CanvasElement) => {
    const element = draft.elements.find((candidate) => candidate.id === id);
    if (element !== undefined) {
      commit(replaceElement(draft, patch(element)));
    }
  };
  const toggleLock = (id: string) => updateElement(id, (element) => ({ ...element, locked: !element.locked }));
  const rename = (id: string, name: string) => updateElement(id, (element) => ({ ...element, name }));
  const reorder = (id: string, index: number) => commit(moveLayer(draft, id, index));
  /** 图层的「隐藏」：只在设计器里看不见、点不中（照常打印），不进模板、不进撤销历史。 */
  const toggleHidden = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  const remove = () => commit(deleteElements(draft, liveSelection));
  // 连续按方向键挪同一组元素算一步撤销。
  const nudge = (dx: number, dy: number) =>
    commit(moveBy(draft, liveSelection, dx, dy), `nudge:${liveSelection.join(',')}`);

  /**
   * 给一个图片元素选文件：解码交给 use-image-import（sandbox 的页面里做，主进程从不解码图片文件）。
   * 解码期间（可能几百毫秒）用 draftRef 读最新草稿去核对图片总量、去合并结果——不用调用这一刻闭包里的
   * 旧草稿，不然这期间如果删掉了这个元素，解码完成后会把它凭空加回来；如果改了别的属性，会被悄悄覆盖掉。
   * 解码完成时还要核对：组件是不是已经卸载、草稿是不是已经换成了另一个模板、这个 id 是不是已经被删过
   * （哪怕之后凑巧又有个新元素复用了同一个 id）——三条有一条不对就丢弃结果，不提交。
   * 不记合并键：换一张图是一次性的操作，不该和下一次换图或别的编辑并成一步撤销。
   */
  const importImage = async (id: string, file: File) => {
    const templateIdAtStart = draftRef.current.id;
    const epochAtStart = idEpochRef.current.get(id) ?? 0;
    setImportingImageIds((ids) => new Set(ids).add(id));
    try {
      const picked = await importImagePixels(file, id, draftRef.current.elements);
      if (picked === null) {
        return;
      }
      if (!isMountedRef.current || draftRef.current.id !== templateIdAtStart) {
        return;
      }
      const current = draftRef.current;
      const target = current.elements.find((element) => element.id === id);
      if (target === undefined || target.kind !== 'image' || (idEpochRef.current.get(id) ?? 0) !== epochAtStart) {
        return;
      }
      commit(replaceElement(current, { ...target, ...picked }));
    } finally {
      setImportingImageIds((ids) => {
        if (!ids.has(id)) {
          return ids;
        }
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }
  };
  const isImportingImage = (id: string) => importingImageIds.has(id);

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
      case 'duplicate':
        duplicate();
        return hasSelection;
      case 'selectAll':
        // 没有元素也拦下：不然 Ctrl+A 会把整页文字选中。
        selectAll();
        return true;
      case 'layer':
        moveLayers(command.move);
        return hasSelection;
      case 'zoom':
        setZoom(command.to === 'fit' ? 'fit' : ACTUAL_SIZE_ZOOM);
        return true;
      case 'help':
        setIsShortcutSheetOpen(true);
        return true;
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
    importImage,
    isImportingImage,
    duplicate,
    selectAll,
    align: (alignment: Alignment) => commit(alignElements(draft, liveSelection, alignment)),
    distribute: (axis: DistributeAxis) => commit(distributeElements(draft, liveSelection, axis)),
    moveLayers,
    runCommand,
    hidden,
    toggleHidden,
    toggleLock,
    rename,
    reorder,
    isShortcutSheetOpen,
    setIsShortcutSheetOpen,
    zoom,
    setZoom,
    showGrid,
    setShowGrid,
    snap,
    setSnap,
  };
}

export type CanvasDesignerViewModel = ReturnType<typeof useCanvasDesigner>;
