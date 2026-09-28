import type { NoteOption } from '../lib/note-options';
import { useScanFocus } from '../view-models/use-scan-focus';
import { useScanInput } from '../view-models/use-scan-input';
import { Switch } from './form-controls';

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
  note: NoteControl;
  onAutoPrintChange: (autoPrint: boolean) => void;
  onScan: (raw: string) => void;
}

export function ScanBar({ isActive, autoPrint, lineGapMs, note, onAutoPrintChange, onScan }: ScanBarProps) {
  const inputRef = useScanFocus(isActive);
  const input = useScanInput(lineGapMs, onScan);

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
          value={input.value}
          onChange={(event) => input.onChange(event.target.value)}
          onKeyDown={input.onKeyDown}
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
    </section>
  );
}
