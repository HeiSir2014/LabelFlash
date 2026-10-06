import type { KeyboardEvent, RefObject } from 'react';
import type { ScanFieldType } from '../lib/scan-field';

/** 隐藏的扫码接收框（见 view-models/use-config-scan.ts）。 */
export interface ScanSink {
  sinkRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** 批量打印页、打印 PDF 页的接收框和「扫码不打印」提醒（use-print-page-scan.ts）。 */
export interface PageScanSink {
  sink: ScanSink;
  fieldType: ScanFieldType;
  pillFlashes: number;
}

/** 打印页的页头里：「扫码不打印」提醒 + 隐藏的接收框。 */
export function PrintPageScanSink({ scan, label }: { scan: PageScanSink; label: string }) {
  return (
    <>
      <IgnoredScanPill flashes={scan.pillFlashes} text="扫码不打印" />
      <ScanSinkField sink={scan.sink} fieldType={scan.fieldType} label={label} />
    </>
  );
}

interface ScanSinkFieldProps {
  sink: ScanSink;
  /** 接收框用密码框还是普通输入框（Windows 上用密码框关掉输入法，见 lib/scan-field.ts）。 */
  fieldType: ScanFieldType;
  label: string;
}

/**
 * 不打印的页面上收扫码的隐藏输入框：扫码枪的字符和回车落在这里，不会落到焦点所在的按钮上
 * （回车会点下按钮，例如把暂停的批量打印「继续」了）。不在 Tab 顺序里。
 */
export function ScanSinkField({ sink, fieldType, label }: ScanSinkFieldProps) {
  return (
    <input
      ref={sink.sinkRef}
      type={fieldType}
      className="visually-hidden"
      aria-label={label}
      tabIndex={-1}
      value={sink.value}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => sink.onChange(event.target.value)}
      onKeyDown={sink.onKeyDown}
    />
  );
}

interface IgnoredScanPillProps {
  /** 这一页扫过码的次数：大于 0 时显示，每变一次闪两下。 */
  flashes: number;
  text: string;
}

/**
 * 只在这里扫了码之后出现（每一页都挂着就是噪音）；换 key 重新挂载，闪烁动画才会每次都从头播放。
 */
export function IgnoredScanPill({ flashes, text }: IgnoredScanPillProps) {
  if (flashes === 0) {
    return null;
  }
  return (
    <span key={flashes} className="config-pill config-pill--flash" role="status">
      {text}
    </span>
  );
}
