import { describe, expect, test } from 'bun:test';
import type { IppSharingStatus } from '../../../shared/ipp-sharing';
import {
  describeClientRequest,
  describeDiscovery,
  describeRememberedClient,
  describeSharingStatus,
  needsSharingFirewall,
  printerAddresses,
} from './ipp-sharing-text';

const LISTENING: IppSharingStatus = {
  server: { state: 'listening', port: 8631, skippedPorts: [] },
  discovery: 'on',
  hostName: 'labelflash-1a2b3c4d.local',
  lanAddresses: ['192.168.1.10'],
  printers: [{ key: '60x40', name: '60×40 标签', printerName: '标签机A' }],
  portOwner: null,
  firewall: 'allowed',
  passwordSet: false,
  pendingClients: [],
  clients: [],
  activeJobs: 0,
};

describe('describeSharingStatus', () => {
  test('says off, sharing, or what is missing', () => {
    expect(describeSharingStatus(LISTENING, false)).toMatchObject({ tone: 'idle', title: '没有开' });
    expect(describeSharingStatus(LISTENING, true)).toMatchObject({ tone: 'success', title: '正在共享' });
    expect(describeSharingStatus({ ...LISTENING, printers: [] }, true)).toMatchObject({
      tone: 'warning',
      title: '没有可共享的纸张',
    });
    expect(describeSharingStatus({ ...LISTENING, server: { state: 'held' } }, true)).toMatchObject({
      tone: 'warning',
      title: '等防火墙放行',
    });
  });

  test('explains a moved port and who took the old one', () => {
    const moved = {
      ...LISTENING,
      server: { state: 'listening' as const, port: 8632, skippedPorts: [8631] },
      portOwner: 'cupsd',
    };
    const view = describeSharingStatus(moved, true);
    expect(view.title).toBe('正在共享（已自动换端口）');
    expect(view.detail).toContain('端口 8631 被别的程序（cupsd）占用，已改用 8632');
  });

  test('explains a failure', () => {
    expect(
      describeSharingStatus(
        { ...LISTENING, server: { state: 'failed', reason: 'PORT_IN_USE', ports: [8631, 0] } },
        true,
      ).tone,
    ).toBe('error');
    expect(
      describeSharingStatus({ ...LISTENING, server: { state: 'failed', reason: 'START_ERROR' } }, true).detail,
    ).toContain('日志');
  });
});

describe('printerAddresses', () => {
  test('gives the http address Windows takes and the ipp address for other systems', () => {
    expect(printerAddresses(LISTENING, '60x40')).toEqual({
      windows: ['http://192.168.1.10:8631/printers/60x40'],
      ipp: ['ipp://192.168.1.10:8631/printers/60x40'],
    });
    expect(printerAddresses({ ...LISTENING, server: { state: 'off' } }, '60x40')).toEqual({ windows: [], ipp: [] });
  });
});

describe('describeDiscovery', () => {
  test('says whether other computers can find the printers by themselves', () => {
    expect(describeDiscovery(LISTENING)).toContain('自动发现');
    expect(describeDiscovery({ ...LISTENING, discovery: 'blocked' })).toContain('UDP 5353');
    expect(describeDiscovery({ ...LISTENING, server: { state: 'off' }, discovery: 'off' })).toBeNull();
  });
});

describe('needsSharingFirewall', () => {
  test('asks for the firewall rule when the service or discovery is held back', () => {
    expect(needsSharingFirewall(LISTENING)).toBe(false);
    expect(needsSharingFirewall({ ...LISTENING, server: { state: 'held' } })).toBe(true);
    expect(needsSharingFirewall({ ...LISTENING, discovery: 'blocked' })).toBe(true);
    expect(needsSharingFirewall({ ...LISTENING, firewall: 'missing' })).toBe(true);
  });
});

describe('client texts', () => {
  test('describe a waiting computer and a remembered one', () => {
    expect(describeClientRequest({ address: '192.168.1.23', user: 'zhang', printerName: '60×40 标签', jobs: 2 })).toBe(
      '自称用户 zhang 要打印到「60×40 标签」（2 个任务在等）。不认识这台电脑就点「拒绝」。',
    );
    expect(describeClientRequest({ address: '192.168.1.23', user: '', printerName: '60×40 标签', jobs: 1 })).toBe(
      '要打印到「60×40 标签」。不认识这台电脑就点「拒绝」。',
    );
    expect(
      describeRememberedClient({ address: '192.168.1.23', decision: 'deny', lastUser: 'zhang', decidedAt: 0 }),
    ).toContain('已拒绝，自称用户 zhang');
  });
});
