import type { Platform } from '../../lib/app-view';
import type { Alignment, DistributeAxis } from '../../lib/canvas-edit';
import type { LayerMove } from '../../lib/canvas-view';
import { withShortcut } from '../../lib/designer-shortcuts';
import { IconButton } from './IconButton';
import type { IconName } from './icons';

const ALIGN_BUTTONS: ReadonlyArray<{ value: Alignment; icon: IconName; name: string }> = [
  { value: 'left', icon: 'alignLeft', name: '左对齐' },
  { value: 'center', icon: 'alignCenter', name: '水平居中' },
  { value: 'right', icon: 'alignRight', name: '右对齐' },
  { value: 'top', icon: 'alignTop', name: '顶对齐' },
  { value: 'middle', icon: 'alignMiddle', name: '垂直居中' },
  { value: 'bottom', icon: 'alignBottom', name: '底对齐' },
];

/**
 * 对齐的六个按钮。选一个时对齐到安全区（纸边往里 1.5mm），选几个时对齐到它们合起来的外框：
 * 名字和悬停提示跟着说清楚是哪一种。
 */
export function AlignButtons({
  isSingle,
  disabled = false,
  onAlign,
}: {
  isSingle: boolean;
  disabled?: boolean;
  onAlign: (alignment: Alignment) => void;
}) {
  return (
    <fieldset className="icon-group" aria-label={isSingle ? '对齐到安全区' : '元素对齐'}>
      {ALIGN_BUTTONS.map((button) => (
        <IconButton
          key={button.value}
          icon={button.icon}
          name={isSingle ? `${button.name}到安全区` : button.name}
          disabled={disabled}
          onClick={() => onAlign(button.value)}
        />
      ))}
    </fieldset>
  );
}

/** 横向、纵向等距：至少三个能动的元素才可用。 */
export function DistributeButtons({
  disabled,
  onDistribute,
}: {
  disabled: boolean;
  onDistribute: (axis: DistributeAxis) => void;
}) {
  return (
    <fieldset className="icon-group" aria-label="等距">
      <IconButton
        icon="distributeHorizontal"
        name="横向等距"
        tooltip="横向等距（至少选三个）"
        disabled={disabled}
        onClick={() => onDistribute('horizontal')}
      />
      <IconButton
        icon="distributeVertical"
        name="纵向等距"
        tooltip="纵向等距（至少选三个）"
        disabled={disabled}
        onClick={() => onDistribute('vertical')}
      />
    </fieldset>
  );
}

const LAYER_BUTTONS: ReadonlyArray<{ move: LayerMove; icon: IconName; name: string }> = [
  { move: 'front', icon: 'bringToFront', name: '置顶' },
  { move: 'forward', icon: 'bringForward', name: '上移一层' },
  { move: 'backward', icon: 'sendBackward', name: '下移一层' },
  { move: 'back', icon: 'sendToBack', name: '置底' },
];

/** 叠放的四个按钮，悬停提示里写快捷键。 */
export function LayerOrderButtons({
  platform,
  disabled = false,
  onMove,
}: {
  platform: Platform;
  disabled?: boolean;
  onMove: (move: LayerMove) => void;
}) {
  return (
    <fieldset className="icon-group" aria-label="叠放">
      {LAYER_BUTTONS.map((button) => (
        <IconButton
          key={button.move}
          icon={button.icon}
          name={button.name}
          tooltip={withShortcut(button.name, button.move, platform)}
          disabled={disabled}
          onClick={() => onMove(button.move)}
        />
      ))}
    </fieldset>
  );
}
