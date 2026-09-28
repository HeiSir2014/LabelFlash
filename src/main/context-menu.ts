import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';

export type ContextMenuState = Pick<ContextMenuParams, 'isEditable' | 'selectionText'> & {
  editFlags: Pick<ContextMenuParams['editFlags'], 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll'>;
};

/**
 * 右键菜单。Electron 不自带网页的右键菜单，安装版又去掉了应用菜单：不加的话，
 * 不熟悉 Ctrl+V 的操作员没法把编码粘贴进扫码框、搜索框或模板编辑器。
 * 可编辑区域给完整的编辑项，选中的只读文字只给复制，其他地方不弹菜单（只有一项灰色菜单不如不弹）。
 * 快捷键只作显示：这些键在渲染进程里已经生效，注册成应用级快捷键反而会盖住它们。
 */
export function buildContextMenuTemplate(state: ContextMenuState): MenuItemConstructorOptions[] {
  const { editFlags } = state;
  const copy: MenuItemConstructorOptions = {
    label: '复制',
    role: 'copy',
    accelerator: 'CmdOrCtrl+C',
    registerAccelerator: false,
    enabled: editFlags.canCopy,
  };
  if (state.isEditable) {
    return [
      { label: '剪切', role: 'cut', accelerator: 'CmdOrCtrl+X', registerAccelerator: false, enabled: editFlags.canCut },
      copy,
      {
        label: '粘贴',
        role: 'paste',
        accelerator: 'CmdOrCtrl+V',
        registerAccelerator: false,
        enabled: editFlags.canPaste,
      },
      { type: 'separator' },
      {
        label: '全选',
        role: 'selectAll',
        accelerator: 'CmdOrCtrl+A',
        registerAccelerator: false,
        enabled: editFlags.canSelectAll,
      },
    ];
  }
  if (state.selectionText.trim() !== '') {
    return [copy];
  }
  return [];
}
