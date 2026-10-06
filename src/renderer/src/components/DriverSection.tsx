import { INSTALL_STEPS } from '../../../core/drivers/driver-install-flow';
import { sanitizeCatalogUrl } from '../../../shared/driver-catalog-url';
import type { DriverInstallView, DriverPlatformView, DriverStatus } from '../../../shared/drivers';
import {
  actionText,
  catalogText,
  deviceDetail,
  deviceTitle,
  emptyDevicesText,
  INSTALL_STEP_LABELS,
  installText,
  stepProgress,
} from '../lib/driver-text';
import { UrlSetting } from './config/UrlSetting';

interface DriverSectionProps {
  status: DriverStatus | null;
  catalogUrl: string | null;
  defaultCatalogUrl: string | null;
  onChangeCatalogUrl: (url: string | null) => Promise<boolean>;
  onDetect: () => void;
  onInstall: (deviceKey: string) => void;
  onCancel: () => void;
  onOpenPage: (deviceKey: string) => void;
}

/** 打印机页的「驱动」卡片：清单状态、缺驱动的 USB 设备、安装进度、清单地址。 */
export function DriverSection({
  status,
  catalogUrl,
  defaultCatalogUrl,
  onChangeCatalogUrl,
  onDetect,
  onInstall,
  onCancel,
  onOpenPage,
}: DriverSectionProps) {
  const platform = status?.platform ?? 'windows';
  const isInstalling = status?.install?.state.phase === 'running';
  const isBusy = isInstalling || status?.isDetecting === true;
  const catalog = status ? catalogText(status.catalog) : null;

  return (
    <div className="driver-section">
      <header className="driver-section__header">
        <h3 className="driver-section__title">驱动</h3>
        {platform !== 'unsupported' && (
          <button type="button" className="button button--small" onClick={onDetect} disabled={isBusy}>
            {/* 和诊断面板用同一个动词：「重新检查」。 */}
            {status?.isDetecting ? '正在检查…' : '重新检查'}
          </button>
        )}
      </header>
      {platform === 'unsupported' ? (
        <p className="driver-section__note">这台电脑的系统不支持自动安装驱动</p>
      ) : (
        <>
          {catalog && (
            <p className={`driver-section__catalog driver-section__catalog--${catalog.tone}`}>{catalog.text}</p>
          )}
          {status?.install && <InstallProgress install={status.install} platform={platform} onCancel={onCancel} />}
          {status?.detectIssue && (
            <p className="driver-section__catalog driver-section__catalog--error" role="alert">
              {status.detectIssue}
            </p>
          )}
          {status?.devices && status.devices.length === 0 && (
            <p className="driver-section__note">{emptyDevicesText(platform)}</p>
          )}
          {status?.devices && status.devices.length > 0 && (
            <ul className="driver-devices">
              {status.devices.map((device) => {
                const { button, guide } = actionText(device.action, platform);
                return (
                  <li key={device.key} className="driver-device">
                    <span className="driver-device__title">{deviceTitle(device)}</span>
                    {button && (
                      <button
                        type="button"
                        className="button button--small"
                        disabled={isBusy}
                        onClick={() =>
                          device.action.kind === 'open-page' ? onOpenPage(device.key) : onInstall(device.key)
                        }
                      >
                        {button}
                      </button>
                    )}
                    <p className="driver-device__detail">{deviceDetail(device)}</p>
                    {guide && <p className="driver-device__guide">{guide}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          <details
            className="driver-section__source"
            open={status?.catalog.state === 'unconfigured' ? true : undefined}
          >
            <summary>驱动清单地址</summary>
            <UrlSetting
              label="驱动清单地址"
              hint={
                <>
                  从这个地址下载驱动清单（型号、官方驱动的下载地址和校验值）。清单必须带出品方的签名，程序核对通过才用，
                  填错地址也装不上来路不明的驱动。
                  {defaultCatalogUrl
                    ? `不填就用安装包自带的地址：${defaultCatalogUrl}`
                    : '这个安装包没有自带地址：要自动安装驱动，填写出品方提供的地址。'}
                </>
              }
              value={catalogUrl}
              defaultValue={defaultCatalogUrl}
              sanitize={sanitizeCatalogUrl}
              invalidText="地址要以 https:// 开头，不带 # 后面的部分（在本机测试可以用 http://localhost）。"
              onChange={onChangeCatalogUrl}
            />
          </details>
        </>
      )}
    </div>
  );
}

function InstallProgress({
  install,
  platform,
  onCancel,
}: {
  install: DriverInstallView;
  platform: DriverPlatformView;
  onCancel: () => void;
}) {
  const { state } = install;
  const message = installText(install, platform);
  return (
    <div className={`driver-install driver-install--${message.tone}`}>
      {state.phase === 'running' && (
        <ol className="driver-steps" aria-label="安装步骤">
          {INSTALL_STEPS.map((step) => (
            <li key={step} className={`driver-steps__item driver-steps__item--${stepProgress(step, state.step)}`}>
              {INSTALL_STEP_LABELS[step]}
            </li>
          ))}
        </ol>
      )}
      <p className="driver-install__text" role={message.tone === 'error' ? 'alert' : 'status'}>
        {message.text}
      </p>
      {state.phase === 'running' && state.step === 'downloading' && (
        <div className="driver-install__actions">
          <progress
            className="driver-install__progress"
            max={state.totalBytes}
            value={state.receivedBytes}
            aria-label="下载进度"
          />
          <button type="button" className="button button--small button--quiet" onClick={onCancel}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}
