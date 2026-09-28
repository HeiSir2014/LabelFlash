import { describe, expect, test } from 'bun:test';
import { findExternalSpecifiers } from './bundle-policy';

const RUNTIME = new Set(['electron', 'fs', 'node:fs', 'node:sqlite']);
const isAllowed = (specifier: string) => RUNTIME.has(specifier);

describe('findExternalSpecifiers', () => {
  test('accepts runtime modules and relative paths', () => {
    const code = 'const a = require("electron"); const b = require("node:fs"); const c = require("./chunk.js");';
    expect(findExternalSpecifiers(code, isAllowed)).toEqual([]);
  });

  test('reports packages left outside the bundle, from require and dynamic import', () => {
    const code = 'require("qrcode"); require(\'ws\'); await import("msedge-tts"); require("qrcode");';
    expect(findExternalSpecifiers(code, isAllowed)).toEqual(['msedge-tts', 'qrcode', 'ws']);
  });

  test('does not treat look-alike identifiers as require calls', () => {
    expect(findExternalSpecifiers('const hasRequired = 1; myrequire("x");', isAllowed)).toEqual([]);
  });
});
