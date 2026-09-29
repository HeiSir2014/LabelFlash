import { describe, expect, test } from 'bun:test';
import { isLoopbackAddress, isLoopbackHost } from './network';

describe('isLoopbackAddress', () => {
  test('tells loopback addresses from LAN addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.8.9.10')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.20')).toBe(false);
    expect(isLoopbackAddress('::ffff:192.168.1.20')).toBe(false);
    expect(isLoopbackAddress('fe80::1')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  // 防 DNS 重绑定：网页的请求只接受本机的 Host（参考 Chrome 远程调试端口的做法）。
  test('accepts only loopback hosts on this port', () => {
    expect(isLoopbackHost('127.0.0.1:17631', 17631)).toBe(true);
    expect(isLoopbackHost('localhost:17631', 17631)).toBe(true);
    expect(isLoopbackHost('LOCALHOST:17631', 17631)).toBe(true);
    expect(isLoopbackHost('[::1]:17631', 17631)).toBe(true);
    expect(isLoopbackHost('evil.example.com:17631', 17631)).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.example.com:17631', 17631)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:80', 17631)).toBe(false);
    expect(isLoopbackHost('127.0.0.1', 17631)).toBe(false);
    expect(isLoopbackHost(undefined, 17631)).toBe(false);
  });
});
