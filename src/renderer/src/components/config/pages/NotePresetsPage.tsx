import { useId, useState } from 'react';
import { NOTE_VARIABLES } from '../../../../../core/templates/note-text';
import { MAX_NOTE_PRESETS, sanitizeNoteText } from '../../../../../shared/settings';
import { DeleteButton } from '../../ConfirmButton';

export interface NotePresetsPageProps {
  presets: readonly string[];
  /** 返回是否保存成功。 */
  onChange: (presets: string[]) => Promise<boolean>;
}

/** 常用备注：工作台「备注」下拉框里的选项。 */
export function NotePresetsPage({ presets, onChange }: NotePresetsPageProps) {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const text = sanitizeNoteText(draft);
  const canAdd = text !== null && !presets.includes(text) && presets.length < MAX_NOTE_PRESETS;

  const add = async () => {
    if (text !== null && canAdd && (await onChange([...presets, text]))) {
      setDraft('');
    }
  };

  return (
    <div className="config-page">
      <p className="config-page__intro">
        在工作台扫码框旁的「备注」下拉框里一键切换。只替换模板的备注文字，位置和字号仍按模板。
      </p>
      <section className="config-card" aria-labelledby={`${inputId}-variables`}>
        <h2 id={`${inputId}-variables`} className="config-card__title">
          可用变量
        </h2>
        <p className="config-card__text">
          <span className="config-code">{NOTE_VARIABLES.join(' ')}</span>，以及{' '}
          <span className="config-code">{'{字段名}'}</span>（例如 <span className="config-code">{'{订单号}'}</span>
          ）。打印时换成这一张标签的内容。
        </p>
      </section>
      {presets.length === 0 ? (
        <p className="config-empty">还没有常用备注。</p>
      ) : (
        <ul className="config-list">
          {presets.map((preset) => (
            <li key={preset} className="config-card note-card">
              <span className="note-card__text">{preset}</span>
              <DeleteButton onConfirm={() => void onChange(presets.filter((item) => item !== preset))} />
            </li>
          ))}
        </ul>
      )}
      <section className="config-card note-form" aria-label="添加常用备注">
        <label className="config-card__title" htmlFor={inputId}>
          新的常用备注
        </label>
        <textarea
          id={inputId}
          className="text-field text-area"
          rows={3}
          value={draft}
          placeholder="例如：样衣间 {日期}（可以写多行）"
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="note-form__actions">
          <button type="button" className="button button--primary" disabled={!canAdd} onClick={() => void add()}>
            添加常用备注（{presets.length}/{MAX_NOTE_PRESETS}）
          </button>
        </div>
      </section>
    </div>
  );
}
