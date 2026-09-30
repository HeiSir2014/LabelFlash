import type { ReactNode } from 'react';

interface WorkbenchSideProps {
  history: ReactNode;
}

/**
 * 工作台右侧栏：打印记录。打印机（纸张分配、本机打印机）在配置中心的「打印机」页，
 * 标题栏的打印机状态和出错时的「去指定打印机」都能直接打开它；这里只留每天都看的记录。
 */
export function WorkbenchSide({ history }: WorkbenchSideProps) {
  return (
    <aside className="side" aria-label="打印记录">
      <div className="panel-body">{history}</div>
    </aside>
  );
}
