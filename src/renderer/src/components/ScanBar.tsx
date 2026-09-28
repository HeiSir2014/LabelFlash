import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { NoteOption } from '../lib/note-options';

const REFOCUS_DELAY_MS = 300;
/** 焦点停在搜索框等文本框里、且这么久没有输入时，自动回到扫码框，避免扫码被别的输入框吃掉。 */
const TEXT_FIELD_IDLE_RETURN_MS = 8_000;
/** 在这些区域（模板编辑、设置）里的文本框可以长时间保留焦点。 */
const KEEP_FOCUS_SELECTOR = '[data-keep-focus]';
const TEXT_ENTRY_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'number']);

function isTextEntry(element: Element | null): boolean {
  if (element instanceof HTMLInputElement) {
    return TEXT_ENTRY_TYPES.has(element.type);
  }
  return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

export interface NoteControl {
  options: NoteOption[];
  selected: string;
  onSelect: (value: string) => void;
}

interface ScanBarProps {
  autoPrint: boolean;
  note: NoteControl;
  onAutoPrintChange: (autoPrint: boolean) => void;
  onScan: (raw: string) => void;
}

export function ScanBar({ autoPrint, note, onAutoPrintChange, onScan }: ScanBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const focusScanInput = () => inputRef.current?.focus();
    let idleTimer: number | undefined;

    const scheduleIdleReturn = () => {
      window.clearTimeout(idleTimer);
      const active = document.activeElement;
      if (active === inputRef.current || !isTextEntry(active) || active?.closest(KEEP_FOCUS_SELECTOR)) {
        return;
      }
      idleTimer = window.setTimeout(() => {
        if (document.activeElement === active) {
          focusScanInput();
        }
      }, TEXT_FIELD_IDLE_RETURN_MS);
    };

    // 焦点落到按钮、开关、空白处时拉回扫码框：否则扫码枪的回车会「点击」刚才的按钮。
    const onFocusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active === inputRef.current) {
          return;
        }
        if (isTextEntry(active)) {
          scheduleIdleReturn();
          return;
        }
        focusScanInput();
      }, REFOCUS_DELAY_MS);
    };

    focusScanInput();
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', scheduleIdleReturn, true);
    return () => {
      window.clearTimeout(idleTimer);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', scheduleIdleReturn, true);
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    const raw = event.currentTarget.value;
    setValue('');
    if (raw.trim() !== '') {
      onScan(raw);
    }
  };

  return (
    <section className="scan-bar" aria-label="扫码">
      <label className="scan-bar__field">
        <span className="scan-bar__label">扫码</span>
        <input
          ref={inputRef}
          className="scan-bar__input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="用扫码枪扫标签二维码，或手动输入后回车"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="note-picker">
        <span className="note-picker__label">备注</span>
        <select
          className="note-picker__select"
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
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          aria-checked={autoPrint}
          checked={autoPrint}
          onChange={(event) => onAutoPrintChange(event.target.checked)}
        />
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        <span className="switch__text">{autoPrint ? '自动打印' : '手动打印'}</span>
      </label>
    </section>
  );
}
