import { type DragEvent, useRef, useState } from 'react';
import { CANVAS_ELEMENT_LABELS, CANVAS_LIMITS, type CanvasElement } from '../../../../core/templates/canvas-model';
import type { Platform } from '../../lib/app-view';
import { layerIndexForDrop, toggleId } from '../../lib/canvas-edit';
import { displayName, renameKeyAction } from '../../lib/canvas-names';
import { shortcutLabel } from '../../lib/designer-shortcuts';
import { IconButton } from './IconButton';
import { ICONS } from './icons';

/** 图层列表拖动排序时，拖动数据里放元素 id 用的格式名（只在这个页面内部用，和元素栏拖到画布的分开）。 */
const LAYER_DRAG_TYPE = 'application/x-labelflash-layer';

interface LayerListProps {
  elements: readonly CanvasElement[];
  selection: readonly string[];
  /** 只在设计器里隐藏的元素。 */
  hidden: ReadonlySet<string>;
  platform: Platform;
  onSelect: (ids: readonly string[]) => void;
  onToggleLock: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** 拖动排序：把 id 挪到数组的 index（0 是最下层）。 */
  onReorder: (id: string, index: number) => void;
}

interface DropTarget {
  id: string;
  position: 'above' | 'below';
}

/**
 * 图层：上层在前。点选（Shift 加选），双击名字就地改名，每行有隐藏（只在设计器里隐藏，照常打印）和锁定，
 * 拖动整行排序（键盘用 Ctrl+] / Ctrl+[ 等，见悬停提示）。叠在一起、很小、锁定的元素在这里最好选。
 */
export function LayerList({
  elements,
  selection,
  hidden,
  platform,
  onSelect,
  onToggleLock,
  onToggleHidden,
  onRename,
  onReorder,
}: LayerListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const reorderHint = `拖动排序，或用 ${shortcutLabel('forward', platform)} / ${shortcutLabel('backward', platform)} 上下移一层`;

  if (elements.length === 0) {
    return <p className="form-hint">还没有元素：点左边的元素加到画布中间，或拖到画布上。</p>;
  }

  const onDragOver = (event: DragEvent<HTMLLIElement>, id: string) => {
    if (!event.dataTransfer.types.includes(LAYER_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
    if (dropTarget?.id !== id || dropTarget.position !== position) {
      setDropTarget({ id, position });
    }
  };
  const onDrop = (event: DragEvent<HTMLLIElement>) => {
    const draggedId = event.dataTransfer.getData(LAYER_DRAG_TYPE);
    if (dropTarget !== null && elements.some((element) => element.id === draggedId)) {
      event.preventDefault();
      onReorder(draggedId, layerIndexForDrop(elements, draggedId, dropTarget.id, dropTarget.position));
    }
    setDropTarget(null);
  };

  return (
    <ul className="layer-list" aria-label="图层" title={reorderHint}>
      {[...elements].reverse().map((element) => {
        const name = displayName(element);
        const kind = CANVAS_ELEMENT_LABELS[element.kind];
        const isHidden = hidden.has(element.id);
        const isSelected = selection.includes(element.id);
        const classes = [
          'layer-row',
          isSelected ? 'layer-row--selected' : null,
          isHidden ? 'layer-row--hidden' : null,
          dropTarget?.id === element.id ? `layer-row--drop-${dropTarget.position}` : null,
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li
            key={element.id}
            className={classes}
            draggable={renamingId !== element.id}
            onDragStart={(event) => {
              event.dataTransfer.setData(LAYER_DRAG_TYPE, element.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => onDragOver(event, element.id)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={onDrop}
            onDragEnd={() => setDropTarget(null)}
          >
            <span className="layer-row__kind" aria-hidden="true">
              {ICONS[element.kind]}
            </span>
            {renamingId === element.id ? (
              <RenameField
                name={element.name}
                onDone={(next) => {
                  setRenamingId(null);
                  if (next !== null) {
                    onRename(element.id, next);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="layer-row__select"
                aria-pressed={isSelected}
                aria-label={`${name}（${element.locked ? `${kind} · 锁定` : kind}）`}
                title="双击改名"
                onClick={(event) => onSelect(event.shiftKey ? toggleId(selection, element.id) : [element.id])}
                onDoubleClick={() => setRenamingId(element.id)}
              >
                <span className="layer-row__name">{name}</span>
              </button>
            )}
            <IconButton
              icon={isHidden ? 'eyeOff' : 'eye'}
              name={isHidden ? `显示「${name}」` : `隐藏「${name}」`}
              tooltip={isHidden ? '显示' : '隐藏（只在设计器里隐藏，照常打印）'}
              pressed={isHidden}
              className="layer-row__toggle"
              onClick={() => onToggleHidden(element.id)}
            />
            <IconButton
              icon={element.locked ? 'lock' : 'unlock'}
              name={element.locked ? `解锁「${name}」` : `锁定「${name}」`}
              tooltip={element.locked ? '解锁' : '锁定：画布上点不中、拖不动、删不掉'}
              pressed={element.locked}
              className="layer-row__toggle"
              onClick={() => onToggleLock(element.id)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** 就地改名：回车或点别处保存，Esc 不改；改成空的不算数。 */
function RenameField({ name, onDone }: { name: string; onDone: (next: string | null) => void }) {
  const [value, setValue] = useState(name);
  // 回车、Esc 之后输入框被拿掉时浏览器可能还会补一个 blur：只认第一次结束，不重复提交。
  const isDoneRef = useRef(false);
  const end = (next: string | null) => {
    if (!isDoneRef.current) {
      isDoneRef.current = true;
      onDone(next);
    }
  };
  const finish = () => {
    const trimmed = value.trim();
    end(trimmed === '' || trimmed === name ? null : trimmed);
  };
  return (
    <input
      className="text-field layer-row__rename"
      aria-label="图层名称"
      value={value}
      maxLength={CANVAS_LIMITS.nameLength}
      // biome-ignore lint/a11y/noAutofocus: 双击名字就是要改它，焦点直接放进来
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        const action = renameKeyAction(event.key, event.nativeEvent.isComposing);
        if (action === 'save') {
          event.preventDefault();
          finish();
        } else if (action === 'cancel') {
          // 只取消改名，不让 Esc 冒泡到配置中心（那会返回模板列表）。
          event.preventDefault();
          event.stopPropagation();
          end(null);
        }
      }}
    />
  );
}
