import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { CANVAS_LIMITS, type CanvasElement } from '../../../../core/templates/canvas-model';
import type { ElementWarning } from '../../../../shared/render-warnings';
import type { Platform } from '../../lib/app-view';
import type { Alignment, Box, DistributeAxis } from '../../lib/canvas-edit';
import { type FloatingPosition, floatingToolbarPosition } from '../../lib/canvas-float';
import type { LayerMove } from '../../lib/canvas-view';
import { PX_PER_MM } from '../../lib/canvas-view';
import { withShortcut } from '../../lib/designer-shortcuts';
import type { SelectOption } from '../../lib/insert-field-options';
import { AlignButtons, DistributeButtons } from './ArrangeButtons';
import { IconButton } from './IconButton';
import { FONT_STEP_MM } from './options';

/** 工具条和选框之间至少隔这么多（px）：控制点可点范围的一半（12px）再留一点，不盖住控制点。 */
const GAP_ABOVE_PX = 18;
/** 放在下方时隔得更远：选框下面还有旋转手柄（离选框 20px、可点范围 24px）。 */
const GAP_BELOW_PX = 46;
/** 工具条离画布滚动区的边至少留这么多（px）。 */
const EDGE_MARGIN_PX = 8;

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
  canDistribute: boolean;
  onChange: (next: CanvasElement) => void;
  onEditText: () => void;
  onGrowToPrint: (warning: ElementWarning) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSetLocked: (locked: boolean) => void;
  onLayer: (move: LayerMove) => void;
  onAlign: (alignment: Alignment) => void;
  onDistribute: (axis: DistributeAxis) => void;
  /** 「⋯」：在按钮下面打开完整的菜单。 */
  onMore: (at: { x: number; y: number }) => void;
}

/**
 * 跟着选中走的浮动工具条（参考平板上的排版软件）：选框上方（放不下在下方）一条圆角小工具条，放这一类最常用的操作。
 * 文字：字号 −/+、加粗、对齐、改字；条码 / 二维码：绑定字段、需要时「放大到能印」；任何元素：复制一份、删除、锁定、
 * 置顶置底，「⋯」打开完整菜单；多选：对齐、等距。拖动时由调用方藏起来，松手再出现。
 * 它在画布覆盖层后面的 DOM 里：画布有焦点时按 Tab 就走到这里。
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
    // 画布区比工具条窄（1024 宽、条码多了「放大到能印」）时折成两行，不伸出画布区、不撑出横向滚动条。
    // 宽度上限要在量尺寸之前就定好，量出来的才是折行后的大小。
    toolbar.style.maxWidth = `${Math.max(0, bounds.right - bounds.left)}px`;
    // 画布区角上的撤销重做、缩放胶囊（和滚动区同在 .designer-stage-area 里）：工具条不盖住它们。
    const avoid = [...(stage.parentElement?.querySelectorAll<HTMLElement>('.designer-float') ?? [])].map((control) => {
      const rect = control.getBoundingClientRect();
      return { x: rect.left - overlayRect.left, y: rect.top - overlayRect.top, width: rect.width, height: rect.height };
    });
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
      {elements.length === 1 && elements[0] !== undefined ? (
        <SingleTools {...props} element={elements[0]} />
      ) : (
        <>
          <AlignButtons isSingle={false} onAlign={props.onAlign} />
          <span className="floating-toolbar__divider" aria-hidden="true" />
          <DistributeButtons disabled={!props.canDistribute} onDistribute={props.onDistribute} />
        </>
      )}
      <span className="floating-toolbar__divider" aria-hidden="true" />
      <CommonTools {...props} />
    </div>
  );
}

function SingleTools(props: FloatingToolbarProps & { element: CanvasElement }) {
  const { element, onChange, warnings, onGrowToPrint } = props;
  switch (element.kind) {
    case 'text': {
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
          <span className="floating-toolbar__value" title="字号（mm）">{`${element.fontSizeMm}`}</span>
          <IconButton
            icon="plus"
            name="字号增大"
            disabled={element.fontSizeMm >= max}
            onClick={() => setSize(element.fontSizeMm + FONT_STEP_MM)}
          />
          <IconButton
            icon="bold"
            name="加粗"
            pressed={element.bold}
            onClick={() => onChange({ ...element, bold: !element.bold })}
          />
          <IconButton
            icon="textLeft"
            name="文字靠左"
            pressed={element.align === 'left'}
            onClick={() => onChange({ ...element, align: 'left' })}
          />
          <IconButton
            icon="textCenter"
            name="文字居中"
            pressed={element.align === 'center'}
            onClick={() => onChange({ ...element, align: 'center' })}
          />
          <IconButton
            icon="textRight"
            name="文字靠右"
            pressed={element.align === 'right'}
            onClick={() => onChange({ ...element, align: 'right' })}
          />
          <IconButton icon="edit" name="改文字" tooltip="改文字（也可以双击）" onClick={props.onEditText} />
        </>
      );
    }
    case 'barcode':
    case 'qr': {
      const growable = warnings.find(
        (warning) => warning.level === 'omitted' && (warning.minWidthMm !== null || warning.minHeightMm !== null),
      );
      return (
        <>
          <FieldSelect element={element} options={props.fieldOptions} onChange={onChange} />
          {growable !== undefined && (
            <IconButton
              icon="grow"
              name="放大到能印"
              text="放大到能印"
              className="floating-toolbar__fix"
              onClick={() => onGrowToPrint(growable)}
            />
          )}
        </>
      );
    }
    default:
      return null;
  }
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

function CommonTools({
  elements,
  platform,
  onDuplicate,
  onDelete,
  onSetLocked,
  onLayer,
  onMore,
}: FloatingToolbarProps) {
  const allLocked = elements.every((element) => element.locked);
  return (
    <>
      <IconButton
        icon="duplicate"
        name="复制一份"
        tooltip={withShortcut('复制一份', 'duplicate', platform)}
        onClick={onDuplicate}
      />
      <IconButton
        icon="trash"
        name="删除"
        tooltip={withShortcut('删除', 'delete', platform)}
        disabled={allLocked}
        onClick={onDelete}
      />
      <IconButton
        icon={allLocked ? 'lock' : 'unlock'}
        name={allLocked ? '解锁' : '锁定'}
        tooltip={allLocked ? '解锁' : '锁定：画布上点不中、拖不动、删不掉'}
        pressed={allLocked}
        onClick={() => onSetLocked(!allLocked)}
      />
      <IconButton
        icon="bringToFront"
        name="置顶"
        tooltip={withShortcut('置顶', 'front', platform)}
        onClick={() => onLayer('front')}
      />
      <IconButton
        icon="sendToBack"
        name="置底"
        tooltip={withShortcut('置底', 'back', platform)}
        onClick={() => onLayer('back')}
      />
      <MoreButton onMore={onMore} />
    </>
  );
}

function MoreButton({ onMore }: { onMore: (at: { x: number; y: number }) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} className="floating-toolbar__more">
      <IconButton
        icon="more"
        name="更多"
        tooltip="更多（也可以在画布上点右键）"
        onClick={() => {
          const rect = ref.current?.getBoundingClientRect();
          onMore({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
        }}
      />
    </span>
  );
}
