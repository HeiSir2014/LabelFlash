import { describe, expect, test } from 'bun:test';
import { assertDeployable, CONTAINER_NAME, dockerRunArgs, imageTag, parseRunningTag, readDeployTarget } from './deploy';

const ENV = {
  RELAY_DEPLOY_SSH: 'relay-host',
  RELAY_PUBLIC_ORIGIN: 'https://relay.example.com',
  RELAY_HEALTH_URL: 'https://relay.example.com/labelflash/healthz',
};

describe('readDeployTarget', () => {
  test('reads the target from the environment', () => {
    expect(readDeployTarget(ENV)).toEqual({
      ssh: 'relay-host',
      publicOrigin: 'https://relay.example.com',
      healthUrl: 'https://relay.example.com/labelflash/healthz',
    });
  });

  test('names each missing variable', () => {
    for (const name of Object.keys(ENV)) {
      expect(() => readDeployTarget({ ...ENV, [name]: undefined })).toThrow(name);
    }
  });

  test('rejects an ssh host that could smuggle options or commands', () => {
    for (const ssh of ['-oProxyCommand=x', 'host;rm', 'a b']) {
      expect(() => readDeployTarget({ ...ENV, RELAY_DEPLOY_SSH: ssh })).toThrow('RELAY_DEPLOY_SSH');
    }
  });
});

describe('imageTag', () => {
  test('turns the build version into a valid docker tag', () => {
    expect(imageTag('1.0.1+abc1234')).toBe('1.0.1-abc1234');
  });

  test('refuses a version that could smuggle a command', () => {
    for (const version of ['1.0.1;rm -rf ~', '1.0.1 x', '-1.0.1', '']) {
      expect(() => imageTag(version)).toThrow();
    }
  });
});

describe('assertDeployable', () => {
  test('deploys a committed version that is not running yet', () => {
    expect(() => assertDeployable('1.0.1+abc1234', '1.0.1-0000000')).not.toThrow();
    expect(() => assertDeployable('1.0.1+abc1234', null)).not.toThrow();
  });

  test('refuses a build with uncommitted changes', () => {
    expect(() => assertDeployable('1.0.1+abc1234.dirty', null)).toThrow('没提交');
  });

  test('refuses to redeploy the version that is running, which would leave nothing to roll back to', () => {
    expect(() => assertDeployable('1.0.1+abc1234', '1.0.1-abc1234')).toThrow('已经在运行');
  });
});

describe('parseRunningTag', () => {
  test('reads the tag recorded on the server', () => {
    expect(parseRunningTag('1.0.1-abc1234\n')).toBe('1.0.1-abc1234');
  });

  test('ignores a missing or tampered record', () => {
    expect(parseRunningTag('')).toBeNull();
    expect(parseRunningTag('x; rm -rf ~')).toBeNull();
  });
});

describe('dockerRunArgs', () => {
  test('runs the relay locked down and reachable only from the host', () => {
    const args = dockerRunArgs('1.0.1-abc1234', 'https://relay.example.com');
    expect(args).toEqual([
      'run',
      '--detach',
      '--name',
      CONTAINER_NAME,
      '--restart',
      'unless-stopped',
      '--publish',
      '127.0.0.1:3180:3180',
      '--memory',
      '128m',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--user',
      'bun',
      '--log-opt',
      'max-size=5m',
      '--log-opt',
      'max-file=2',
      '--env',
      'PUBLIC_ORIGIN=https://relay.example.com',
      'labelflash-relay:1.0.1-abc1234',
    ]);
  });
});
