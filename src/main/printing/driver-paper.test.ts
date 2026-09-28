import { describe, expect, test } from 'bun:test';
import { cupsPrinterUri, parseCimPaper, parseIppPaper } from './driver-paper';

describe('parseCimPaper (Windows)', () => {
  test('converts tenths of a millimetre and keeps the resolution', () => {
    expect(parseCimPaper('{"PaperWidth":600,"PaperLength":400,"HorizontalResolution":203}\r\n')).toEqual({
      widthMm: 60,
      heightMm: 40,
      dpi: 203,
    });
    // 在 Windows 真机上对「Microsoft Print to PDF」实测的输出（A4、600dpi）。
    expect(parseCimPaper('{"PaperWidth":2100,"PaperLength":2970,"HorizontalResolution":600}')).toEqual({
      widthMm: 210,
      heightMm: 297,
      dpi: 600,
    });
  });

  test('keeps the size when the driver does not report a resolution', () => {
    expect(parseCimPaper('{"PaperWidth":600,"PaperLength":400,"HorizontalResolution":null}')).toEqual({
      widthMm: 60,
      heightMm: 40,
      dpi: null,
    });
  });

  test('returns null when the printer or its paper size is missing', () => {
    expect(parseCimPaper('')).toBeNull();
    expect(parseCimPaper('{"PaperWidth":null,"PaperLength":400,"HorizontalResolution":203}')).toBeNull();
    expect(parseCimPaper('{"PaperWidth":0,"PaperLength":0,"HorizontalResolution":203}')).toBeNull();
  });

  test('returns null for output that is not the expected JSON object', () => {
    expect(parseCimPaper('Get-CimInstance : Access denied')).toBeNull();
    expect(parseCimPaper('null')).toBeNull();
    expect(parseCimPaper('"600"')).toBeNull();
  });
});

describe('parseIppPaper (macOS)', () => {
  // 在 macOS 真机上对一台 USB 打印机实测的 ipptool 输出片段（A4、360dpi）。
  const A4_OUTPUT = [
    '        printer-state (enum) = idle',
    '        media-default (keyword) = iso_a4_210x297mm',
    '        media-col-default (collection) = {media-size={x-dimension=20997 y-dimension=29697} media-bottom-margin=296 media-left-margin=296 media-right-margin=296 media-top-margin=296}',
    '        printer-resolution-default (resolution) = 360dpi',
  ].join('\n');

  test('converts hundredths of a millimetre and reads the resolution', () => {
    expect(parseIppPaper(A4_OUTPUT)).toEqual({ widthMm: 209.97, heightMm: 296.97, dpi: 360 });
  });

  test('reads a 60×40mm label and an asymmetric resolution', () => {
    const output = [
      'media-col-default (collection) = {media-size={x-dimension=6000 y-dimension=4000} media-top-margin=0}',
      'printer-resolution-default (resolution) = 203x203dpi',
    ].join('\n');
    expect(parseIppPaper(output)).toEqual({ widthMm: 60, heightMm: 40, dpi: 203 });
  });

  test('returns null when the printer reports no default media size', () => {
    expect(parseIppPaper('')).toBeNull();
    expect(parseIppPaper('printer-resolution-default (resolution) = 203dpi')).toBeNull();
  });
});

describe('cupsPrinterUri', () => {
  test('encodes the queue name into a local IPP URI', () => {
    expect(cupsPrinterUri('Label_Printer')).toBe('ipp://localhost/printers/Label_Printer');
    expect(cupsPrinterUri('a/b?c#d')).toBe('ipp://localhost/printers/a%2Fb%3Fc%23d');
  });
});
