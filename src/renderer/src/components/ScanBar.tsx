import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { NoteOption } from '../lib/note-options';
import { fromDisplay, pasteInto, type ScanFieldType, selectionParts } from '../lib/scan-field';
import { IdleWatcher, SCAN_FOCUS_IDLE_MS } from '../lib/scan-focus';
import { nextScanMode, type ScanMode, type ScanModeEvent } from '../lib/scan-mode';
import { WINDOW_TIMERS } from '../lib/timers';
import { useImeScanRescue } from '../view-models/use-ime-scan-rescue';
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
  // Windows 上的两种模式（见 lib/scan-mode.ts）：点进扫码框手动编辑时换成普通输入框，能用输入法。
  const [mode, setMode] = useState<ScanMode>('scan');
  // 输入法截走了扫码枪的按键、又拼不回来时的提醒。
  const [isScanLost, setIsScanLost] = useState(false);
  const switchMode = useCallback((event: ScanModeEvent) => {
    setMode((current) => nextScanMode(current, event));
    setIsScanLost(false);
  }, []);
  const input = useScanInput(lineGapMs, (raw) => {
    switchMode('submitted');
    onScan(raw);
  });
  // 输入法开着时扫码（macOS、Windows 的手动编辑模式）：按物理按键拼回扫码枪发出的内容，丢掉输入法组出来的字。
  const rescue = useImeScanRescue({
    lineGapMs,
    content: () => fromDisplay(input.value),
    onRebuilt: (raw) => {
      // 先让输入法结束组字（失焦会把没上屏的字交出来），再清掉框里被输入法弄乱的内容。
      const field = inputRef.current;
      field?.blur();
      field?.focus();
      input.clear();
      switchMode('submitted');
      if (raw.trim() !== '') {
        onScan(raw);
      }
    },
    onUnreadable: () => setIsScanLost(true),
  });
  const canEditManually = fieldType === 'password';
  const type: ScanFieldType = mode === 'manual' ? 'text' : fieldType;
  const idleRef = useRef<IdleWatcher | null>(null);

  // 手动模式下一段时间没有操作就回到扫码模式：操作员走开了，下一个人拿起扫码枪就能扫。
  useEffect(() => {
    if (mode !== 'manual') {
      return;
    }
    const idle = new IdleWatcher(SCAN_FOCUS_IDLE_MS, () => switchMode('idle'), WINDOW_TIMERS);
    idle.activity();
    idleRef.current = idle;
    return () => {
      idle.dispose();
      idleRef.current = null;
    };
  }, [mode, switchMode]);
  const textRef = useRef<HTMLSpanElement>(null);
  const textId = useId();

  const [selection, setSelection] = useState<Selection>({ start: null, end: null });
  // 粘贴后光标要落在粘进来的内容后面：值由界面状态重设，浏览器会把光标挪到末尾，所以渲染后再放回去。
  const caretAfterPaste = useRef<number | null>(null);
  const readSelection = (field: HTMLInputElement) =>
    setSelection({ start: field.selectionStart, end: field.selectionEnd });

  // 换模式时浏览器可能重置选区：换完之后按输入框的真实选区重画光标。
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (field?.type === type) {
      setSelection({ start: field.selectionStart, end: field.selectionEnd });
    }
  }, [type, inputRef]);

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
      <label className={`scan-bar__field${mode === 'manual' ? ' scan-bar__field--manual' : ''}`}>
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
            type={type}
            className="scan-bar__input"
            value={input.value}
            onChange={(event) => input.onChange(event.target.value)}
            onPointerDown={() => {
              if (canEditManually) {
                switchMode('pointer-down');
              }
            }}
            onKeyDown={(event) => {
              idleRef.current?.activity();
              if (rescue.onKeyDown(event)) {
                return;
              }
              if (mode === 'manual' && event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                switchMode('escape');
                return;
              }
              input.onKeyDown(event);
            }}
            onBlur={() => switchMode('blur')}
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
        {mode === 'manual' && (
          <span className="scan-bar__mode" role="status">
            手动输入 · 回车提交 · Esc 返回扫码
          </span>
        )}
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
      {isScanLost && (
        <p className="scan-bar__ime" role="status">
          {canEditManually
            ? '扫码枪扫的内容被输入法截走了，这一次没有提交。按 Esc 回到扫码模式，再扫一次。'
            : '扫码枪扫的内容被输入法截走了，这一次没有提交。按一下 Shift 把输入法切到英文，再扫一次。'}
        </p>
      )}
    </section>
  );
}
