import { useEffect, useRef } from 'react';
import { IdleWatcher, isScannerCharacter, isTypingField } from '../lib/scan-focus';
import { WINDOW_TIMERS } from '../lib/timers';
import { activeFocusTarget } from './use-scan-focus';
import { useScanInput } from './use-scan-input';

/**
 * 接收框这么久没有新输入，里面的就是误按的零散按键，不是扫码：清空并离开接收框。
 * 扫码枪的字符间隔是几十毫秒，扫完后的停顿最长 500 毫秒（SCAN_LINE_GAP_RANGE.max），1 秒足够分开两者。
 * 不清的话，焦点留在看不见的接收框里：下一次扫码接在残留内容后面，Tab 也被当成扫码的分隔键移不走焦点。
 */
const STRAY_KEYS_IDLE_MS = 1_000;

interface ConfigScanOptions {
  /** 配置中心打开、没有确认框时为 true；淡出期间和确认框打开时不接收。 */
  isEnabled: boolean;
  lineGapMs: number;
  /** 拼好的一次扫码：交给当前页（填进测试框，或提醒「正在配置，没有打印」）。 */
  onScan: (raw: string) => void;
}

/**
 * 配置中心里的扫码：焦点不在输入框（下拉框也不算）时，扫码枪的第一个字符就把焦点切到隐藏的接收框，
 * 和工作台扫码框一样按停顿拼成一次扫码，再交给页面。这里永远不打印。
 * 焦点在输入框（例如规则名称、密钥内容）里时按键照常输入那个框，那是用户自己在填。
 */
export function useConfigScan({ isEnabled, lineGapMs, onScan }: ConfigScanOptions) {
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  const idleRef = useRef<IdleWatcher | null>(null);
  const input = useScanInput(lineGapMs, (raw) => {
    // 交出去之后离开接收框：它不在 Tab 顺序里，焦点不该停在看不见的地方。
    sinkRef.current?.blur();
    onScan(raw);
  });
  const { clear } = input;

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    const idle = new IdleWatcher(
      STRAY_KEYS_IDLE_MS,
      () => {
        const sink = sinkRef.current;
        if (sink !== null && document.activeElement === sink) {
          clear();
          sink.blur();
        }
      },
      WINDOW_TIMERS,
    );
    idleRef.current = idle;

    const onKeyDown = (event: KeyboardEvent) => {
      const sink = sinkRef.current;
      if (sink === null) {
        return;
      }
      if (event.target === sink) {
        idle.activity();
        return;
      }
      if (event.isComposing || !isScannerCharacter(event) || isTypingField(activeFocusTarget())) {
        return;
      }
      // 新的一次扫码：丢掉上次残留的内容（界面状态和输入框本身都要清，
      // 否则浏览器把字符接在旧内容后面），再在 keydown 阶段切焦点，这个字符随后落进接收框。
      clear();
      sink.value = '';
      sink.focus();
      idle.activity();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      idle.dispose();
      idleRef.current = null;
    };
  }, [isEnabled, clear]);

  return {
    sinkRef,
    value: input.value,
    // 中文可能不经过 keydown 送达（输入法上屏、Alt+小键盘码），内容变化也算接收框有动静。
    onChange: (next: string) => {
      idleRef.current?.activity();
      input.onChange(next);
    },
    onKeyDown: input.onKeyDown,
  };
}
