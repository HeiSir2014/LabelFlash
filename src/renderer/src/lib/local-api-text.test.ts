import { describe, expect, test } from 'bun:test';
import type { LocalApiStatus } from '../../../shared/local-api';
import { describeApiStatus, describeCaller, describeFirewall, describeKeyUsage } from './local-api-text';

const BASE: LocalApiStatus = {
  server: { state: 'listening', port: 17631, lanEnabled: true, skippedPorts: [] },
  lanAddresses: ['192.168.1.20'],
  portOwner: null,
  authorizedOrigins: [],
  pendingOrigins: [],
};

describe('describeApiStatus', () => {
  test('lists the addresses callers can use on this computer and the LAN', () => {
    expect(describeApiStatus(BASE)).toEqual({
      tone: 'success',
      title: '正在运行',
      addresses: ['http://127.0.0.1:17631', 'http://192.168.1.20:17631'],
      detail: '局域网里的程序要带程序密钥；传输是明文 HTTP，只在可信的局域网里使用。',
    });
  });

  test('lists only this computer when the LAN is off', () => {
    const view = describeApiStatus({
      ...BASE,
      server: { state: 'listening', port: 17632, lanEnabled: false, skippedPorts: [] },
    });
    expect(view.addresses).toEqual(['http://127.0.0.1:17632']);
    expect(view.detail).toBe('只接受这台电脑上的网页和程序。');
  });

  // 端口被占用时程序自动换了端口：说清楚被谁占用、换成了哪个，已经配好旧端口的程序要跟着改。
  test('says which port it moved to and who holds the one it skipped', () => {
    expect(
      describeApiStatus({
        ...BASE,
        server: { state: 'listening', port: 51234, lanEnabled: true, skippedPorts: [17631, 17632, 17633] },
        portOwner: 'nginx',
      }),
    ).toEqual({
      tone: 'warning',
      title: '正在运行（已自动换端口）',
      addresses: ['http://127.0.0.1:51234', 'http://192.168.1.20:51234'],
      detail:
        '端口 17631、17632、17633 被别的程序（nginx）占用，已自动改用 51234。已经配好旧端口的程序要改成新端口。局域网里的程序要带程序密钥；传输是明文 HTTP，只在可信的局域网里使用。',
    });
  });

  test('names the program holding the ports', () => {
    expect(
      describeApiStatus({
        ...BASE,
        server: { state: 'failed', reason: 'PORT_IN_USE', ports: [17631, 17632, 17633] },
        portOwner: 'nginx',
      }),
    ).toEqual({
      tone: 'error',
      title: '端口被占用',
      addresses: [],
      detail: '端口 17631、17632、17633 都被别的程序（nginx）占用了：可以在下面换一个端口。',
    });
  });

  test('says when it cannot tell which program holds the port', () => {
    const view = describeApiStatus({ ...BASE, server: { state: 'failed', reason: 'PORT_IN_USE', ports: [18000] } });
    expect(view.detail).toBe('端口 18000 被别的程序占用了：可以在下面换一个端口。');
  });

  // 0 是「系统分配」，不是一个被占用的端口：不写进给人看的话里。
  test('leaves the system-assigned fallback out of the failure message', () => {
    const view = describeApiStatus({
      ...BASE,
      server: { state: 'failed', reason: 'PORT_IN_USE', ports: [17631, 17632, 0] },
    });
    expect(view.detail).toBe(
      '端口 17631、17632 都被别的程序占用了，系统也没能分配空闲端口：请重启电脑后再试，或查看日志。',
    );
  });

  test('points to the log when it failed for another reason', () => {
    expect(describeApiStatus({ ...BASE, server: { state: 'failed', reason: 'START_ERROR' } })).toEqual({
      tone: 'error',
      title: '没有运行',
      addresses: [],
      detail: '本机接口启动出错，详情已写入日志（配置中心「通用」页可以打开日志文件夹）。',
    });
  });

  test('says it has not started yet', () => {
    expect(describeApiStatus({ ...BASE, server: { state: 'off' } })).toMatchObject({ tone: 'idle', title: '没有运行' });
  });
});

describe('describeCaller', () => {
  test('shows the key name or the website of a job', () => {
    expect(describeCaller('key:k1', [{ id: 'k1', name: 'ERP', createdAt: 0, lastUsedAt: null }])).toBe('ERP');
    expect(describeCaller('key:gone', [])).toBe('已撤销的密钥');
    expect(describeCaller('origin:https://erp.example.com', [])).toBe('https://erp.example.com');
    expect(describeCaller(undefined, [])).toBeNull();
  });
});

describe('describeKeyUsage', () => {
  test('says when a key was last used', () => {
    expect(describeKeyUsage({ id: 'k', name: 'ERP', createdAt: 0, lastUsedAt: null })).toBe('还没有用过');
    expect(describeKeyUsage({ id: 'k', name: 'ERP', createdAt: 0, lastUsedAt: 0 })).toMatch(/^最后使用：/);
  });
});

describe('describeFirewall', () => {
  test('says whether other computers can get through and offers to add the rule', () => {
    expect(describeFirewall('allowed')).toEqual({
      text: '已放行本程序（专用网络和域网络）。',
      canAdd: false,
    });
    expect(describeFirewall('missing')).toEqual({
      text: 'Windows 防火墙还没有放行本程序，局域网里的电脑可能连不上。',
      canAdd: true,
    });
  });

  test('hides the row when the state is unknown', () => {
    expect(describeFirewall('unknown')).toBeNull();
  });
});
