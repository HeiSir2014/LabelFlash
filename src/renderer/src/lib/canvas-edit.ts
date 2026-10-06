import {
  CANVAS_LIMITS,
  type CanvasElement,
  type CanvasElementKind,
  type CanvasTemplate,
  newCanvasElement,
  type Rotation,
} from '../../../core/templates/canvas-model';
import type { PaperSize } from '../../../shared/paper-sizes';

/**
 * 设计器的编辑操作，全是纯函数：输入模板，返回改好的新模板（不改原来的；没有变化时尽量原样返回）。
 * 位置和大小的规则和 core 的 sanitize-canvas 一致（不小于最小尺寸、整个元素在纸上），保存时不会再被改动。
 * 锁定的元素不移动、不缩放、不删除（防止误碰），但可以选中、在属性栏里改。
 */

/** 元素在纸上占的框（mm），和 CanvasElementBase 的 x、y、width、height 一致。 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 纸上的一个点（mm）。 */
export interface Point {
  x: number;
  y: number;
}

/** 添加、粘贴的结果：新模板和新元素的 id（设计器接着选中它们）。 */
export interface Added {
  template: CanvasTemplate;
  ids: string[];
  /**
   * 因为会把模板的图片总量推过 `CANVAS_LIMITS.templateImageBytes` 而被跳过的图片个数；
   * 界面据此给出提示（「有 N 张图片超出图片总量上限，未粘贴」）。`addElement` 不会跳图片，恒为 0。
   */
  skippedImages: number;
}

/** 0.01mm：比打印点（203dpi 约 0.125mm）细得多；再细的小数存进模板没有意义，数字框里还会出现 12.300000001。 */
const MM_PRECISION = 100;

/** 保留两位小数；`|| 0` 把 -0 变成 0，数字框不会显示「-0」。 */
export function roundMm(value: number): number {
  return Math.round(value * MM_PRECISION) / MM_PRECISION || 0;
}

/** 取整到 step 的整数倍（例如拖动按 0.1mm 一步）。 */
export function roundTo(value: number, step: number): number {
  return roundMm(Math.round(value / step) * step);
}

/**
 * 属性栏数字框（X/Y/宽/高）的上限：纸边减去元素占另一边的量，取整到 0.01mm。
 * 不取整的话浮点误差会把刚好顶到边的合法值挡在外面，例如 60 - 36.7 算出 23.299999999999997，
 * 比用户想填的 23.3 还小，`<input type="number" max=...>` 会拒收这个值。
 */
export function maxExtentMm(totalMm: number, usedMm: number): number {
  return roundMm(totalMm - usedMm);
}

/** 只取框的四个数（元素本身也是一个框）。 */
export function boxOf(box: Box): Box {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/** 几个框合起来的外框；空列表返回 null。 */
export function boundsOf(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) {
    return null;
  }
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 框收进纸内：先定大小（不小于最小尺寸、不大于纸），再定位置（整个框在纸上）。 */
export function clampBox(box: Box, paper: PaperSize): Box {
  const min = CANVAS_LIMITS.minSizeMm;
  const width = roundMm(Math.min(paper.widthMm, Math.max(min, box.width)));
  const height = roundMm(Math.min(paper.heightMm, Math.max(min, box.height)));
  return {
    x: roundMm(Math.min(paper.widthMm - width, Math.max(0, box.x))),
    y: roundMm(Math.min(paper.heightMm - height, Math.max(0, box.y))),
    width,
    height,
  };
}

/** 选中的里面加上或去掉一个（Shift 点选）。 */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

function withBox<T extends CanvasElement>(element: T, box: Box): T {
  return { ...element, x: box.x, y: box.y, width: box.width, height: box.height };
}

/** 选中了、又没锁定：拖动、缩放、删除、对齐都只动这些。 */
function isMovable(element: CanvasElement, ids: readonly string[]): boolean {
  return ids.includes(element.id) && !element.locked;
}

/** 所有元素收进纸内：换了更小的纸以后用，不然元素落在纸外，覆盖层上也看不到。 */
export function clampAll(template: CanvasTemplate): CanvasTemplate {
  return {
    ...template,
    elements: template.elements.map((element) => withBox(element, clampBox(element, template.paper))),
  };
}

/** 按 id 换掉一个元素（属性栏的修改），框收进纸内；没有这个 id 时元素不变。 */
export function replaceElement(template: CanvasTemplate, next: CanvasElement): CanvasTemplate {
  return {
    ...template,
    elements: template.elements.map((element) =>
      element.id === next.id ? withBox(next, clampBox(next, template.paper)) : element,
    ),
  };
}

/** 给一个元素新的框（拖控制点松手时），收进纸内；锁定的不变。 */
export function setBox(template: CanvasTemplate, id: string, box: Box): CanvasTemplate {
  return {
    ...template,
    elements: template.elements.map((element) =>
      element.id === id && !element.locked ? withBox(element, clampBox(box, template.paper)) : element,
    ),
  };
}

/** 整组移动：位移先限制在「整组都还在纸上」以内，组里元素的相对位置不变。锁定的不动；没有能动的原样返回。 */
export function moveBy(template: CanvasTemplate, ids: readonly string[], dx: number, dy: number): CanvasTemplate {
  const moving = template.elements.filter((element) => isMovable(element, ids));
  const bounds = boundsOf(moving);
  if (bounds === null) {
    return template;
  }
  const { paper } = template;
  const clampedDx = Math.min(paper.widthMm - bounds.x - bounds.width, Math.max(-bounds.x, dx));
  const clampedDy = Math.min(paper.heightMm - bounds.y - bounds.height, Math.max(-bounds.y, dy));
  return {
    ...template,
    elements: template.elements.map((element) =>
      isMovable(element, ids)
        ? { ...element, x: roundMm(element.x + clampedDx), y: roundMm(element.y + clampedDy) }
        : element,
    ),
  };
}

/** 选框的 8 个控制点：四个角和四条边的中点。 */
export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
/** `RESIZE_HANDLES` 里的一个：两个字母是角，一个字母是边的中点。 */
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** 拖控制点改框：只动这个控制点所在的边，对边不动；不小于最小尺寸、不出纸。 */
export function resizeBox(start: Box, handle: ResizeHandle, dx: number, dy: number, paper: PaperSize): Box {
  const min = CANVAS_LIMITS.minSizeMm;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) {
    left = Math.min(right - min, Math.max(0, left + dx));
  }
  if (handle.includes('e')) {
    right = Math.max(left + min, Math.min(paper.widthMm, right + dx));
  }
  if (handle.includes('n')) {
    top = Math.min(bottom - min, Math.max(0, top + dy));
  }
  if (handle.includes('s')) {
    bottom = Math.max(top + min, Math.min(paper.heightMm, bottom + dy));
  }
  return { x: roundMm(left), y: roundMm(top), width: roundMm(right - left), height: roundMm(bottom - top) };
}

/**
 * 转到新的直角：框是转过之后的外框，横竖互换时（0 ↔ 90 这类）以中心为准交换宽高，再收进纸内；
 * 转半圈（0 ↔ 180）框不变。
 */
export function rotateElement(template: CanvasTemplate, id: string, rotation: Rotation): CanvasTemplate {
  return {
    ...template,
    elements: template.elements.map((element) => {
      if (element.id !== id) {
        return element;
      }
      if ((element.rotation - rotation) % 180 === 0) {
        return { ...element, rotation };
      }
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      const box = clampBox(
        {
          x: centerX - element.height / 2,
          y: centerY - element.width / 2,
          width: element.height,
          height: element.width,
        },
        template.paper,
      );
      return withBox({ ...element, rotation }, box);
    }),
  };
}

/** 新元素的 id：e1、e2……取第一个没用过的（符合 sanitize-canvas 的 id 规则：字母、数字、连字符）。 */
export function newElementId(elements: readonly CanvasElement[]): string {
  const used = new Set(elements.map((element) => element.id));
  let number = 1;
  while (used.has(`e${number}`)) {
    number += 1;
  }
  return `e${number}`;
}

/** 名字末尾的编号（「文字 2」的「 2」）：再编号时去掉，不会变成「文字 2 2」。 */
const NAME_NUMBER_PATTERN = / \d+$/;

/**
 * 不和别的元素重名：重名时在末尾加编号（文字 → 文字 2 → 文字 3）。打印前检查用名字指出是哪个元素，重名就分不清。
 * 名字有长度上限，太长时截掉前面部分的末尾给编号让位。
 */
export function uniqueName(name: string, elements: readonly CanvasElement[]): string {
  const used = new Set(elements.map((element) => element.name));
  if (!used.has(name)) {
    return name;
  }
  // 末尾的数字只在它本身就是一轮编号时才去掉：比如「文字 2」的「 2」，因为「文字」也在用，说明这是重编号；
  // 不然这串数字是名字本身的内容（比如「尺码 38」），原样当 base，不能把 38 丢掉变成「尺码 2」。
  const stripped = name.replace(NAME_NUMBER_PATTERN, '');
  const base = stripped !== name && used.has(stripped) ? stripped : name;
  const numbered = (number: number) => {
    const suffix = ` ${number}`;
    return `${base.slice(0, CANVAS_LIMITS.nameLength - suffix.length)}${suffix}`;
  };
  let number = 2;
  while (used.has(numbered(number))) {
    number += 1;
  }
  return numbered(number);
}

/** 加一个元素，中心放在 center（默认纸的中心），收进纸内，放在最上层；已到元素上限时返回 null（界面提示）。 */
export function addElement(template: CanvasTemplate, kind: CanvasElementKind, center?: Point): Added | null {
  if (template.elements.length >= CANVAS_LIMITS.elements) {
    return null;
  }
  const id = newElementId(template.elements);
  const created = newCanvasElement(kind, id, template.paper);
  const at = center ?? { x: template.paper.widthMm / 2, y: template.paper.heightMm / 2 };
  const box = clampBox(
    { ...boxOf(created), x: at.x - created.width / 2, y: at.y - created.height / 2 },
    template.paper,
  );
  const element = withBox({ ...created, name: uniqueName(created.name, template.elements) }, box);
  return { template: { ...template, elements: [...template.elements, element] }, ids: [id], skippedImages: 0 };
}

/** 删掉选中的（锁定的留着）；没有能删的原样返回。 */
export function deleteElements(template: CanvasTemplate, ids: readonly string[]): CanvasTemplate {
  const kept = template.elements.filter((element) => !isMovable(element, ids));
  return kept.length === template.elements.length ? template : { ...template, elements: kept };
}

/** 对齐方式，和属性栏的分段按钮一一对应。 */
export const ALIGNMENTS = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
/** `ALIGNMENTS` 里的一种。 */
export type Alignment = (typeof ALIGNMENTS)[number];

/** 安全区：纸边往里 1.5mm（再往外，打印前检查会提示「靠近纸边」）。 */
function safeArea(paper: PaperSize): Box {
  const margin = CANVAS_LIMITS.safeMarginMm;
  return { x: margin, y: margin, width: paper.widthMm - 2 * margin, height: paper.heightMm - 2 * margin };
}

function aligned(box: Box, target: Box, alignment: Alignment): Box {
  switch (alignment) {
    case 'left':
      return { ...boxOf(box), x: target.x };
    case 'center':
      return { ...boxOf(box), x: target.x + (target.width - box.width) / 2 };
    case 'right':
      return { ...boxOf(box), x: target.x + target.width - box.width };
    case 'top':
      return { ...boxOf(box), y: target.y };
    case 'middle':
      return { ...boxOf(box), y: target.y + (target.height - box.height) / 2 };
    case 'bottom':
      return { ...boxOf(box), y: target.y + target.height - box.height };
  }
}

/**
 * 对齐：选一个时对齐到安全区（单个元素居中、靠边是最常用的）；选几个时对齐到它们合起来的外框。
 * 锁定的不动，但算进外框（拿它当基准对齐别的元素）。
 */
export function alignElements(template: CanvasTemplate, ids: readonly string[], alignment: Alignment): CanvasTemplate {
  const selected = template.elements.filter((element) => ids.includes(element.id));
  const target = selected.length === 1 ? safeArea(template.paper) : boundsOf(selected);
  if (target === null) {
    return template;
  }
  return {
    ...template,
    elements: template.elements.map((element) =>
      isMovable(element, ids)
        ? withBox(element, clampBox(aligned(element, target, alignment), template.paper))
        : element,
    ),
  };
}

/** 等距的方向：横向按 x 排一行，纵向按 y 排一列。 */
export type DistributeAxis = 'horizontal' | 'vertical';

/** 「等距」至少要三个：两个之间的空隙本来就只有一个。 */
export const MIN_DISTRIBUTE_COUNT = 3;

/** 等距：按位置排好，第一个和最后一个不动，中间的让相邻两个之间的空隙相等。锁定的不参与。 */
export function distributeElements(
  template: CanvasTemplate,
  ids: readonly string[],
  axis: DistributeAxis,
): CanvasTemplate {
  const isHorizontal = axis === 'horizontal';
  const startOf = (box: Box) => (isHorizontal ? box.x : box.y);
  const sizeOf = (box: Box) => (isHorizontal ? box.width : box.height);
  const moving = template.elements.filter((element) => isMovable(element, ids)).sort((a, b) => startOf(a) - startOf(b));
  const first = moving[0];
  const last = moving.at(-1);
  if (moving.length < MIN_DISTRIBUTE_COUNT || first === undefined || last === undefined) {
    return template;
  }
  const span = startOf(last) + sizeOf(last) - startOf(first);
  const gap = (span - moving.reduce((sum, element) => sum + sizeOf(element), 0)) / (moving.length - 1);
  const positions = new Map<string, number>();
  if (gap < 0) {
    // 元素本身比首尾之间的空间还宽，按边对齐已经没有空隙可分：改成按中心点等距，至少顺序不乱、间距均匀。
    const centerOf = (box: Box) => startOf(box) + sizeOf(box) / 2;
    const centerStep = (centerOf(last) - centerOf(first)) / (moving.length - 1);
    moving.forEach((element, index) => {
      positions.set(element.id, centerOf(first) + centerStep * index - sizeOf(element) / 2);
    });
  } else {
    let cursor = startOf(first);
    for (const element of moving) {
      positions.set(element.id, cursor);
      cursor += sizeOf(element) + gap;
    }
  }
  return {
    ...template,
    elements: template.elements.map((element) => {
      const at = positions.get(element.id);
      if (at === undefined) {
        return element;
      }
      const box = isHorizontal ? { ...boxOf(element), x: at } : { ...boxOf(element), y: at };
      return withBox(element, clampBox(box, template.paper));
    }),
  };
}

/** 置顶：选中的按原来的先后挪到最上层（数组末尾就是最上层）。 */
export function bringToFront(template: CanvasTemplate, ids: readonly string[]): CanvasTemplate {
  const picked = template.elements.filter((element) => ids.includes(element.id));
  const rest = template.elements.filter((element) => !ids.includes(element.id));
  return { ...template, elements: [...rest, ...picked] };
}

/** 置底：选中的按原来的先后挪到最下层。 */
export function sendToBack(template: CanvasTemplate, ids: readonly string[]): CanvasTemplate {
  const picked = template.elements.filter((element) => ids.includes(element.id));
  const rest = template.elements.filter((element) => !ids.includes(element.id));
  return { ...template, elements: [...picked, ...rest] };
}

/**
 * 上移一层：每个选中的元素和它上面紧挨着的一个没选中的元素换位置（一次只挪一层，选中的几个相对顺序不变）。
 * 已经在最上面、没有可换的时原样返回。
 */
export function bringForward(template: CanvasTemplate, ids: readonly string[]): CanvasTemplate {
  const elements = [...template.elements];
  let changed = false;
  // 从上往下扫：上面的先挪，下面的选中元素才不会被刚挪上来的同伴挡住。
  for (let index = elements.length - 2; index >= 0; index -= 1) {
    const current = elements[index];
    const above = elements[index + 1];
    if (current && above && ids.includes(current.id) && !ids.includes(above.id)) {
      elements[index] = above;
      elements[index + 1] = current;
      changed = true;
    }
  }
  return changed ? { ...template, elements } : template;
}

/** 下移一层：和上移一层对称。已经在最下面时原样返回。 */
export function sendBackward(template: CanvasTemplate, ids: readonly string[]): CanvasTemplate {
  const elements = [...template.elements];
  let changed = false;
  for (let index = 1; index < elements.length; index += 1) {
    const current = elements[index];
    const below = elements[index - 1];
    if (current && below && ids.includes(current.id) && !ids.includes(below.id)) {
      elements[index] = below;
      elements[index - 1] = current;
      changed = true;
    }
  }
  return changed ? { ...template, elements } : template;
}

/** 把一个元素挪到数组里的 index（0 是最下层）：图层列表拖动排序用。没有这个元素或位置没变时原样返回。 */
export function moveLayer(template: CanvasTemplate, id: string, index: number): CanvasTemplate {
  const from = template.elements.findIndex((element) => element.id === id);
  const to = Math.max(0, Math.min(template.elements.length - 1, index));
  const moving = template.elements[from];
  if (moving === undefined || from === to) {
    return template;
  }
  const rest = template.elements.filter((element) => element.id !== id);
  return { ...template, elements: [...rest.slice(0, to), moving, ...rest.slice(to)] };
}

/** 粘贴往右下错开 2mm：和原来的叠在一起时看不出粘贴成功了。 */
export const PASTE_OFFSET_MM = 2;

/** 复制：深拷贝（之后改模板不影响剪贴板里的）。 */
export function copyElements(template: CanvasTemplate, ids: readonly string[]): CanvasElement[] {
  return template.elements.filter((element) => ids.includes(element.id)).map((element) => structuredClone(element));
}

/** 一组元素里，图片的灰度像素总字节数（粗略的「总量」口径，和 sanitize-canvas 一致：宽 × 高，一像素一字节）。 */
function imageBytesOf(elements: readonly CanvasElement[]): number {
  return elements.reduce(
    (sum, element) => (element.kind === 'image' ? sum + element.pixelWidth * element.pixelHeight : sum),
    0,
  );
}

/**
 * 粘贴：换新 id、名字加编号、不带锁定；整组按同一个偏移错开（和 `moveBy` 一样，偏移先收进「整组都还在纸上」
 * 以内），不会像逐个收边那样把组里的间距挤没。超出元素上限的部分不贴；图片会把模板的图片总量推过
 * `CANVAS_LIMITS.templateImageBytes` 时也不贴，算进 `skippedImages`，调用方据此提示用户。
 */
export function pasteElements(
  template: CanvasTemplate,
  clip: readonly CanvasElement[],
  offsetMm: number = PASTE_OFFSET_MM,
): Added {
  const { paper } = template;
  const room = Math.max(0, CANVAS_LIMITS.elements - template.elements.length);
  const bounds = boundsOf(clip);
  const offsetX =
    bounds === null ? offsetMm : Math.min(paper.widthMm - bounds.x - bounds.width, Math.max(-bounds.x, offsetMm));
  const offsetY =
    bounds === null ? offsetMm : Math.min(paper.heightMm - bounds.y - bounds.height, Math.max(-bounds.y, offsetMm));
  const elements = [...template.elements];
  const ids: string[] = [];
  let imageBytes = imageBytesOf(elements);
  let skippedImages = 0;
  for (const source of clip.slice(0, room)) {
    if (source.kind === 'image') {
      const bytes = source.pixelWidth * source.pixelHeight;
      if (imageBytes + bytes > CANVAS_LIMITS.templateImageBytes) {
        skippedImages += 1;
        continue;
      }
      imageBytes += bytes;
    }
    const id = newElementId(elements);
    const copy: CanvasElement = {
      ...structuredClone(source),
      id,
      name: uniqueName(source.name, elements),
      locked: false,
    };
    const box = clampBox({ ...boxOf(source), x: source.x + offsetX, y: source.y + offsetY }, paper);
    elements.push(withBox(copy, box));
    ids.push(id);
  }
  return { template: { ...template, elements }, ids, skippedImages };
}

/** 复制一份（Ctrl+D）：等于复制再粘贴，但不动设计器的剪贴板。 */
export function duplicateElements(template: CanvasTemplate, ids: readonly string[]): Added {
  return pasteElements(template, copyElements(template, ids));
}

/** 两个角（任意顺序）围成的框：框选用。 */
export function rectFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** 框选：和选框有重叠的元素（细线、小元素不用整个框住），按上下层顺序。 */
export function elementsInRect(template: CanvasTemplate, rect: Box): string[] {
  return template.elements
    .filter(
      (element) =>
        element.x < rect.x + rect.width &&
        element.x + element.width > rect.x &&
        element.y < rect.y + rect.height &&
        element.y + element.height > rect.y,
    )
    .map((element) => element.id);
}
