import type { BatchPauseReason, BatchProgress } from '../../../core/batch/batch-runner';

/**
 * 批量打印和打印 PDF 共用的进度文字：两边都是 BatchRun 在逐张打，同一件事用同一句话说
 * （「已发送」= 驱动收下了，不说「打印成功」）。
 */
export interface ProgressView {
  text: string;
  /** 0–100（已发送 + 失败）。 */
  percent: number;
}

const PERCENT = 100;

/** 底部操作条的进度文字。 */
export function describeRunProgress(progress: BatchProgress): ProgressView {
  const done = progress.sent + progress.failed;
  const percent = progress.total === 0 ? 0 : Math.round((done / progress.total) * PERCENT);
  const counts = `已发送 ${progress.sent} / ${progress.total} 张${progress.failed > 0 ? ` · 失败 ${progress.failed} 张` : ''}`;
  switch (progress.state) {
    case 'running':
      return { text: `正在打印 · ${counts}`, percent };
    case 'paused':
      return { text: `已暂停（${describePauseReason(progress.pauseReason)}）· ${counts}`, percent };
    case 'canceled':
      return { text: `已取消 · ${counts}`, percent };
    case 'done':
      return { text: `${progress.failed > 0 ? '已结束' : '全部已发送'} · ${counts}`, percent };
  }
}

export function describePauseReason(reason: BatchPauseReason | null): string {
  switch (reason) {
    case 'no-printer':
      return '这种纸还没有打印机：到「打印机」页分配后点继续';
    case 'PRINTER_NOT_READY':
      return '打印机现在不能打印：缺纸、离线或卡纸，处理好后点继续';
    case 'PRINTER_NOT_FOUND':
      return '找不到打印机：检查连接后点继续';
    // 打印机状态在 macOS 上一直是「未知」，拔纸、卡纸不会被认成上面那几种：连续失败几张就自动暂停，
    // 和「这种纸没有打印机」分开提示，操作员知道要去检查打印机本身，而不是去配置页分配打印机。
    case 'consecutive-failures':
      return '连续几张都没打印成功：检查打印机后点继续';
    // 触发暂停的那一张是超时：驱动没回话不代表没打印，和前一种分开措辞，提醒操作员自己确认有没有出纸，
    // 而不是直接当成「没打」去重打（重打有重复出纸的风险）。
    case 'consecutive-failures-after-timeout':
      return '最后一张可能已经打出来了：看一眼打印机，确认后点继续';
    case 'operator':
    case null:
      return '点继续接着打';
  }
}

/**
 * 标题栏「批量打印」「打印 PDF」按钮上的进度：正在打或暂停时显示「36/120」（已发送 + 失败 / 总数，
 * 和进度条一样数），其余不显示；关掉页面也看得到。
 */
export function runButtonProgress(progress: BatchProgress | null): string | null {
  if (progress === null || (progress.state !== 'running' && progress.state !== 'paused')) {
    return null;
  }
  return `${progress.sent + progress.failed}/${progress.total}`;
}
