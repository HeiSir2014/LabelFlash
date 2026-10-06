import { type ReactNode, useCallback, useId } from 'react';
import { CONFIG_NAV, type ConfigPage, isFillPage, pageLabel } from '../../lib/app-view';
import type { ScanFieldType } from '../../lib/scan-field';
import { IgnoredScanPill, type ScanSink, ScanSinkField } from '../ScanSinkField';

/** 二级页面（编辑视图）的面包屑：「识别规则 / 编辑：下划线查货架」，第一段回到列表。 */
export interface Breadcrumb {
  current: string;
  onList: () => void;
}

interface ConfigCenterProps {
  page: ConfigPage;
  isLeaving: boolean;
  breadcrumb: Breadcrumb | null;
  sink: ScanSink;
  /** 接收框用密码框还是普通输入框（Windows 上用密码框关掉输入法，见 lib/scan-field.ts）。 */
  scanFieldType: ScanFieldType;
  /** 在没有测试框的页面扫了码的次数：大于 0 时显示「配置中不打印」，每变一次闪两下。 */
  pillFlashes: number;
  onNavigate: (page: ConfigPage) => void;
  onClose: () => void;
  children: ReactNode;
}

/** 铺满标题栏以下的配置中心：左侧分组导航，右侧页头 + 页面内容。 */
export function ConfigCenter({
  page,
  isLeaving,
  breadcrumb,
  sink,
  scanFieldType,
  pillFlashes,
  onNavigate,
  onClose,
  children,
}: ConfigCenterProps) {
  const navId = useId();
  const titleId = useId();
  // 打开、切换页面、进出编辑视图时焦点移到页标题：读屏软件读出所在位置，Tab 从页面内容开始。
  // 标题按「页面 + 列表或编辑 + 是否在淡出」换 key，这些变化都会重新挂载它：
  // 淡出中又打开同一页、关掉编辑器回到列表时，焦点也不会掉到 body 上。
  // 回调保持同一个引用，其他重新渲染不会再次抢焦点；淡出时这一层是 inert，聚焦不会生效。
  const focusTitle = useCallback((title: HTMLHeadingElement | null) => title?.focus(), []);
  const titleKey = `${page}:${breadcrumb ? 'edit' : 'list'}:${isLeaving ? 'leaving' : 'open'}`;

  return (
    // 淡出期间工作台已经恢复：这一层不再接收焦点和点击。
    <div className={`config-center${isLeaving ? ' config-center--leaving' : ''}`} inert={isLeaving}>
      <div className="config-center__back">
        <button type="button" className="button button--quiet" onClick={onClose}>
          <span aria-hidden="true">←</span> 返回工作台
        </button>
      </div>
      {/* 不用 <header>：标题栏已经是页面的 banner，这里只是配置中心的页头。 */}
      <div className="config-header">
        <h1 key={titleKey} id={titleId} ref={focusTitle} className="config-header__title" tabIndex={-1}>
          {breadcrumb ? (
            <>
              <button type="button" className="link-button config-header__crumb" onClick={breadcrumb.onList}>
                {pageLabel(page)}
              </button>
              <span className="config-header__divider" aria-hidden="true">
                /
              </span>
              <span className="config-header__current">{breadcrumb.current}</span>
            </>
          ) : (
            pageLabel(page)
          )}
        </h1>
        {/* 离开配置中心就收起（use-config-center.ts）。 */}
        <IgnoredScanPill flashes={pillFlashes} text="配置中不打印" />
        <ScanSinkField sink={sink} fieldType={scanFieldType} label="扫码内容（配置中心里不打印）" />
      </div>
      <nav className="config-nav" aria-label="配置">
        {CONFIG_NAV.map((group) => (
          <div key={group.label}>
            <p id={`${navId}-${group.label}`} className="config-nav__heading">
              {group.label}
            </p>
            <ul className="config-nav__list" aria-labelledby={`${navId}-${group.label}`}>
              {group.pages.map((item) => (
                <li key={item.page}>
                  <button
                    type="button"
                    className="config-nav__item"
                    aria-current={item.page === page ? 'page' : undefined}
                    onClick={() => onNavigate(item.page)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className={`config-content${isFillPage(page) ? ' config-content--fill' : ''}`} aria-labelledby={titleId}>
        <div className="config-content__inner">{children}</div>
      </main>
    </div>
  );
}
