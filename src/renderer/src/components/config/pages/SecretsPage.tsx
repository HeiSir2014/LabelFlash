import { useId, useState } from 'react';
import { SECRET_LIMITS } from '../../../../../core/scan/enrich-model';
import { useCopyText } from '../../../view-models/use-copy-text';
import { ConfirmButton } from '../../ConfirmButton';

interface SecretsPageProps {
  names: readonly string[];
  /** 保存成功返回 null，否则返回原因。 */
  onSave: (name: string, value: string) => Promise<string | null>;
  onDelete: (name: string) => void;
}

const reference = (name: string) => `{密钥:${name}}`;

/**
 * 密钥：接口令牌、通知签名密钥。只保存在这台电脑、用系统加密存放；保存后界面上再也看不到内容，
 * 只能重新设置。HTTP 查询的请求头里写 {密钥:名称} 引用。
 */
export function SecretsPage({ names, onSave, onDelete }: SecretsPageProps) {
  const copy = useCopyText();
  const nameId = useId();
  const valueId = useId();
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
    <div className="config-page">
      <p className="config-page__intro">
        接口令牌、通知签名这类敏感内容存成密钥：用系统加密保存在这台电脑，不随规则导出，保存后也不再显示。在 HTTP
        查询的请求头里写 <span className="config-code">{'{密钥:名称}'}</span> 引用；同名再保存一次即可更换。
      </p>
      {names.length === 0 ? (
        <p className="config-empty">还没有密钥。</p>
      ) : (
        <ul className="config-list">
          {names.map((secretName) => (
            <li key={secretName} className="config-card secret-card">
              <code className="secret-card__reference">{reference(secretName)}</code>
              <button
                type="button"
                className="button button--small button--quiet"
                onClick={() => void copy(reference(secretName))}
              >
                复制引用
              </button>
              <ConfirmButton
                className="button button--small button--quiet"
                label="删除"
                confirmLabel="确认删除"
                onConfirm={() => onDelete(secretName)}
              />
            </li>
          ))}
        </ul>
      )}
      <section className="config-card secret-form" aria-labelledby={`${nameId}-title`}>
        <h2 id={`${nameId}-title`} className="config-card__title secret-form__title">
          添加或更换密钥
        </h2>
        <label className="secret-form__label" htmlFor={nameId}>
          名称
        </label>
        <input
          id={nameId}
          type="text"
          className="text-field"
          placeholder="例如 仓库接口"
          value={name}
          maxLength={SECRET_LIMITS.nameLength}
          onChange={(event) => setName(event.target.value)}
        />
        <label className="secret-form__label" htmlFor={valueId}>
          内容
        </label>
        <input
          id={valueId}
          type="password"
          className="text-field"
          placeholder="保存后不再显示"
          value={value}
          maxLength={SECRET_LIMITS.valueLength}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="secret-form__actions">
          {issue && <p className="form-hint form-hint--error">{issue}</p>}
          <button
            type="button"
            className="button button--primary"
            disabled={name.trim() === '' || value === ''}
            onClick={() => void save()}
          >
            保存密钥
          </button>
        </div>
      </section>
    </div>
  );
}
