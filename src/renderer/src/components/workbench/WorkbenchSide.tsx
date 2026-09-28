import { type ReactNode, useState } from 'react';

type SideTab = 'printers' | 'history';

const TABS: ReadonlyArray<{ id: SideTab; label: string }> = [
  { id: 'printers', label: '打印机' },
  { id: 'history', label: '打印记录' },
];

interface WorkbenchSideProps {
  printers: ReactNode;
  history: ReactNode;
}

/** 工作台右侧栏：打印机 | 打印记录。非当前标签只隐藏不卸载，搜索词和滚动位置都保留。 */
export function WorkbenchSide({ printers, history }: WorkbenchSideProps) {
  const [active, setActive] = useState<SideTab>('printers');
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
            onClick={() => setActive(tab.id)}
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
