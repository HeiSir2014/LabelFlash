import { useId } from 'react';
import { CANVAS_ELEMENT_LABELS, type CanvasElement } from '../../../../core/templates/canvas-model';
import { toggleId } from '../../lib/canvas-edit';

interface LayerListProps {
  elements: readonly CanvasElement[];
  selection: readonly string[];
  onSelect: (ids: readonly string[]) => void;
}

/** 图层：上层在前，只用来点选（叠在一起、很小的元素在画布上不好点），Shift 加选。 */
export function LayerList({ elements, selection, onSelect }: LayerListProps) {
  const headingId = useId();
  return (
    <section className="layer-list" aria-labelledby={headingId}>
      <h2 id={headingId} className="form-section__title">
        图层
      </h2>
      {elements.length === 0 ? (
        <p className="form-hint">还没有元素：点左边的元素加到画布中间，或拖到画布上。</p>
      ) : (
        <ul className="layer-list__items" aria-label="图层">
          {[...elements].reverse().map((element) => (
            <li key={element.id}>
              <button
                type="button"
                className="layer-list__item"
                aria-pressed={selection.includes(element.id)}
                aria-label={
                  element.locked
                    ? `${element.name}（${CANVAS_ELEMENT_LABELS[element.kind]} · 锁定）`
                    : `${element.name}（${CANVAS_ELEMENT_LABELS[element.kind]}）`
                }
                onClick={(event) => onSelect(event.shiftKey ? toggleId(selection, element.id) : [element.id])}
              >
                <span className="layer-list__name">{element.name}</span>
                <span className="layer-list__kind">
                  {element.locked
                    ? `${CANVAS_ELEMENT_LABELS[element.kind]} · 锁定`
                    : CANVAS_ELEMENT_LABELS[element.kind]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
