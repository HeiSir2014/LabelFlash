import { useState } from 'react';
import { SECRET_LIMITS } from '../../../core/scan/enrich-model';
import { ConfirmButton } from './ConfirmButton';

interface SecretListProps {
  names: readonly string[];
  /** 保存成功返回 null，否则返回原因。 */
  onSave: (name: string, value: string) => Promise<string | null>;
  onDelete: (name: string) => void;
}

/**
 * 密钥：接口令牌、通知签名密钥。只保存在这台电脑、用系统加密存放；保存后界面上再也看不到内容，
 * 只能重新设置。HTTP 查询的请求头里写 {密钥:名称} 引用。
 */
export function SecretList({ names, onSave, onDelete }: SecretListProps) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [issue, setIssue] = useState<string | null>(null);

  const save = async () => {
    const result = await onSave(name.trim(), value);
    setIssue(result);
    if (result === null) {
      setName('');
      setValue('');
    }
  };

  return (
    <section className="form-section">
      <h3 className="form-section__title">密钥</h3>
      <p className="form-hint">
        接口令牌等敏感内容存成密钥：加密保存在这台电脑，不会随规则导出，也不会显示出来。请求头里写
        {' {密钥:名称} '}引用；同名再保存一次即可更换。
      </p>
      <ul className="plain-list">
        {names.map((secretName) => (
          <li key={secretName} className="plain-list__item">
            <span className="plain-list__text">
              <code>{`{密钥:${secretName}}`}</code>
            </span>
            <ConfirmButton
              className="button button--small button--quiet"
              label="删除"
              confirmLabel="确认删除"
              onConfirm={() => onDelete(secretName)}
            />
          </li>
        ))}
      </ul>
      <div className="secret-form">
        <input
          type="text"
          className="text-field"
          aria-label="密钥名称"
          placeholder="名称，例如 仓库接口"
          value={name}
          maxLength={SECRET_LIMITS.nameLength}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          type="password"
          className="text-field"
          aria-label="密钥内容"
          placeholder="内容（保存后不再显示）"
          value={value}
          maxLength={SECRET_LIMITS.valueLength}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          className="button button--small"
          disabled={name.trim() === '' || value === ''}
          onClick={() => void save()}
        >
          保存
        </button>
      </div>
      {issue && <p className="form-hint form-hint--error">{issue}</p>}
    </section>
  );
}
