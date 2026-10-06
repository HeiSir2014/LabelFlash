import type { ReactNode } from 'react';
import type { Alignment } from '../../lib/canvas-edit';
import { zoomIn, zoomOut } from '../../lib/canvas-view';
import type { CanvasDesignerViewModel } from '../../view-models/use-canvas-designer';
import { type SampleContent, SampleInput } from '../SampleInput';

interface DesignerToolbarProps {
  designer: CanvasDesignerViewModel;
  /** 现在的缩放倍数（「适合窗口」时是算出来的倍数）。 */
  zoom: number;
  sample: SampleContent;
}

/** 对齐按钮：按钮上一个字，完整名称给读屏和鼠标悬停（名称里含按钮上的字）。 */
const ALIGN_BUTTONS: ReadonlyArray<{ value: Alignment; label: string; name: string }> = [
  { value: 'left', label: '左', name: '左对齐' },
  { value: 'center', label: '中', name: '水平居中' },
  { value: 'right', label: '右', name: '右对齐' },
  { value: 'top', label: '顶', name: '顶对齐' },
  { value: 'middle', label: '中', name: '垂直居中' },
  { value: 'bottom', label: '底', name: '底对齐' },
];

/** 缩放倍数显示成百分比：1 倍 = 100%（实物大小）。 */
const PERCENT = 100;

interface ToolButtonProps {
  label: string;
  name: string;
  disabled?: boolean;
  /** 开关按钮的状态；普通按钮不传。 */
  pressed?: boolean;
  onClick: () => void;
}

function ToolButton({ label, name, disabled = false, pressed, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className="button button--small button--quiet"
      title={name}
      aria-label={name}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** 一组按钮：组名给读屏；对齐、等距的按钮只有一个字，把组名也显示出来。 */
function ToolGroup({
  label,
  showLabel = false,
  children,
}: {
  label: string;
  showLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="designer-toolbar__group" aria-label={label}>
      {showLabel && (
        <span className="designer-toolbar__label" aria-hidden="true">
          {label}
        </span>
      )}
      {children}
    </fieldset>
  );
}

/** 设计器的工具条：编辑、对齐、等距、叠放、网格和吸附、缩放，最后是预览内容。 */
export function DesignerToolbar({ designer, zoom, sample }: DesignerToolbarProps) {
  const { hasSelection } = designer;
  // 到头了：zoomOut/zoomIn 在端点上原样返回当前值，用「算出来和现在一样」判断该不该再禁用一次。
  const atMinZoom = zoomOut(zoom) === zoom;
  const atMaxZoom = zoomIn(zoom) === zoom;
  return (
    <div className="designer-toolbar">
      <ToolGroup label="编辑">
        <ToolButton label="撤销" name="撤销" disabled={!designer.canUndo} onClick={designer.undo} />
        <ToolButton label="重做" name="重做" disabled={!designer.canRedo} onClick={designer.redo} />
        <ToolButton label="复制" name="复制" disabled={!hasSelection} onClick={designer.copy} />
        <ToolButton label="粘贴" name="粘贴" disabled={!designer.canPaste} onClick={designer.paste} />
        <ToolButton label="删除" name="删除" disabled={!hasSelection} onClick={designer.remove} />
      </ToolGroup>
      {/* 组名「元素对齐」而不是「对齐」：属性栏里文字、表格格子也有一个叫「对齐」的控件，两边都在屏幕上时名字不能撞。 */}
      <ToolGroup label="元素对齐" showLabel>
        {ALIGN_BUTTONS.map((button) => (
          <ToolButton
            key={button.value}
            label={button.label}
            name={button.name}
            disabled={!hasSelection}
            onClick={() => designer.align(button.value)}
          />
        ))}
      </ToolGroup>
      <ToolGroup label="等距" showLabel>
        <ToolButton
          label="横"
          name="横向等距"
          disabled={!designer.canDistribute}
          onClick={() => designer.distribute('horizontal')}
        />
        <ToolButton
          label="纵"
          name="纵向等距"
          disabled={!designer.canDistribute}
          onClick={() => designer.distribute('vertical')}
        />
      </ToolGroup>
      <ToolGroup label="叠放">
        <ToolButton label="置顶" name="置顶" disabled={!hasSelection} onClick={() => designer.moveLayers('front')} />
        <ToolButton label="置底" name="置底" disabled={!hasSelection} onClick={() => designer.moveLayers('back')} />
      </ToolGroup>
      <ToolGroup label="辅助">
        <ToolButton
          label="网格"
          name="网格"
          pressed={designer.showGrid}
          onClick={() => designer.setShowGrid(!designer.showGrid)}
        />
        <ToolButton label="吸附" name="吸附" pressed={designer.snap} onClick={() => designer.setSnap(!designer.snap)} />
      </ToolGroup>
      <ToolGroup label="缩放">
        <ToolButton label="缩小" name="缩小" disabled={atMinZoom} onClick={() => designer.setZoom(zoomOut(zoom))} />
        <output className="designer-toolbar__zoom" aria-label="缩放倍数">
          {`${Math.round(zoom * PERCENT)}%`}
        </output>
        <ToolButton label="放大" name="放大" disabled={atMaxZoom} onClick={() => designer.setZoom(zoomIn(zoom))} />
        <ToolButton
          label="适合"
          name="适合窗口"
          pressed={designer.zoom === 'fit'}
          onClick={() => designer.setZoom('fit')}
        />
      </ToolGroup>
      <SampleInput sample={sample} isCompact />
    </div>
  );
}
