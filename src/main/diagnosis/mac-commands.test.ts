import { describe, expect, test } from 'bun:test';
import {
  adminOsascriptArgs,
  assertQueueName,
  CUPS_FORBIDDEN_PATTERN,
  enablePrinterCommand,
  setMediaArgs,
  shellCommand,
  shellQuote,
  USER_CANCELED_PATTERN,
} from './mac-commands';

describe('shell quoting for do shell script', () => {
  test('single-quotes every argument, including quotes and $ inside it', () => {
    expect(shellQuote("O'Neil $HOME")).toBe(`'O'\\''Neil $HOME'`);
    expect(shellCommand('/usr/bin/cancel', ['-a', 'Label Printer'])).toBe("'/usr/bin/cancel' '-a' 'Label Printer'");
    expect(enablePrinterCommand('Label_Printer')).toBe(
      "'/usr/sbin/cupsenable' 'Label_Printer' && '/usr/sbin/cupsaccept' 'Label_Printer'",
    );
  });
});

describe('adminOsascriptArgs', () => {
  test('passes the command and the prompt as argv, never inside the AppleScript', () => {
    const args = adminOsascriptArgs("'/usr/bin/cancel' '-a' 'Q'", 'CDL-云签速印 要清空打印机「Q」的队列。');
    expect(args.slice(0, 6)).toEqual([
      '-e',
      'on run argv',
      '-e',
      'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges',
      '-e',
      'end run',
    ]);
    expect(args.slice(6)).toEqual(["'/usr/bin/cancel' '-a' 'Q'", 'CDL-云签速印 要清空打印机「Q」的队列。']);
  });
});

describe('guards', () => {
  test('rejects queue names that a command would read as an option', () => {
    expect(() => assertQueueName('-a')).toThrow('queue name');
    expect(() => assertQueueName('')).toThrow('queue name');
    expect(() => assertQueueName('Label_Printer')).not.toThrow();
  });

  test('only sets media names that look like PWG keywords', () => {
    expect(setMediaArgs('Label_Printer', 'om_60x40mm_60x40mm')).toEqual([
      '-p',
      'Label_Printer',
      '-o',
      'media-default=om_60x40mm_60x40mm',
    ]);
    expect(() => setMediaArgs('Label_Printer', 'a b')).toThrow('media');
  });

  test('recognizes a refused CUPS request and a canceled password prompt', () => {
    expect(CUPS_FORBIDDEN_PATTERN.test('lpadmin: Forbidden')).toBe(true);
    expect(CUPS_FORBIDDEN_PATTERN.test('cupsenable: Unauthorized')).toBe(true);
    expect(USER_CANCELED_PATTERN.test('execution error: User canceled. (-128)')).toBe(true);
  });
});
