import type { CSSProperties, DragEvent, KeyboardEvent, RefObject } from 'react';
import {
  CANVAS_ELEMENT_KINDS,
  CANVAS_LIMITS,
  type CanvasElementKind,
  type CanvasTemplate,
} from '../../../../core/templates/canvas-model';
import { type Box, RESIZE_HANDLES } from '../../lib/canvas-edit';
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
  selection: readonly string[];
  gesture: GestureView;
  handlers: GestureHandlers;
  /** 外层滚动区：量「适合窗口」的大小、挂 Ctrl+滚轮。 */
  stageRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onDropElement: (kind: CanvasElementKind, center: { x: number; y: number }) => void;
  onEditText: (id: string) => void;
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

function isElementKind(value: string): value is CanvasElementKind {
  return (CANVAS_ELEMENT_KINDS as readonly string[]).includes(value);
}

/**
 * 画布：软尺、标签（和打印同一份 HTML，放在 sandbox 的 iframe 里）、上面一层透明的覆盖层。
 * 覆盖层画网格、安全区、选框、控制点、吸附参考线和框选；鼠标和键盘都在它上面操作，元素框本身不挂事件
 * （覆盖层按 data-element-id、data-handle 认出按在哪里）。
 */
export function CanvasStage({
  template,
  html,
  placeholder,
  zoom,
  showGrid,
  selection,
  gesture,
  handlers,
  stageRef,
  overlayRef,
  onKeyDown,
  onDropElement,
  onEditText,
}: CanvasStageProps) {
  const { paper } = template;
  const single =
    selection.length === 1 ? (template.elements.find((element) => element.id === selection[0]) ?? null) : null;

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
          <div className="label-slot">
            {html ? (
              <iframe className="label-frame" title="标签预览" sandbox="" srcDoc={html} tabIndex={-1} />
            ) : (
              <p className="label-placeholder">{placeholder}</p>
            )}
          </div>
          <div
            ref={overlayRef}
            className={showGrid ? 'canvas-overlay canvas-overlay--grid' : 'canvas-overlay'}
            role="application"
            aria-label="画布：方向键移动选中的元素（Shift 加方向键一次 1 毫米），Delete 删除，Ctrl+Z 撤销"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: 画布是自定义的鼠标和键盘控件（role=application），键盘操作写在 aria-label 里
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerCancel}
            onLostPointerCapture={handlers.onLostPointerCapture}
            onDoubleClick={() => {
              // 指针被覆盖层捕获，双击事件落在覆盖层上：按刚才点选的元素判断是不是文字。
              if (single?.kind === 'text') {
                onEditText(single.id);
              }
            }}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <div
              className="canvas-overlay__safe"
              aria-hidden="true"
              style={{ inset: `calc(${CANVAS_LIMITS.safeMarginMm} * var(--mm))` }}
            />
            {template.elements.map((element) => {
              const classes = [
                'canvas-overlay__box',
                selection.includes(element.id) ? 'canvas-overlay__box--selected' : null,
                element.locked ? 'canvas-overlay__box--locked' : null,
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
                  {single?.id === element.id &&
                    !element.locked &&
                    RESIZE_HANDLES.map((handle) => (
                      <div key={handle} className="canvas-overlay__handle" data-handle={handle} />
                    ))}
                </div>
              );
            })}
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
            {gesture.marquee && (
              <div className="canvas-overlay__marquee" aria-hidden="true" style={boxStyle(gesture.marquee)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
