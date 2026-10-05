import { type CSSProperties, type PointerEvent, useState } from 'react';
import { type NormalizedBox, PDF_LIMITS } from '../../../../core/pdf/pdf-model';
import type { BitmapView } from '../../../../shared/pdf';
import { boxFromDrag, canAddBox, type Point } from '../../lib/pdf-view';

interface PdfBoxEditorProps {
  firstPage: BitmapView;
  boxes: readonly NormalizedBox[];
  onAdd: (box: NormalizedBox) => void;
  onRemove: (index: number) => void;
}

function boxStyle(box: NormalizedBox): CSSProperties {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
}

function pointOf(event: PointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}

/** 在第一页上拖出要打印的区域（按页面比例记），每一页按同样的位置裁。底图是程序认为「有内容」的地方。 */
export function PdfBoxEditor({ firstPage, boxes, onAdd, onRemove }: PdfBoxEditorProps) {
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const canAdd = canAddBox(boxes);
  const draft = drag === null ? null : boxFromDrag(drag.start, drag.end);
  return (
    <div className="pdf-box-editor">
      <div
        className="pdf-box-editor__stage"
        role="application"
        aria-label="在第一页上画框"
        style={{ aspectRatio: `${firstPage.width} / ${firstPage.height}` }}
        onPointerDown={(event) => {
          if (!canAdd || event.button !== 0) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointOf(event);
          setDrag({ start: point, end: point });
        }}
        onPointerMove={(event) => {
          if (drag !== null) {
            setDrag({ start: drag.start, end: pointOf(event) });
          }
        }}
        onPointerUp={(event) => {
          if (drag === null) {
            return;
          }
          const box = boxFromDrag(drag.start, pointOf(event));
          setDrag(null);
          if (box !== null) {
            onAdd(box);
          }
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <img
          className="pdf-box-editor__page"
          alt="第一页"
          src={`data:image/bmp;base64,${firstPage.bmp}`}
          draggable={false}
        />
        {boxes.map((box, index) => (
          <div key={`${box.x}-${box.y}-${box.width}-${box.height}`} className="pdf-box" style={boxStyle(box)}>
            <span className="pdf-box__number">{index + 1}</span>
          </div>
        ))}
        {draft !== null && <div className="pdf-box pdf-box--draft" style={boxStyle(draft)} />}
      </div>
      <div className="pdf-box-editor__side">
        <p className="config-card__text">
          {canAdd
            ? '在第一页上按住鼠标拖出要打印的区域，可以画几个；每一页按同样的位置裁，空白的不打。'
            : `最多 ${PDF_LIMITS.manualBoxes} 个框。`}
        </p>
        {boxes.length > 0 && (
          <ol className="pdf-box-list">
            {boxes.map((box, index) => (
              <li key={`${box.x}-${box.y}-${box.width}-${box.height}`}>
                框 {index + 1}
                <button
                  type="button"
                  className="button button--small button--quiet"
                  aria-label={`删掉框 ${index + 1}`}
                  onClick={() => onRemove(index)}
                >
                  删除
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
