/**
 * 画布的右键菜单（浮动工具条的「⋯」打开同一个）：有哪些项、哪些能用、快捷键怎么写。纯函数，组件只管画和键盘。
 */
import type { Platform } from './app-view';
import type { Alignment, DistributeAxis } from './canvas-edit';
import type { LayerMove } from './canvas-view';
import { shortcutLabel } from './designer-shortcuts';

/** 菜单项做的事：视图模型据此执行（见 use-canvas-designer 的 runMenuAction）。 */
export type MenuAction =
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'duplicate' }
  | { kind: 'delete' }
  | { kind: 'selectAll' }
  | { kind: 'layer'; move: LayerMove }
  | { kind: 'lock'; locked: boolean }
  | { kind: 'align'; alignment: Alignment }
  | { kind: 'distribute'; axis: DistributeAxis };

export interface MenuItem {
  id: string;
  label: string;
  /** 快捷键（按平台写好）；没有时是空字符串。 */
  shortcut: string;
  disabled: boolean;
  /** 和上一项之间画一条分隔线。 */
  separatorBefore: boolean;
  action: MenuAction | null;
  /** 有子菜单（「对齐」）时 action 为 null。 */
  submenu: readonly MenuItem[] | null;
}

export interface MenuState {
  selectionCount: number;
  canPaste: boolean;
  /** 选中的全都锁定了：锁定那一项变成「解锁」，删除不可用（锁定的删不掉）。 */
  allLocked: boolean;
  /** 能不能等距（选中的没锁定的至少三个）。 */
  canDistribute: boolean;
  platform: Platform;
}

const ALIGN_ITEMS: ReadonlyArray<{ alignment: Alignment; label: string }> = [
  { alignment: 'left', label: '左对齐' },
  { alignment: 'center', label: '水平居中' },
  { alignment: 'right', label: '右对齐' },
  { alignment: 'top', label: '顶对齐' },
  { alignment: 'middle', label: '垂直居中' },
  { alignment: 'bottom', label: '底对齐' },
];

const DISTRIBUTE_ITEMS: ReadonlyArray<{ axis: DistributeAxis; label: string }> = [
  { axis: 'horizontal', label: '水平等距' },
  { axis: 'vertical', label: '垂直等距' },
];

const LAYER_ITEMS: ReadonlyArray<{ move: LayerMove; label: string }> = [
  { move: 'front', label: '置顶' },
  { move: 'forward', label: '上移一层' },
  { move: 'backward', label: '下移一层' },
  { move: 'back', label: '置底' },
];

/** 对齐至少要两个：一个元素的对齐（到安全区）在检查器的「排列」里。 */
const MIN_ALIGN_COUNT = 2;

function item(
  id: string,
  label: string,
  action: MenuAction | null,
  options: { shortcut?: string; disabled?: boolean; separatorBefore?: boolean; submenu?: readonly MenuItem[] } = {},
): MenuItem {
  return {
    id,
    label,
    shortcut: options.shortcut ?? '',
    disabled: options.disabled ?? false,
    separatorBefore: options.separatorBefore ?? false,
    action,
    submenu: options.submenu ?? null,
  };
}

/** 右键菜单的项：复制、粘贴、复制一份、删除；叠放四项；锁定 / 解锁；选两个以上时有「对齐」子菜单；没选中时有「全选」。 */
export function contextMenuItems(state: MenuState): MenuItem[] {
  const { selectionCount, canPaste, allLocked, platform } = state;
  const none = selectionCount === 0;
  const items: MenuItem[] = [
    item('copy', '复制', { kind: 'copy' }, { shortcut: shortcutLabel('copy', platform), disabled: none }),
    item('paste', '粘贴', { kind: 'paste' }, { shortcut: shortcutLabel('paste', platform), disabled: !canPaste }),
    item(
      'duplicate',
      '复制一份',
      { kind: 'duplicate' },
      { shortcut: shortcutLabel('duplicate', platform), disabled: none },
    ),
    item(
      'delete',
      '删除',
      { kind: 'delete' },
      { shortcut: shortcutLabel('delete', platform), disabled: none || allLocked },
    ),
  ];
  if (none) {
    items.push(
      item(
        'selectAll',
        '全选',
        { kind: 'selectAll' },
        { shortcut: shortcutLabel('selectAll', platform), separatorBefore: true },
      ),
    );
    return items;
  }
  LAYER_ITEMS.forEach((layer, index) => {
    items.push(
      item(
        layer.move,
        layer.label,
        { kind: 'layer', move: layer.move },
        { shortcut: shortcutLabel(layer.move, platform), separatorBefore: index === 0 },
      ),
    );
  });
  items.push(
    item(
      allLocked ? 'unlock' : 'lock',
      allLocked ? '解锁' : '锁定',
      { kind: 'lock', locked: !allLocked },
      {
        separatorBefore: true,
      },
    ),
  );
  if (selectionCount >= MIN_ALIGN_COUNT) {
    items.push(
      item('align', '对齐', null, {
        submenu: ALIGN_ITEMS.map((align) => item(`align-${align.alignment}`, align.label, { kind: 'align', ...align })),
      }),
      // 浮动工具条上多选只放对齐，等距在这里；少于三个时灰着（两个之间没有「中间」可分）。
      item('distribute', '等距', null, {
        disabled: !state.canDistribute,
        submenu: DISTRIBUTE_ITEMS.map((distribute) =>
          item(`distribute-${distribute.axis}`, distribute.label, { kind: 'distribute', axis: distribute.axis }),
        ),
      }),
    );
  }
  return items;
}

/**
 * 键盘上下移动：从 current 往 direction 方向找下一个能用的项，到头了绕回来；current 为 -1（还没有焦点）时
 * 往下从第一项、往上从最后一项开始找。一项都不能用时返回 -1。
 */
export function nextEnabledIndex(
  items: readonly Pick<MenuItem, 'disabled'>[],
  current: number,
  direction: 1 | -1,
): number {
  const count = items.length;
  const start = current === -1 ? (direction === 1 ? -1 : count) : current;
  for (let step = 1; step <= count; step += 1) {
    const index = (((start + direction * step) % count) + count) % count;
    if (items[index]?.disabled === false) {
      return index;
    }
  }
  return -1;
}
