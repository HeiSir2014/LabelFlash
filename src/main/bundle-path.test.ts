import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { APP_ENTRY_URL, resolveBundlePath } from './bundle-path';

const ROOT = join('/opt', 'cdl', 'out', 'renderer');

describe('resolveBundlePath', () => {
  test('maps the entry page and assets inside the renderer bundle', () => {
    expect(resolveBundlePath(ROOT, APP_ENTRY_URL)).toBe(join(ROOT, 'index.html'));
    expect(resolveBundlePath(ROOT, 'app://bundle/assets/index-abc.js')).toBe(join(ROOT, 'assets', 'index-abc.js'));
    expect(resolveBundlePath(ROOT, 'app://bundle/assets/%E5%BE%97%E6%84%8F%E9%BB%91.woff2')).toBe(
      join(ROOT, 'assets', '得意黑.woff2'),
    );
  });

  test('rejects path traversal that survives URL parsing (encoded slashes)', () => {
    expect(resolveBundlePath(ROOT, 'app://bundle/..%2F..%2Fsecrets.txt')).toBeNull();
    expect(resolveBundlePath(ROOT, 'app://bundle/assets/..%2F..%2F..%2Fsecrets.txt')).toBeNull();
    expect(resolveBundlePath(ROOT, 'app://bundle/')).toBeNull();
  });

  test('rejects encoded backslashes and NUL on every platform', () => {
    expect(resolveBundlePath(ROOT, 'app://bundle/..%5C..%5Csecrets.txt')).toBeNull();
    expect(resolveBundlePath(ROOT, 'app://bundle/assets%5Cindex.js')).toBeNull();
    expect(resolveBundlePath(ROOT, 'app://bundle/index.html%00.js')).toBeNull();
  });

  test('dot segments are normalized by the URL parser and stay inside the bundle', () => {
    expect(resolveBundlePath(ROOT, 'app://bundle/%2e%2e/%2e%2e/secrets.txt')).toBe(join(ROOT, 'secrets.txt'));
    expect(resolveBundlePath(ROOT, 'app://bundle/../../secrets.txt')).toBe(join(ROOT, 'secrets.txt'));
  });

  test('rejects other hosts, schemes and malformed URLs', () => {
    expect(resolveBundlePath(ROOT, 'app://evil/index.html')).toBeNull();
    expect(resolveBundlePath(ROOT, 'file:///etc/passwd')).toBeNull();
    expect(resolveBundlePath(ROOT, 'app://bundle/%E0%A4%A')).toBeNull();
    expect(resolveBundlePath(ROOT, 'not a url')).toBeNull();
  });
});
