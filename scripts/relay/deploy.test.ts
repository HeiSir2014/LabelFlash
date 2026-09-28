import { describe, expect, test } from 'bun:test';
import { CONTAINER_NAME, dockerRunArgs, imageTag, readDeployTarget } from './deploy';

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
    expect(imageTag('1.1.0+abc1234')).toBe('1.1.0-abc1234');
  });
});

describe('dockerRunArgs', () => {
  test('runs the relay locked down and reachable only from the host', () => {
    const args = dockerRunArgs('1.1.0-abc1234', 'https://relay.example.com');
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
      'labelflash-relay:1.1.0-abc1234',
    ]);
  });
});
