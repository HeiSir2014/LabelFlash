import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES, SHELF_NUMBER_STEP } from './builtin-rules';
import { SHELF_NUMBER_PATTERN } from './image-text';
import { sanitizeRule } from './sanitize-rule';

describe('BUILT_IN_RULES', () => {
  // 货架号是样衣间的常用字段：手机扫码时不用自己建规则，内置规则就会从拍下的标签上读它。
  test('every built-in rule reads the shelf number from the label image', () => {
    for (const rule of BUILT_IN_RULES) {
      expect(rule.steps).toEqual([SHELF_NUMBER_STEP]);
    }
  });

  // 没有货架号的标签（或扫码枪、本机接口这类没有图的扫码）要和以前一样照常打印：内置规则不能拦下。
  test('prints anyway when the shelf number is not found', () => {
    expect(SHELF_NUMBER_STEP).toEqual({
      kind: 'imageText',
      output: '货架号',
      pattern: SHELF_NUMBER_PATTERN,
      flags: '',
      preferredArea: null,
      whenMissing: 'empty',
    });
  });

  test('passes the same validation as user rules', () => {
    for (const rule of BUILT_IN_RULES) {
      expect(sanitizeRule(rule, rule.id)).toEqual(rule);
    }
  });
});
