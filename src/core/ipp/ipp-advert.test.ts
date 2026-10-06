import { describe, expect, test } from 'bun:test';
import { MAX_INSTANCE_BYTES } from '../mdns/dns-sd';
import { type AdvertContext, ippAdvert } from './ipp-advert';
import { testPrinter } from './testing/ipp-requests';

const CONTEXT: AdvertContext = {
  port: 8631,
  hostName: 'labelflash-1a2b3c4d.local',
  computerName: '前台',
  productNameAscii: 'CDL-LabelFlash',
  authentication: 'none',
  serial: 1,
};

describe('ippAdvert', () => {
  test('advertises a driverless IPP Everywhere printer', () => {
    const advert = ippAdvert(testPrinter(), CONTEXT);
    expect(advert).toMatchObject({
      instance: '60×40 标签 @ 前台',
      serviceType: ['_ipp', '_tcp', 'local'],
      subtypes: ['_universal', '_print'],
      port: 8631,
    });
    const txt = new Map(advert.txt);
    expect(txt.get('rp')).toBe('printers/60x40');
    expect(txt.get('URF')).toBe('V1.4,CP1,W8,SRGB24,RS203');
    expect(txt.get('pdl')).toBe('application/pdf,image/jpeg,image/png,image/pwg-raster,image/urf');
    expect(txt.get('UUID')).toBe('3f2504e0-4f89-51d3-9a0c-0305e82c3301');
    expect(txt.get('adminurl')).toBe('http://labelflash-1a2b3c4d.local:8631/printers/60x40');
    expect(txt.get('air')).toBe('none');
    expect(txt.get('kind')).toBe('label');
  });

  test('asks for a user name and password once the share password is set', () => {
    expect(new Map(ippAdvert(testPrinter(), { ...CONTEXT, authentication: 'basic' }).txt).get('air')).toBe(
      'username,password',
    );
  });

  test('adds a number after a name conflict and keeps within 63 bytes', () => {
    expect(ippAdvert(testPrinter(), { ...CONTEXT, serial: 2 }).instance).toBe('60×40 标签 @ 前台 (2)');
    const long = ippAdvert(testPrinter(), { ...CONTEXT, computerName: '仓'.repeat(30), serial: 3 }).instance;
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(MAX_INSTANCE_BYTES);
    expect(long.endsWith(' (3)')).toBe(true);
  });
});
