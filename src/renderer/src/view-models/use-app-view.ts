import { useCallback, useEffect, useRef, useState } from 'react';
import { type AppView, backStep, type ConfigPage, isConfigShortcut, type Platform, WORKBENCH } from '../lib/app-view';
import { parseCssTime } from '../lib/css-time';
import { type EditorGuard, planLeave } from '../lib/editor-guard';

/** 离开有未保存修改的编辑器前的确认。 */
export interface LeaveConfirm {
  onDiscard: () => void;
  onContinue: () => void;
}

const DEFAULT_PAGE: ConfigPage = 'templates';

/** 配置中心淡出的时长：读 tokens.css 的 --config-duration（减少动态效果时是 0），读不到就不等。 */
function transitionMs(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--config-duration');
  return parseCssTime(value) ?? 0;
}

/** 下拉框和带候选列表的输入框里，Esc 是用来收起下拉的，不当作「返回」。 */
function isDropdown(target: EventTarget | null): boolean {
  return target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.hasAttribute('list'));
}

interface AppViewOptions {
  platform: Platform;
  /** 设置读到之前配置中心没有内容可显示：打开的操作都不响应。 */
  canOpen: boolean;
  /** 每次离开前调用，读取正在显示的那一页（工作台时为 null）的编辑器的最新状态。 */
  editor: (page: ConfigPage | null) => EditorGuard;
  /** 回到工作台之后调用（配置可能改过，工作台据此刷新）。 */
  onClosed: () => void;
}

/**
 * 整个窗口的视图：工作台，或配置中心的某一页。
 * - 任何离开编辑器的动作（切换页面、返回、关闭、快捷键、Esc、跳转链接）都经过 requestLeave：
 *   有未保存的修改时先确认，放弃修改后才执行。
 * - 再次打开时回到上次的页面（本次运行内记住）。
 * - 关闭时工作台立即恢复（扫码框马上能收码），配置中心只是淡出：淡出期间的 leavingPage 仍是那一页。
 * - Ctrl+,（macOS ⌘,）开关配置中心；Esc 返回上一级（下拉框、带候选的输入框和输入法组字时的 Esc 除外）。
 *   按住不放产生的重复按键不响应，免得配置中心反复开关、一路退回工作台。
 */
export function useAppView({ platform, canOpen, editor, onClosed }: AppViewOptions) {
  const [view, setView] = useState<AppView>(WORKBENCH);
  const [leavingPage, setLeavingPage] = useState<ConfigPage | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const lastPage = useRef<ConfigPage>(DEFAULT_PAGE);
  const leaveTimer = useRef<number | null>(null);
  const editorRef = useRef(editor);
  const onClosedRef = useRef(onClosed);

  useEffect(() => {
    editorRef.current = editor;
    onClosedRef.current = onClosed;
  });

  const shownPage = view.kind === 'config' ? view.page : null;

  const cancelLeaving = useCallback(() => {
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setLeavingPage(null);
  }, []);

  useEffect(() => cancelLeaving, [cancelLeaving]);

  const requestLeave = useCallback(
    (action: () => void) => {
      const plan = planLeave(editorRef.current(shownPage), action);
      if (plan.needsConfirm) {
        setPendingLeave(() => plan.leave);
      } else {
        plan.leave();
      }
    },
    [shownPage],
  );

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
    (page?: ConfigPage) => {
      if (canOpen) {
        requestLeave(() => showPage(page ?? lastPage.current));
      }
    },
    [canOpen, requestLeave, showPage],
  );

  const close = useCallback(
    () =>
      requestLeave(() => {
        cancelLeaving();
        setLeavingPage(lastPage.current);
        setView(WORKBENCH);
        leaveTimer.current = window.setTimeout(() => {
          leaveTimer.current = null;
          setLeavingPage(null);
        }, transitionMs());
        onClosedRef.current();
      }),
    [requestLeave, cancelLeaving],
  );

  const isOpen = view.kind === 'config';
  const toggle = useCallback(() => (isOpen ? close() : open()), [isOpen, close, open]);

  const back = useCallback(() => {
    switch (backStep(view, editorRef.current(shownPage).isEditing)) {
      case 'close-editor':
        requestLeave(() => undefined);
        break;
      case 'close-config':
        close();
        break;
      case 'none':
        break;
    }
  }, [view, shownPage, requestLeave, close]);

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyHandler.current = (event) => {
      // 确认框开着时由它自己处理按键。
      if (pendingLeave || event.repeat) {
        return;
      }
      if (isConfigShortcut(event, platform)) {
        event.preventDefault();
        toggle();
        return;
      }
      const isEscape = event.key === 'Escape' && !event.isComposing;
      if (isEscape && isOpen && !isDropdown(event.target)) {
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

  return { view, leavingPage, open, close, toggle, requestLeave, leaveConfirm };
}
