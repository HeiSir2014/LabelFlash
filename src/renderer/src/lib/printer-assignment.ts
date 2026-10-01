import { type PrinterTarget, resolvePrinter } from '../../../core/printing/resolve-printer';
import type { RuleSetting } from '../../../core/scan/rule-settings';
import { isBuiltInTemplateId, type LabelTemplate } from '../../../core/templates/template-model';
import type { DriverPaper } from '../../../shared/driver-paper';
import { DEFAULT_PAPER } from '../../../shared/label-paper';
import { formatPaperName, isSamePaper, type PaperSize, paperKey, parsePaperKey } from '../../../shared/paper-sizes';

/** 分配表只用到模板的这几项。 */
export interface TemplateUse extends PrinterTarget {
  name: string;
  /** 没有打印机也不标红：没在用的内置面单（订单系统可能根本不用它，但纸张照样列出来，要用时在这里分配）。 */
  optional?: boolean;
}

/**
 * 分配表要看的模板。内置面单人人都有，没设为当前模板、也没被规则指定时算「可选」：
 * 它的纸照样列出来（订单系统经本机接口用它时在这里分配），但没有打印机不标红，不用面单的人不会看到一片红。
 */
export function templateUses(
  templates: readonly LabelTemplate[],
  activeTemplateId: string | null,
  ruleSettings: readonly RuleSetting[],
): TemplateUse[] {
  const bound = new Set(ruleSettings.flatMap((setting) => (setting.templateId ? [setting.templateId] : [])));
  return templates.map((template) => ({
    name: template.name,
    paper: template.paper,
    printer: template.printer,
    optional:
      template.kind === 'waybill' &&
      isBuiltInTemplateId(template.id) &&
      template.id !== activeTemplateId &&
      !bound.has(template.id),
  }));
}

export interface PaperRow {
  key: string;
  name: string;
  /** 分配到的打印机；没分配时为 null。 */
  printer: string | null;
  /** 没分配、而某台打印机的驱动纸张正好是这个尺寸时，建议它（只建议，不自动分配：驱动纸张可能只是出厂默认值）。 */
  suggestion: string | null;
  /** 分配到的打印机不在这台电脑上。 */
  isMissing: boolean;
  /** 用这种纸的模板都有打印机可用（分配了，或模板自己指定了本机有的打印机）；为 false 时标红。 */
  isCovered: boolean;
}

/**
 * 打印机页顶部的「纸张 → 打印机」表：模板用到的每种纸一行（按第一次出现的顺序），
 * 再加上已分配、但已经没有模板在用的纸（方便清掉）。
 */
export function paperRows(
  templates: readonly TemplateUse[],
  paperPrinters: Readonly<Record<string, string>>,
  installed: readonly string[],
  driverPaper: Readonly<Record<string, DriverPaper | null>>,
): PaperRow[] {
  const papers = new Map<string, PaperSize>();
  for (const template of templates) {
    const key = paperKey(template.paper);
    if (!papers.has(key)) {
      papers.set(key, template.paper);
    }
  }
  for (const key of Object.keys(paperPrinters)) {
    const paper = parsePaperKey(key);
    if (paper !== null && !papers.has(key)) {
      papers.set(key, paper);
    }
  }
  // 已经分配给别的纸、或被模板指定的打印机不再建议：它装的是别的纸。
  const assigned = new Set([
    ...Object.values(paperPrinters),
    ...templates.flatMap((template) => (template.printer ? [template.printer] : [])),
  ]);
  return [...papers].map(([key, paper]) => {
    const printer = paperPrinters[key] ?? null;
    const users = templates.filter((template) => paperKey(template.paper) === key && !template.optional);
    const isCovered = users.every(
      (template) => resolvePrinter(template, paperPrinters, installed).printerName !== null,
    );
    const suggestion =
      printer === null
        ? (Object.entries(driverPaper).find(
            ([name, driver]) => driver !== null && !assigned.has(name) && isSamePaper(driver, paper),
          )?.[0] ?? null)
        : null;
    return {
      key,
      name: formatPaperName(paper),
      printer,
      suggestion,
      isMissing: printer !== null && !installed.includes(printer),
      isCovered,
    };
  });
}

export interface Responsibilities {
  /** 纸张分配给了这台。 */
  papers: { key: string; name: string }[];
  /** 模板指定了这台。 */
  templates: { name: string; paperKey: string }[];
}

/** 一台打印机负责哪些纸张（纸张分配）和哪些模板（模板指定了它）。 */
export function responsibilitiesOf(
  printerName: string,
  templates: readonly TemplateUse[],
  paperPrinters: Readonly<Record<string, string>>,
): Responsibilities {
  const papers = Object.entries(paperPrinters).flatMap(([key, name]) => {
    const paper = parsePaperKey(key);
    return name === printerName && paper !== null ? [{ key, name: formatPaperName(paper) }] : [];
  });
  return {
    papers,
    templates: templates
      .filter((template) => template.printer === printerName)
      .map((template) => ({ name: template.name, paperKey: paperKey(template.paper) })),
  };
}

/** 这台打印机应该装的纸：先看纸张分配，再看指定了它的模板；都没有时为 null。 */
export function expectedPaperKey(responsibilities: Responsibilities): string | null {
  return responsibilities.papers[0]?.key ?? responsibilities.templates[0]?.paperKey ?? null;
}

/** 改一种纸的分配；printer 为 null 时删掉这一项。 */
export function withAssignment(
  paperPrinters: Readonly<Record<string, string>>,
  key: string,
  printer: string | null,
): Record<string, string> {
  const { [key]: _removed, ...rest } = paperPrinters;
  return printer === null ? rest : { ...rest, [key]: printer };
}

/** 模板实际会用的打印机（模板列表、编辑器用）。 */
export function describeTemplatePrinter(
  target: PrinterTarget,
  paperPrinters: Readonly<Record<string, string>>,
  installed: readonly string[],
  /** 系统打印机名 → 界面上显示的名字（macOS 上系统名是打印队列名）。 */
  displayName: (printerName: string) => string = (printerName) => printerName,
): string {
  const choice = resolvePrinter(target, paperPrinters, installed);
  if (choice.printerName === null) {
    return '还没有打印机';
  }
  const name = displayName(choice.printerName);
  return choice.reason === 'template-missing' ? `${name}（指定的 ${choice.missingPrinter} 不在这台电脑上）` : name;
}

/**
 * 模板列表一行里模板名下面的说明：只写和默认不同的——不是默认纸张（写纸张和这种纸打到哪台），
 * 或者模板自己指定了打印机（写实际用哪台）。默认纸张、按纸张分配的返回 null：
 * 每一行都写「60×40 标签 · 还没有打印机」是噪音，打印机的情况在标题栏和「打印机」页。
 */
export function describeTemplateUse(
  target: PrinterTarget,
  paperPrinters: Readonly<Record<string, string>>,
  installed: readonly string[],
  displayName: (printerName: string) => string = (printerName) => printerName,
): string | null {
  const printer = describeTemplatePrinter(target, paperPrinters, installed, displayName);
  if (!isSamePaper(target.paper, DEFAULT_PAPER)) {
    return `${formatPaperName(target.paper)} · ${printer}`;
  }
  return target.printer === null ? null : printer;
}
