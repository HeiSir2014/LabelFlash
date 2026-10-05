import { useCallback, useReducer } from 'react';
import { SAMPLE_LABEL_RAW } from '../../../shared/sample-label';
import type { LibrarySampleBinding } from '../lib/template-library';

/**
 * 模板页的「预览内容」：默认跟着最近一次扫码（还没扫过就用示例），
 * 用户改过之后保持用户的内容，不再被新的扫码覆盖。
 * 「用这个模板」从模板库复制出的模板先按模板库的示例数据预览（library，连内容一起存进绑定里）；
 * 绑定只在正在查看那一个模板时生效——切到别的模板，预览内容照常跟着扫码走，不会卡在示例上。
 * 打字或扫码（reduceSampleContent 的 change）就解除绑定，回到按内容识别。
 * 状态和算值都拆成纯函数（reduceSampleContent、sampleContentValue），不用渲染就能测。
 */

export interface SampleContentState {
  custom: string | null;
  library: LibrarySampleBinding | null;
}

export type SampleContentAction =
  | { type: 'change'; value: string }
  | { type: 'show-library-sample'; binding: LibrarySampleBinding };

const INITIAL_SAMPLE_CONTENT_STATE: SampleContentState = { custom: null, library: null };

/** 打字、扫码：记下用户的内容，解除模板库示例的绑定（不管现在绑的是不是正看着的模板）。 */
export function reduceSampleContent(state: SampleContentState, action: SampleContentAction): SampleContentState {
  switch (action.type) {
    case 'change':
      return { custom: action.value, library: null };
    case 'show-library-sample':
      return { ...state, library: action.binding };
  }
}

/**
 * 「预览内容」实际显示、用来识别的值：绑定的示例只在查看绑定的那个模板时生效；
 * 没生效或没绑定时，按用户输入、最近一次扫码、内置示例依次退回。
 */
export function sampleContentValue(
  state: SampleContentState,
  templateId: string | null,
  latestScanRaw: string | null,
): string {
  if (state.library !== null && state.library.templateId === templateId) {
    return state.library.content;
  }
  return state.custom ?? latestScanRaw ?? SAMPLE_LABEL_RAW;
}

/** @param templateId 正在预览的模板（草稿或选中的那个）；绑定的示例只对它生效。 */
export function useSampleContent(latestScanRaw: string | null, templateId: string | null) {
  const [state, dispatch] = useReducer(reduceSampleContent, INITIAL_SAMPLE_CONTENT_STATE);
  const onChange = useCallback((value: string) => dispatch({ type: 'change', value }), []);
  /** 复制出 binding.templateId 之后：预览内容显示示例数据的完整内容，预览、试打用示例数据。 */
  const showLibrarySample = useCallback(
    (binding: LibrarySampleBinding) => dispatch({ type: 'show-library-sample', binding }),
    [],
  );
  return {
    value: sampleContentValue(state, templateId, latestScanRaw),
    library: state.library,
    onChange,
    showLibrarySample,
  };
}
