import { describe, expect, test } from 'bun:test';
import {
  isLanClientAddress,
  isLoopbackAddress,
  isLoopbackHost,
  isSameSubnet,
  lanIPv4Addresses,
  lanIPv4Interfaces,
  plainAddress,
} from './network';

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

describe('lanIPv4Addresses', () => {
  const nic = (address: string, mac: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false) => [
    { address, family, internal, mac, netmask: '255.255.255.0' },
  ];

  // 一台装了代理、VMware、WSL 的 Windows 电脑的真实网卡：只有 WLAN 是局域网里别的电脑连得到的。
  test('keeps the physical LAN address and drops proxy, virtual machine and container adapters', () => {
    expect(
      lanIPv4Addresses({
        Mihomo: nic('198.18.0.1', '00:00:00:00:00:00'),
        'WLAN 3': nic('192.168.3.21', 'c4:75:ab:2d:6a:77'),
        'VMware Network Adapter VMnet1': nic('169.254.194.187', '00:50:56:c0:00:01'),
        'VMware Network Adapter VMnet9': nic('192.168.16.1', '00:50:56:c0:00:09'),
        'Loopback Pseudo-Interface 1': nic('127.0.0.1', '00:00:00:00:00:00', 'IPv4', true),
        'vEthernet (Default Switch)': nic('172.31.192.1', '00:15:5d:f6:39:f7'),
        'vEthernet (WSL)': nic('172.21.208.1', '00:15:5d:8c:f5:c4'),
        eth0: nic('fe80::1', 'c4:75:ab:2d:6a:77', 'IPv6'),
      }),
    ).toEqual(['192.168.3.21']);
  });

  test('drops VirtualBox, Docker, VPN and CGNAT addresses on macOS too', () => {
    expect(
      lanIPv4Addresses({
        en0: nic('10.0.0.8', 'a4:83:e7:11:22:33'),
        vboxnet0: nic('192.168.56.1', '0a:00:27:00:00:00'),
        bridge100: nic('192.168.64.1', '3e:22:fb:aa:bb:cc'),
        docker0: nic('172.17.0.1', '02:42:ac:11:00:01'),
        utun4: nic('10.8.0.2', '00:00:00:00:00:00'),
        tailscale0: nic('100.101.102.103', '00:00:00:00:00:00'),
      }),
    ).toEqual(['10.0.0.8']);
  });

  // 规则判断不了的环境（全被当成虚拟的）：宁可多列，也不能一个地址都不给。
  test('falls back to every external address when all of them look virtual', () => {
    expect(
      lanIPv4Addresses({
        'vEthernet (External)': nic('192.168.1.50', '00:15:5d:01:02:03'),
        link: nic('169.254.1.1', '00:15:5d:01:02:04'),
      }),
    ).toEqual(['192.168.1.50']);
  });
});

describe('isLanClientAddress', () => {
  test('accepts private, link-local and loopback IPv4 addresses, mapped or not', () => {
    for (const address of [
      '192.168.1.23',
      '10.0.0.5',
      '172.16.3.4',
      '172.31.255.1',
      '169.254.10.2',
      '127.0.0.1',
      '::ffff:192.168.1.23',
    ]) {
      expect(isLanClientAddress(address)).toBe(true);
    }
  });

  test('refuses public addresses, carrier NAT, IPv6 and nothing', () => {
    for (const address of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '198.18.0.1', '::1', 'fe80::1', '', undefined]) {
      expect(isLanClientAddress(address)).toBe(false);
    }
  });
});

describe('lanIPv4Interfaces and isSameSubnet', () => {
  test('keep the netmask of each physical LAN card', () => {
    const card = (address: string, mac: string, netmask: string) => [
      { address, family: 'IPv4', internal: false, mac, netmask },
    ];
    const interfaces = {
      'Wi-Fi': card('192.168.1.10', 'a4:5e:60:00:00:01', '255.255.255.0'),
      'vEthernet (WSL)': card('172.20.0.1', '00:15:5d:00:00:01', '255.255.240.0'),
    };
    expect(lanIPv4Interfaces(interfaces)).toEqual([
      { name: 'Wi-Fi', address: '192.168.1.10', netmask: '255.255.255.0' },
    ]);
  });

  test('compare addresses under a netmask', () => {
    expect(isSameSubnet('192.168.1.10', '192.168.1.200', '255.255.255.0')).toBe(true);
    expect(isSameSubnet('192.168.1.10', '192.168.2.10', '255.255.255.0')).toBe(false);
    expect(isSameSubnet('10.1.2.3', '10.200.0.1', '255.0.0.0')).toBe(true);
  });

  test('strip the IPv4-mapped prefix', () => {
    expect(plainAddress('::ffff:192.168.1.23')).toBe('192.168.1.23');
    expect(plainAddress('192.168.1.23')).toBe('192.168.1.23');
  });
});
