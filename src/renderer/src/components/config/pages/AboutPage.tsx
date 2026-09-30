import { BRAND } from '../../../../../shared/brand';
import type { AppInfo } from '../../../../../shared/ipc-contract';
import { formatAppVersion } from '../../../lib/app-version';
import type { UpdateView } from '../../../lib/update-text';
import { QR_IMAGE_SIZE_PX } from '../../../view-models/use-qr-image';
import { SettingRow } from '../SettingRow';

export interface AboutPageProps {
  appInfo: AppInfo | null;
  /** 店铺二维码（data URL）；生成前为 null。 */
  shopQr: string | null;
  update: UpdateView;
  onOpenShop: () => void;
  onCheckForUpdates: () => void;
  onOpenLogFolder: () => void;
}

/** 关于：产品名、版本、出品方、淘宝店铺（链接和二维码）、数据目录；软件更新和日志。 */
export function AboutPage({ appInfo, shopQr, update, onOpenShop, onCheckForUpdates, onOpenLogFolder }: AboutPageProps) {
  if (!appInfo) {
    return <p className="config-empty">正在读取版本信息…</p>;
  }
  return (
    <div className="config-page">
      <section className="config-card about-card" aria-label="软件信息">
        <dl className="about-card__list">
          <dt>软件</dt>
          <dd>
            {appInfo.productName} {formatAppVersion(appInfo.version, appInfo.buildNumber)}
          </dd>
          <dt>出品</dt>
          <dd>
            {appInfo.brandOwner}（{BRAND.mark}）
          </dd>
          <dt>淘宝店铺</dt>
          <dd>
            <button type="button" className="link-button" onClick={onOpenShop}>
              {BRAND.shop.name}
            </button>
            <span className="about-card__path">{BRAND.shop.url}</span>
          </dd>
          <dt>数据目录</dt>
          <dd className="about-card__path">{appInfo.dataPath}</dd>
        </dl>
        {shopQr && (
          <figure className="about-card__qr">
            <img src={shopQr} alt={`${BRAND.shop.name}店铺二维码`} width={QR_IMAGE_SIZE_PX} height={QR_IMAGE_SIZE_PX} />
            <figcaption>手机淘宝扫一扫进店</figcaption>
          </figure>
        )}
      </section>
      <section className="config-card" aria-label="软件更新与日志">
        <SettingRow
          label="软件更新"
          hint="新版本在后台下载，下载好后点标题栏的「重启更新」；窗口关在托盘里没人用时会自动更新"
        >
          <div className="setting-row__inline">
            <span role="status">{update.text}</span>
            <button
              type="button"
              className="button button--small"
              onClick={onCheckForUpdates}
              disabled={!update.canCheck}
            >
              检查更新
            </button>
          </div>
        </SettingRow>
        <SettingRow label="日志" hint="打印失败或程序出错时，当天的日志里有详细原因，保留 14 天">
          <button type="button" className="button button--small" onClick={onOpenLogFolder}>
            打开日志目录
          </button>
        </SettingRow>
      </section>
    </div>
  );
}
