import type { PrinterInfo } from '../../../core/types';

export function filterPrinters(printers: PrinterInfo[], query: string): PrinterInfo[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return printers;
  }
  return printers.filter(
    (printer) => printer.displayName.toLowerCase().includes(needle) || printer.name.toLowerCase().includes(needle),
  );
}
