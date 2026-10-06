import { useEffect, useState } from 'react';
import type { AppView } from '../lib/app-view';
import { type IgnoredScanPlace, ignoredScanPlace } from '../lib/scan-routing';
import { useConfigScan } from './use-config-scan';

interface PrintPageScanOptions {
  view: AppView;
  /** 没有确认框时为 true：确认框打开时按键属于确认框。 */
  canReceive: boolean;
  lineGapMs: number;
  /** 批量打印页、打印 PDF 页上扫了码：提醒「这一页扫码不打印」。 */
  onScanIgnored: (where: IgnoredScanPlace) => void;
}

/**
 * 批量打印页、打印 PDF 页里的扫码：和配置中心一样收进隐藏的接收框，永远不打印。
 * 不收的话，扫码枪的字符落到焦点所在的按钮上，最后的回车会点下它（例如把暂停的一批「继续」了）。
 */
export function usePrintPageScan({ view, canReceive, lineGapMs, onScanIgnored }: PrintPageScanOptions) {
  const isPrintPage = view.kind === 'batch' || view.kind === 'pdf';
  const [pillFlashes, setPillFlashes] = useState(0);
  // 提醒只对这一次打开页面时扫过码的人：离开就收起。
  useEffect(() => {
    if (!isPrintPage) {
      setPillFlashes(0);
    }
  }, [isPrintPage]);
  const sink = useConfigScan({
    isEnabled: isPrintPage && canReceive,
    lineGapMs,
    onScan: () => {
      // 停顿计时到点时页面可能已经关了：这次按键已经不属于这一页，丢掉。
      const where = ignoredScanPlace(view);
      if (where !== 'batch' && where !== 'pdf') {
        return;
      }
      onScanIgnored(where);
      setPillFlashes((count) => count + 1);
    },
  });
  return { sink, pillFlashes };
}
