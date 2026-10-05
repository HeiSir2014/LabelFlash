import { describe, expect, test } from 'bun:test';
import { SAMPLE_LABEL_RAW } from '../../../shared/sample-label';
import { reduceSampleContent, type SampleContentState, sampleContentValue } from './use-sample-content';

const INITIAL: SampleContentState = { custom: null, library: null };
const BINDING = { templateId: 'custom:t1', libraryId: 'library:price-simple', content: '6901234567892' };

describe('sampleContentValue', () => {
  test('shows the bound library sample while viewing the template it was copied for', () => {
    const state: SampleContentState = { custom: null, library: BINDING };
    expect(sampleContentValue(state, 'custom:t1', '扫码内容')).toBe('6901234567892');
  });

  // 换了模板之后不再显示那个模板的示例，回到按最近一次扫码（或内置示例）跟随。
  test('switching templates restores the scan-following content', () => {
    const state: SampleContentState = { custom: null, library: BINDING };
    expect(sampleContentValue(state, 'custom:t2', '扫码内容')).toBe('扫码内容');
    expect(sampleContentValue(state, null, null)).toBe(SAMPLE_LABEL_RAW);
  });

  test('falls back to the user override, then the scan, then the built-in sample', () => {
    expect(sampleContentValue(INITIAL, 'custom:t1', null)).toBe(SAMPLE_LABEL_RAW);
    expect(sampleContentValue(INITIAL, 'custom:t1', '扫码内容')).toBe('扫码内容');
    expect(sampleContentValue({ custom: '手改的', library: null }, 'custom:t1', '扫码内容')).toBe('手改的');
  });
});

describe('reduceSampleContent', () => {
  // 编辑了预览内容（打字或扫码都走这条）：不管绑定是不是正看着的模板，都解除。
  test('editing the preview content clears the binding', () => {
    const bound: SampleContentState = { custom: null, library: BINDING };
    expect(reduceSampleContent(bound, { type: 'change', value: '手改的' })).toEqual({
      custom: '手改的',
      library: null,
    });
  });

  test('showing a library sample records the binding without touching custom', () => {
    expect(reduceSampleContent(INITIAL, { type: 'show-library-sample', binding: BINDING })).toEqual({
      custom: null,
      library: BINDING,
    });
  });
});
