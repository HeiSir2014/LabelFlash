/**
 * 设计器的快捷键：按钮悬停提示里写的、快捷键表（F1、「?」）里列的，都从这里取，按平台写成 Ctrl+Z 或 ⌘Z。
 * 真正处理按键的在 canvas-view.ts 的 designerCommand；这里只管「怎么写给人看」。纯函数。
 */
import type { Platform } from './app-view';

/** 一个按键组合：mod 是 Windows 的 Ctrl、macOS 的 ⌘；key 是键名，pointer 是鼠标动作（「点击」「拖动」）。 */
export interface KeyCombo {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  key?: string;
  pointer?: string;
}

/** 键名在 macOS 上的写法：系统菜单里删除键写成 ⌫。 */
const MAC_KEY_NAMES: Readonly<Record<string, string>> = { Delete: '⌫', Enter: '↩', Escape: 'Esc' };

/** 一个组合写成文字：Windows「Ctrl+Shift+]」，macOS 按系统菜单的顺序「⇧⌘]」（⌥ ⇧ ⌘ 在前，不用加号）。 */
export function comboLabel(combo: KeyCombo, platform: Platform): string {
  const target = combo.key ?? combo.pointer ?? '';
  if (platform === 'mac') {
    const key = combo.key === undefined ? target : (MAC_KEY_NAMES[combo.key] ?? combo.key);
    return `${combo.alt ? '⌥' : ''}${combo.shift ? '⇧' : ''}${combo.mod ? '⌘' : ''}${key}`;
  }
  return [combo.mod ? 'Ctrl' : null, combo.shift ? 'Shift' : null, combo.alt ? 'Alt' : null, target]
    .filter((part): part is string => part !== null)
    .join('+');
}

export interface DesignerShortcut {
  id: string;
  /** 快捷键表里这一行做什么。 */
  label: string;
  group: '编辑' | '选择' | '移动和叠放' | '视图';
  combos: readonly KeyCombo[];
  /** 只在 macOS 或只在其他平台列出的组合（例如 macOS 上重做习惯 ⇧⌘Z）；不写就两边都列。 */
  macCombos?: readonly KeyCombo[];
}

/** 快捷键表：一行一项，按分组列。画布不拦字母、数字（扫码枪会打这些字），所以这里没有单个字母的快捷键。 */
export const DESIGNER_SHORTCUTS: readonly DesignerShortcut[] = [
  { id: 'undo', label: '撤销', group: '编辑', combos: [{ mod: true, key: 'Z' }] },
  {
    id: 'redo',
    label: '重做',
    group: '编辑',
    combos: [
      { mod: true, key: 'Y' },
      { mod: true, shift: true, key: 'Z' },
    ],
    macCombos: [{ mod: true, shift: true, key: 'Z' }],
  },
  { id: 'copy', label: '复制', group: '编辑', combos: [{ mod: true, key: 'C' }] },
  { id: 'paste', label: '粘贴', group: '编辑', combos: [{ mod: true, key: 'V' }] },
  { id: 'duplicate', label: '复制一份', group: '编辑', combos: [{ mod: true, key: 'D' }] },
  { id: 'delete', label: '删除', group: '编辑', combos: [{ key: 'Delete' }] },
  { id: 'editText', label: '改文字（就地编辑）', group: '编辑', combos: [{ pointer: '双击' }] },
  { id: 'commitText', label: '改完文字', group: '编辑', combos: [{ mod: true, key: 'Enter' }] },
  { id: 'selectAll', label: '全选（锁定的除外）', group: '选择', combos: [{ mod: true, key: 'A' }] },
  {
    id: 'addToSelection',
    label: '加选 / 减选',
    group: '选择',
    combos: [
      { shift: true, pointer: '点击' },
      { mod: true, pointer: '点击' },
    ],
  },
  { id: 'cycle', label: '选叠在下面的元素', group: '选择', combos: [{ alt: true, pointer: '点击' }] },
  { id: 'marquee', label: '框选（从元素上开始也行）', group: '选择', combos: [{ mod: true, pointer: '拖动' }] },
  { id: 'deselect', label: '取消选中', group: '选择', combos: [{ key: 'Esc' }] },
  { id: 'nudge', label: '移动 0.1mm', group: '移动和叠放', combos: [{ key: '方向键' }] },
  { id: 'nudgeLarge', label: '移动 1mm', group: '移动和叠放', combos: [{ shift: true, key: '方向键' }] },
  {
    id: 'keepRatio',
    label: '缩放时保持比例（图片、二维码默认保持，按住放开）',
    group: '移动和叠放',
    combos: [{ shift: true, pointer: '拖控制点' }],
  },
  { id: 'forward', label: '上移一层', group: '移动和叠放', combos: [{ mod: true, key: ']' }] },
  { id: 'backward', label: '下移一层', group: '移动和叠放', combos: [{ mod: true, key: '[' }] },
  { id: 'front', label: '置顶', group: '移动和叠放', combos: [{ mod: true, shift: true, key: ']' }] },
  { id: 'back', label: '置底', group: '移动和叠放', combos: [{ mod: true, shift: true, key: '[' }] },
  { id: 'zoomFit', label: '适合窗口', group: '视图', combos: [{ mod: true, key: '0' }] },
  { id: 'zoomActual', label: '100%', group: '视图', combos: [{ mod: true, key: '1' }] },
  {
    id: 'zoomWheel',
    label: '以指针为中心缩放（触控板捏合也行）',
    group: '视图',
    combos: [{ mod: true, pointer: '滚轮' }],
  },
  {
    id: 'pan',
    label: '平移画布（也可以按住中键拖、两指滚动）',
    group: '视图',
    combos: [{ key: '空格', pointer: '拖动' }],
  },
  { id: 'help', label: '快捷键表', group: '视图', combos: [{ key: 'F1' }] },
];

function combosOf(shortcut: DesignerShortcut, platform: Platform): readonly KeyCombo[] {
  return platform === 'mac' && shortcut.macCombos !== undefined ? shortcut.macCombos : shortcut.combos;
}

/** 一项的全部组合（「Ctrl+Y / Ctrl+Shift+Z」）；没有这一项时是空字符串。 */
export function shortcutLabel(id: string, platform: Platform): string {
  const shortcut = DESIGNER_SHORTCUTS.find((candidate) => candidate.id === id);
  if (shortcut === undefined) {
    return '';
  }
  return combosOf(shortcut, platform)
    .map((combo) =>
      combo.key !== undefined && combo.pointer !== undefined
        ? `${comboLabel({ ...combo, pointer: undefined }, platform)}+${combo.pointer}`
        : comboLabel(combo, platform),
    )
    .join(' / ');
}

/** 按钮的悬停提示：名字后面括上快捷键（「置顶（Ctrl+Shift+]）」）。 */
export function withShortcut(name: string, id: string, platform: Platform): string {
  const label = shortcutLabel(id, platform);
  return label === '' ? name : `${name}（${label}）`;
}
