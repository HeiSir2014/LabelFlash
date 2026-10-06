import { useEffect, useRef, useState } from 'react';
import type { Platform } from '../../lib/app-view';
import { zoomIn, zoomOut } from '../../lib/canvas-view';
import { withShortcut } from '../../lib/designer-shortcuts';
import type { CanvasDesignerViewModel } from '../../view-models/use-canvas-designer';
import { type SampleContent, SampleInput } from '../SampleInput';
import { IconButton } from './IconButton';

/** 缩放倍数显示成百分比：1 倍 = 100%（实物大小）。 */
const PERCENT = 100;
/** 缩放胶囊里「200%」一项的倍数：小标签放大两倍看清细节。 */
const DOUBLE_ZOOM = 2;

interface DesignerHeaderProps {
  designer: CanvasDesignerViewModel;
  sample: SampleContent;
  platform: Platform;
}

/**
 * 画布上方的一条窄栏：预览内容（画布按它排版，配置中心里扫码也填进来）、网格、吸附、快捷键表。
 * 编辑、对齐、叠放这些「对选中的东西做的事」不在这里：在浮动工具条、检查器和右键菜单里，靠近正在改的东西。
 */
export function DesignerHeader({ designer, sample, platform }: DesignerHeaderProps) {
  return (
    <div className="designer-header">
      <SampleInput sample={sample} isCompact />
      <div className="designer-header__tools">
        <IconButton
          icon="grid"
          name="网格"
          text="网格"
          pressed={designer.showGrid}
          onClick={() => designer.setShowGrid(!designer.showGrid)}
        />
        <IconButton
          icon="magnet"
          name="吸附"
          tooltip="吸附：拖动时靠近纸边、安全区、中线和别的元素的边就吸过去"
          text="吸附"
          pressed={designer.snap}
          onClick={() => designer.setSnap(!designer.snap)}
        />
        <IconButton
          icon="help"
          name="快捷键"
          tooltip={withShortcut('快捷键', 'help', platform)}
          onClick={() => designer.setIsShortcutSheetOpen(true)}
        />
      </div>
    </div>
  );
}

/** 撤销、重做：画布区左上角两个圆按钮，随时看得见（参考平板上的绘图软件）。 */
export function HistoryButtons({ designer, platform }: { designer: CanvasDesignerViewModel; platform: Platform }) {
  return (
    <fieldset className="designer-float designer-history" aria-label="撤销和重做">
      <IconButton
        icon="undo"
        name="撤销"
        tooltip={withShortcut('撤销', 'undo', platform)}
        disabled={!designer.canUndo}
        onClick={designer.undo}
      />
      <IconButton
        icon="redo"
        name="重做"
        tooltip={withShortcut('重做', 'redo', platform)}
        disabled={!designer.canRedo}
        onClick={designer.redo}
      />
    </fieldset>
  );
}

/**
 * 缩放：画布区右下角的小胶囊「− 250% +」，点百分比展开「适合窗口 / 100% / 200%」。
 * 展开的小面板点外面、按 Esc、选了一项都收起。
 */
export function ZoomPill({
  designer,
  zoom,
  platform,
}: {
  designer: CanvasDesignerViewModel;
  /** 现在的缩放倍数（「适合窗口」时是算出来的倍数）。 */
  zoom: number;
  platform: Platform;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLFieldSetElement>(null);
  // 到头了：zoomOut/zoomIn 在端点上原样返回当前值，用「算出来和现在一样」判断该不该禁用。
  const atMinZoom = zoomOut(zoom) === zoom;
  const atMaxZoom = zoomIn(zoom) === zoom;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && rootRef.current?.contains(event.target))) {
        setIsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const choose = (value: 'fit' | number) => {
    designer.setZoom(value);
    setIsOpen(false);
  };
  return (
    <fieldset
      ref={rootRef}
      className="designer-float designer-zoom"
      aria-label="缩放"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      {isOpen && (
        <fieldset className="designer-zoom__menu" aria-label="缩放到">
          <button type="button" className="designer-zoom__choice" onClick={() => choose('fit')}>
            {withShortcut('适合窗口', 'zoomFit', platform)}
          </button>
          <button type="button" className="designer-zoom__choice" onClick={() => choose(1)}>
            {withShortcut('100%', 'zoomActual', platform)}
          </button>
          <button type="button" className="designer-zoom__choice" onClick={() => choose(DOUBLE_ZOOM)}>
            200%
          </button>
        </fieldset>
      )}
      <IconButton icon="minus" name="缩小" disabled={atMinZoom} onClick={() => designer.setZoom(zoomOut(zoom))} />
      <button
        type="button"
        className="designer-zoom__value"
        aria-label={`缩放倍数 ${Math.round(zoom * PERCENT)}%，点开选适合窗口或 100%`}
        aria-expanded={isOpen}
        title="选适合窗口、100% 或 200%"
        onClick={() => setIsOpen(!isOpen)}
      >
        {`${Math.round(zoom * PERCENT)}%`}
      </button>
      <IconButton icon="plus" name="放大" disabled={atMaxZoom} onClick={() => designer.setZoom(zoomIn(zoom))} />
    </fieldset>
  );
}
