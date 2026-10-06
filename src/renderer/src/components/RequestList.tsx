/** 询问条里的一项。 */
export interface RequestItem {
  /** 唯一键，也是回调里交回的值（网站、电脑地址）。 */
  key: string;
  /** 等宽字体单独一行：一眼看清是哪个网站、哪台电脑。 */
  subject: string;
  text: string;
}

interface RequestListProps {
  /** 区域的名字（读屏、E2E 按它找）。 */
  label: string;
  items: readonly RequestItem[];
  onDecide: (key: string, allow: boolean) => void;
}

/**
 * 程序顶部请操作员用鼠标点「允许」或「拒绝」的一组请求（网站想用本机接口、局域网里的电脑想用共享打印机）。
 * 两个按钮都不进 Tab 顺序（tabIndex=-1）：扫码枪敲的 Tab、回车不能把焦点带到「允许」上再按下去。
 * 不标 data-keep-focus：点完之后焦点照常回到扫码框。
 */
export function RequestList({ label, items, onDecide }: RequestListProps) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="request-list" aria-label={label}>
      {items.map((item) => (
        <div key={item.key} className="request">
          <p className="request__text">
            <strong className="request__subject">{item.subject}</strong>
            {item.text}
          </p>
          <div className="request__actions">
            <button
              type="button"
              tabIndex={-1}
              className="button button--small"
              onClick={() => onDecide(item.key, false)}
            >
              拒绝
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="button button--small button--primary"
              onClick={() => onDecide(item.key, true)}
            >
              允许
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
