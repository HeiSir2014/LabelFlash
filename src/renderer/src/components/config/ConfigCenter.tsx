import { type ReactNode, useCallback } from 'react';
import { CONFIG_NAV, type ConfigPage, pageLabel } from '../../lib/app-view';

/** 二级页面（编辑视图）的面包屑：「识别规则 / 编辑：下划线查货架」，第一段回到列表。 */
export interface Breadcrumb {
  current: string;
  onList: () => void;
}

interface ConfigCenterProps {
  page: ConfigPage;
  isLeaving: boolean;
  breadcrumb: Breadcrumb | null;
  onNavigate: (page: ConfigPage) => void;
  onClose: () => void;
  children: ReactNode;
}

/** 铺满标题栏以下的配置中心：左侧分组导航，右侧页头 + 页面内容。 */
export function ConfigCenter({ page, isLeaving, breadcrumb, onNavigate, onClose, children }: ConfigCenterProps) {
  // 打开和切换页面时焦点移到页标题：读屏软件读出所在位置，Tab 从页面内容开始。
  // 标题按页面换 key，换页即重新挂载；回调保持同一个引用，其他重新渲染不会再次抢焦点。
  const focusTitle = useCallback((title: HTMLHeadingElement | null) => title?.focus(), []);

  return (
    <div className={`config-center${isLeaving ? ' config-center--leaving' : ''}`}>
      <div className="config-center__back">
        <button type="button" className="button button--quiet" onClick={onClose}>
          <span aria-hidden="true">←</span> 返回工作台
        </button>
      </div>
      <header className="config-header">
        <h1 key={page} ref={focusTitle} className="config-header__title" tabIndex={-1}>
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
        <span className="config-pill">配置中不打印</span>
      </header>
      <nav className="config-nav" aria-label="配置">
        {CONFIG_NAV.map((group) => (
          <div key={group.label} className="config-nav__group">
            <p className="config-nav__heading">{group.label}</p>
            <ul className="config-nav__list">
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
      <div className="config-content">
        <div className="config-content__inner">{children}</div>
      </div>
    </div>
  );
}
