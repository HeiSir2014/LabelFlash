import { describe, expect, test } from 'bun:test';
import { chooseCupsMedia, choosePrintTicketPaper, pwgMediaSize } from './paper-choice';

const LABEL = { widthMm: 60, heightMm: 40 };
const DRIVER_NS = 'urn:labelflash-test:label-driver';

describe('choosePrintTicketPaper', () => {
  test('picks the driver option of the same size, the closest one when several fit', () => {
    const options = {
      options: [
        { namespace: DRIVER_NS, localName: 'ISOA4', widthMicrons: 210_000, heightMicrons: 297_000 },
        { namespace: DRIVER_NS, localName: 'Label60x40a', widthMicrons: 60_800, heightMicrons: 40_000 },
        { namespace: DRIVER_NS, localName: 'Label60x40', widthMicrons: 60_000, heightMicrons: 40_100 },
      ],
      supportsCustom: true,
    };
    expect(choosePrintTicketPaper(options, LABEL)).toEqual({
      kind: 'option',
      namespace: DRIVER_NS,
      localName: 'Label60x40',
    });
  });

  test('falls back to a custom size, or gives up when the driver has neither', () => {
    const none = {
      options: [{ namespace: DRIVER_NS, localName: 'ISOA4', widthMicrons: 210_000, heightMicrons: 297_000 }],
    };
    expect(choosePrintTicketPaper({ ...none, supportsCustom: true }, LABEL)).toEqual({
      kind: 'custom',
      widthMicrons: 60_000,
      heightMicrons: 40_000,
    });
    expect(choosePrintTicketPaper({ ...none, supportsCustom: false }, LABEL)).toBeNull();
  });

  // 宽高要和模板的方向一致（和 checkDriverPaper 一样），40×60 的选项不算。
  test('does not take a rotated size', () => {
    const rotated = {
      options: [{ namespace: DRIVER_NS, localName: 'Label40x60', widthMicrons: 40_000, heightMicrons: 60_000 }],
      supportsCustom: false,
    };
    expect(choosePrintTicketPaper(rotated, LABEL)).toBeNull();
  });
});

describe('pwgMediaSize', () => {
  test('reads the size at the end of a PWG self-describing name', () => {
    expect(pwgMediaSize('om_60x40mm_60x40mm')).toEqual({ widthMm: 60, heightMm: 40 });
    expect(pwgMediaSize('oe_4x6-label_4x6in')).toEqual({ widthMm: 101.6, heightMm: 152.4 });
    expect(pwgMediaSize('Letter')).toBeNull();
  });
});

describe('chooseCupsMedia', () => {
  test('picks a supported media of the same size', () => {
    expect(chooseCupsMedia(['iso_a4_210x297mm', 'om_60x40mm_60x40mm'], LABEL)).toBe('om_60x40mm_60x40mm');
  });

  test('uses a custom size inside the supported range, nothing outside it', () => {
    const ranged = ['oe_4x6-label_4x6in', 'custom_min_25.4x12.7mm', 'custom_max_104x990mm'];
    expect(chooseCupsMedia(ranged, LABEL)).toBe('custom_60x40mm_60x40mm');
    expect(chooseCupsMedia(ranged, { widthMm: 120, heightMm: 40 })).toBeNull();
    expect(chooseCupsMedia(['iso_a4_210x297mm'], LABEL)).toBeNull();
  });
});
