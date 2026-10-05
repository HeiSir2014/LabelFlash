import { type ReactNode, useEffect, useId, useState } from 'react';
import { SettingRow } from './SettingRow';

export interface UrlSettingProps {
  label: string;
  hint: ReactNode;
  /** 设置里填的地址；null 表示用安装包自带的默认地址。 */
  value: string | null;
  /** 安装包自带的默认地址；自己构建的安装包可能没有。 */
  defaultValue: string | null;
  /** 地址规则（和主进程同一个函数）；不合法返回 null。 */
  sanitize: (text: string) => string | null;
  invalidText: string;
  /** 保存地址（null = 恢复默认）；返回是否已保存。 */
  onChange: (url: string | null) => Promise<boolean>;
}

/** 一行地址设置：离开输入框或按回车时保存，清空等于恢复默认。 */
export function UrlSetting({ label, hint, value, defaultValue, sanitize, invalidText, onChange }: UrlSettingProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(value ?? '');
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value ?? '');
    setIssue(null);
  }, [value]);

  const commit = async () => {
    const text = draft.trim();
    if (text === (value ?? '')) {
      setIssue(null);
      return;
    }
    if (text === '') {
      await onChange(null);
      return;
    }
    const url = sanitize(text);
    if (url === null) {
      setIssue(invalidText);
      return;
    }
    setIssue(null);
    if (await onChange(url)) {
      setDraft(url);
    }
  };

  return (
    <>
      <SettingRow label={label} htmlFor={inputId} hint={hint}>
        <input
          id={inputId}
          type="url"
          className="text-field"
          spellCheck={false}
          placeholder={defaultValue ?? 'https://…/'}
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
          disabled={value === null}
          onClick={() => void onChange(null)}
        >
          恢复默认
        </button>
      </SettingRow>
      {issue && (
        <p id={`${inputId}-issue`} className="setting-row__issue" role="alert">
          {issue}
        </p>
      )}
    </>
  );
}
