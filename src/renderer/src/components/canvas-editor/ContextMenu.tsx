import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { type MenuAction, type MenuItem, nextEnabledIndex } from '../../lib/canvas-menu';
import { ICONS } from './icons';

/** 菜单离窗口边至少留这么多（px）：贴着边不好点，也看不出是浮在上面的。 */
const VIEWPORT_MARGIN_PX = 8;

interface ContextMenuProps {
  items: readonly MenuItem[];
  /** 打开的位置（窗口坐标，右键的指针位置或「⋯」按钮的左下角）。 */
  at: { x: number; y: number };
  onAction: (action: MenuAction) => void;
  /** 收起菜单（选了一项、Esc、点外面、Tab 走开）：调用方把焦点还给画布。 */
  onClose: () => void;
}

/**
 * 页面内的右键菜单（不用系统菜单：系统菜单的项由主进程按「能不能编辑」决定，画布上本来就不该弹）。
 * 打开时焦点在第一项；上下键移动（跳过不能用的），Enter / 空格执行，→ 打开子菜单、← 收起子菜单，Esc 收起。
 * 挂在 body 上（portal）：配置中心进出时有 transform，fixed 定位在它里面会跑偏。
 */
export function ContextMenu({ items, at, onAction, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && rootRef.current?.contains(event.target))) {
        onClose();
      }
    };
    // 窗口失去焦点（Alt+Tab）、滚动画布：菜单的位置已经对不上了，收起。
    // scroll 不冒泡：在捕获阶段听，画布滚动区、检查器这些元素自己的滚动也收得到；菜单自己里面的滚动不算。
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && rootRef.current?.contains(event.target))) {
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={rootRef} className="context-menu-root">
      <MenuList
        items={items}
        at={at}
        label="元素菜单"
        onAction={(action) => {
          onClose();
          onAction(action);
        }}
        onClose={onClose}
        onBack={onClose}
      />
    </div>,
    document.body,
  );
}

interface MenuListProps {
  items: readonly MenuItem[];
  at: { x: number; y: number };
  label: string;
  onAction: (action: MenuAction) => void;
  /** 收起整个菜单。 */
  onClose: () => void;
  /** ← 或 Esc：子菜单收起回到上一级；第一级就是收起整个菜单。 */
  onBack: () => void;
}

function MenuList({ items, at, label, onAction, onClose, onBack }: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);
  const [focused, setFocused] = useState(() => nextEnabledIndex(items, -1, 1));
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  // 打开后量一下菜单的大小，超出窗口时往回挪（靠右下角右键时往左上开）。
  useLayoutEffect(() => {
    const menu = listRef.current;
    if (menu === null) {
      return;
    }
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(VIEWPORT_MARGIN_PX, Math.min(at.x, window.innerWidth - width - VIEWPORT_MARGIN_PX)),
      y: Math.max(VIEWPORT_MARGIN_PX, Math.min(at.y, window.innerHeight - height - VIEWPORT_MARGIN_PX)),
    });
  }, [at.x, at.y]);

  useEffect(() => {
    if (openSubmenu === null && focused >= 0) {
      listRef.current?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]')[focused]?.focus();
    }
  }, [focused, openSubmenu]);

  const activate = (index: number) => {
    const item = items[index];
    if (item === undefined || item.disabled) {
      return;
    }
    if (item.submenu !== null) {
      setFocused(index);
      setOpenSubmenu(index);
    } else if (item.action !== null) {
      onAction(item.action);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 菜单里的按键都由菜单自己处理，不让它冒泡到画布（方向键会挪动元素、Esc 会取消选中）。
    event.stopPropagation();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setFocused(nextEnabledIndex(items, focused, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setFocused(nextEnabledIndex(items, focused, -1));
        return;
      case 'Home':
        event.preventDefault();
        setFocused(nextEnabledIndex(items, -1, 1));
        return;
      case 'End':
        event.preventDefault();
        setFocused(nextEnabledIndex(items, -1, -1));
        return;
      case 'ArrowRight':
        if (items[focused]?.submenu) {
          event.preventDefault();
          activate(focused);
        }
        return;
      case 'ArrowLeft':
      case 'Escape':
        event.preventDefault();
        onBack();
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate(focused);
        return;
      case 'Tab':
        event.preventDefault();
        onClose();
        return;
    }
  };

  return (
    <div
      ref={listRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: position.x, top: position.y }}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => (
        <MenuEntry
          key={item.id}
          item={item}
          isOpen={openSubmenu === index}
          onActivate={() => activate(index)}
          onHover={() => {
            if (!item.disabled) {
              setFocused(index);
              setOpenSubmenu(item.submenu === null ? null : index);
            }
          }}
          submenu={
            openSubmenu === index && item.submenu !== null ? (
              <SubMenu
                items={item.submenu}
                parent={listRef}
                index={index}
                label={item.label}
                onAction={onAction}
                onClose={onClose}
                onBack={() => setOpenSubmenu(null)}
              />
            ) : null
          }
        />
      ))}
    </div>
  );
}

function MenuEntry({
  item,
  isOpen,
  onActivate,
  onHover,
  submenu,
}: {
  item: MenuItem;
  isOpen: boolean;
  onActivate: () => void;
  onHover: () => void;
  submenu: ReactNode;
}) {
  return (
    <>
      {item.separatorBefore && <hr className="context-menu__separator" />}
      <button
        type="button"
        role="menuitem"
        className="context-menu__item"
        aria-disabled={item.disabled}
        aria-haspopup={item.submenu === null ? undefined : 'menu'}
        aria-expanded={item.submenu === null ? undefined : isOpen}
        tabIndex={-1}
        onClick={onActivate}
        onPointerEnter={onHover}
      >
        <span className="context-menu__label">{item.label}</span>
        {item.shortcut !== '' && <span className="context-menu__shortcut">{item.shortcut}</span>}
        {item.submenu !== null && <span className="context-menu__chevron">{ICONS.chevronDown}</span>}
      </button>
      {submenu}
    </>
  );
}

/** 子菜单（「对齐」）：开在这一项的右边，放不下时 MenuList 自己往回挪。 */
function SubMenu({
  items,
  parent,
  index,
  label,
  onAction,
  onClose,
  onBack,
}: {
  items: readonly MenuItem[];
  parent: RefObject<HTMLDivElement | null>;
  index: number;
  label: string;
  onAction: (action: MenuAction) => void;
  onClose: () => void;
  onBack: () => void;
}) {
  const row = parent.current?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]')[index];
  const rect = row?.getBoundingClientRect();
  const at = rect === undefined ? { x: 0, y: 0 } : { x: rect.right + 2, y: rect.top - 4 };
  return (
    <MenuList
      items={items}
      at={at}
      label={label}
      onAction={onAction}
      onClose={onClose}
      onBack={() => {
        onBack();
        row?.focus();
      }}
    />
  );
}
