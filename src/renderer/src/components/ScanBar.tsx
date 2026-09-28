import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { WINDOW_TIMERS } from '../lib/hover-intent';
import type { NoteOption } from '../lib/note-options';
import { ScanAssembler } from '../lib/scan-assembler';
import { useScanFocus } from '../view-models/use-scan-focus';

export interface NoteControl {
  options: NoteOption[];
  selected: string;
  onSelect: (value: string) => void;
}

interface ScanBarProps {
  autoPrint: boolean;
  /** 多行扫码：回车 / Tab 之后等这么久没有新字符，才算一次扫码结束。 */
  lineGapMs: number;
  note: NoteControl;
  onAutoPrintChange: (autoPrint: boolean) => void;
  onScan: (raw: string) => void;
}

export function ScanBar({ autoPrint, lineGapMs, note, onAutoPrintChange, onScan }: ScanBarProps) {
  const inputRef = useScanFocus();
  const [value, setValue] = useState('');
  // 计时器回调里要读到最新的内容和回调，用 ref 保存。
  const valueRef = useRef('');
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const setContent = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };
  const [assembler] = useState(
    () =>
      new ScanAssembler(
        lineGapMs,
        () => {
          const raw = valueRef.current;
          setContent('');
          if (raw.trim() !== '') {
            onScanRef.current(raw);
          }
        },
        WINDOW_TIMERS,
      ),
  );

  useEffect(() => assembler.setGap(lineGapMs), [assembler, lineGapMs]);
  useEffect(() => () => assembler.dispose(), [assembler]);

  /**
   * 回车和 Tab 都交给 ScanAssembler 判断是码里的换行还是扫码结束（Tab 因此不再移动焦点；
   * Shift+Tab 仍可离开扫码框）。
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const isBreakKey = event.key === 'Enter' || event.key === 'Tab';
    const hasModifier = event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
    if (event.nativeEvent.isComposing || !isBreakKey || hasModifier) {
      return;
    }
    event.preventDefault();
    setContent(valueRef.current + assembler.breakKey(event.key === 'Enter' ? 'enter' : 'tab'));
  };

  /**
   * 挂起期间内容变长了：说明刚才的回车 / Tab 是码里的，补上分隔符。
   * 按内容变化判断而不是按键：中文往往不经过 keydown 送达（Windows 扫码枪的 Alt+小键盘码、输入法上屏）。
   * 扫码枪总是在末尾输入，所以只处理「在原内容后面追加」的情况。
   */
  const handleChange = (next: string) => {
    const previous = valueRef.current;
    if (assembler.isPending && next.length > previous.length && next.startsWith(previous)) {
      setContent(previous + assembler.character() + next.slice(previous.length));
      return;
    }
    setContent(next);
  };

  return (
    <section className="scan-bar" aria-label="扫码">
      <label className="scan-bar__field">
        <span className="scan-bar__label">扫码</span>
        {/* textarea 才能收下码里的换行；只显示一行，扫完即清空。 */}
        <textarea
          ref={inputRef}
          className="scan-bar__input"
          rows={1}
          wrap="off"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          // 编码里有「-」，默认双击只选中一段；扫码框里的内容是一个整体，双击全选。
          onDoubleClick={(event) => event.currentTarget.select()}
          placeholder="用扫码枪扫标签二维码，或手动输入后回车"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {/* 窗口窄时这一组整体换到第二行，扫码框不被挤窄。 */}
      <div className="scan-bar__options">
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
      </div>
    </section>
  );
}
