import { describe, expect, test } from 'bun:test';
import { isCompleteRoute, newRouteDraft, routesButtonLabel, routesToSave } from './template-routes';

describe('template route drafts', () => {
  test('starts a new row on the courier company, not yet complete', () => {
    const draft = newRouteDraft();
    expect(draft.field).toBe('快递公司');
    expect(isCompleteRoute(draft)).toBe(false);
  });

  test('saves only rows with a field, a value and a template, in order', () => {
    const sf = { field: '快递公司', match: 'contains' as const, value: '顺丰', templateId: 'builtin:waybill-sf-150' };
    const unfinished = { ...sf, templateId: '' };
    const blank = { ...sf, value: '  ' };
    const badField = { ...sf, field: '{x}' };
    const deppon = { ...sf, value: '德邦', templateId: 'builtin:waybill-deppon-180' };
    expect(routesToSave([sf, unfinished, blank, badField, deppon])).toEqual([sf, deppon]);
  });

  test('names the count on the card button', () => {
    expect(routesButtonLabel(0)).toBe('按字段换模板');
    expect(routesButtonLabel(2)).toBe('按字段换模板（2 条）');
  });
});
