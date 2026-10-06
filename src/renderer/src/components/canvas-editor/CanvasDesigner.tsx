import { type KeyboardEvent, useRef, useState } from 'react';
import { CANVAS_ELEMENT_LABELS, type CanvasTemplate } from '../../../../core/templates/canvas-model';
import { type ElementWarning, NO_RENDER_WARNINGS, renderWarningTexts } from '../../../../shared/render-warnings';
import type { Platform } from '../../lib/app-view';
import { clampAll, replaceElement, rotateElement } from '../../lib/canvas-edit';
import { growToPrint } from '../../lib/canvas-fix';
import { basicsMergeKey, historyMergeKey } from '../../lib/canvas-history';
import { designerCommand, undoShortcutLabel, zoomIn, zoomOut } from '../../lib/canvas-view';
import { useCanvasDesigner } from '../../view-models/use-canvas-designer';
import { useCanvasGesture, useCtrlWheelZoom } from '../../view-models/use-canvas-gesture';
import { useFitScale } from '../../view-models/use-fit-scale';
import type { TemplatePreview } from '../../view-models/use-template-preview';
import { RULER_DEPTH_MM } from '../Ruler';
import type { SampleContent } from '../SampleInput';
import { type PrinterChoices, TemplateBasics } from '../TemplateBasics';
import { AlignButtons, DistributeButtons, LayerOrderButtons } from './ArrangeButtons';
import { CanvasStage } from './CanvasStage';
import { type CheckItem, DesignerChecks } from './DesignerChecks';
import { DesignerHeader, HistoryButtons, ZoomPill } from './DesignerToolbar';
import { ElementPalette } from './ElementPalette';
import { ElementContent, ElementGeometry, ElementWarnings } from './ElementProperties';
import { Inspector, type InspectorTab } from './Inspector';
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
  /** 快捷键的文字按平台显示（Windows「Ctrl+Z」，macOS「⌘Z」）。 */
  platform: Platform;
  onChange: (draft: CanvasTemplate) => void;
}

/** 检查器的三种标签页：第一页（元素自己的设置；没选中时是模板、多选时是排列）、排列、图层。 */
type InspectorTabId = 'main' | 'arrange' | 'layers';

/** 画布上没有标签时说的话：只说程序确知的事。 */
function placeholderOf(preview: TemplatePreview | null): string {
  return preview === null ? '正在生成预览…' : '这段预览内容无法识别：换一段试试，元素照样可以摆放';
}

/**
 * 打印前检查的清单：自由设计模板的每条问题都带着元素（RenderWarnings.elements）；万一有没对上元素的，
 * 按 renderWarningTexts 的文字补在后面，不丢。
 */
function checkItemsOf(warnings: typeof NO_RENDER_WARNINGS): CheckItem[] {
  const items: CheckItem[] = warnings.elements.map((warning) => ({
    text: warning.text,
    level: warning.level,
    elementId: warning.elementId,
  }));
  for (const text of renderWarningTexts(warnings)) {
    if (!items.some((item) => item.text === text)) {
      items.push({ text, level: 'warning', elementId: null });
    }
  }
  // 不印的排在前面：收起时那一条里先看到最要紧的。sort 是稳定的，同一级别保持原来的顺序。
  return items.sort((a, b) => Number(b.level === 'omitted') - Number(a.level === 'omitted'));
}

/**
 * 自由设计模板的设计器：画布优先。上面一条窄栏（预览内容、网格、吸附、快捷键），左边竖排的元素图标，
 * 中间画布（左上角撤销重做、右下角缩放），右边检查器（分段标签），下面一条打印前检查。
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
  const warnings = currentPreview?.warnings ?? NO_RENDER_WARNINGS;

  // 检查器的标签页：选中的东西变了就回到第一页（看「图层」时除外：在图层里点选不该被弹回去）。
  const selectionKey = designer.selection.join(',');
  const [tabState, setTabState] = useState<{ key: string; tab: InspectorTabId }>({ key: '', tab: 'main' });
  const requestedTab = tabState.key === selectionKey || tabState.tab === 'layers' ? tabState.tab : 'main';
  const selectTab = (tab: InspectorTabId) => setTabState({ key: selectionKey, tab });

  const growToPrintOf = (warning: ElementWarning) => {
    const grown = growToPrint(draft, warning);
    if (grown.status === 'grown') {
      designer.commit(grown.template);
    }
  };

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

  const layers = <LayerList elements={draft.elements} selection={designer.selection} onSelect={designer.select} />;
  const layerTab: InspectorTab<InspectorTabId> = { id: 'layers', label: '图层', content: layers };
  const arrangeButtons = (isSingle: boolean) => (
    <>
      <h3 className="inspector-heading">{isSingle ? '对齐到安全区' : '对齐'}</h3>
      <AlignButtons isSingle={isSingle} onAlign={designer.align} />
      {!isSingle && (
        <>
          <h3 className="inspector-heading">等距</h3>
          <DistributeButtons disabled={!designer.canDistribute} onDistribute={designer.distribute} />
        </>
      )}
      <h3 className="inspector-heading">叠放</h3>
      <LayerOrderButtons platform={platform} onMove={designer.moveLayers} />
    </>
  );

  let tabs: InspectorTab<InspectorTabId>[];
  if (selected !== null) {
    const onElementChange = (next: typeof selected, field: string | null) =>
      designer.commit(replaceElement(draft, next), historyMergeKey(next.id, field));
    const onRotate = (rotation: typeof selected.rotation) =>
      designer.commit(rotateElement(draft, selected.id, rotation));
    tabs = [
      {
        id: 'main',
        label: CANVAS_ELEMENT_LABELS[selected.kind],
        content: (
          <ElementContent
            key={selected.id}
            element={selected}
            paper={draft.paper}
            fieldNames={fieldNames}
            editTextId={editTextId}
            onTextEditStarted={() => setEditTextId(null)}
            onChange={onElementChange}
            onRotate={onRotate}
            onEndMerge={designer.endMerge}
            onImportImage={(file) => designer.importImage(selected.id, file)}
            isImportingImage={designer.isImportingImage(selected.id)}
          />
        ),
      },
      {
        id: 'arrange',
        label: '排列',
        content: (
          <section className="inspector-section" aria-label="排列">
            <ElementGeometry
              key={selected.id}
              element={selected}
              paper={draft.paper}
              onChange={onElementChange}
              onRotate={onRotate}
              onEndMerge={designer.endMerge}
            />
            {arrangeButtons(true)}
          </section>
        ),
      },
      layerTab,
    ];
  } else if (designer.selection.length > 1) {
    tabs = [
      {
        id: 'main',
        label: '排列',
        content: (
          <section className="inspector-section" aria-label="排列">
            <p className="form-hint">{`已选 ${designer.selection.length} 个元素：方向键一起移动，拖动其中一个整组跟着动。`}</p>
            {arrangeButtons(false)}
          </section>
        ),
      },
      layerTab,
    ];
  } else {
    tabs = [
      {
        id: 'main',
        label: '模板',
        content: (
          <section className="inspector-section" aria-label="模板">
            <TemplateBasics
              draft={draft}
              onChange={onBasicsChange}
              onNameEndMerge={designer.endMerge}
              printers={printers}
              paperPrinters={paperPrinters}
            />
          </section>
        ),
      },
      layerTab,
    ];
  }
  const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : 'main';
  const selectedWarnings =
    selected === null ? [] : warnings.elements.filter((warning) => warning.elementId === selected.id);

  return (
    <section className="canvas-designer" aria-label="设计器">
      <DesignerHeader designer={designer} sample={sample} platform={platform} />
      <ElementPalette onAdd={(kind) => designer.add(kind)} />
      <div className="designer-stage-area">
        <CanvasStage
          template={draft}
          html={currentPreview?.html ?? null}
          placeholder={placeholderOf(currentPreview)}
          zoom={zoom}
          showGrid={designer.showGrid}
          undoShortcut={undoShortcutLabel(platform)}
          selection={designer.selection}
          hoverId={gesture.hoverId}
          warnings={warnings.elements}
          gesture={gesture.view}
          handlers={gesture.handlers}
          stageRef={stageRef}
          overlayRef={overlayRef}
          onKeyDown={onKeyDown}
          onDropElement={(kind, center) => designer.add(kind, center)}
          onEditText={(id) => {
            setEditTextId(id);
            selectTab('main');
          }}
        />
        <HistoryButtons designer={designer} platform={platform} />
        <ZoomPill designer={designer} zoom={zoom} platform={platform} />
      </div>
      <Inspector
        tabs={tabs}
        active={activeTab}
        onSelect={selectTab}
        header={
          selectedWarnings.length > 0 && (
            <ElementWarnings warnings={selectedWarnings} paper={draft.paper} onGrowToPrint={growToPrintOf} />
          )
        }
      />
      <DesignerChecks
        isPending={currentPreview === null}
        items={checkItemsOf(warnings)}
        onSelectElement={(id) => designer.select([id])}
      />
    </section>
  );
}
