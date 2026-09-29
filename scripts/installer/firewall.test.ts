import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIREWALL_RULE_NAME } from '../../src/shared/firewall-rule';

const ROOT = join(import.meta.dir, '..', '..');

describe('installer firewall rule', () => {
  // 卸载程序由第一段构建生成，只包含 installer.nsh，拿不到生成的常量：规则名写在里面，由这里核对。
  test('the uninstaller removes the rule by the name the app and installer create', () => {
    const script = readFileSync(join(ROOT, 'resources', 'installer.nsh'), 'utf8');
    const names = [...script.matchAll(/-DisplayName '([^']+)'/g)].map((match) => match[1]);
    expect(names).toEqual([FIREWALL_RULE_NAME, FIREWALL_RULE_NAME]);
  });
});
