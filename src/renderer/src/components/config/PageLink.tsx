import type { ConfigPage } from '../../lib/app-view';

interface PageLinkProps {
  page: ConfigPage;
  /** 跳到那一页：经过未保存修改的确认。 */
  onOpen: (page: ConfigPage) => void;
  children: string;
}

/** 提示去别的配置页操作时，直接做成可点的跳转。 */
export function PageLink({ page, onOpen, children }: PageLinkProps) {
  return (
    <button type="button" className="link-button" onClick={() => onOpen(page)}>
      {children}
    </button>
  );
}
