import { useEffect, useId, useRef, useState } from 'react';
import { API_KEY_NAME_LENGTH, type ApiKeyInfo } from '../../../../../shared/local-api';
import { API_PORT_RANGE } from '../../../../../shared/settings';
import { describeApiStatus, describeFirewall, describeKeyUsage } from '../../../lib/local-api-text';
import type { CopyResult, LocalApiModel } from '../../../view-models/use-local-api';
import { ConfirmButton } from '../../ConfirmButton';
import { Switch } from '../../form-controls';
import { SettingRow } from '../SettingRow';

/** 端口怎么选：和主进程的 apiPortOrder 一致，写在说明里给操作员看。 */
const PORT_HINT =
  '一般不用填：程序一直用上次成功的端口；它被占用时依次试 17631–17640，都被占用时由系统分配一个空闲端口。填了就优先用它，被占用时同样自动换，并在上面提示。';

export interface LocalApiPageProps {
  api: LocalApiModel;
  port: number | null;
  lanEnabled: boolean;
  /** 返回是否已保存。 */
  onChangePort: (port: number | null) => Promise<boolean>;
  onChangeLanEnabled: (enabled: boolean) => void;
}

/** 本机接口：运行状态和地址、局域网开关、端口、程序密钥、已授权的网站。 */
export function LocalApiPage({ api, port, lanEnabled, onChangePort, onChangeLanEnabled }: LocalApiPageProps) {
  const { refreshKeys, checkFirewall, dismissNewKey } = api;
  // 打开这一页时重读密钥（最后使用时间在后台变，不推送），并查一次防火墙。
  // 离开这一页时收起刚生成的密钥：原文不该在别人回到这一页时还显示着。
  useEffect(() => {
    void refreshKeys();
    void checkFirewall();
    return dismissNewKey;
  }, [refreshKeys, checkFirewall, dismissNewKey]);

  return (
    <div className="config-page">
      <p className="config-page__intro">
        别的网页系统、客户端软件可以通过本机接口提交「模板 + 字段」打印，或者只排版、取回 PDF。接口描述在
        <span className="config-code">/v1/openapi.json</span>，接入说明见项目的 docs/local-api.md。
      </p>
      <StatusCard
        api={api}
        port={port}
        lanEnabled={lanEnabled}
        onChangePort={onChangePort}
        onChangeLanEnabled={onChangeLanEnabled}
      />
      <KeysCard api={api} />
      <OriginsCard origins={api.status?.authorizedOrigins ?? []} onRevoke={(origin) => void api.revokeOrigin(origin)} />
      <p className="config-page__intro">
        本机接口提交的每一张都完整保存字段（面单上可能有收件人的姓名、电话、地址），只存在这台电脑上：打印记录里的超过保留条数时和其他记录一起删除；给调用方查询进度的任务记录保留
        7 天后自动删除。
      </p>
    </div>
  );
}

function StatusCard({ api, port, lanEnabled, onChangePort, onChangeLanEnabled }: LocalApiPageProps) {
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

  const view = api.status === null ? null : describeApiStatus(api.status);
  return (
    <section className="config-card" aria-label="运行状态">
      <SettingRow label="状态" hint={view?.detail}>
        <strong className={`api-status tone--${view?.tone ?? 'idle'}`} role="status">
          {view?.title ?? '读取中…'}
        </strong>
      </SettingRow>
      {view !== null && view.addresses.length > 0 && (
        <SettingRow label="地址">
          <ul className="api-addresses">
            {view.addresses.map((address) => (
              <li key={address}>
                <code className="api-address">{address}</code>
              </li>
            ))}
          </ul>
        </SettingRow>
      )}
      <SettingRow
        label="局域网访问"
        hint="开着时，局域网里别的电脑上的程序带着程序密钥就能调用；关掉后只接受这台电脑上的网页和程序。"
      >
        <Switch
          isBare
          ariaLabel="局域网访问"
          checked={lanEnabled}
          text={lanEnabled ? '开启' : '关闭'}
          onChange={onChangeLanEnabled}
        />
      </SettingRow>
      {lanEnabled && <FirewallRow api={api} />}
      <SettingRow label="端口" htmlFor={portId} hint={PORT_HINT}>
        <input
          id={portId}
          type="text"
          inputMode="numeric"
          className="text-field text-field--number"
          placeholder="17631"
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

/** Windows 防火墙：没放行时给「添加」按钮（弹管理员确认）。不是 Windows 或查不到时不显示。 */
function FirewallRow({ api }: { api: LocalApiModel }) {
  const view = describeFirewall(api.firewall, api.lanHeldBack);
  if (view === null) {
    return null;
  }
  return (
    <SettingRow label="防火墙" hint={view.text}>
      {view.canAdd ? (
        <button
          type="button"
          className="button button--small"
          disabled={api.isAddingFirewall}
          onClick={() => void api.addFirewall()}
        >
          {api.isAddingFirewall ? '等待管理员确认…' : '添加防火墙规则（需要管理员确认）'}
        </button>
      ) : (
        <strong className="api-status tone--success">已放行</strong>
      )}
    </SettingRow>
  );
}

function KeysCard({ api }: { api: LocalApiModel }) {
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  // 复制结果按密钥记：生成了下一个密钥时，上一个的「已复制」不能沿用。
  const [copyResult, setCopyResult] = useState<{ id: string; result: CopyResult } | null>(null);
  const { newKey } = api;
  const copied = newKey !== null && copyResult?.id === newKey.key.id ? copyResult.result : null;
  const canCreate = name.trim() !== '' && !isCreating;

  // 连按回车或连点只生成一个；没生成成功时名称留着，改一下再点就行。
  const create = async () => {
    if (!canCreate) {
      return;
    }
    setIsCreating(true);
    try {
      if (await api.createKey(name.trim())) {
        setName('');
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        程序密钥
      </h2>
      <p className="config-card__text">
        客户端软件、服务器程序在请求头里带 <span className="config-code">Authorization: Bearer 密钥</span>
        。每个程序用一个密钥，撤销后它立即不能再调用。
      </p>
      {newKey && (
        <div className="api-new-key">
          {/* 只让读屏软件读这句话，不读密钥原文。 */}
          <p className="api-new-key__title" role="status">
            「{newKey.key.name}」的密钥只显示这一次，关掉后就看不到了，请现在复制到调用方的配置里：
          </p>
          <input
            className="text-field api-new-key__secret"
            readOnly
            aria-label="新密钥"
            value={newKey.secret}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="button button--small"
            onClick={() => void api.copyNewKey().then((result) => setCopyResult({ id: newKey.key.id, result }))}
          >
            {copied === 'copied' ? '已复制' : '复制'}
          </button>
          <button type="button" className="button button--small button--quiet" onClick={api.dismissNewKey}>
            完成
          </button>
          {copied === 'expired' && (
            <p className="form-hint form-hint--error api-new-key__issue">
              已超过 10 分钟，不能再复制：请撤销后重新生成。
            </p>
          )}
          {copied === 'failed' && (
            <p className="form-hint form-hint--error api-new-key__issue">
              没能复制到剪贴板：请选中上面的密钥，按 Ctrl+C 复制。
            </p>
          )}
        </div>
      )}
      {api.keys.length === 0 ? (
        <p className="config-empty">还没有程序密钥。</p>
      ) : (
        <ul className="config-list">
          {api.keys.map((key) => (
            <KeyRow key={key.id} apiKey={key} api={api} />
          ))}
        </ul>
      )}
      <div className="api-key-form">
        <label className="api-key-form__label" htmlFor={nameId}>
          名称
        </label>
        <input
          id={nameId}
          type="text"
          className="text-field"
          placeholder="例如 ERP 服务器"
          value={name}
          maxLength={API_KEY_NAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void create();
            }
          }}
        />
        <button type="button" className="button button--primary" disabled={!canCreate} onClick={() => void create()}>
          {isCreating ? '生成中…' : '生成密钥'}
        </button>
      </div>
    </section>
  );
}

function KeyRow({ apiKey, api }: { apiKey: ApiKeyInfo; api: LocalApiModel }) {
  const [draft, setDraft] = useState<string | null>(null);
  // Esc 放弃修改：输入框随后失去焦点，失焦时不能再把草稿存进去。
  const isCancelled = useRef(false);

  const commit = async () => {
    const name = isCancelled.current ? '' : (draft?.trim() ?? '');
    isCancelled.current = false;
    setDraft(null);
    if (name !== '' && name !== apiKey.name) {
      await api.renameKey(apiKey.id, name);
    }
  };

  return (
    <li className="config-card api-key-card">
      <div className="api-key-card__text">
        {draft === null ? (
          <strong className="api-key-card__name">{apiKey.name}</strong>
        ) : (
          <input
            className="text-field"
            aria-label={`「${apiKey.name}」的新名称`}
            value={draft}
            maxLength={API_KEY_NAME_LENGTH}
            // biome-ignore lint/a11y/noAutofocus: 点「改名」后直接输入，焦点应当落在这个输入框里。
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                isCancelled.current = true;
                event.currentTarget.blur();
              }
            }}
          />
        )}
        <span className="api-key-card__usage">{describeKeyUsage(apiKey)}</span>
      </div>
      {draft === null && (
        <button
          type="button"
          className="button button--small button--quiet"
          onClick={() => {
            isCancelled.current = false;
            setDraft(apiKey.name);
          }}
        >
          改名
        </button>
      )}
      <ConfirmButton
        className="button button--small button--quiet"
        label="撤销"
        confirmLabel="确认撤销"
        onConfirm={() => void api.removeKey(apiKey.id)}
      />
    </li>
  );
}

function OriginsCard({ origins, onRevoke }: { origins: readonly string[]; onRevoke: (origin: string) => void }) {
  const titleId = useId();
  return (
    <section className="config-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="config-card__title">
        已授权的网站
      </h2>
      {origins.length === 0 ? (
        <p className="config-empty">
          网页第一次调用时，程序顶部会出现询问，同时弹出系统通知；点「允许」的网站会列在这里，撤销之前一直有效。
        </p>
      ) : (
        <ul className="config-list">
          {origins.map((origin) => (
            <li key={origin} className="config-card api-key-card">
              <code className="api-key-card__text api-address">{origin}</code>
              <ConfirmButton
                className="button button--small button--quiet"
                label="撤销"
                confirmLabel="确认撤销"
                onConfirm={() => onRevoke(origin)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
