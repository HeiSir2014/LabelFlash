import {
  CANVAS_ELEMENT_KINDS,
  CANVAS_ELEMENT_LABELS,
  type CanvasElementKind,
} from '../../../../core/templates/canvas-model';
import { ELEMENT_DRAG_TYPE } from '../../lib/canvas-view';
import { ICONS } from './icons';

interface ElementPaletteProps {
  onAdd: (kind: CanvasElementKind) => void;
}

/** 左边竖排的元素栏：图标加两三个字，点一下加到画布中间，或拖到画布上松手的位置。 */
export function ElementPalette({ onAdd }: ElementPaletteProps) {
  return (
    <nav className="element-rail" aria-label="元素">
      {CANVAS_ELEMENT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="element-rail__item"
          draggable
          aria-label={`添加${CANVAS_ELEMENT_LABELS[kind]}`}
          title={`${CANVAS_ELEMENT_LABELS[kind]}：点一下放到中间，或拖到画布上`}
          onClick={() => onAdd(kind)}
          onDragStart={(event) => {
            event.dataTransfer.setData(ELEMENT_DRAG_TYPE, kind);
            event.dataTransfer.effectAllowed = 'copy';
          }}
        >
          {ICONS[kind]}
          <span className="element-rail__label">{CANVAS_ELEMENT_LABELS[kind]}</span>
        </button>
      ))}
    </nav>
  );
}
