import type { ReactNode } from 'react';

export type SideTab = 'printers' | 'history';

const TABS: ReadonlyArray<{ id: SideTab; label: string }> = [
  { id: 'printers', label: '打印机' },
  { id: 'history', label: '打印记录' },
];

interface WorkbenchSideProps {
  printers: ReactNode;
  history: ReactNode;
  /** 当前标签页：由外面持有，标题栏的打印机胶囊和状态条的「去指定打印机」能切到打印机页。 */
  active: SideTab;
  onSelect: (tab: SideTab) => void;
}

/** 工作台右侧栏：打印机 | 打印记录。非当前标签只隐藏不卸载，搜索词和滚动位置都保留。 */
export function WorkbenchSide({ printers, history, active, onSelect }: WorkbenchSideProps) {
  const panels: Record<SideTab, ReactNode> = { printers, history };
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
            onClick={() => onSelect(tab.id)}
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
