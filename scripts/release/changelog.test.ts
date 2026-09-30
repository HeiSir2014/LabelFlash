import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import packageJson from '../../package.json';
import { changelogSection } from './changelog';

const SAMPLE = `# 更新日志

说明文字。

## 1.0.10（2026-10-01）

- 十号版本。

## 1.0.1（2026-09-29）

第一个正式版本。

- 扫码打印。

## 0.9.0

- 旧版本。
`;

describe('changelogSection', () => {
  test('takes the section of the version up to the next version', () => {
    expect(changelogSection(SAMPLE, '1.0.1')).toBe('第一个正式版本。\n\n- 扫码打印。');
  });

  test('takes the last section up to the end of the file', () => {
    expect(changelogSection(SAMPLE, '0.9.0')).toBe('- 旧版本。');
  });

  test('does not mistake a longer version for a shorter one', () => {
    expect(changelogSection(SAMPLE, '1.0.10')).toBe('- 十号版本。');
    expect(changelogSection(SAMPLE, '1.0')).toBeNull();
  });

  test('returns null for a version that has no notes', () => {
    expect(changelogSection(SAMPLE, '2.0.0')).toBeNull();
    expect(changelogSection('## 2.0.0\n\n', '2.0.0')).toBeNull();
  });
});

// 发版时发布作业用这一节当 GitHub Release 的说明，没有就不发布：改 package.json 的版本时就该写好。
test('the current version has release notes in CHANGELOG.md', () => {
  const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  expect(changelogSection(changelog, packageJson.version)).not.toBeNull();
});
