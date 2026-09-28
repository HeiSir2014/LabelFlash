import { BRAND } from '../../../../../shared/brand';
import type { AppInfo } from '../../../../../shared/ipc-contract';
import { QR_IMAGE_SIZE_PX } from '../../../view-models/use-qr-image';

export interface AboutPageProps {
  appInfo: AppInfo | null;
  /** 店铺二维码（data URL）；生成前为 null。 */
  shopQr: string | null;
  onOpenShop: () => void;
}

/** 关于：产品名、版本、出品方、淘宝店铺（链接和二维码）、数据目录。 */
export function AboutPage({ appInfo, shopQr, onOpenShop }: AboutPageProps) {
  if (!appInfo) {
    return <p className="config-empty">正在读取版本信息…</p>;
  }
  return (
    <div className="config-page">
      <section className="config-card about-card" aria-label="软件信息">
        <dl className="about-card__list">
          <dt>软件</dt>
          <dd>
            {appInfo.productName} v{appInfo.version}
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
    </div>
  );
}
