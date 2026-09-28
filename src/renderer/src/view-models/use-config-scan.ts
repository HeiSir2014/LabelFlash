import { useEffect, useRef } from 'react';
import { isScannerCharacter } from '../lib/scan-focus';
import { isTextEntry } from './use-scan-focus';
import { useScanInput } from './use-scan-input';

interface ConfigScanOptions {
  /** 配置中心打开、没有确认框时为 true；淡出期间和确认框打开时不接收。 */
  isEnabled: boolean;
  lineGapMs: number;
  /** 拼好的一次扫码：交给当前页（填进测试框，或提醒「正在配置，没有打印」）。 */
  onScan: (raw: string) => void;
}

/**
 * 配置中心里的扫码：焦点不在任何输入框时，扫码枪的第一个字符就把焦点切到隐藏的接收框，
 * 和工作台扫码框一样按停顿拼成一次扫码，再交给页面。这里永远不打印。
 * 焦点在输入框（例如规则名称）里时按键照常输入那个框，那是用户自己在填。
 */
export function useConfigScan({ isEnabled, lineGapMs, onScan }: ConfigScanOptions) {
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  const input = useScanInput(lineGapMs, (raw) => {
    // 交出去之后离开接收框：它不在 Tab 顺序里，焦点不该停在看不见的地方。
    sinkRef.current?.blur();
    onScan(raw);
  });
  const clearRef = useRef(input.clear);
  useEffect(() => {
    clearRef.current = input.clear;
  });

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !isScannerCharacter(event) || isTextEntry(document.activeElement)) {
        return;
      }
      const sink = sinkRef.current;
      if (!sink) {
        return;
      }
      // 新的一次扫码：丢掉上次残留的零散按键（界面状态和输入框本身都要清，
      // 否则浏览器把字符接在旧内容后面），再在 keydown 阶段切焦点，这个字符随后落进接收框。
      clearRef.current();
      sink.value = '';
      sink.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isEnabled]);

  return { sinkRef, ...input };
}
