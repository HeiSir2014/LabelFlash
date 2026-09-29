interface OriginRequestsProps {
  /** 正在等确认的网站，先来的在前。 */
  origins: readonly string[];
  onDecide: (origin: string, allow: boolean) => void;
}

/**
 * 网站想使用本机接口：在程序顶部请操作员用鼠标点「允许」或「拒绝」。
 * 两个按钮都不进 Tab 顺序（tabIndex=-1）：扫码枪敲的 Tab、回车不能把焦点带到「允许」上再按下去。
 * 不标 data-keep-focus：点完之后焦点照常回到扫码框，键盘不在这里停留。
 */
export function OriginRequests({ origins, onDecide }: OriginRequestsProps) {
  if (origins.length === 0) {
    return null;
  }
  return (
    <section className="origin-requests" aria-label="等待确认的网站">
      {origins.map((origin) => (
        <div key={origin} className="origin-request">
          <p className="origin-request__text">
            <strong className="origin-request__site">{origin}</strong>
            想使用这台电脑的打印服务：提交打印、读取模板和打印机列表。不认识这个网站就点「拒绝」。
          </p>
          <div className="origin-request__actions">
            <button
              type="button"
              tabIndex={-1}
              className="button button--small"
              onClick={() => onDecide(origin, false)}
            >
              拒绝
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="button button--small button--primary"
              onClick={() => onDecide(origin, true)}
            >
              允许
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
