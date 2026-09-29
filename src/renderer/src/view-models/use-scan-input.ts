import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ScanAssembler } from '../lib/scan-assembler';
import { fromDisplay, toDisplay } from '../lib/scan-field';
import { WINDOW_TIMERS } from '../lib/timers';

type ScanField = HTMLInputElement | HTMLTextAreaElement;

/**
 * 接收扫码枪「打字」的输入框：码里的换行（回车 / Tab 后紧跟下一个字符）留在内容里，
 * 回车 / Tab 之后停顿 lineGapMs 才算扫完，交给 onScan 并清空。工作台扫码框和配置中心的接收框共用。
 * 输入框是单行的（Windows 上是密码框，见 lib/scan-field.ts），框里的值用 ⏎ / ⇥ 表示换行和 Tab。
 */
export function useScanInput(lineGapMs: number, onScan: (raw: string) => void) {
  const [value, setValue] = useState('');
  // 输入法在这个框里开始组字：扫码枪的按键会被截走，要提醒切到英文（Windows 的密码框里不会发生）。
  const [isImeComposing, setIsImeComposing] = useState(false);
  // 计时器回调里要读到最新的内容和回调，用 ref 保存（在 effect 里更新，不在渲染中改 ref）。
  const valueRef = useRef('');
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });
  const setContent = useCallback((next: string) => {
    valueRef.current = next;
    setValue(next);
  }, []);
  const [assembler] = useState(
    () =>
      new ScanAssembler(
        lineGapMs,
        () => {
          const raw = valueRef.current;
          setContent('');
          if (raw.trim() !== '') {
            // 完整收到一次扫码，说明输入法已经不挡了。
            setIsImeComposing(false);
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
   * Shift+Tab 仍可离开输入框）。
   */
  const onKeyDown = (event: KeyboardEvent<ScanField>) => {
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
  const onChange = (nextDisplay: string) => {
    const next = fromDisplay(nextDisplay);
    const previous = valueRef.current;
    if (assembler.isPending && next.length > previous.length && next.startsWith(previous)) {
      setContent(previous + assembler.character() + next.slice(previous.length));
      return;
    }
    setContent(next);
  };

  const onCompositionStart = () => setIsImeComposing(true);

  /** 丢掉还没扫完的内容（例如接收框里残留的零散按键）。 */
  const clear = useCallback(() => setContent(''), [setContent]);

  return { value: toDisplay(value), isImeComposing, onChange, onKeyDown, onCompositionStart, clear };
}
