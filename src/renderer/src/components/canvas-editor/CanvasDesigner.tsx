import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { CANVAS_ELEMENT_LABELS, type CanvasTemplate } from '../../../../core/templates/canvas-model';
import { type ElementWarning, NO_RENDER_WARNINGS, renderWarningTexts } from '../../../../shared/render-warnings';
import type { Platform } from '../../lib/app-view';
import { boundsOf, clampAll, type Point, replaceElement, rotateElement } from '../../lib/canvas-edit';
import { growToPrint } from '../../lib/canvas-fix';
import { basicsMergeKey, historyMergeKey } from '../../lib/canvas-history';
import { hitTest } from '../../lib/canvas-hit';
import {
  applyInlineEdit,
  type InlineEditorLayout,
  type InlineTarget,
  inlineEditorLayout,
} from '../../lib/canvas-inline';
import { contextMenuItems } from '../../lib/canvas-menu';
import { tableCellAt } from '../../lib/canvas-table';
import {
  designerCommand,
  hideElementsInHtml,
  PX_PER_MM,
  pxToMm,
  scrollToKeep,
  shouldReturnFocusToCanvas,
  undoShortcutLabel,
  wheelZoom,
} from '../../lib/canvas-view';
import { insertFieldOptions } from '../../lib/insert-field-options';
import { useCanvasDesigner } from '../../view-models/use-canvas-designer';
import { useCanvasGesture, useCanvasPan, useWheelZoom } from '../../view-models/use-canvas-gesture';
import { useFitScale } from '../../view-models/use-fit-scale';
import type { TemplatePreview } from '../../view-models/use-template-preview';
import { RULER_DEPTH_MM } from '../Ruler';
import type { SampleContent } from '../SampleInput';
import { type PrinterChoices, TemplateBasics } from '../TemplateBasics';
import { AlignButtons, DistributeButtons, LayerOrderButtons } from './ArrangeButtons';
import { CanvasStage } from './CanvasStage';
import { ContextMenu } from './ContextMenu';
import { type CheckItem, DesignerChecks } from './DesignerChecks';
import { DesignerHeader, HistoryButtons, ZoomPill } from './DesignerToolbar';
import { ElementPalette } from './ElementPalette';
import { ElementContent, ElementGeometry, ElementWarnings } from './ElementProperties';
import { FloatingToolbar } from './FloatingToolbar';
import { InlineTextEditor } from './InlineTextEditor';
import { Inspector, type InspectorTab } from './Inspector';
import { LayerList } from './LayerList';
import { ShortcutSheet } from './ShortcutSheet';

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
  /**
   * 空画布上的「从模板库新建」：离开这个空白模板、打开模板库。有没保存的修改时为 null（不提供，免得悄悄丢掉）。
   */
  onOpenLibrary: (() => void) | null;
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
 * 设计器里点了按钮（浮动工具条、检查器、元素栏、撤销重做……）之后把焦点还给画布（规则见 shouldReturnFocusToCanvas）：
 * 快捷键挂在画布上，焦点留在按钮上的话，接着按 Ctrl+Z、方向键都没反应。
 * 图层列表除外：那里的行要能拖动排序、双击改名，焦点由它自己管。
 * 鼠标（数位板的笔也一样）按下按钮时就把焦点放到画布上、不让按钮接走：在按下这一刻做，松手后紧接着的按键一定落在画布上，
 * 不和下一帧赛跑。按钮的操作自己要焦点的（就地改字的输入框、菜单）在这之后照样拿走。
 * 用键盘按的看操作做完之后焦点落在哪（下一个任务里看：原生 click 监听在 React 的处理之前跑）。
 */
function useReturnFocusToCanvas(
  sectionRef: RefObject<HTMLElement | null>,
  overlayRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const section = sectionRef.current;
    if (section === null) {
      return;
    }
    let timer = 0;
    const buttonOf = (event: MouseEvent): HTMLButtonElement | null => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      return button === null || button.closest('.layer-list, .designer-empty') !== null ? null : button;
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0 && buttonOf(event) !== null) {
        event.preventDefault();
        overlayRef.current?.focus({ preventScroll: true });
      }
    };
    const onClick = (event: MouseEvent) => {
      const button = buttonOf(event);
      if (button === null) {
        return;
      }
      const isPointerClick = event.detail > 0;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const active = document.activeElement;
        const focus =
          active === button ? 'clicked' : active === null || active === document.body ? 'body' : 'elsewhere';
        if (shouldReturnFocusToCanvas({ isPointerClick, focus })) {
          overlayRef.current?.focus({ preventScroll: true });
        }
      });
    };
    section.addEventListener('mousedown', onMouseDown);
    section.addEventListener('click', onClick);
    return () => {
      window.clearTimeout(timer);
      section.removeEventListener('mousedown', onMouseDown);
      section.removeEventListener('click', onClick);
    };
  }, [sectionRef, overlayRef]);
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
  onOpenLibrary,
  printers,
  paperPrinters,
}: CanvasDesignerProps) {
  const designer = useCanvasDesigner({ draft, onChange });
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useReturnFocusToCanvas(sectionRef, overlayRef);
  // 就地改字：改的是哪个元素（哪一格）、输入框盖在哪；没在改时为 null。
  const [inline, setInline] = useState<{ target: InlineTarget; layout: InlineEditorLayout } | null>(null);
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
  const pan = useCanvasPan(stageRef);
  // 以指针为中心缩放：缩放前记下指针下面是纸上哪一点，缩放后（布局已经按新倍数排好）把画布滚回去，让这一点还在指针下面。
  const zoomAnchorRef = useRef<{ mm: Point; client: Point } | null>(null);
  useWheelZoom(stageRef, (deltaY, client) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    zoomAnchorRef.current = {
      mm: { x: pxToMm(client.x - rect.left, zoom), y: pxToMm(client.y - rect.top, zoom) },
      client,
    };
    designer.setZoom(wheelZoom(zoom, deltaY));
  });
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const stage = stageRef.current;
    const rect = overlayRef.current?.getBoundingClientRect();
    zoomAnchorRef.current = null;
    if (anchor === null || stage === null || rect === undefined) {
      return;
    }
    const adjustment = scrollToKeep(anchor.mm, anchor.client, { x: rect.left, y: rect.top }, zoom);
    stage.scrollLeft += adjustment.x;
    stage.scrollTop += adjustment.y;
  }, [zoom]);
  const handlers = {
    ...gesture.handlers,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pan.onPointerDown(event)) {
        gesture.handlers.onPointerDown(event);
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pan.onPointerMove(event)) {
        gesture.handlers.onPointerMove(event);
      }
    },
    onPointerUp: () => {
      if (!pan.end()) {
        gesture.handlers.onPointerUp();
      }
    },
    onPointerCancel: () => {
      pan.end();
      gesture.handlers.onPointerCancel();
    },
    onLostPointerCapture: () => {
      pan.end();
      gesture.handlers.onLostPointerCapture();
    },
  };
  const selected =
    designer.selection.length === 1
      ? (draft.elements.find((element) => element.id === designer.selection[0]) ?? null)
      : null;
  // 切换模板那一刻，preview 还是上一个草稿的结果（生成新的要等 150ms 防抖 + 一次主进程往返）：
  // 按 templateId 核对，不是这份草稿的结果就当还没有，不然会闪一下上一个模板的标签和检查结果。
  const currentPreview = preview?.templateId === draft.id ? preview : null;
  const warnings = currentPreview?.warnings ?? NO_RENDER_WARNINGS;
  // 「插入字段」「绑定字段」的选项：写出这段预览内容识别出的值（「编码 — CL5640-TK」）。
  const sampleScan = currentPreview?.result.status === 'ok' ? currentPreview.result.scan : null;
  const fieldOptions = insertFieldOptions(fieldNames, sampleScan);

  // 检查器的标签页：选中的东西变了就回到第一页（看「图层」时除外：在图层里点选不该被弹回去）。
  const selectionKey = designer.selection.join(',');
  const [tabState, setTabState] = useState<{ key: string; tab: InspectorTabId }>({ key: '', tab: 'main' });
  const requestedTab = tabState.key === selectionKey || tabState.tab === 'layers' ? tabState.tab : 'main';
  const selectTab = (tab: InspectorTabId) => setTabState({ key: selectionKey, tab });

  // 右键菜单：打开的位置和打开那一刻选中的元素（右键点在没选中的元素上会先选中它）。
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; ids: readonly string[] } | null>(null);
  const closeMenu = useCallback(() => {
    setMenu(null);
    // 焦点在菜单里（键盘操作、选了一项）时还给画布，接着能用方向键；点到别处的话焦点由那里接走。
    const active = document.activeElement;
    if (active === null || active === document.body || active.closest('.context-menu') !== null) {
      overlayRef.current?.focus();
    }
  }, []);
  const visibleElements = draft.elements.filter((element) => !designer.hidden.has(element.id));
  const selectedElements = visibleElements.filter((element) => designer.selection.includes(element.id));
  const selectionBox = boundsOf(selectedElements);
  const onCanvasContextMenu = (point: Point, client: Point) => {
    // 点在已选中的东西上（包括锁定的）：菜单对整组；点在别的元素上先选中它；点在空白处清空选中（菜单只剩粘贴、全选）。
    const isOnSelection = selectedElements.some(
      (element) =>
        point.x >= element.x &&
        point.x <= element.x + element.width &&
        point.y >= element.y &&
        point.y <= element.y + element.height,
    );
    const hit = hitTest(visibleElements, point, zoom);
    const ids = isOnSelection ? designer.selection : hit === null ? [] : [hit];
    designer.select(ids);
    setMenu({ at: client, ids });
  };
  /** 菜单键、Shift+F10：在选中的东西左下角（没选中时在画布左上角）打开菜单。 */
  const openMenuFromKeyboard = () => {
    const rect = overlayRef.current?.getBoundingClientRect();
    const pxPerMm = PX_PER_MM * zoom;
    const at =
      selectionBox === null
        ? { x: rect?.left ?? 0, y: rect?.top ?? 0 }
        : {
            x: (rect?.left ?? 0) + selectionBox.x * pxPerMm,
            y: (rect?.top ?? 0) + (selectionBox.y + selectionBox.height) * pxPerMm,
          };
    setMenu({ at, ids: designer.selection });
  };
  const menuItems =
    menu === null
      ? []
      : contextMenuItems({
          selectionCount: menu.ids.length,
          canPaste: designer.canPaste,
          allLocked:
            menu.ids.length > 0 &&
            draft.elements.filter((element) => menu.ids.includes(element.id)).every((element) => element.locked),
          platform,
        });

  /**
   * 双击选中的文字（或表格的一格）、浮动工具条的「改文字」：盖一个输入框就地改。
   * 转过的表格不就地改（格子方向和屏幕对不上），翻到检查器的表格页去改。
   */
  const startInlineEdit = (point: Point | null) => {
    if (selected === null) {
      return;
    }
    const cell = selected.kind === 'table' && point !== null ? tableCellAt(selected, point) : null;
    const layout = inlineEditorLayout(selected, cell);
    if (layout === null) {
      if (selected.kind === 'table') {
        selectTab('main');
      }
      return;
    }
    setInline({
      target: { elementId: selected.id, cell: cell === null ? null : { row: cell.row, column: cell.column } },
      layout,
    });
  };
  const endInlineEdit = (text: string | null) => {
    if (inline !== null && text !== null) {
      designer.commit(applyInlineEdit(draft, inline.target, text));
    }
    setInline(null);
    // 用键盘改完（Ctrl+Enter、Esc）时焦点还在输入框里：还给画布。点到别处改完的，焦点已经被那里接走，不抢。
    const active = document.activeElement;
    if (active === null || active === document.body || active.classList.contains('inline-editor')) {
      overlayRef.current?.focus();
    }
  };

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
    // 空格：按住拖动平移画布（不让浏览器把它当成滚动页面）。
    if (pan.onKey(event)) {
      event.preventDefault();
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
    if (command.kind === 'menu') {
      event.preventDefault();
      event.stopPropagation();
      openMenuFromKeyboard();
      return;
    }
    // 只拦下设计器用掉的按键：没选中时的方向键、Esc 照常（Esc 冒泡到配置中心，返回模板列表）。
    if (designer.runCommand(command)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const layers = (
    <LayerList
      elements={draft.elements}
      selection={designer.selection}
      hidden={designer.hidden}
      platform={platform}
      onSelect={designer.select}
      onToggleLock={designer.toggleLock}
      onToggleHidden={designer.toggleHidden}
      onRename={designer.rename}
      onReorder={designer.reorder}
    />
  );
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
            fieldOptions={fieldOptions}
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
    <section ref={sectionRef} className="canvas-designer" aria-label="设计器">
      <DesignerHeader designer={designer} sample={sample} platform={platform} />
      <ElementPalette onAdd={(kind) => designer.add(kind)} />
      <div className="designer-stage-area">
        <CanvasStage
          template={draft}
          html={currentPreview?.html == null ? null : hideElementsInHtml(currentPreview.html, designer.hidden)}
          hidden={designer.hidden}
          placeholder={placeholderOf(currentPreview)}
          zoom={zoom}
          showGrid={designer.showGrid}
          undoShortcut={undoShortcutLabel(platform)}
          selection={designer.selection}
          warnings={warnings.elements}
          gestureStore={gesture.store}
          handlers={handlers}
          panMode={pan.isPanning ? 'grabbing' : pan.isSpaceHeld ? 'grab' : null}
          onKeyUp={(event) => {
            if (pan.onKey(event)) {
              event.preventDefault();
            }
          }}
          onBlur={pan.releaseSpace}
          stageRef={stageRef}
          overlayRef={overlayRef}
          onKeyDown={onKeyDown}
          onDropElement={(kind, center) => designer.add(kind, center)}
          onEditText={(point) => startInlineEdit(point)}
          onContextMenu={onCanvasContextMenu}
          floating={
            inline !== null ? (
              <InlineTextEditor
                key={`${inline.target.elementId}:${inline.target.cell?.row ?? ''}:${inline.target.cell?.column ?? ''}`}
                layout={inline.layout}
                onCommit={(text) => endInlineEdit(text)}
                onCancel={() => endInlineEdit(null)}
              />
            ) : selectionBox !== null && !gesture.isDragging ? (
              <FloatingToolbar
                elements={selectedElements}
                box={selectionBox}
                zoom={zoom}
                platform={platform}
                stageRef={stageRef}
                overlayRef={overlayRef}
                warnings={selectedWarnings}
                fieldOptions={fieldOptions}
                canDistribute={designer.canDistribute}
                onChange={(next) => designer.commit(replaceElement(draft, next))}
                onEditText={() => startInlineEdit(null)}
                onGrowToPrint={growToPrintOf}
                onDuplicate={designer.duplicate}
                onDelete={designer.remove}
                onSetLocked={designer.setLocked}
                onLayer={designer.moveLayers}
                onAlign={designer.align}
                onDistribute={designer.distribute}
                onMore={(at) => setMenu({ at, ids: designer.selection })}
              />
            ) : undefined
          }
        />
        {menu !== null && (
          <ContextMenu items={menuItems} at={menu.at} onAction={designer.runMenuAction} onClose={closeMenu} />
        )}
        {draft.elements.length === 0 && (
          <p className="designer-empty">
            从左边点一个元素加进来
            {onOpenLibrary !== null && (
              <>
                ，或{' '}
                <button type="button" className="designer-empty__link" onClick={onOpenLibrary}>
                  从模板库新建
                </button>
              </>
            )}
          </p>
        )}
        <HistoryButtons designer={designer} platform={platform} />
        {designer.isShortcutSheetOpen && (
          <ShortcutSheet
            platform={platform}
            onClose={() => {
              designer.setIsShortcutSheetOpen(false);
              overlayRef.current?.focus();
            }}
          />
        )}
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
