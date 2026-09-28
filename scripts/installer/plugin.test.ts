import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { NSIS_SKIN_PLUGIN, sha256Hex, verifyPluginDigest } from './plugin';

describe('nsNiuniuSkin plugin', () => {
  test('the vendored DLL is the reviewed build', async () => {
    const dll = await readFile(NSIS_SKIN_PLUGIN.path);
    expect(sha256Hex(dll)).toBe(NSIS_SKIN_PLUGIN.sha256);
  });

  test('rejects any other file with a message that names both digests', () => {
    const tampered = Buffer.from('not the plugin');
    expect(() => verifyPluginDigest(tampered)).toThrow(NSIS_SKIN_PLUGIN.sha256);
    expect(() => verifyPluginDigest(tampered)).toThrow(sha256Hex(tampered));
  });
});
