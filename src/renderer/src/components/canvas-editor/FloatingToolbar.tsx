import { Fragment, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { CANVAS_LIMITS, type CanvasElement } from '../../../../core/templates/canvas-model';
import type { ElementWarning } from '../../../../shared/render-warnings';
import type { Platform } from '../../lib/app-view';
import type { Alignment, Box } from '../../lib/canvas-edit';
import {
  type FloatingPosition,
  type FloatingTool,
  floatingToolbarPosition,
  floatingTools,
  nextTextAlign,
} from '../../lib/canvas-float';
import { PX_PER_MM } from '../../lib/canvas-view';
import { withShortcut } from '../../lib/designer-shortcuts';
import type { SelectOption } from '../../lib/insert-field-options';
import { AlignButtons } from './ArrangeButtons';
import { IconButton } from './IconButton';
import { FONT_STEP_MM } from './options';

/** 工具条和选框之间至少隔这么多（px）：控制点可点范围的一半（12px）再留一点，不盖住控制点。 */
const GAP_ABOVE_PX = 18;
/** 放在下方时隔得更远：选框下面还有旋转手柄（离选框 20px、可点范围 24px）。 */
const GAP_BELOW_PX = 46;
/** 工具条离画布滚动区的边至少留这么多（px）。 */
const EDGE_MARGIN_PX = 8;
/** 对齐按钮的图标和名字跟着现在的对齐走（点一下换下一种）。 */
const TEXT_ALIGN_TOOL = {
  left: { icon: 'textLeft', label: '靠左' },
  center: { icon: 'textCenter', label: '居中' },
  right: { icon: 'textRight', label: '靠右' },
} as const;

interface FloatingToolbarProps {
  /** 选中的元素（一个或几个）。 */
  elements: readonly CanvasElement[];
  /** 选中的东西合起来的框（mm，拖动中用临时框）。 */
  box: Box;
  zoom: number;
  platform: Platform;
  /** 滚动区和覆盖层：工具条只放在看得见的范围里，滚动、缩放时跟着重新算位置。 */
  stageRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  /** 选中的那一个元素的问题（「放大到能印」要用）。 */
  warnings: readonly ElementWarning[];
  /** 「绑定字段」下拉框的选项（条码、二维码用）。 */
  fieldOptions: readonly SelectOption[];
  onChange: (next: CanvasElement) => void;
  onEditText: () => void;
  onGrowToPrint: (warning: ElementWarning) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAlign: (alignment: Alignment) => void;
  /** 「⋯」：在按钮下面打开完整的菜单（锁定、叠放、等距都在那里）。 */
  onMore: (at: { x: number; y: number }) => void;
}

/**
 * 跟着选中走的浮动工具条（参考平板上的排版软件）：选框上方（放不下在下方）一条圆角小工具条，一行、六到八个按钮，
 * 放这一类最常用的操作（见 lib/canvas-float 的 floatingTools）。文字：字号 −/+、加粗、对齐、改字；
 * 条码 / 二维码：绑定字段、需要时「放大到能印」；多选：对齐；都有复制一份、删除和「⋯」（完整菜单：锁定、叠放、等距）。
 * 拖起来时由调用方藏起来，松手再出现。它在画布覆盖层后面的 DOM 里：画布有焦点时按 Tab 就走到这里。
 */
export function FloatingToolbar(props: FloatingToolbarProps) {
  const { elements, box, zoom, stageRef, overlayRef } = props;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const [scrollTick, setScrollTick] = useState(0);

  // 画布滚动、窗口变大小时位置要重算：只记一个计数，真正的计算在下面的 layout effect 里。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage === null) {
      return;
    }
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollTick((tick) => tick + 1));
    };
    stage.addEventListener('scroll', bump, { passive: true });
    const observer = new ResizeObserver(bump);
    observer.observe(stage);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener('scroll', bump);
      observer.disconnect();
    };
  }, [stageRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollTick 只用来在滚动后重算位置；元素变了工具条的宽度会变，也要重算
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const stage = stageRef.current;
    const overlay = overlayRef.current;
    if (toolbar === null || stage === null || overlay === null) {
      return;
    }
    const pxPerMm = PX_PER_MM * zoom;
    const stageRect = stage.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const bounds = {
      left: stageRect.left - overlayRect.left + EDGE_MARGIN_PX,
      top: stageRect.top - overlayRect.top + EDGE_MARGIN_PX,
      right: stageRect.right - overlayRect.left - EDGE_MARGIN_PX,
      bottom: stageRect.bottom - overlayRect.top - EDGE_MARGIN_PX,
    };
    // 画布区角上的撤销重做、缩放胶囊（和滚动区同在 .designer-stage-area 里）：工具条不盖住它们。
    const avoid = [...(stage.parentElement?.querySelectorAll<HTMLElement>('.designer-float') ?? [])].map((control) => {
      const rect = control.getBoundingClientRect();
      return { x: rect.left - overlayRect.left, y: rect.top - overlayRect.top, width: rect.width, height: rect.height };
    });
    // 工具条一行不折（按钮少，1024 宽也放得下）：按量出来的大小摆。
    setPosition(
      floatingToolbarPosition({
        selection: { x: box.x * pxPerMm, y: box.y * pxPerMm, width: box.width * pxPerMm, height: box.height * pxPerMm },
        toolbar: { width: toolbar.offsetWidth, height: toolbar.offsetHeight },
        bounds,
        gap: GAP_ABOVE_PX,
        gapBelow: GAP_BELOW_PX,
        avoid,
      }),
    );
  }, [box.x, box.y, box.width, box.height, zoom, scrollTick, elements]);

  return (
    <div
      ref={toolbarRef}
      className="floating-toolbar"
      role="toolbar"
      aria-label="选中元素的工具条"
      style={
        position === null ? { visibility: 'hidden' } : { left: position.left, top: position.top, visibility: 'visible' }
      }
    >
      {floatingTools({ kinds: elements.map((element) => element.kind), canGrow: growableOf(props) !== undefined }).map(
        (tool, index) => (
          <Fragment key={tool}>
            {/* 这一类自己的操作和通用的（复制一份、删除、⋯）之间一条竖线。 */}
            {tool === 'duplicate' && index > 0 && <span className="floating-toolbar__divider" aria-hidden="true" />}
            <Tool tool={tool} {...props} />
          </Fragment>
        ),
      )}
    </div>
  );
}

/** 选中的那一个条码（二维码）印不出、放大就能印时，那条问题。 */
function growableOf({ elements, warnings }: FloatingToolbarProps): ElementWarning | undefined {
  return elements.length === 1
    ? warnings.find(
        (warning) => warning.level === 'omitted' && (warning.minWidthMm !== null || warning.minHeightMm !== null),
      )
    : undefined;
}

function Tool(props: FloatingToolbarProps & { tool: FloatingTool }) {
  const { tool, elements, platform, onChange } = props;
  const [single] = elements;
  switch (tool) {
    case 'fontSize':
      return single?.kind === 'text' ? <FontSize element={single} onChange={onChange} /> : null;
    case 'bold':
      return single?.kind === 'text' ? (
        <IconButton
          icon="bold"
          name="加粗"
          pressed={single.bold}
          onClick={() => onChange({ ...single, bold: !single.bold })}
        />
      ) : null;
    case 'textAlign': {
      if (single?.kind !== 'text') {
        return null;
      }
      const current = TEXT_ALIGN_TOOL[single.align];
      const next = TEXT_ALIGN_TOOL[nextTextAlign(single.align)];
      return (
        <IconButton
          icon={current.icon}
          name={`文字${current.label}`}
          tooltip={`文字${current.label}（点一下换成${next.label}）`}
          onClick={() => onChange({ ...single, align: nextTextAlign(single.align) })}
        />
      );
    }
    case 'editText':
      return <IconButton icon="edit" name="改文字" tooltip="改文字（也可以双击）" onClick={props.onEditText} />;
    case 'field':
      return single?.kind === 'barcode' || single?.kind === 'qr' ? (
        <FieldSelect element={single} options={props.fieldOptions} onChange={onChange} />
      ) : null;
    case 'grow': {
      const growable = growableOf(props);
      return growable === undefined ? null : (
        <IconButton
          icon="grow"
          name="放大到能印"
          text="放大到能印"
          className="floating-toolbar__fix"
          onClick={() => props.onGrowToPrint(growable)}
        />
      );
    }
    case 'alignElements':
      return <AlignButtons isSingle={false} onAlign={props.onAlign} />;
    case 'duplicate':
      return (
        <IconButton
          icon="duplicate"
          name="复制一份"
          tooltip={withShortcut('复制一份', 'duplicate', platform)}
          onClick={props.onDuplicate}
        />
      );
    case 'delete':
      return (
        <IconButton
          icon="trash"
          name="删除"
          tooltip={withShortcut('删除', 'delete', platform)}
          disabled={elements.every((element) => element.locked)}
          onClick={props.onDelete}
        />
      );
    case 'more':
      return <MoreButton onMore={props.onMore} />;
  }
}

/** 字号 − 数字 +：数字后面小字写单位（字号按毫米算，和检查器、打印一致）。 */
function FontSize({
  element,
  onChange,
}: {
  element: Extract<CanvasElement, { kind: 'text' }>;
  onChange: (next: CanvasElement) => void;
}) {
  const { min, max } = CANVAS_LIMITS.fontSizeMm;
  const setSize = (fontSizeMm: number) =>
    onChange({ ...element, fontSizeMm: Math.min(max, Math.max(min, Math.round(fontSizeMm * 10) / 10)) });
  return (
    <>
      <IconButton
        icon="minus"
        name="字号减小"
        disabled={element.fontSizeMm <= min}
        onClick={() => setSize(element.fontSizeMm - FONT_STEP_MM)}
      />
      <span className="floating-toolbar__value" title={`字号 ${element.fontSizeMm}mm`}>
        {element.fontSizeMm}
        <span className="floating-toolbar__unit">mm</span>
      </span>
      <IconButton
        icon="plus"
        name="字号增大"
        disabled={element.fontSizeMm >= max}
        onClick={() => setSize(element.fontSizeMm + FONT_STEP_MM)}
      />
    </>
  );
}

/** 条码、二维码的「绑定字段」：选一个字段就把内容换成 {字段名}（要拼几个字段在检查器里改）。 */
function FieldSelect({
  element,
  options,
  onChange,
}: {
  element: Extract<CanvasElement, { kind: 'barcode' | 'qr' }>;
  options: readonly SelectOption[];
  onChange: (next: CanvasElement) => void;
}) {
  const bound = options.find((option) => option.value === element.value);
  return (
    <label className="floating-toolbar__field" title="绑定字段：内容换成这个字段">
      <span className="floating-toolbar__field-icon" aria-hidden="true">
        {'{ }'}
      </span>
      <select
        className="floating-toolbar__select"
        aria-label="绑定字段"
        value={bound?.value ?? ''}
        onChange={(event) => {
          if (event.target.value !== '') {
            onChange({ ...element, value: event.target.value });
          }
        }}
      >
        {bound === undefined && <option value="">{element.value === '' ? '选字段…' : '多个字段 / 自填'}</option>}
        {options
          .filter((option) => option.value !== '')
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
    </label>
  );
}

function MoreButton({ onMore }: { onMore: (at: { x: number; y: number }) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} className="floating-toolbar__more">
      <IconButton
        icon="more"
        name="更多"
        tooltip="更多：锁定、叠放、对齐……（也可以在画布上点右键）"
        onClick={() => {
          const rect = ref.current?.getBoundingClientRect();
          onMore({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
        }}
      />
    </span>
  );
}
