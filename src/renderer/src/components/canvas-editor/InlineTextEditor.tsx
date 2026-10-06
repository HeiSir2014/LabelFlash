import { type CSSProperties, useRef, useState } from 'react';
import { CANVAS_LIMITS } from '../../../../core/templates/canvas-model';
import { LINE_HEIGHT } from '../../../../core/templates/text-fit';
import type { InlineEditorLayout } from '../../lib/canvas-inline';

interface InlineTextEditorProps {
  layout: InlineEditorLayout;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

/** 转过的文字：输入框和打印一样绕左上角转，再平移回元素的框里（见 main/printing/canvas-html 的 rotationCss）。 */
function rotationTransform({ rotation, box }: InlineEditorLayout): string | undefined {
  const width = `calc(${box.width} * var(--mm))`;
  const height = `calc(${box.height} * var(--mm))`;
  switch (rotation) {
    case 0:
      return undefined;
    case 90:
      return `translate(${width}, 0) rotate(90deg)`;
    case 180:
      return `translate(${width}, ${height}) rotate(180deg)`;
    case 270:
      return `translate(0, ${height}) rotate(270deg)`;
  }
}

/**
 * 就地改字：盖在文字（或表格的一格）上、同样大小、字号、粗细、对齐的输入框。
 * Enter 换行，Ctrl / ⌘ + Enter 或点到外面算改完（一次提交、一步撤销），Esc 放弃。
 * 它是普通的输入框：扫码枪打的字会进到这里（正在改字，本来就该这样）。
 */
export function InlineTextEditor({ layout, onCommit, onCancel }: InlineTextEditorProps) {
  const [value, setValue] = useState(layout.text);
  // 提交、放弃之后输入框被拿掉时浏览器可能还会补一个 blur：只认第一次结束。
  const isDoneRef = useRef(false);
  const finish = (commit: boolean) => {
    if (isDoneRef.current) {
      return;
    }
    isDoneRef.current = true;
    if (commit) {
      onCommit(value);
    } else {
      onCancel();
    }
  };
  const { box, rotation } = layout;
  const isTurned = rotation === 90 || rotation === 270;
  const frame = isTurned ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
  const style: CSSProperties = {
    left: `calc(${box.x} * var(--mm))`,
    top: `calc(${box.y} * var(--mm))`,
    width: `calc(${frame.width} * var(--mm))`,
    height: `calc(${frame.height} * var(--mm))`,
    fontSize: `calc(${layout.fontSizeMm} * var(--mm))`,
    fontWeight: layout.bold ? 700 : 400,
    textAlign: layout.align,
    lineHeight: LINE_HEIGHT,
    transform: rotationTransform(layout),
  };
  return (
    <textarea
      className="inline-editor"
      aria-label="就地改文字（Ctrl+Enter 改完，Esc 放弃）"
      style={style}
      value={value}
      maxLength={CANVAS_LIMITS.textLength}
      spellCheck={false}
      // biome-ignore lint/a11y/noAutofocus: 双击文字就是要改它，焦点直接放进来
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === 'Escape') {
          // 只放弃这次改字：不让 Esc 冒泡到配置中心（那会返回模板列表）。
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          finish(true);
        }
      }}
    />
  );
}
