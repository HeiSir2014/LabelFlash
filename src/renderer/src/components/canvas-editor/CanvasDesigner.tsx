import { type KeyboardEvent, useRef, useState } from 'react';
import type { CanvasTemplate } from '../../../../core/templates/canvas-model';
import { NO_RENDER_WARNINGS, renderWarningTexts } from '../../../../shared/render-warnings';
import type { Platform } from '../../lib/app-view';
import { clampAll, replaceElement, rotateElement } from '../../lib/canvas-edit';
import { basicsMergeKey, historyMergeKey } from '../../lib/canvas-history';
import { designerCommand, undoShortcutLabel, zoomIn, zoomOut } from '../../lib/canvas-view';
import { useCanvasDesigner } from '../../view-models/use-canvas-designer';
import { useCanvasGesture, useCtrlWheelZoom } from '../../view-models/use-canvas-gesture';
import { useFitScale } from '../../view-models/use-fit-scale';
import type { TemplatePreview } from '../../view-models/use-template-preview';
import { RULER_DEPTH_MM } from '../Ruler';
import type { SampleContent } from '../SampleInput';
import { type PrinterChoices, TemplateBasics } from '../TemplateBasics';
import { CanvasStage } from './CanvasStage';
import { DesignerToolbar } from './DesignerToolbar';
import { ElementPalette } from './ElementPalette';
import { ElementProperties } from './ElementProperties';
import { LayerList } from './LayerList';

/** 「适合窗口」最多放大到 4 倍：小标签放得太大反而看不出实际大小，要更大用「放大」。 */
const MAX_FIT_ZOOM = 4;

export interface CanvasDesignerProps extends PrinterChoices {
  draft: CanvasTemplate;
  /** 草稿按「预览内容」排版的结果（和打印同一份 HTML）；第一次生成前为 null。 */
  preview: TemplatePreview | null;
  sample: SampleContent;
  /** 「插入字段」的候选。 */
  fieldNames: readonly string[];
  /** 画布覆盖层 aria-label 里撤销快捷键的文字按平台显示（Windows「Ctrl+Z」，macOS「⌘Z」）。 */
  platform: Platform;
  onChange: (draft: CanvasTemplate) => void;
}

/** 画布上没有标签时说的话：只说程序确知的事。 */
function placeholderOf(preview: TemplatePreview | null): string {
  return preview === null ? '正在生成预览…' : '这段预览内容无法识别：换一段试试，元素照样可以摆放';
}

/**
 * 自由设计模板的设计器（经典三栏）：上面工具条，左边元素，中间画布，右边属性和图层，下面打印前检查。
 * 状态在 use-canvas-designer、use-canvas-gesture；这里只把它们接到各个部分上。
 */
export function CanvasDesigner({
  draft,
  preview,
  sample,
  fieldNames,
  platform,
  onChange,
  printers,
  paperPrinters,
}: CanvasDesignerProps) {
  const designer = useCanvasDesigner({ draft, onChange });
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [editTextId, setEditTextId] = useState<string | null>(null);
  const fitZoom = useFitScale(
    stageRef,
    draft.paper.widthMm + RULER_DEPTH_MM,
    draft.paper.heightMm + RULER_DEPTH_MM,
    MAX_FIT_ZOOM,
  );
  const zoom = designer.zoom === 'fit' ? fitZoom : designer.zoom;
  const gesture = useCanvasGesture({
    template: draft,
    selection: designer.selection,
    zoom,
    snap: designer.snap,
    overlayRef,
    hidden: designer.hidden,
    onSelect: designer.select,
    onCommit: designer.commit,
  });
  useCtrlWheelZoom(stageRef, (direction) => designer.setZoom(direction > 0 ? zoomIn(zoom) : zoomOut(zoom)));
  const selected =
    designer.selection.length === 1
      ? (draft.elements.find((element) => element.id === designer.selection[0]) ?? null)
      : null;
  // 切换模板那一刻，preview 还是上一个草稿的结果（生成新的要等 150ms 防抖 + 一次主进程往返）：
  // 按 templateId 核对，不是这份草稿的结果就当还没有，不然会闪一下上一个模板的标签和检查结果。
  const currentPreview = preview?.templateId === draft.id ? preview : null;
  const checks = renderWarningTexts(currentPreview?.warnings ?? NO_RENDER_WARNINGS);

  /**
   * 「模板」里的名称、纸张、打印机：名称是要连续打字的输入框，纸张和打印机是下拉框、一次选择就改完，
   * 合并规则见 lib/canvas-history 的 basicsMergeKey。
   */
  const onBasicsChange = (next: CanvasTemplate) => {
    designer.commit(clampAll(next), basicsMergeKey(draft, next));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const command = designerCommand(event);
    if (command === null) {
      return;
    }
    if (gesture.isActive) {
      // 手势正按着：拖动框是按下那一刻的模板算出来的，这时候撤销、删除这类会改模板或历史的命令
      // 执行了也是把结果套用到错的起点上，一律跳过不执行；Esc 例外——取消这次手势（不提交，恢复原样），
      // 不去清空选中。这个按键已经被画布用掉，一律拦下。
      if (command.kind === 'deselect') {
        gesture.cancel();
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // 只拦下设计器用掉的按键：没选中时的方向键、Esc 照常（Esc 冒泡到配置中心，返回模板列表）。
    if (designer.runCommand(command)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <section className="canvas-designer" aria-label="设计器">
      <DesignerToolbar designer={designer} zoom={zoom} sample={sample} />
      <ElementPalette onAdd={(kind) => designer.add(kind)} />
      <CanvasStage
        template={draft}
        html={currentPreview?.html ?? null}
        placeholder={placeholderOf(currentPreview)}
        zoom={zoom}
        showGrid={designer.showGrid}
        undoShortcut={undoShortcutLabel(platform)}
        selection={designer.selection}
        hoverId={gesture.hoverId}
        gesture={gesture.view}
        handlers={gesture.handlers}
        stageRef={stageRef}
        overlayRef={overlayRef}
        onKeyDown={onKeyDown}
        onDropElement={(kind, center) => designer.add(kind, center)}
        onEditText={setEditTextId}
      />
      <aside className="designer-panel" aria-label="属性">
        {selected !== null ? (
          <ElementProperties
            key={selected.id}
            element={selected}
            paper={draft.paper}
            fieldNames={fieldNames}
            editTextId={editTextId}
            onTextEditStarted={() => setEditTextId(null)}
            onChange={(next, field) => designer.commit(replaceElement(draft, next), historyMergeKey(next.id, field))}
            onRotate={(rotation) => designer.commit(rotateElement(draft, selected.id, rotation))}
            onEndMerge={designer.endMerge}
            onImportImage={(file) => designer.importImage(selected.id, file)}
            isImportingImage={designer.isImportingImage(selected.id)}
          />
        ) : designer.selection.length > 1 ? (
          <p className="form-hint">{`已选 ${designer.selection.length} 个元素：用上面的按钮对齐、等距、置顶置底，方向键一起移动。`}</p>
        ) : (
          <section className="form-section">
            <h2 className="form-section__title">模板</h2>
            <TemplateBasics
              draft={draft}
              onChange={onBasicsChange}
              onNameEndMerge={designer.endMerge}
              printers={printers}
              paperPrinters={paperPrinters}
            />
          </section>
        )}
        <LayerList elements={draft.elements} selection={designer.selection} onSelect={designer.select} />
      </aside>
      <section className="designer-checks" aria-label="打印前检查">
        <h2 className="designer-checks__title">打印前检查</h2>
        {currentPreview === null ? (
          <p className="designer-checks__ok">正在检查…</p>
        ) : checks.length === 0 ? (
          <p className="designer-checks__ok">按这段预览内容没有发现问题</p>
        ) : (
          <ul className="designer-checks__list">
            {checks.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
