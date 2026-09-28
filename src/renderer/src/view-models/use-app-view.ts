import { useCallback, useEffect, useRef, useState } from 'react';
import { type AppView, backStep, type ConfigPage, isConfigShortcut, type Platform, WORKBENCH } from '../lib/app-view';

/** 当前页面里的编辑器（模板或规则的编辑视图）；由页面的 view-model 提供。 */
export interface EditorGuard {
  isEditing: boolean;
  isDirty: boolean;
  /** 关掉编辑器回到列表，丢掉未保存的修改。 */
  close: () => void;
}

export const NO_EDITOR: EditorGuard = { isEditing: false, isDirty: false, close: () => undefined };

/** 离开有未保存修改的编辑器前的确认。 */
export interface LeaveConfirm {
  onDiscard: () => void;
  onContinue: () => void;
}

/** 配置中心淡出的时长，与 tokens.css 的 --config-duration 一致。 */
const CONFIG_TRANSITION_MS = 160;
const DEFAULT_PAGE: ConfigPage = 'templates';

function transitionMs(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : CONFIG_TRANSITION_MS;
}

interface AppViewOptions {
  platform: Platform;
  /** 每次离开前调用，读取当前页面编辑器的最新状态。 */
  editor: () => EditorGuard;
}

/**
 * 整个窗口的视图：工作台，或配置中心的某一页。
 * - 任何离开编辑器的动作（切换页面、返回、关闭、快捷键、Esc、跳转链接）都经过 requestLeave：
 *   有未保存的修改时先确认，放弃修改后才执行。
 * - 再次打开时回到上次的页面（本次运行内记住）。
 * - Ctrl+,（macOS ⌘,）开关配置中心；Esc 返回上一级（下拉框和输入法组字时的 Esc 除外）。
 */
export function useAppView({ platform, editor }: AppViewOptions) {
  const [view, setView] = useState<AppView>(WORKBENCH);
  const [isLeaving, setIsLeaving] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const lastPage = useRef<ConfigPage>(DEFAULT_PAGE);
  const leaveTimer = useRef<number | null>(null);
  const editorRef = useRef(editor);

  useEffect(() => {
    editorRef.current = editor;
  });

  const cancelLeaving = useCallback(() => {
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setIsLeaving(false);
  }, []);

  useEffect(() => cancelLeaving, [cancelLeaving]);

  const requestLeave = useCallback((action: () => void) => {
    const current = editorRef.current();
    const leave = () => {
      if (current.isEditing) {
        current.close();
      }
      action();
    };
    if (current.isDirty) {
      setPendingLeave(() => leave);
    } else {
      leave();
    }
  }, []);

  const showPage = useCallback(
    (page: ConfigPage) => {
      cancelLeaving();
      lastPage.current = page;
      setView({ kind: 'config', page });
    },
    [cancelLeaving],
  );

  /** 打开配置中心或切换页面；不传页面时回到上次的页面。 */
  const open = useCallback(
    (page?: ConfigPage) => requestLeave(() => showPage(page ?? lastPage.current)),
    [requestLeave, showPage],
  );

  const close = useCallback(
    () =>
      requestLeave(() => {
        setIsLeaving(true);
        leaveTimer.current = window.setTimeout(() => {
          leaveTimer.current = null;
          setIsLeaving(false);
          setView(WORKBENCH);
        }, transitionMs());
      }),
    [requestLeave],
  );

  const isOpen = view.kind === 'config' && !isLeaving;
  const toggle = useCallback(() => (isOpen ? close() : open()), [isOpen, close, open]);

  const back = useCallback(() => {
    switch (backStep(view, editorRef.current().isEditing)) {
      case 'close-editor':
        requestLeave(() => undefined);
        break;
      case 'close-config':
        close();
        break;
      case 'none':
        break;
    }
  }, [view, requestLeave, close]);

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyHandler.current = (event) => {
      // 确认框开着时由它自己处理按键。
      if (pendingLeave) {
        return;
      }
      if (isConfigShortcut(event, platform)) {
        event.preventDefault();
        toggle();
        return;
      }
      const isEscape = event.key === 'Escape' && !event.isComposing;
      if (isEscape && isOpen && !(event.target instanceof HTMLSelectElement)) {
        event.preventDefault();
        back();
      }
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const leaveConfirm: LeaveConfirm | null = pendingLeave && {
    onDiscard: () => {
      setPendingLeave(null);
      pendingLeave();
    },
    onContinue: () => setPendingLeave(null),
  };

  return { view, isLeaving, open, close, toggle, back, requestLeave, leaveConfirm };
}
