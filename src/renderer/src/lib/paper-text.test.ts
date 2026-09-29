import { describe, expect, test } from 'bun:test';
import { describePaperCheck } from './paper-text';

const LABEL = { widthMm: 60, heightMm: 40 };

describe('describePaperCheck', () => {
  test('shows nothing until the driver paper is known', () => {
    expect(describePaperCheck(null, LABEL)).toBeNull();
    expect(describePaperCheck({ status: 'unknown' }, LABEL)).toBeNull();
  });

  test('confirms a matching driver paper, with the resolution when reported', () => {
    expect(describePaperCheck({ status: 'ok', paper: { widthMm: 60, heightMm: 40, dpi: 203 } }, LABEL)).toEqual({
      tone: 'ok',
      text: '驱动纸张 60×40mm · 203dpi',
    });
    expect(describePaperCheck({ status: 'ok', paper: { widthMm: 60, heightMm: 40, dpi: null } }, LABEL)?.text).toBe(
      '驱动纸张 60×40mm',
    );
  });

  test('warns with the actual size and how to fix it', () => {
    const view = describePaperCheck({ status: 'mismatch', paper: { widthMm: 76, heightMm: 130, dpi: 203 } }, LABEL);
    expect(view?.tone).toBe('warning');
    expect(view?.text).toContain('驱动默认纸张是 76×130mm，不是 60×40mm');
    expect(view?.text).toContain('纸张类型选间隙纸');
  });

  test('warns with the paper the printer is expected to hold', () => {
    const view = describePaperCheck(
      { status: 'mismatch', paper: { widthMm: 60, heightMm: 40, dpi: 203 } },
      { widthMm: 100, heightMm: 180 },
    );
    expect(view?.text).toContain('驱动默认纸张是 60×40mm，不是 100×180mm');
    expect(view?.text).toContain('设为 100×180mm');
  });

  // 没有负责任何纸张的打印机：只说驱动纸张，不提醒对不上。
  test('only describes the driver paper of a printer that holds no assigned paper', () => {
    expect(describePaperCheck({ status: 'mismatch', paper: { widthMm: 210, heightMm: 297, dpi: 600 } }, null)).toEqual({
      tone: 'ok',
      text: '驱动纸张 210×297mm · 600dpi',
    });
  });
});
