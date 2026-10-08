import { describe, expect, test } from 'bun:test';
import { PrintError } from '../../core/errors';
import { driverPrintError, PRINT_CANCELED_DETAIL } from './driver-print-failure';

describe('driverPrintError', () => {
  // 例如虚拟 PDF 打印机的「保存」对话框被关掉：没有出纸，但打印机没有坏，不能说「驱动报错」。
  test('says a canceled job was canceled, not that the driver failed', () => {
    const error = driverPrintError('Print job canceled');
    expect(error).toBeInstanceOf(PrintError);
    expect(error.reason).toBe('PRINT_ERROR');
    expect(error.info).toEqual({ detail: PRINT_CANCELED_DETAIL });
    expect(error.message).toBe('Print job canceled');
  });

  test('keeps other driver failures as they are, with the reason for the log', () => {
    const error = driverPrintError('Print job failed');
    expect(error.reason).toBe('PRINT_ERROR');
    expect(error.info).toEqual({});
    expect(error.message).toBe('Print job failed');
  });
});
