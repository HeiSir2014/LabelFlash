import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { NoteOption } from '../lib/note-options';
import { pasteInto, type ScanFieldType, selectionParts } from '../lib/scan-field';
import { useScanFocus } from '../view-models/use-scan-focus';
import { useScanInput } from '../view-models/use-scan-input';
import { Switch } from './form-controls';

const PLACEHOLDER = '用扫码枪扫标签二维码，或手动输入后回车';
/** 光标离文字层边缘至少留这么宽：滚动时光标不贴着边框。 */
const CARET_MARGIN_PX = 24;

interface Selection {
  start: number | null;
  end: number | null;
}

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
  const textId = useId();

  const [selection, setSelection] = useState<Selection>({ start: null, end: null });
  // 粘贴后光标要落在粘进来的内容后面：值由界面状态重设，浏览器会把光标挪到末尾，所以渲染后再放回去。
  const caretAfterPaste = useRef<number | null>(null);
  const readSelection = (field: HTMLInputElement) =>
    setSelection({ start: field.selectionStart, end: field.selectionEnd });

  // 让光标（或选区的末端）留在看得见的范围里：扫码枪和手动输入都在末尾打字，方向键移到前面时跟着滚回去。
  const { value } = input;
  const parts = selectionParts(value, selection.start, selection.end);
  const { before, selected } = parts;
  useLayoutEffect(() => {
    const field = inputRef.current;
    const caret = caretAfterPaste.current;
    // 等输入框里已经是粘贴后的内容，再把光标放回粘进来的内容后面。
    if (field && caret !== null && field.value === value) {
      caretAfterPaste.current = null;
      field.setSelectionRange(caret, caret);
      setSelection({ start: caret, end: caret });
    }
  }, [value, inputRef]);
  useLayoutEffect(() => {
    const text = textRef.current;
    // 没有选中时跟着光标，有选中时跟着选区的末端；before / selected 变了就说明光标或选区动了。
    const marker = text?.querySelector<HTMLElement>(selected === '' ? '.scan-bar__caret' : '.scan-bar__selection');
    // 光标在最前面（包括框里没有内容）：从头显示。
    if (!text || !marker || (before === '' && selected === '')) {
      text?.scrollTo({ left: 0 });
      return;
    }
    const left = marker.offsetLeft - text.offsetLeft;
    const right = left + marker.offsetWidth;
    if (left < text.scrollLeft + CARET_MARGIN_PX) {
      text.scrollLeft = Math.max(0, left - CARET_MARGIN_PX);
    } else if (right > text.scrollLeft + text.clientWidth - CARET_MARGIN_PX) {
      text.scrollLeft = right - text.clientWidth + CARET_MARGIN_PX;
    }
  }, [before, selected]);

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
            id={textId}
            className={`scan-bar__text${value === '' ? ' scan-bar__text--placeholder' : ''}`}
            // 由程序滚到光标处（滚动条隐藏）：是滚动容器，不是被裁掉的文字。
            data-allow-x-scroll=""
            aria-hidden="true"
          >
            {value === '' ? (
              <>
                <span className="scan-bar__caret" />
                {PLACEHOLDER}
              </>
            ) : (
              <>
                {parts.before}
                {parts.selected === '' ? (
                  <span className="scan-bar__caret" />
                ) : (
                  <mark className="scan-bar__selection">{parts.selected}</mark>
                )}
                {parts.after}
              </>
            )}
          </span>
          <input
            ref={inputRef}
            type={fieldType}
            className="scan-bar__input"
            value={input.value}
            onChange={(event) => input.onChange(event.target.value)}
            onKeyDown={input.onKeyDown}
            onCompositionStart={input.onCompositionStart}
            onSelect={(event) => readSelection(event.currentTarget)}
            // 自己处理粘贴：单行输入框会删掉换行，多行的码粘进来就变了。
            onPaste={(event) => {
              event.preventDefault();
              const field = event.currentTarget;
              const start = field.selectionStart ?? field.value.length;
              const end = field.selectionEnd ?? start;
              const next = pasteInto(field.value, start, end, event.clipboardData.getData('text/plain'));
              caretAfterPaste.current = start + next.length - (field.value.length - (end - start));
              input.onChange(next);
            }}
            // 名字来自外层的「扫码」标签。密码框的内容读屏只念成圆点，所以把看得见的那层文字当作说明念出来
            // （那层本身 aria-hidden，不会念两遍）。
            aria-describedby={textId}
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
