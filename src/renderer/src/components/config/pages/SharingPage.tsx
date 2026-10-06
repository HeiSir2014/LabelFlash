import { useEffect, useId, useState } from 'react';
import { DEFAULT_IPP_PORT, isValidSharePassword, SHARE_PASSWORD_LENGTH } from '../../../../../shared/ipp-sharing';
import { API_PORT_RANGE } from '../../../../../shared/settings';
import {
  describeDiscovery,
  describeRememberedClient,
  describeSharingStatus,
  needsSharingFirewall,
  printerAddresses,
} from '../../../lib/ipp-sharing-text';
import { describeFirewall } from '../../../lib/local-api-text';
import type { IppSharingModel } from '../../../view-models/use-ipp-sharing';
import { ConfirmButton } from '../../ConfirmButton';
import { Switch } from '../../form-controls';
import { SettingRow } from '../SettingRow';

/** 默认端口被占用时依次试的个数：和主进程的 DEFAULT_IPP_PORTS 一致（8631–8640）。 */
const FALLBACK_PORT_COUNT = 10;
/** 端口怎么选：和主进程的 portOrder 一致。 */
const PORT_HINT = `一般不用填：程序一直用上次成功的端口；它被占用时依次试 ${DEFAULT_IPP_PORT}–${DEFAULT_IPP_PORT + FALLBACK_PORT_COUNT - 1}，都被占用时由系统分配。换了端口，按地址添加过的电脑要重新添加。`;
const ADD_HELP_WINDOWS =
  'Windows：设置 → 蓝牙和其他设备 → 打印机和扫描仪 → 添加设备 →「我需要的打印机不在列表中」→「按名称选择共享打印机」，填上面的 http:// 地址，驱动选「Microsoft IPP Class Driver」。';
const ADD_HELP_MAC =
  'macOS：系统设置 → 打印机与扫描仪 → 添加打印机，在列表里选「纸张名 @ 这台电脑的名字」，「使用」保持系统自动选的免驱打印。';

/** SharingPage 的参数。 */
export interface SharingPageProps {
  sharing: IppSharingModel;
  enabled: boolean;
  port: number | null;
  onChangeEnabled: (enabled: boolean) => void;
  /** 返回是否已保存。 */
  onChangePort: (port: number | null) => Promise<boolean>;
}

/** 局域网共享：开关和状态、共享的打印机和地址、共享密码、记住的电脑。 */
export function SharingPage(props: SharingPageProps) {
  const { sharing, enabled } = props;
  const status = sharing.status;
  return (
    <div className="config-page">
      <p className="config-page__intro">
        局域网里的电脑可以把这台电脑上的热敏标签机当成普通打印机用：每种分配了打印机的纸张是一台共享打印机，从任何程序打印的内容都按这张纸缩放、转黑白后打出来。
      </p>
      <StatusCard {...props} />
      {enabled && status !== null && status.server.state === 'listening' && <PrintersCard sharing={sharing} />}
      <PasswordCard sharing={sharing} />
      <ClientsCard sharing={sharing} />
      <p className="config-page__intro">
        收到的每一张都记进打印记录（来源「局域网共享」，记下对方电脑的地址和它报的用户名），7 天内能预览、重打。
      </p>
    </div>
  );
}

function StatusCard({ sharing, enabled, port, onChangeEnabled, onChangePort }: SharingPageProps) {
  const portId = useId();
  const [draft, setDraft] = useState(port === null ? '' : String(port));
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    setDraft(port === null ? '' : String(port));
    setIssue(null);
  }, [port]);

  const commit = async () => {
    const text = draft.trim();
    if (text === (port === null ? '' : String(port))) {
      setIssue(null);
      return;
    }
    // 清空等于用默认端口。
    const next = text === '' ? null : Number(text);
    if (next !== null && (!Number.isInteger(next) || next < API_PORT_RANGE.min || next > API_PORT_RANGE.max)) {
      setIssue(`端口要是 ${API_PORT_RANGE.min}–${API_PORT_RANGE.max} 的整数。`);
      return;
    }
    setIssue(null);
    await onChangePort(next);
  };

  const status = sharing.status;
  const view = status === null ? null : describeSharingStatus(status, enabled);
  const discovery = status === null ? null : describeDiscovery(status);
  const firewall =
    status === null
      ? null
      : describeFirewall(needsSharingFirewall(status) ? 'missing' : status.firewall, status.server.state === 'held');
  return (
    <section className="config-card" aria-label="共享状态">
      <SettingRow label="局域网共享" hint="打开后才监听网络、在局域网里广播；关掉后别的电脑就连不上了。">
        <Switch
          isBare
          ariaLabel="局域网共享"
          checked={enabled}
          text={enabled ? '开启' : '关闭'}
          onChange={onChangeEnabled}
        />
      </SettingRow>
      <SettingRow label="状态" hint={view?.detail}>
        <strong className={`api-status tone--${view?.tone ?? 'idle'}`} role="status">
          {view?.title ?? '读取中…'}
        </strong>
      </SettingRow>
      {enabled && firewall !== null && (
        <SettingRow label="防火墙" hint={firewall.text}>
          {firewall.canAdd ? (
            <button
              type="button"
              className="button button--small"
              disabled={sharing.isAddingFirewall}
              onClick={() => void sharing.addFirewall()}
            >
              {sharing.isAddingFirewall ? '等待管理员确认…' : '添加防火墙规则（需要管理员确认）'}
            </button>
          ) : (
            <strong className="api-status tone--success">已放行</strong>
          )}
        </SettingRow>
      )}
      {enabled && discovery !== null && (
        <SettingRow label="自动发现">
          <span className="config-card__text">{discovery}</span>
        </SettingRow>
      )}
      <SettingRow label="端口" htmlFor={portId} hint={PORT_HINT}>
        <input
          id={portId}
          type="text"
          inputMode="numeric"
          className="text-field text-field--number"
          placeholder={String(DEFAULT_IPP_PORT)}
          value={draft}
          aria-invalid={issue !== null}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className="button button--small"
          disabled={port === null}
          onClick={() => void onChangePort(null)}
        >
          恢复默认
        </button>
      </SettingRow>
      {issue && (
        <p className="setting-row__issue" role="alert">
          {issue}
        </p>
      )}
    </section>
  );
}

function PrintersCard({ sharing }: { sharing: IppSharingModel }) {
  const titleId = useId();
  const status = sharing.status;
  if (status === null) {
    return null;
  }
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        共享的打印机
      </h2>
      {status.printers.length === 0 ? (
        <p className="config-empty">还没有分配了打印机的纸张：在「打印机」页给纸张分配打印机后，它就出现在这里。</p>
      ) : (
        <ul className="config-list">
          {status.printers.map((printer) => {
            const addresses = printerAddresses(status, printer.key);
            return (
              <li key={printer.key} className="config-card sharing-printer">
                <strong className="sharing-printer__name">{printer.name}</strong>
                <span className="sharing-printer__target">打到 {printer.printerName}</span>
                <span className="sharing-printer__label">Windows 添加时填</span>
                <ul className="api-addresses">
                  {addresses.windows.map((address) => (
                    <li key={address}>
                      <code className="api-address">{address}</code>
                    </li>
                  ))}
                </ul>
                <span className="sharing-printer__label">其他系统</span>
                <ul className="api-addresses">
                  {addresses.ipp.map((address) => (
                    <li key={address}>
                      <code className="api-address">{address}</code>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      <p className="config-card__text">{ADD_HELP_WINDOWS}</p>
      <p className="config-card__text">{ADD_HELP_MAC}</p>
    </section>
  );
}

function PasswordCard({ sharing }: { sharing: IppSharingModel }) {
  const titleId = useId();
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isSet = sharing.status?.passwordSet ?? false;
  const canSave = isValidSharePassword(draft) && !isSaving;

  const save = async () => {
    if (!canSave) {
      return;
    }
    setIsSaving(true);
    try {
      if (await sharing.setPassword(draft)) {
        setDraft('');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        共享密码
      </h2>
      <p className="config-card__text">
        {isSet ? '已设置。' : '没有设置：局域网里的电脑不用密码就能添加、打印（新电脑第一次打印时仍会先问你）。'}
        设了密码后，别的电脑添加打印机或打印时要输入它（用户名随便填）。传输是明文
        HTTP，密码在局域网里能被抓包看到：它挡住随手添加，不防有心人。
      </p>
      <div className="api-key-form">
        <label className="api-key-form__label" htmlFor={inputId}>
          {isSet ? '新密码' : '密码'}
        </label>
        <input
          id={inputId}
          type="password"
          className="text-field"
          autoComplete="new-password"
          placeholder={`${SHARE_PASSWORD_LENGTH.min}–${SHARE_PASSWORD_LENGTH.max} 个字`}
          maxLength={SHARE_PASSWORD_LENGTH.max}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void save();
            }
          }}
        />
        <button type="button" className="button button--primary" disabled={!canSave} onClick={() => void save()}>
          {isSaving ? '保存中…' : '保存密码'}
        </button>
      </div>
      {isSet && (
        <ConfirmButton
          className="button button--small button--quiet"
          label="不用密码"
          confirmLabel="确认不用密码"
          onConfirm={() => void sharing.clearPassword()}
        />
      )}
    </section>
  );
}

function ClientsCard({ sharing }: { sharing: IppSharingModel }) {
  const titleId = useId();
  const clients = sharing.status?.clients ?? [];
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        电脑
      </h2>
      {clients.length === 0 ? (
        <p className="config-empty">
          新电脑第一次打印时，程序顶部会出现询问，同时弹出系统通知；点过「允许」或「拒绝」的电脑列在这里，撤销后它下次打印时重新问。
        </p>
      ) : (
        <ul className="config-list">
          {clients.map((client) => (
            <li key={client.address} className="config-card api-key-card">
              <div className="api-key-card__text">
                <code className="api-address">{client.address}</code>
                <span className="api-key-card__usage">{describeRememberedClient(client)}</span>
              </div>
              <ConfirmButton
                className="button button--small button--quiet"
                label="撤销"
                confirmLabel="确认撤销"
                onConfirm={() => void sharing.forgetClient(client.address)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
