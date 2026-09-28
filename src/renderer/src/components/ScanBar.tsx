import { type KeyboardEvent, useState } from 'react';
import type { NoteOption } from '../lib/note-options';
import { useScanFocus } from '../view-models/use-scan-focus';

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
  const inputRef = useScanFocus();
  const [value, setValue] = useState('');

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
          // 编码里有「-」，默认双击只选中一段；扫码框里的内容是一个整体，双击全选。
          onDoubleClick={(event) => event.currentTarget.select()}
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
