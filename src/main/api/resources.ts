import type { PrintJob } from '../../core/api/api-model';
import { templateFields } from '../../core/api/template-fields';
import { templateName } from '../../core/api/template-names';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { PaperSize } from '../../shared/paper-sizes';
import type { PrinterReadiness } from '../../shared/printer-readiness';

const PRINT_JOB_COLLECTION = 'printJobs/';
const PRINTER_COLLECTION = 'printers/';

/** 主进程交给接口的一台打印机。 */
export interface ApiPrinter {
  /** 系统里的打印机名（提交任务时 printer 填它）。 */
  name: string;
  displayName: string;
  /** 纸张分配里分给它的纸。 */
  papers: PaperSize[];
  /** 指定了这台打印机的模板编号。 */
  templateIds: string[];
  /** null = 状态未知（没有被分配、还没查到，或 macOS）。 */
  readiness: PrinterReadiness | null;
}

export function printJobName(id: string): string {
  return `${PRINT_JOB_COLLECTION}${id}`;
}

/** 接口里的任务名（printJobs/{id}）或编号 → 编号；不是任务名时为 null。 */
export function printJobIdFromName(name: string): string | null {
  const id = name.startsWith(PRINT_JOB_COLLECTION) ? name.slice(PRINT_JOB_COLLECTION.length) : name;
  return id === '' || id.includes('/') ? null : id;
}

/** 时间用 RFC 3339（AIP-142）。 */
function timestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function paperResource(paper: PaperSize) {
  return { widthMm: paper.widthMm, heightMm: paper.heightMm };
}

export function printJobResource(job: PrintJob) {
  return {
    name: printJobName(job.id),
    template: templateName(job.templateId),
    fields: job.fields,
    content: job.content,
    copies: job.copies,
    printer: job.printer,
    requestId: job.requestId,
    state: job.state,
    sentCopies: job.sentCopies,
    failure: job.failure,
    createTime: timestamp(job.createdAt),
    updateTime: timestamp(job.updatedAt),
  };
}

export function templateResource(template: LabelTemplate) {
  const fields = templateFields(template);
  return {
    name: templateName(template.id),
    displayName: template.name,
    paper: paperResource(template.paper),
    printer: template.printer,
    fieldsMode: fields.mode,
    fieldNames: fields.names,
  };
}

export function printerResource(printer: ApiPrinter) {
  const { readiness } = printer;
  return {
    name: `${PRINTER_COLLECTION}${encodeURIComponent(printer.name)}`,
    printer: printer.name,
    displayName: printer.displayName,
    papers: printer.papers.map(paperResource),
    templates: printer.templateIds.map(templateName),
    state: readiness === null ? 'UNKNOWN' : readiness.ready ? 'READY' : 'NOT_READY',
    stateMessage: readiness !== null && !readiness.ready ? readiness.detail : null,
  };
}
