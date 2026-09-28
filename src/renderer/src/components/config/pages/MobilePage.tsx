import { useEffect, useId, useState } from 'react';
import { sanitizeRelayUrl } from '../../../../../shared/relay-url';
import { SettingRow } from '../SettingRow';

export interface MobilePageProps {
  /** 设置里填的中转地址；null 表示用安装包自带的默认地址。 */
  relayUrl: string | null;
  /** 安装包自带的默认地址；自己构建的安装包可能没有。 */
  defaultRelayUrl: string | null;
  /** 当前状态的一句话（lib/mobile-text 的 describeMobileState）。 */
  statusText: string;
  /** 保存地址（null = 恢复默认）；返回是否已保存。 */
  onChangeRelayUrl: (url: string | null) => Promise<boolean>;
}

/** 手机扫码：中转地址（离开输入框或按回车时保存）、恢复默认、当前状态。 */
export function MobilePage({ relayUrl, defaultRelayUrl, statusText, onChangeRelayUrl }: MobilePageProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(relayUrl ?? '');
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    setDraft(relayUrl ?? '');
    setIssue(null);
  }, [relayUrl]);

  const commit = async () => {
    const text = draft.trim();
    if (text === (relayUrl ?? '')) {
      setIssue(null);
      return;
    }
    // 清空等于恢复默认。
    if (text === '') {
      await onChangeRelayUrl(null);
      return;
    }
    const url = sanitizeRelayUrl(text);
    if (url === null) {
      setIssue('地址要以 https:// 开头，不带 ? 和 # 后面的部分（在本机测试可以用 http://localhost）。');
      return;
    }
    setIssue(null);
    if (await onChangeRelayUrl(url)) {
      setDraft(url);
    }
  };

  const defaultHint = defaultRelayUrl
    ? `不填就用安装包自带的地址：${defaultRelayUrl}`
    : '这个安装包没有自带地址，要填写自己部署的中转服务。';

  return (
    <div className="config-page">
      <p className="config-page__intro">
        手机扫码时，手机和这台电脑经中转服务通信，扫到的条码在这台电脑的打印机上打印。内容端到端加密，中转服务看不到扫码内容。
      </p>
      <section className="config-card" aria-label="中转服务">
        <SettingRow
          label="中转地址"
          htmlFor={inputId}
          hint={
            <>
              {defaultHint}
              改了地址后，正在进行的手机扫码会结束，下次开始时连新地址。电脑要能直接访问这个地址（不支持系统代理）。
            </>
          }
        >
          <input
            id={inputId}
            type="url"
            className="text-field"
            spellCheck={false}
            placeholder={defaultRelayUrl ?? 'https://…/'}
            value={draft}
            aria-invalid={issue !== null}
            aria-describedby={issue ? `${inputId}-issue` : undefined}
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
            disabled={relayUrl === null}
            onClick={() => void onChangeRelayUrl(null)}
          >
            恢复默认
          </button>
        </SettingRow>
        {issue && (
          <p id={`${inputId}-issue`} className="setting-row__issue" role="alert">
            {issue}
          </p>
        )}
        <SettingRow label="当前状态">
          <span role="status">{statusText}</span>
        </SettingRow>
      </section>
    </div>
  );
}
