import type { ConfigPage } from './app-view';

/** 当前页里的编辑器：模板、规则或通知接口的编辑草稿。 */
export interface EditorGuard {
  isEditing: boolean;
  isDirty: boolean;
  /** 关掉编辑器回到列表，丢掉未保存的修改。 */
  close: () => void;
}

/** 某一页的草稿状态。 */
export interface PageDraft {
  isEditing: boolean;
  isDirty: boolean;
}

/**
 * 当前页的编辑器。草稿按页面区分：点「新建规则」后马上切到模板页，稍后才建好的规则草稿不会冒充模板页的编辑器。
 * 关闭时关掉所有页面的草稿：这样离开任何一页，别的页面残留的草稿都一并丢掉，回去时不会突然出现。
 */
export function editorForPage(
  page: ConfigPage | null,
  drafts: Partial<Record<ConfigPage, PageDraft>>,
  closeAll: () => void,
): EditorGuard {
  const draft = page === null ? undefined : drafts[page];
  return {
    isEditing: draft?.isEditing ?? false,
    isDirty: draft?.isDirty ?? false,
    close: closeAll,
  };
}

export interface LeavePlan {
  /** 有未保存的修改：先弹确认框，选「放弃修改」才执行 leave。 */
  needsConfirm: boolean;
  /** 先关掉草稿，再执行离开的动作。 */
  leave: () => void;
}

/** 任何离开编辑器的动作（切换页面、返回、关闭、快捷键、Esc、跳转链接）都按这个计划执行。 */
export function planLeave(editor: EditorGuard, action: () => void): LeavePlan {
  return {
    needsConfirm: editor.isDirty,
    leave: () => {
      editor.close();
      action();
    },
  };
}
