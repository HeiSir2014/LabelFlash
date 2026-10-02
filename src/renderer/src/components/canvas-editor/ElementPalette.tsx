import {
  CANVAS_ELEMENT_KINDS,
  CANVAS_ELEMENT_LABELS,
  type CanvasElementKind,
} from '../../../../core/templates/canvas-model';
import { ELEMENT_DRAG_TYPE } from '../../lib/canvas-view';

interface ElementPaletteProps {
  onAdd: (kind: CanvasElementKind) => void;
}

/** 左边的元素栏：点一下加到画布中间，或拖到画布上松手的位置。 */
export function ElementPalette({ onAdd }: ElementPaletteProps) {
  return (
    <section className="element-palette" aria-label="元素">
      {CANVAS_ELEMENT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="element-palette__item"
          draggable
          aria-label={`添加${CANVAS_ELEMENT_LABELS[kind]}`}
          onClick={() => onAdd(kind)}
          onDragStart={(event) => {
            event.dataTransfer.setData(ELEMENT_DRAG_TYPE, kind);
            event.dataTransfer.effectAllowed = 'copy';
          }}
        >
          {CANVAS_ELEMENT_LABELS[kind]}
        </button>
      ))}
      <p className="element-palette__hint">点一下放到中间，或拖到画布上</p>
    </section>
  );
}
