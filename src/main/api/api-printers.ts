import type { LabelTemplate } from '../../core/templates/template-model';
import type { PrinterInfo } from '../../core/types';
import { parsePaperKey } from '../../shared/paper-sizes';
import type { PrinterReadiness } from '../../shared/printer-readiness';
import type { ApiPrinter } from './resources';

export interface ApiPrintersInput {
  installed: readonly PrinterInfo[];
  paperPrinters: Readonly<Record<string, string>>;
  templates: readonly LabelTemplate[];
  readinessOf: (printerName: string) => PrinterReadiness | null;
}

/** 接口里的打印机列表：只列这台电脑上装着的打印机，带上它负责的纸、指定了它的模板和状态。 */
export function apiPrinters(input: ApiPrintersInput): ApiPrinter[] {
  return input.installed.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName,
    papers: Object.entries(input.paperPrinters).flatMap(([key, name]) => {
      const paper = name === printer.name ? parsePaperKey(key) : null;
      return paper === null ? [] : [paper];
    }),
    templateIds: input.templates.filter((template) => template.printer === printer.name).map((template) => template.id),
    readiness: input.readinessOf(printer.name),
  }));
}
