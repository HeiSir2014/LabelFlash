import { useId, useState } from 'react';
import { ICONS } from './icons';

export interface CheckItem {
  text: string;
  /** omitted：这一张不印这个元素（红）；warning：照常印，但要留意（黄）。 */
  level: 'omitted' | 'warning';
  /** 问题出在哪个元素：点这一项选中它。不对应某个元素时为 null。 */
  elementId: string | null;
}

interface DesignerChecksProps {
  /** 预览还没排出来：先说「正在检查…」。 */
  isPending: boolean;
  items: readonly CheckItem[];
  onSelectElement: (id: string) => void;
}

/**
 * 打印前检查，收成画布下面的一条：没有问题时一句话；有问题时「⚠ N 项」加第一条，点开展开整张清单，
 * 点某一项选中出问题的元素（画布上它也标着浅红或黄框）。不挡保存。
 */
export function DesignerChecks({ isPending, items, onSelectElement }: DesignerChecksProps) {
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();
  const first = items[0];
  return (
    <section className="designer-checks" aria-label="打印前检查">
      {isPending ? (
        <p className="designer-checks__summary designer-checks__summary--quiet">打印前检查：正在检查…</p>
      ) : first === undefined ? (
        <p className="designer-checks__summary designer-checks__summary--ok">
          {ICONS.check}
          按这段预览内容没有发现问题
        </p>
      ) : (
        <>
          <button
            type="button"
            className="designer-checks__summary designer-checks__toggle"
            aria-expanded={isOpen}
            aria-controls={listId}
            onClick={() => setIsOpen(!isOpen)}
          >
            <span className={`designer-checks__count designer-checks__count--${worstLevel(items)}`}>
              {ICONS.warning}
              {`${items.length} 项`}
            </span>
            {!isOpen && <span className="designer-checks__first">{first.text}</span>}
            {isOpen && <span className="designer-checks__first">打印前检查（点一项选中那个元素）</span>}
            {isOpen ? ICONS.chevronDown : ICONS.chevronUp}
          </button>
          <ul id={listId} className="designer-checks__list" hidden={!isOpen}>
            {items.map((item) => (
              <li key={`${item.elementId ?? ''}${item.text}`}>
                {item.elementId === null ? (
                  <span className={`designer-checks__item designer-checks__item--${item.level}`}>{item.text}</span>
                ) : (
                  <button
                    type="button"
                    className={`designer-checks__item designer-checks__item--${item.level}`}
                    onClick={() => item.elementId !== null && onSelectElement(item.elementId)}
                  >
                    {item.text}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function worstLevel(items: readonly CheckItem[]): CheckItem['level'] {
  return items.some((item) => item.level === 'omitted') ? 'omitted' : 'warning';
}
