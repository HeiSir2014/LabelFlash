import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';

export interface InspectorTab<T extends string> {
  id: T;
  label: string;
  content: ReactNode;
}

interface InspectorProps<T extends string> {
  tabs: readonly InspectorTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** 所有标签页上面都显示的东西（选中元素的问题）。 */
  header?: ReactNode;
}

/**
 * 右栏的检查器：顶上一排分段标签（按选中的东西换：文字「文字 / 排列 / 图层」，没选中「模板 / 图层」……），
 * 下面是当前那一页。标签之间用左右方向键切换（WAI-ARIA 的 tabs 做法），Tab 键直接进到页面内容。
 */
export function Inspector<T extends string>({ tabs, active, onSelect, header }: InspectorProps<T>) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 || current === undefined) {
      return;
    }
    event.preventDefault();
    const index = tabs.indexOf(current);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next !== undefined) {
      onSelect(next.id);
      listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${baseId}-${next.id}`)}`)?.focus();
    }
  };

  return (
    <aside className="inspector" aria-label="检查器">
      <div ref={listRef} className="inspector__tabs" role="tablist" aria-label="检查器" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${baseId}-${tab.id}`}
            type="button"
            role="tab"
            className="inspector__tab"
            aria-selected={tab.id === current?.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab.id === current?.id ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`${baseId}-panel`}
        className="inspector__panel"
        role="tabpanel"
        aria-labelledby={current === undefined ? undefined : `${baseId}-${current.id}`}
      >
        {header}
        {current?.content}
      </div>
    </aside>
  );
}
