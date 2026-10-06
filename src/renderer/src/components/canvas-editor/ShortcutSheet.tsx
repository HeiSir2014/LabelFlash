import { useEffect, useRef } from 'react';
import type { Platform } from '../../lib/app-view';
import { DESIGNER_SHORTCUTS, type DesignerShortcut, shortcutLabel } from '../../lib/designer-shortcuts';
import { IconButton } from './IconButton';

const GROUPS: readonly DesignerShortcut['group'][] = ['编辑', '选择', '移动和叠放', '视图'];

interface ShortcutSheetProps {
  platform: Platform;
  onClose: () => void;
}

/**
 * 快捷键表（F1 或「?」打开）：按分组列出设计器的全部快捷键，按平台写 Ctrl 或 ⌘。浮在画布区上面，不挡扫码：
 * 不是模态框，Esc 或「关闭」收起，焦点回到画布。
 */
export function ShortcutSheet({ platform, onClose }: ShortcutSheetProps) {
  const closeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeRef.current?.querySelector('button')?.focus();
  }, []);
  return (
    <div
      className="shortcut-sheet"
      role="dialog"
      aria-label="快捷键"
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'F1') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="shortcut-sheet__header">
        <h2 className="shortcut-sheet__title">快捷键</h2>
        <div ref={closeRef}>
          <IconButton icon="close" name="关闭快捷键表" tooltip="关闭（Esc）" onClick={onClose} />
        </div>
      </div>
      <div className="shortcut-sheet__groups">
        {GROUPS.map((group) => (
          <section key={group} className="shortcut-sheet__group" aria-label={group}>
            <h3 className="inspector-heading">{group}</h3>
            <dl className="shortcut-sheet__list">
              {DESIGNER_SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.id} className="shortcut-sheet__row">
                  <dt>{shortcut.label}</dt>
                  <dd>
                    <kbd>{shortcutLabel(shortcut.id, platform)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="form-hint">画布上不用字母、数字做快捷键：扫码枪打的字照常填进「预览内容」。</p>
    </div>
  );
}
