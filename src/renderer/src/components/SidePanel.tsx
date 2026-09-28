import type { ReactNode } from 'react';

export type SideTab = 'printers' | 'templates' | 'history' | 'settings';

const TABS: ReadonlyArray<{ id: SideTab; label: string }> = [
  { id: 'printers', label: '打印机' },
  { id: 'templates', label: '模板' },
  { id: 'history', label: '打印记录' },
  { id: 'settings', label: '设置' },
];

interface SidePanelProps {
  active: SideTab;
  onActiveChange: (tab: SideTab) => void;
  panels: Record<SideTab, ReactNode>;
}

/** 非当前标签页只隐藏不卸载：搜索词、滚动位置、编辑中的模板都会保留。 */
export function SidePanel({ active, onActiveChange, panels }: SidePanelProps) {
  return (
    <aside className="side">
      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            className="tab"
            onClick={() => onActiveChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          className="tab-panel"
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
        >
          {panels[tab.id]}
        </div>
      ))}
    </aside>
  );
}
