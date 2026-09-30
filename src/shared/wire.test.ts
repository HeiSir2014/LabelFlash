import { describe, expect, test } from 'bun:test';
import { encode } from '@msgpack/msgpack';
import { decodeWire, encodeWire, WIRE_LIMITS } from './wire';

describe('wire encoding', () => {
  // 图直接是字节：不再两次 base64（图在 JSON 里一次、加密后放进信封再一次），上传量约为原来的 56%。
  test('round-trips messages with raw bytes', () => {
    const message = { t: 'send', body: { iv: new Uint8Array([1, 2, 3]), ct: new Uint8Array(1000).fill(7) } };
    const bytes = encodeWire(message);
    expect(bytes.length).toBeLessThan(1100);
    expect(decodeWire(bytes)).toEqual(message);
  });

  test('returns null for bytes that are not one msgpack value', () => {
    expect(decodeWire(new Uint8Array([0xc1]))).toBeNull();
    expect(decodeWire(new Uint8Array([0x92, 0x01]))).toBeNull();
    expect(decodeWire(new Uint8Array([...encodeWire(1), ...encodeWire(2)]))).toBeNull();
  });

  // 收到的帧都不可信：超长的字符串、字节、数组、键值对在分配内存之前就拒绝。
  test('refuses oversized strings, bytes, arrays and maps before allocating them', () => {
    expect(decodeWire(encode('x'.repeat(WIRE_LIMITS.maxStrLength + 1)))).toBeNull();
    expect(decodeWire(encode(new Uint8Array(WIRE_LIMITS.maxBinLength + 1)))).toBeNull();
    expect(decodeWire(encode(new Array(WIRE_LIMITS.maxArrayLength + 1).fill(0)))).toBeNull();
    const map = Object.fromEntries(
      Array.from({ length: WIRE_LIMITS.maxMapLength + 1 }, (_, index) => [`k${index}`, 0]),
    );
    expect(decodeWire(encode(map))).toBeNull();
  });

  test('refuses a __proto__ key instead of changing the prototype', () => {
    // fixmap 1：键 "__proto__"，值 1。
    const key = new TextEncoder().encode('__proto__');
    const bytes = new Uint8Array([0x81, 0xa0 | key.length, ...key, 0x01]);
    expect(decodeWire(bytes)).toBeNull();
  });

  test('refuses extension types such as timestamps', () => {
    expect(decodeWire(encode(new Date(0)))).toBeNull();
  });
});
