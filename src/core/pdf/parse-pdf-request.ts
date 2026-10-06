import { parsePaperKey } from '../../shared/paper-sizes';
import { IMAGE_MODES, type ImageMode } from '../templates/canvas-model';
import {
  CROP_MODES,
  type CropMode,
  type NormalizedBox,
  PDF_LIMITS,
  type PdfLayout,
  type PdfPrintRequest,
  PIECE_ID_PATTERN,
} from './pdf-model';

/** 框至少占页面宽、高的 2%：A4 上约 4×6mm，再小是手抖拖出来的。 */
export const MIN_BOX_FRACTION = 0.02;
/** 浮点误差的余量：界面算出来的右边、下边可能是 1.0000000002。 */
const EDGE_EPSILON = 1e-9;
/** 阈值 1–254：0 和 255 会让整张全白或全黑。 */
const THRESHOLD_RANGE = { min: 1, max: 254 } as const;
/** 出块编号是 UUID（主进程生成）。 */
export const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseBox(value: unknown): NormalizedBox | null {
  if (!isRecord(value)) {
    return null;
  }
  const x = value['x'];
  const y = value['y'];
  const width = value['width'];
  const height = value['height'];
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return null;
  }
  const isInside =
    x >= 0 &&
    y >= 0 &&
    width >= MIN_BOX_FRACTION &&
    height >= MIN_BOX_FRACTION &&
    x + width <= 1 + EDGE_EPSILON &&
    y + height <= 1 + EDGE_EPSILON;
  return isInside ? { x, y, width, height } : null;
}

/**
 * 渲染进程交来的裁切设置（IPC 是信任边界）：任何一项不对整个拒绝。界面只会交合法的值，
 * 不合法说明页面出了问题，不去猜它想要什么。
 */
export function parsePdfLayout(value: unknown): PdfLayout | null {
  if (!isRecord(value)) {
    return null;
  }
  const paperKey = value['paperKey'];
  const crop = value['crop'];
  const mono = value['mono'];
  const threshold = value['threshold'];
  const boxes = value['boxes'];
  if (typeof paperKey !== 'string' || parsePaperKey(paperKey) === null) {
    return null;
  }
  if (!(CROP_MODES as readonly unknown[]).includes(crop) || !(IMAGE_MODES as readonly unknown[]).includes(mono)) {
    return null;
  }
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < THRESHOLD_RANGE.min ||
    threshold > THRESHOLD_RANGE.max
  ) {
    return null;
  }
  if (!Array.isArray(boxes) || boxes.length > PDF_LIMITS.manualBoxes) {
    return null;
  }
  const parsedBoxes: NormalizedBox[] = [];
  for (const box of boxes) {
    const parsed = parseBox(box);
    if (parsed === null) {
      return null;
    }
    parsedBoxes.push(parsed);
  }
  if (crop === 'manual' && parsedBoxes.length === 0) {
    return null;
  }
  return { paperKey, crop: crop as CropMode, boxes: parsedBoxes, mono: mono as ImageMode, threshold };
}

/** 渲染进程交来的打印设置：块编号合法、不重复、不超过上限；份数 1–99。 */
export function parsePdfPrintRequest(value: unknown): PdfPrintRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const runId = value['runId'];
  const pieceIds = value['pieceIds'];
  const copies = value['copies'];
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    return null;
  }
  if (!Array.isArray(pieceIds) || pieceIds.length === 0 || pieceIds.length > PDF_LIMITS.pieces) {
    return null;
  }
  const ids: string[] = [];
  for (const id of pieceIds) {
    if (typeof id !== 'string' || !PIECE_ID_PATTERN.test(id)) {
      return null;
    }
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) {
    return null;
  }
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > PDF_LIMITS.copies) {
    return null;
  }
  return { runId, pieceIds: ids, copies };
}
