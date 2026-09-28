import { describe, expect, test } from 'bun:test';
import type { PrintFailureReason } from '../core/types';
import type { PhonePrintResult } from './mobile-protocol';
import { type PrintMode, printResultCue } from './print-cues';
import type { PrinterIssue } from './printer-readiness';
import type { VoiceCue } from './voice';

const failed = (reason: PrintFailureReason, issue?: PrinterIssue) => ({ status: 'failed', reason, issue }) as const;

describe('printResultCue', () => {
  test('names how a printed label was started', () => {
    const cases: [PrintMode, VoiceCue][] = [
      ['scan', 'printed'],
      ['force', 'forced'],
      ['history', 'reprinted'],
      ['test', 'testPrinted'],
    ];
    for (const [mode, cue] of cases) {
      expect(printResultCue({ status: 'printed' }, mode)).toBe(cue);
    }
  });

  test('tells a label still printing from one printed within the window', () => {
    expect(printResultCue({ status: 'duplicate', recent: { state: 'printing', at: 0 } }, 'scan')).toBe('stillPrinting');
    expect(printResultCue({ status: 'duplicate', recent: { state: 'printed', at: 0 } }, 'scan')).toBe('duplicate');
  });

  test('reports unreadable content', () => {
    expect(printResultCue({ status: 'invalid' }, 'scan')).toBe('invalid');
  });

  test('names the printer issue when the printer is not ready', () => {
    const cases: [PrinterIssue, VoiceCue][] = [
      ['paperOut', 'paperOut'],
      ['paperJam', 'paperJam'],
      ['doorOpen', 'doorOpen'],
      ['offline', 'printerOffline'],
      ['other', 'printerNotReady'],
    ];
    for (const [issue, cue] of cases) {
      expect(printResultCue(failed('PRINTER_NOT_READY', issue), 'scan')).toBe(cue);
    }
    expect(printResultCue(failed('PRINTER_NOT_READY'), 'scan')).toBe('printerNotReady');
  });

  test('maps the other failure reasons', () => {
    const cases: [PrintFailureReason, VoiceCue][] = [
      ['PRINTER_NOT_FOUND', 'printerNotFound'],
      ['PRINT_TIMEOUT', 'timeout'],
      ['PRINT_ERROR', 'failed'],
      ['LOOKUP_FAILED', 'lookupFailed'],
    ];
    for (const [reason, cue] of cases) {
      expect(printResultCue(failed(reason), 'scan')).toBe(cue);
    }
  });

  test('accepts the trimmed result a phone receives', () => {
    const result: PhonePrintResult = { status: 'failed', reason: 'PRINTER_NOT_READY', detail: null, issue: null };
    expect(printResultCue(result, 'scan')).toBe('printerNotReady');
  });

  test('asks for a printer when the desktop has none selected', () => {
    const result: PhonePrintResult = { status: 'no-printer' };
    expect(printResultCue(result, 'scan')).toBe('noPrinter');
  });
});
