import { describe, expect, test } from 'bun:test';
import { resolvePrinter } from './resolve-printer';

const LABEL = { paper: { widthMm: 60, heightMm: 40 }, printer: null };
const WAYBILL = { paper: { widthMm: 100, heightMm: 180 }, printer: null };
const ASSIGNED = { '60x40': '标签机A', '100x180': '面单机B' };
const INSTALLED = ['标签机A', '面单机B', '面单机C'];

describe('resolvePrinter', () => {
  test('sends each paper to the printer assigned to it', () => {
    expect(resolvePrinter(LABEL, ASSIGNED, INSTALLED)).toEqual({ printerName: '标签机A', reason: 'paper' });
    expect(resolvePrinter(WAYBILL, ASSIGNED, INSTALLED)).toEqual({ printerName: '面单机B', reason: 'paper' });
  });

  test('prefers the printer the template names', () => {
    expect(resolvePrinter({ ...WAYBILL, printer: '面单机C' }, ASSIGNED, INSTALLED)).toEqual({
      printerName: '面单机C',
      reason: 'template',
    });
  });

  // 打印机改了名、数据库搬到别的电脑：不能打到不相关的打印机上，退回按纸张分配并说明原因。
  test('falls back to the paper assignment when the named printer is not here', () => {
    expect(resolvePrinter({ ...WAYBILL, printer: '别的电脑上的打印机' }, ASSIGNED, INSTALLED)).toEqual({
      printerName: '面单机B',
      reason: 'template-missing',
      missingPrinter: '别的电脑上的打印机',
    });
  });

  test('has no printer when the paper is not assigned', () => {
    expect(resolvePrinter({ paper: { widthMm: 100, heightMm: 150 }, printer: null }, ASSIGNED, INSTALLED)).toEqual({
      printerName: null,
      reason: 'unassigned',
      paperKey: '100x150',
      missingPrinter: null,
    });
  });

  test('says both things when the named printer is missing and the paper is unassigned', () => {
    const target = { paper: { widthMm: 100, heightMm: 150 }, printer: '面单机D' };
    expect(resolvePrinter(target, ASSIGNED, INSTALLED)).toEqual({
      printerName: null,
      reason: 'unassigned',
      paperKey: '100x150',
      missingPrinter: '面单机D',
    });
  });

  test('matches a paper assigned as a slightly different size', () => {
    const choice = resolvePrinter({ paper: { widthMm: 60.3, heightMm: 40 }, printer: null }, ASSIGNED, INSTALLED);
    expect(choice.printerName).toBe('标签机A');
  });

  // 分配到的打印机拔掉了：不悄悄换打印机，照样交给它，由适配器报「找不到打印机」（和现在一样）。
  test('keeps an assigned printer even when it is not installed', () => {
    expect(resolvePrinter(LABEL, ASSIGNED, []).printerName).toBe('标签机A');
  });
});
