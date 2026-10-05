import { isSamePaper, type PaperSize, paperKey, parsePaperKey } from '../../shared/paper-sizes';

/** 决定打印机只需要模板的这两项。 */
export interface PrinterTarget {
  paper: PaperSize;
  printer: string | null;
}

export type PrinterChoice =
  | { printerName: string; reason: 'template' | 'paper' }
  /** 模板指定的打印机不在这台电脑上，已退回按纸张分配。 */
  | { printerName: string; reason: 'template-missing'; missingPrinter: string }
  /** 这种纸没有分配打印机（模板指定的也不在时 missingPrinter 是它的名字）：不打印。 */
  | { printerName: null; reason: 'unassigned'; paperKey: string; missingPrinter: string | null };

/**
 * 用哪台打印机：模板指定的（这台电脑上有）→ 纸张分配的 → 没有。
 * installed 是系统里的打印机名；纸张分配按宽松相等匹配（驱动和模板的尺寸可能差零点几毫米）。
 * 分配到的打印机不在系统里时照样返回它：由打印适配器报「找不到打印机」，不悄悄换成别的打印机。
 */
export function resolvePrinter(
  target: PrinterTarget,
  paperPrinters: Readonly<Record<string, string>>,
  installed: readonly string[],
): PrinterChoice {
  if (target.printer !== null && installed.includes(target.printer)) {
    return { printerName: target.printer, reason: 'template' };
  }
  const assigned = findAssigned(target.paper, paperPrinters);
  if (assigned === null) {
    return {
      printerName: null,
      reason: 'unassigned',
      paperKey: paperKey(target.paper),
      missingPrinter: target.printer,
    };
  }
  return target.printer === null
    ? { printerName: assigned, reason: 'paper' }
    : { printerName: assigned, reason: 'template-missing', missingPrinter: target.printer };
}

/**
 * 这台打印机负责哪种纸：先看纸张分配表（某种纸分配给了它），再看有没有模板直接指定它；都没有为 null。
 * 给诊断的「自动设置驱动纸张」用：目标纸张由主进程按设置和模板自己算出来，不收渲染进程报来的纸张键——
 * 打印机可以改名、设置可以被改，渲染进程算出来的「负责的纸」不能当作权威答案去改驱动的默认设置。
 */
export function responsiblePaper(
  printerName: string,
  paperPrinters: Readonly<Record<string, string>>,
  templates: readonly PrinterTarget[],
): PaperSize | null {
  const assignedKey = Object.entries(paperPrinters).find(([, name]) => name === printerName)?.[0];
  const assignedPaper = assignedKey === undefined ? null : parsePaperKey(assignedKey);
  if (assignedPaper !== null) {
    return assignedPaper;
  }
  return templates.find((template) => template.printer === printerName)?.paper ?? null;
}

function findAssigned(paper: PaperSize, paperPrinters: Readonly<Record<string, string>>): string | null {
  const exact = paperPrinters[paperKey(paper)];
  if (exact !== undefined) {
    return exact;
  }
  // 容差内有几种纸时取最接近的，不按分配表里的先后。
  let nearest: { printer: string; distance: number } | null = null;
  for (const [key, printer] of Object.entries(paperPrinters)) {
    const assigned = parsePaperKey(key);
    if (assigned === null || !isSamePaper(assigned, paper)) {
      continue;
    }
    const distance = Math.abs(assigned.widthMm - paper.widthMm) + Math.abs(assigned.heightMm - paper.heightMm);
    if (nearest === null || distance < nearest.distance) {
      nearest = { printer, distance };
    }
  }
  return nearest?.printer ?? null;
}
