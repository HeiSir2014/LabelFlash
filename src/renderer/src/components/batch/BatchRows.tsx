// biome-ignore-all lint/a11y/useSemanticElements: 虚拟滚动只画视野里的行，需要用绝对定位的 div（见 app.css 的
// .batch-rows__row），原生 <table>/<tr>/<td> 做不到；用 role="table"/"row"/"columnheader"/"cell" 是
// WAI-ARIA 给这类自定义表格推荐的标准写法（react-window、各家虚拟表格都是这样做的），不是偷懒。
// biome-ignore-all lint/a11y/useFocusableInteractive: 可以 Tab 到的是格子里真正的控件（复选框、按钮），
// 行本身不是一个可操作的控件，不需要单独可聚焦——这和只有格子（gridcell）可聚焦、行只是分组的标准网格模式一致。
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { BatchTable } from '../../../../core/batch/batch-model';
import type { BatchFailure } from '../../../../core/batch/batch-runner';
import { BATCH_ROW_HEIGHT_PX, visibleRange } from '../../lib/batch-view';
import { describeFailureShort } from '../../lib/status-text';

interface BatchRowsProps {
  columns: readonly string[];
  table: BatchTable | null;
  /** 要显示的行（搜索结果，0 起的下标）。 */
  rows: readonly number[];
  /** 有问题的行（键是从 1 数的行号）：标黄，问题写在悬停提示里。 */
  problems: ReadonlyMap<number, readonly string[]>;
  failures: ReadonlyMap<number, readonly BatchFailure[]>;
  currentRow: number;
  isSelected: (index: number) => boolean;
  isAllChecked: boolean;
  /** 现在能不能单独重打一行（有一批在打时不能）。 */
  canRetry: boolean;
  onToggleRow: (index: number) => void;
  onToggleAll: (checked: boolean) => void;
  onSelectRow: (index: number) => void;
  onRetryRow: (row: number) => void;
}

/** 要打的数据：表头固定，只画视野里的行（一万行也不卡），勾选要打的行，点行号看这一行的预览。 */
export function BatchRows({
  columns,
  table,
  rows,
  problems,
  failures,
  currentRow,
  isSelected,
  isAllChecked,
  canRetry,
  onToggleRow,
  onToggleAll,
  onSelectRow,
  onRetryRow,
}: BatchRowsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { start, end } = visibleRange(scrollTop, viewportHeight, rows.length);
  const style = { '--batch-columns': columns.length } as CSSProperties;

  return (
    <div
      ref={scrollRef}
      className="batch-rows"
      role="table"
      aria-label="要打的数据"
      aria-rowcount={rows.length + 1}
      style={style}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="batch-rows__row batch-rows__row--head" role="row">
        <span role="columnheader">
          <input
            type="checkbox"
            aria-label="全选（搜索结果）"
            checked={isAllChecked}
            onChange={(event) => onToggleAll(event.target.checked)}
          />
        </span>
        <span role="columnheader">行</span>
        {columns.map((column) => (
          <span key={column} role="columnheader" title={column}>
            {column}
          </span>
        ))}
        <span role="columnheader">结果</span>
      </div>
      <div className="batch-rows__body" style={{ height: rows.length * BATCH_ROW_HEIGHT_PX }}>
        {rows.slice(start, end).map((index, offset) => {
          const row = index + 1;
          const rowProblems = problems.get(row);
          const firstFailure = failures.get(row)?.[0];
          const classes = [
            'batch-rows__row',
            rowProblems === undefined ? null : 'batch-rows__row--problem',
            index === currentRow ? 'batch-rows__row--current' : null,
            isSelected(index) ? null : 'batch-rows__row--skipped',
          ]
            .filter((name) => name !== null)
            .join(' ');
          return (
            <div
              key={index}
              className={classes}
              role="row"
              aria-rowindex={start + offset + 2}
              aria-current={index === currentRow ? 'true' : undefined}
              title={rowProblems?.join('；')}
              style={{ top: (start + offset) * BATCH_ROW_HEIGHT_PX }}
            >
              <span role="cell">
                <input
                  type="checkbox"
                  aria-label={`打印第 ${row} 行`}
                  checked={isSelected(index)}
                  onChange={() => onToggleRow(index)}
                />
              </span>
              <span role="cell">
                <button
                  type="button"
                  className="link-button"
                  aria-label={`预览第 ${row} 行`}
                  onClick={() => onSelectRow(index)}
                >
                  {row}
                </button>
              </span>
              {columns.map((column, at) => {
                const cell = table?.rows[index]?.[at] ?? '';
                return (
                  <span key={column} role="cell" className="batch-rows__cell" title={cell}>
                    {cell}
                  </span>
                );
              })}
              <span role="cell">
                {firstFailure !== undefined && (
                  <span className="batch-rows__failed">
                    失败：{describeFailureShort(firstFailure.reason)}
                    {canRetry && (
                      <button
                        type="button"
                        className="link-button"
                        aria-label={`重打第 ${row} 行`}
                        onClick={() => onRetryRow(row)}
                      >
                        重打
                      </button>
                    )}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
