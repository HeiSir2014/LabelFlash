import type { ReactNode } from 'react';

interface SettingRowProps {
  label: string;
  /** 标签指向的控件 id；控件自带标签（例如开关）时不传。 */
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}

/** 配置页里的一项设置：左边标签，右边控件，控件下方是说明。 */
export function SettingRow({ label, htmlFor, hint, children }: SettingRowProps) {
  return (
    <div className="setting-row">
      {htmlFor ? (
        <label className="setting-row__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="setting-row__label">{label}</span>
      )}
      <div className="setting-row__control">{children}</div>
      {hint && <p className="setting-row__hint">{hint}</p>}
    </div>
  );
}
