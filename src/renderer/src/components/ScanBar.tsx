import { useLayoutEffect, useRef } from 'react';
import type { NoteOption } from '../lib/note-options';
import type { ScanFieldType } from '../lib/scan-field';
import { useScanFocus } from '../view-models/use-scan-focus';
import { useScanInput } from '../view-models/use-scan-input';
import { Switch } from './form-controls';

const PLACEHOLDER = '用扫码枪扫标签二维码，或手动输入后回车';

export interface NoteControl {
  options: NoteOption[];
  selected: string;
  onSelect: (value: string) => void;
}

export interface ScanBarProps {
  /** 工作台在前台（配置中心没打开）：扫码框的自动回焦规则只在这时生效。 */
  isActive: boolean;
  autoPrint: boolean;
  /** 多行扫码：回车 / Tab 之后等这么久没有新字符，才算一次扫码结束。 */
  lineGapMs: number;
  /** 密码框还是普通输入框：Windows 上用密码框关掉输入法（见 lib/scan-field.ts）。 */
  fieldType: ScanFieldType;
  note: NoteControl;
  onAutoPrintChange: (autoPrint: boolean) => void;
  onScan: (raw: string) => void;
}

export function ScanBar({ isActive, autoPrint, lineGapMs, fieldType, note, onAutoPrintChange, onScan }: ScanBarProps) {
  const inputRef = useScanFocus(isActive);
  const input = useScanInput(lineGapMs, onScan);
  const textRef = useRef<HTMLSpanElement>(null);

  // 内容比框长时显示末尾：扫码枪和手动输入都在末尾打字，和输入框自己滚动到光标处一样。
  const { value } = input;
  useLayoutEffect(() => {
    const text = textRef.current;
    if (text) {
      text.scrollLeft = value === '' ? 0 : text.scrollWidth;
    }
  }, [value]);

  return (
    <section className="scan-bar" aria-label="扫码">
      <label className="scan-bar__field">
        <span className="scan-bar__label">扫码</span>
        <span className="scan-bar__box">
          {/*
            看得见的文字画在这一层：密码框里的字只能显示成圆点。真正接收按键的输入框透明地盖在上面，
            点击、焦点、粘贴都落在它身上。macOS 上是普通输入框，直接显示，这一层隐藏。
          */}
          <span
            ref={textRef}
            className={`scan-bar__text${input.value === '' ? ' scan-bar__text--placeholder' : ''}`}
            aria-hidden="true"
          >
            {input.value === '' ? PLACEHOLDER : input.value}
          </span>
          <input
            ref={inputRef}
            type={fieldType}
            className="scan-bar__input"
            value={input.value}
            onChange={(event) => input.onChange(event.target.value)}
            onKeyDown={input.onKeyDown}
            onCompositionStart={input.onCompositionStart}
            // 编码里有「-」，默认双击只选中一段；扫码框里的内容是一个整体，双击全选。
            onDoubleClick={(event) => event.currentTarget.select()}
            placeholder={PLACEHOLDER}
            autoComplete="off"
            spellCheck={false}
          />
        </span>
      </label>
      {/* 窗口窄时这一组整体换到第二行，扫码框不被挤窄。 */}
      <div className="scan-bar__options">
        <label className="note-picker">
          <span className="note-picker__label">备注</span>
          <select
            className="select-field note-picker__select"
            value={note.selected}
            onChange={(event) => {
              note.onSelect(event.target.value);
              // 选完立刻把焦点还给扫码框，避免下一次扫码的回车落在下拉框上。
              inputRef.current?.focus();
            }}
          >
            {note.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <Switch checked={autoPrint} onChange={onAutoPrintChange} text={autoPrint ? '自动打印' : '手动打印'} />
      </div>
      {input.isImeComposing && (
        <p className="scan-bar__ime" role="status">
          输入法在中文状态，扫码枪扫的内容会被输入法截走、也收不到回车。扫码前按一下 Shift 切到英文。
        </p>
      )}
    </section>
  );
}
