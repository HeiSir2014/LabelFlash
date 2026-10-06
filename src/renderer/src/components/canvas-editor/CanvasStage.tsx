import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useState,
} from 'react';
import {
  CANVAS_ELEMENT_KINDS,
  CANVAS_LIMITS,
  type CanvasElementKind,
  type CanvasTemplate,
} from '../../../../core/templates/canvas-model';
import type { ElementWarning } from '../../../../shared/render-warnings';
import { type Box, boundsOf, RESIZE_HANDLES } from '../../lib/canvas-edit';
import { ROTATE_HANDLE } from '../../lib/canvas-gesture';
import type { Gap } from '../../lib/canvas-snap';
import { ELEMENT_DRAG_TYPE, pxToMm } from '../../lib/canvas-view';
import type { GestureHandlers, GestureView } from '../../view-models/use-canvas-gesture';
import { Ruler } from '../Ruler';

interface CanvasStageProps {
  template: CanvasTemplate;
  /** 和打印相同的 HTML（预览经主进程排版）；还没有、或预览内容识别不了时为 null。 */
  html: string | null;
  placeholder: string;
  zoom: number;
  showGrid: boolean;
  /** 覆盖层 aria-label 里撤销快捷键的文字（Windows「Ctrl+Z」，macOS「⌘Z」），由调用方按平台算好传入。 */
  undoShortcut: string;
  selection: readonly string[];
  /** 指针下面的元素（点中测试的结果）：画浅色框，指针变成「移动」。 */
  hoverId: string | null;
  /** 这次排版每个元素的问题：不印的浅红底、框里写短原因；条码宽度快不够的黄框。 */
  warnings: readonly ElementWarning[];
  /** 只在设计器里隐藏的元素：不画框（标签上的内容由调用方从 HTML 里藏起来）。 */
  hidden: ReadonlySet<string>;
  gesture: GestureView;
  handlers: GestureHandlers;
  /** 外层滚动区：量「适合窗口」的大小、挂 Ctrl+滚轮。 */
  stageRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (event: KeyboardEvent<HTMLDivElement>) => void;
  onBlur: () => void;
  /** 平移画布：按住空格时是「抓手」，拖动中是「抓着」；平常为 null。 */
  panMode: 'grab' | 'grabbing' | null;
  onDropElement: (kind: CanvasElementKind, center: { x: number; y: number }) => void;
  /** 双击：纸上的位置（mm）。调用方按选中的元素决定就地改哪段字。 */
  onEditText: (point: { x: number; y: number }) => void;
  /** 右键（数位板笔杆上的按键、长按也是 contextmenu）：point 是纸上的毫米，client 是窗口坐标。 */
  onContextMenu: (point: { x: number; y: number }, client: { x: number; y: number }) => void;
  /** 浮在标签上面、跟着画布一起滚动的东西（浮动工具条）：放在覆盖层后面，画布有焦点时 Tab 就到。 */
  floating?: ReactNode;
}

/** 框（毫米）→ 覆盖层上的位置：乘以 --mm（随缩放变化的每毫米像素数）。 */
function boxStyle(box: Box): CSSProperties {
  return {
    left: `calc(${box.x} * var(--mm))`,
    top: `calc(${box.y} * var(--mm))`,
    width: `calc(${box.width} * var(--mm))`,
    height: `calc(${box.height} * var(--mm))`,
  };
}

/** 间距的数字：一位小数，整数不带「.0」（「2.5」「3」）。 */
function gapLabel(gap: Gap): string {
  return String(Number((gap.end - gap.start).toFixed(1)));
}

/** 拖动时和邻居之间的一段间距：细线、两头短竖线，中间写毫米数；两边相等时数字前加「=」。 */
function GapMark({ gap }: { gap: Gap }) {
  const style: CSSProperties =
    gap.axis === 'x'
      ? {
          left: `calc(${gap.start} * var(--mm))`,
          top: `calc(${gap.cross} * var(--mm))`,
          width: `calc(${gap.end - gap.start} * var(--mm))`,
        }
      : {
          left: `calc(${gap.cross} * var(--mm))`,
          top: `calc(${gap.start} * var(--mm))`,
          height: `calc(${gap.end - gap.start} * var(--mm))`,
        };
  return (
    <span
      className={`canvas-overlay__gap canvas-overlay__gap--${gap.axis}${gap.isEqual ? ' canvas-overlay__gap--equal' : ''}`}
      aria-hidden="true"
      style={style}
    >
      <span className="canvas-overlay__gap-label">{gap.isEqual ? `= ${gapLabel(gap)}` : gapLabel(gap)}</span>
    </span>
  );
}

/**
 * 标尺上的标记：指针所在位置的一条细线，选中的东西占的范围（浅色一段）。放在软尺同一个格子里，盖在刻度上，不接指针。
 */
function RulerMarks({
  axis,
  pointer,
  extent,
}: {
  axis: 'x' | 'y';
  pointer: number | null;
  extent: { start: number; size: number } | null;
}) {
  const along = axis === 'x' ? 'left' : 'top';
  const size = axis === 'x' ? 'width' : 'height';
  return (
    <div className={`ruler-marks ruler-marks--${axis}`} aria-hidden="true">
      {extent !== null && (
        <span
          className="ruler-marks__extent"
          style={{ [along]: `calc(${extent.start} * var(--mm))`, [size]: `calc(${extent.size} * var(--mm))` }}
        />
      )}
      {pointer !== null && (
        <span className="ruler-marks__pointer" style={{ [along]: `calc(${pointer} * var(--mm))` }} />
      )}
    </div>
  );
}

function isElementKind(value: string): value is CanvasElementKind {
  return (CANVAS_ELEMENT_KINDS as readonly string[]).includes(value);
}

/**
 * 画布：软尺、标签（和打印同一份 HTML，放在 sandbox 的 iframe 里）、上面一层透明的覆盖层。
 * 覆盖层画网格、安全区、选框、控制点、吸附参考线和框选；鼠标和键盘都在它上面操作，元素框本身不接指针
 * （按在哪个元素上由 lib/canvas-hit 按位置算，只有控制点接指针，按 data-handle 认出）。
 */
export function CanvasStage({
  template,
  html,
  placeholder,
  zoom,
  showGrid,
  undoShortcut,
  selection,
  hoverId,
  warnings,
  hidden,
  gesture,
  handlers,
  stageRef,
  overlayRef,
  onKeyDown,
  onKeyUp,
  onBlur,
  panMode,
  onDropElement,
  onEditText,
  onContextMenu,
  floating,
}: CanvasStageProps) {
  const { paper } = template;
  const single =
    selection.length === 1 ? (template.elements.find((element) => element.id === selection[0]) ?? null) : null;
  // 选中的东西现在占的框（拖动中跟着临时框走）：标尺上标出范围；选中好几个时画一个合起来的外框，按在框里就能整组拖动。
  const extent = boundsOf(
    template.elements
      .filter((element) => selection.includes(element.id) && !hidden.has(element.id))
      .map((element) => gesture.boxes.get(element.id) ?? element),
  );
  const groupBox = selection.length > 1 ? extent : null;
  // 指针在纸上的位置（mm）：标尺上画一条细线。离开画布时为 null。
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const kind = event.dataTransfer.getData(ELEMENT_DRAG_TYPE);
    if (!isElementKind(kind)) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onDropElement(kind, { x: pxToMm(event.clientX - rect.left, zoom), y: pxToMm(event.clientY - rect.top, zoom) });
  };

  return (
    <div ref={stageRef} className="canvas-stage">
      <div
        className="canvas-stage__bench"
        style={{ '--preview-scale': zoom, '--paper-w': paper.widthMm, '--paper-h': paper.heightMm } as CSSProperties}
      >
        <div className="tape">
          <div className="tape__corner" aria-hidden="true">
            mm
          </div>
          <Ruler orientation="horizontal" lengthMm={paper.widthMm} />
          <Ruler orientation="vertical" lengthMm={paper.heightMm} />
          <RulerMarks
            axis="x"
            pointer={pointer?.x ?? null}
            extent={extent === null ? null : { start: extent.x, size: extent.width }}
          />
          <RulerMarks
            axis="y"
            pointer={pointer?.y ?? null}
            extent={extent === null ? null : { start: extent.y, size: extent.height }}
          />
          <div className="label-slot">
            {html ? (
              <iframe className="label-frame" title="标签预览" sandbox="" srcDoc={html} tabIndex={-1} />
            ) : (
              <p className="label-placeholder">{placeholder}</p>
            )}
          </div>
          <div
            ref={overlayRef}
            className={[
              'canvas-overlay',
              showGrid ? 'canvas-overlay--grid' : null,
              hoverId !== null ? 'canvas-overlay--over-element' : null,
              panMode === null ? null : `canvas-overlay--${panMode}`,
            ]
              .filter(Boolean)
              .join(' ')}
            role="application"
            aria-label={`画布：方向键移动选中的元素（Shift 加方向键一次 1 毫米），Delete 删除，${undoShortcut} 撤销`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: 画布是自定义的鼠标和键盘控件（role=application），键盘操作写在 aria-label 里
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onBlur={onBlur}
            onMouseDown={(event) => {
              // 中键按下：Windows 上浏览器会进「自动滚动」模式，和中键拖动平移抢，拦下。
              if (event.button === 1) {
                event.preventDefault();
              }
            }}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setPointer({
                x: pxToMm(event.clientX - rect.left, zoom),
                y: pxToMm(event.clientY - rect.top, zoom),
              });
              handlers.onPointerMove(event);
            }}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerCancel}
            onLostPointerCapture={handlers.onLostPointerCapture}
            onPointerLeave={() => {
              setPointer(null);
              handlers.onPointerLeave();
            }}
            onDoubleClick={(event) => {
              // 指针被覆盖层捕获，双击事件落在覆盖层上：调用方按刚才点选的元素和位置决定改哪段字（表格要知道哪一格）。
              const rect = event.currentTarget.getBoundingClientRect();
              onEditText({
                x: pxToMm(event.clientX - rect.left, zoom),
                y: pxToMm(event.clientY - rect.top, zoom),
              });
            }}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onContextMenu={(event) => {
              // 拦下浏览器的右键：主进程的系统菜单只对输入框、选中的文字弹，画布上一律用页面自己的菜单。
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              onContextMenu(
                { x: pxToMm(event.clientX - rect.left, zoom), y: pxToMm(event.clientY - rect.top, zoom) },
                { x: event.clientX, y: event.clientY },
              );
            }}
          >
            <div
              className="canvas-overlay__safe"
              aria-hidden="true"
              style={{ inset: `calc(${CANVAS_LIMITS.safeMarginMm} * var(--mm))` }}
            />
            {template.elements.map((element) => {
              if (hidden.has(element.id)) {
                return null;
              }
              const mine = warnings.filter((warning) => warning.elementId === element.id);
              const omitted = mine.find((warning) => warning.level === 'omitted') ?? null;
              // 宽度只比最小宽度多一点的条码（带着最小尺寸的提醒）：黄框提前提醒。
              const isTight = mine.some(
                (warning) =>
                  warning.level === 'warning' && (warning.minWidthMm !== null || warning.minHeightMm !== null),
              );
              const classes = [
                'canvas-overlay__box',
                selection.includes(element.id) ? 'canvas-overlay__box--selected' : null,
                hoverId === element.id ? 'canvas-overlay__box--hover' : null,
                element.locked ? 'canvas-overlay__box--locked' : null,
                omitted !== null ? 'canvas-overlay__box--omitted' : null,
                isTight ? 'canvas-overlay__box--tight' : null,
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={element.id}
                  className={classes}
                  data-element-id={element.id}
                  aria-hidden="true"
                  style={boxStyle(gesture.boxes.get(element.id) ?? element)}
                >
                  {omitted?.short && <span className="canvas-overlay__reason">{omitted.short}</span>}
                  {single?.id === element.id && !element.locked && (
                    <>
                      {RESIZE_HANDLES.map((handle) => (
                        <div
                          key={handle}
                          className={`canvas-overlay__handle canvas-overlay__handle--${handle.length === 2 ? 'corner' : 'edge'}`}
                          data-handle={handle}
                        />
                      ))}
                      <div
                        className="canvas-overlay__rotate"
                        data-handle={ROTATE_HANDLE}
                        title="拖动旋转（只转直角）"
                      />
                    </>
                  )}
                </div>
              );
            })}
            {groupBox !== null && (
              <div className="canvas-overlay__group" aria-hidden="true" style={boxStyle(groupBox)} />
            )}
            {gesture.guides.map((guide) => (
              <div
                key={`${guide.axis}${guide.at}`}
                className={`canvas-overlay__guide canvas-overlay__guide--${guide.axis}`}
                aria-hidden="true"
                style={
                  guide.axis === 'x'
                    ? { left: `calc(${guide.at} * var(--mm))` }
                    : { top: `calc(${guide.at} * var(--mm))` }
                }
              />
            ))}
            {gesture.gaps.map((gap) => (
              <GapMark key={`${gap.axis}${gap.start}`} gap={gap} />
            ))}
            {gesture.badge !== null && (
              <span
                // 指针在纸的右半边、下半边时标签放到指针的左边、上边：不伸出纸外撑出滚动条，也不被裁掉。
                className={[
                  'canvas-overlay__badge',
                  gesture.badge.at.x > paper.widthMm / 2 ? 'canvas-overlay__badge--left' : null,
                  gesture.badge.at.y > paper.heightMm / 2 ? 'canvas-overlay__badge--up' : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
                style={{
                  left: `calc(${gesture.badge.at.x} * var(--mm))`,
                  top: `calc(${gesture.badge.at.y} * var(--mm))`,
                }}
              >
                {gesture.badge.text}
              </span>
            )}
            {gesture.marquee && (
              <div className="canvas-overlay__marquee" aria-hidden="true" style={boxStyle(gesture.marquee)} />
            )}
          </div>
          {floating !== undefined && <div className="canvas-float-layer">{floating}</div>}
        </div>
      </div>
    </div>
  );
}
