import { describe, expect, test } from 'bun:test';
import { templateIdFromName, templateName } from './template-names';

describe('template names', () => {
  // 接口里用横线：冒号是 AIP 自定义方法的分隔符（templates/{id}:render）。
  test('turns template ids into API names and back', () => {
    expect(templateName('builtin:generic')).toBe('templates/builtin-generic');
    expect(templateName('custom:7a2e-01')).toBe('templates/custom-7a2e-01');
    expect(templateIdFromName('builtin-generic')).toBe('builtin:generic');
    expect(templateIdFromName('templates/custom-7a2e-01')).toBe('custom:7a2e-01');
  });

  // 对接方写死了 1.2.x 的样衣模板名的，照样能打，用的是版式相同的通用模板。
  test('reads a retired garment template name as its generic replacement', () => {
    expect(templateIdFromName('templates/builtin-standard')).toBe('builtin:generic');
    expect(templateIdFromName('builtin-qr-right')).toBe('builtin:generic-qr-right');
  });

  test('rejects names that are not template names', () => {
    expect(templateIdFromName('standard')).toBeNull();
    expect(templateIdFromName('builtin-')).toBeNull();
    expect(templateIdFromName('other-x')).toBeNull();
    expect(templateIdFromName('templates/')).toBeNull();
  });
});
