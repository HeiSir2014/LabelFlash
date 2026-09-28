import { describe, expect, test } from 'bun:test';
import { describePaperCheck } from './paper-text';

describe('describePaperCheck', () => {
  test('shows nothing until the driver paper is known', () => {
    expect(describePaperCheck(null)).toBeNull();
    expect(describePaperCheck({ status: 'unknown' })).toBeNull();
  });

  test('confirms a matching driver paper, with the resolution when reported', () => {
    expect(describePaperCheck({ status: 'ok', paper: { widthMm: 60, heightMm: 40, dpi: 203 } })).toEqual({
      tone: 'ok',
      text: '驱动纸张 60×40mm · 203dpi',
    });
    expect(describePaperCheck({ status: 'ok', paper: { widthMm: 60, heightMm: 40, dpi: null } })?.text).toBe(
      '驱动纸张 60×40mm',
    );
  });

  test('warns with the actual size and how to fix it', () => {
    const view = describePaperCheck({ status: 'mismatch', paper: { widthMm: 76, heightMm: 130, dpi: 203 } });
    expect(view?.tone).toBe('warning');
    expect(view?.text).toContain('驱动默认纸张是 76×130mm，不是 60×40mm');
    expect(view?.text).toContain('纸张类型选间隙纸');
  });
});
