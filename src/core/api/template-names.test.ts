import { describe, expect, test } from 'bun:test';
import { templateIdFromName, templateName } from './template-names';

describe('template names', () => {
  // 接口里用横线：冒号是 AIP 自定义方法的分隔符（templates/{id}:render）。
  test('turns template ids into API names and back', () => {
    expect(templateName('builtin:standard')).toBe('templates/builtin-standard');
    expect(templateName('custom:7a2e-01')).toBe('templates/custom-7a2e-01');
    expect(templateIdFromName('builtin-standard')).toBe('builtin:standard');
    expect(templateIdFromName('templates/custom-7a2e-01')).toBe('custom:7a2e-01');
  });

  test('rejects names that are not template names', () => {
    expect(templateIdFromName('standard')).toBeNull();
    expect(templateIdFromName('builtin-')).toBeNull();
    expect(templateIdFromName('other-x')).toBeNull();
    expect(templateIdFromName('templates/')).toBeNull();
  });
});
