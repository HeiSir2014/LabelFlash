import { resolveSizes } from '../../../core/templates/waybill-layout';
import {
  isSplit,
  type SplitDirection,
  WAYBILL_LIMITS,
  type WaybillContent,
  type WaybillNode,
  type WaybillTemplate,
  walkNodes,
} from '../../../core/templates/waybill-model';

/**
 * 面单编辑器的纯逻辑：按路径（从根开始每一层的子项序号）找格子、改格子，拆分、添加、删除、移动，
 * 以及大纲里每一项怎么写。都返回新的模板，不改原来的（React 按引用判断有没有变）。
 */

export type NodePath = readonly number[];

type Root = WaybillTemplate['root'];

export interface OutlineItem {
  path: NodePath;
  depth: number;
  /** 例如「行 · 3 格」「文字 {收件人} {收件电话}」。 */
  label: string;
  /** 例如「高 15mm」「宽 自动 30mm」。 */
  size: string;
  /** 在父分割里是最后一个：尺寸自动取剩余，不能改。 */
  isLast: boolean;
  /** 父分割的方向：决定尺寸是高还是宽。 */
  parentSplit: SplitDirection;
  node: WaybillNode;
}

/** 新拆出来的格子，内容为空。 */
const EMPTY: WaybillContent = { kind: 'empty' };

export function nodeAt(root: Root, path: NodePath): WaybillNode | null {
  let node: WaybillNode = root;
  for (const index of path) {
    if (!isSplit(node.body)) {
      return null;
    }
    const child: WaybillNode | undefined = node.body.children[index];
    if (!child) {
      return null;
    }
    node = child;
  }
  return node;
}

/** 每个格子在版面上的实际尺寸（mm，不取整到打印点）：编辑器显示「自动：剩余 x mm」、拆分时平分都用它。 */
export function nodeExtents(template: WaybillTemplate): Map<string, { width: number; height: number }> {
  const extents = new Map<string, { width: number; height: number }>();
  const { paper, marginsMm } = template;
  const visit = (node: WaybillNode, path: NodePath, width: number, height: number) => {
    extents.set(pathKey(path), { width, height });
    if (!isSplit(node.body)) {
      return;
    }
    const { split, children } = node.body;
    const sizes = resolveSizes(
      children.map((child) => child.sizeMm),
      split === 'rows' ? height : width,
    );
    children.forEach((child, index) => {
      const size = sizes[index] ?? 0;
      visit(child, [...path, index], split === 'rows' ? width : size, split === 'rows' ? size : height);
    });
  };
  visit(
    template.root,
    [],
    paper.widthMm - marginsMm.left - marginsMm.right,
    paper.heightMm - marginsMm.top - marginsMm.bottom,
  );
  return extents;
}

export function pathKey(path: NodePath): string {
  return path.join('.');
}

export function outline(template: WaybillTemplate): OutlineItem[] {
  const extents = nodeExtents(template);
  const items: OutlineItem[] = [];
  walkNodes(template.root, (node, depth, path) => {
    if (path.length === 0) {
      return;
    }
    const parent = nodeAt(template.root, path.slice(0, -1));
    if (!parent || !isSplit(parent.body)) {
      return;
    }
    const parentSplit = parent.body.split;
    const isLast = path.at(-1) === parent.body.children.length - 1;
    const extent = extents.get(pathKey(path));
    const value = extent ? (parentSplit === 'rows' ? extent.height : extent.width) : 0;
    items.push({
      path,
      depth: depth - 1,
      label: describeNode(node),
      size: `${parentSplit === 'rows' ? '高' : '宽'} ${isLast ? '自动 ' : ''}${formatMm(value)}`,
      isLast,
      parentSplit,
      node,
    });
  });
  return items;
}

export function describeNode(node: WaybillNode): string {
  if (isSplit(node.body)) {
    return `${node.body.split === 'rows' ? '上下分' : '左右分'} ${node.body.children.length} 格`;
  }
  const { content } = node.body;
  switch (content.kind) {
    case 'empty':
      return '空白';
    case 'qr':
      return `二维码 ${content.value}`.trim();
    case 'barcode':
      return `${content.vertical ? '竖排条码' : '条码'} ${content.value}`.trim();
    case 'text': {
      const text = content.paragraphs.map((paragraph) => paragraph.text).join(' / ');
      return `${content.inverse ? '反白' : '文字'} ${text}`.trim();
    }
  }
}

function formatMm(value: number): string {
  return `${Number(value.toFixed(1))}mm`;
}

export function updateNode(
  template: WaybillTemplate,
  path: NodePath,
  update: (node: WaybillNode) => WaybillNode,
): WaybillTemplate {
  const replace = (node: WaybillNode, depth: number): WaybillNode => {
    if (depth === path.length) {
      return update(node);
    }
    if (!isSplit(node.body)) {
      return node;
    }
    const index = path[depth];
    return {
      ...node,
      body: {
        ...node.body,
        children: node.body.children.map((child, i) => (i === index ? replace(child, depth + 1) : child)),
      },
    };
  };
  return { ...template, root: replace(template.root, 0) as Root };
}

/** 能不能再加格子：不超过格数上限、拆分不超过层数上限。 */
export function canAdd(template: WaybillTemplate, extraNodes: number): boolean {
  let count = 0;
  walkNodes(template.root, () => {
    count += 1;
  });
  return count + extraNodes <= WAYBILL_LIMITS.nodes;
}

export function canSplit(template: WaybillTemplate, path: NodePath): boolean {
  // 根是第 1 层；拆分后新格子在 path.length + 2 层。
  return path.length + 2 <= WAYBILL_LIMITS.depth && canAdd(template, 2);
}

/** 把一个格子拆成两半（左右或上下）：前一半保留原来的内容，后一半空白；格子本身在父分割里的尺寸不变。 */
export function splitNode(template: WaybillTemplate, path: NodePath, direction: SplitDirection): WaybillTemplate {
  const extent = nodeExtents(template).get(pathKey(path));
  if (!extent || !canSplit(template, path)) {
    return template;
  }
  const half = roundTenth((direction === 'rows' ? extent.height : extent.width) / 2);
  return updateNode(template, path, (node) => {
    if (isSplit(node.body)) {
      return node;
    }
    return {
      sizeMm: node.sizeMm,
      ruleAfter: node.ruleAfter,
      body: {
        split: direction,
        children: [
          { sizeMm: half, ruleAfter: 'solid', body: node.body },
          { sizeMm: 0, ruleAfter: 'solid', body: { content: EMPTY } },
        ],
      },
    };
  });
}

/**
 * 在一个格子后面加一格：从这一格里分出一半给新格子，其他格子的位置不动。
 * 这一格原来是最后一个（尺寸自动）时，新格子成为最后一个，这一格改成固定的一半。
 */
export function insertAfter(template: WaybillTemplate, path: NodePath): WaybillTemplate {
  const parentPath = path.slice(0, -1);
  const index = path.at(-1);
  const parent = nodeAt(template.root, parentPath);
  const extent = nodeExtents(template).get(pathKey(path));
  if (index === undefined || !parent || !isSplit(parent.body) || !extent || !canAdd(template, 1)) {
    return template;
  }
  if (parent.body.children.length >= WAYBILL_LIMITS.children) {
    return template;
  }
  const along = parent.body.split === 'rows' ? extent.height : extent.width;
  const half = roundTenth(along / 2);
  const isLast = index === parent.body.children.length - 1;
  return updateNode(template, parentPath, (node) => {
    if (!isSplit(node.body)) {
      return node;
    }
    const children = node.body.children.map((child, i) => (i === index ? { ...child, sizeMm: half } : child));
    const added: WaybillNode = {
      sizeMm: isLast ? 0 : roundTenth(along - half),
      ruleAfter: 'solid',
      body: { content: EMPTY },
    };
    children.splice(index + 1, 0, added);
    return { ...node, body: { ...node.body, children } };
  });
}

/**
 * 删除一个格子：它的尺寸让给后一个兄弟（是最后一个时让给前一个），其他格子的位置不动。
 * 删到只剩一个子项的分割收起来，由那个子项顶替它。根至少留一行。
 */
export function removeNode(template: WaybillTemplate, path: NodePath): WaybillTemplate {
  const parentPath = path.slice(0, -1);
  const index = path.at(-1);
  const parent = nodeAt(template.root, parentPath);
  if (index === undefined || !parent || !isSplit(parent.body)) {
    return template;
  }
  const siblings = parent.body.children;
  if (parentPath.length === 0 && siblings.length <= 1) {
    return template;
  }
  const removed = siblings[index];
  const children = siblings.filter((_, i) => i !== index);
  const lastIndex = children.length - 1;
  // 让出的尺寸：给原来的后一个（现在的同一位置）；删的是最后一个时，前一个变成最后一个，自动取剩余。
  const receiver = index <= lastIndex ? index : lastIndex;
  const adjusted = children.map((child, i) => {
    if (i === lastIndex) {
      return { ...child, sizeMm: 0 };
    }
    return i === receiver ? { ...child, sizeMm: roundTenth(child.sizeMm + (removed?.sizeMm ?? 0)) } : child;
  });
  return updateNode(template, parentPath, (node) => {
    const only = adjusted[0];
    if (adjusted.length === 1 && only && parentPath.length > 0) {
      return { ...only, sizeMm: node.sizeMm, ruleAfter: node.ruleAfter };
    }
    return isSplit(node.body) ? { ...node, body: { ...node.body, children: adjusted } } : node;
  });
}

/** 和前一个（-1）或后一个（+1）兄弟换位置：每个格子保持自己的实际尺寸。 */
export function moveNode(template: WaybillTemplate, path: NodePath, offset: -1 | 1): WaybillTemplate {
  const parentPath = path.slice(0, -1);
  const index = path.at(-1);
  const parent = nodeAt(template.root, parentPath);
  if (index === undefined || !parent || !isSplit(parent.body)) {
    return template;
  }
  const target = index + offset;
  const { children, split } = parent.body;
  if (target < 0 || target >= children.length) {
    return template;
  }
  const extents = nodeExtents(template);
  const sized = children.map((child, i) => {
    const extent = extents.get(pathKey([...parentPath, i]));
    const actual = extent ? (split === 'rows' ? extent.height : extent.width) : child.sizeMm;
    return { ...child, sizeMm: roundTenth(actual) };
  });
  const [moved] = sized.splice(index, 1);
  if (!moved) {
    return template;
  }
  sized.splice(target, 0, moved);
  const last = sized.length - 1;
  const reordered = sized.map((child, i) => (i === last ? { ...child, sizeMm: 0 } : child));
  return updateNode(template, parentPath, (node) =>
    isSplit(node.body) ? { ...node, body: { ...node.body, children: reordered } } : node,
  );
}

/** 编辑器里的尺寸保留到 0.1mm。 */
function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
