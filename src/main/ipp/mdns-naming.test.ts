import { describe, expect, test } from 'bun:test';
import {
  DISCOVERY_RETRY_LIMITS,
  discoveryRetryDelayMs,
  FIRST_NAMES,
  hostLabelFor,
  MAX_NAME_SERIAL,
  renamedAfterConflict,
} from './mdns-naming';

const HOST = ['labelflash-1a2b3c4d', 'local'];
const INSTANCE = ['60×40 标签 @ 前台', '_ipp', '_tcp', 'local'];

describe('renamedAfterConflict', () => {
  test('numbers the instance names after an instance conflict', () => {
    expect(renamedAfterConflict(FIRST_NAMES, [INSTANCE], HOST)).toEqual({ instanceSerial: 2, hostSerial: 1 });
  });

  // 主机名撞了要换主机名，不是换实例名（RFC 6762 §9）。
  test('numbers the host label after a host conflict', () => {
    expect(renamedAfterConflict(FIRST_NAMES, [['LabelFlash-1A2B3C4D', 'local']], HOST)).toEqual({
      instanceSerial: 1,
      hostSerial: 2,
    });
  });

  test('gives up for now after too many renames', () => {
    expect(renamedAfterConflict({ instanceSerial: MAX_NAME_SERIAL, hostSerial: 1 }, [INSTANCE], HOST)).toBeNull();
  });
});

describe('hostLabelFor', () => {
  test('adds the serial after the first', () => {
    expect(hostLabelFor('1a2b3c4d', 1)).toBe('labelflash-1a2b3c4d');
    expect(hostLabelFor('1a2b3c4d', 3)).toBe('labelflash-1a2b3c4d-3');
  });
});

describe('discoveryRetryDelayMs', () => {
  // 不永久放弃：越等越久，但有上限。
  test('backs off up to a cap', () => {
    expect(discoveryRetryDelayMs(0)).toBe(DISCOVERY_RETRY_LIMITS.firstMs);
    expect(discoveryRetryDelayMs(1)).toBe(DISCOVERY_RETRY_LIMITS.firstMs * 2);
    expect(discoveryRetryDelayMs(50)).toBe(DISCOVERY_RETRY_LIMITS.maxMs);
  });
});
