/**
 * 扫码页的状态机。页面只按状态渲染、把浏览器和连接的事件送进来，状态转换都在这里，用 bun test 测试。
 *
 * 连接状态（link）和扫码流程（screen）分开：断线重连时扫码流程停在原处，连上后接着走。
 */
import type { InvalidReason } from '../../../src/core/types';
import type { EndReason, PhonePreview, PhonePrintResult } from '../../../src/shared/mobile-protocol';

export type Screen =
  | 'no-link'
  | 'connecting'
  | 'scanning'
  | 'checking'
  | 'confirm'
  | 'printing'
  | 'result'
  | 'ended'
  | 'not-found'
  | 'taken';

/** reconnecting = 正在连中转服务；desktop-offline = 中转服务在，电脑暂时断线。 */
export type LinkState = 'online' | 'reconnecting' | 'desktop-offline';
export type CameraState = 'pending' | 'live' | 'unavailable';
export type RequestFailure = 'busy' | 'rate-limited' | 'timeout';

export type ResultContent =
  | { kind: 'print'; result: PhonePrintResult; forced: boolean }
  | { kind: 'invalid'; reason: InvalidReason };

export interface PhoneState {
  screen: Screen;
  link: LinkState;
  camera: CameraState;
  printer: string | null;
  /** 当前这张的原文：从扫到开始，直到回到取景。 */
  raw: string | null;
  preview: Extract<PhonePreview, { status: 'ok' }> | null;
  forced: boolean;
  result: ResultContent | null;
  /** 一次性的提示：请求没成功，退回上一步时说明原因。 */
  notice: string | null;
  endReason: EndReason | null;
}

export type PhoneEvent =
  | { type: 'link'; link: Exclude<LinkState, 'online'> }
  | { type: 'welcomed'; printer: string | null }
  | { type: 'camera'; camera: Exclude<CameraState, 'pending'> }
  | { type: 'decoded'; raw: string }
  | { type: 'preview-result'; result: PhonePreview }
  | { type: 'print-requested'; force: boolean }
  | { type: 'print-result'; result: PhonePrintResult }
  | { type: 'request-failed'; reason: RequestFailure }
  | { type: 'rescan' }
  | { type: 'ended'; reason: EndReason }
  | { type: 'not-found' }
  | { type: 'taken' };

const FAILURE_NOTICES: Record<RequestFailure, string> = {
  busy: '电脑正在处理上一张，请稍后再试',
  'rate-limited': '打印太频繁，请稍后再试',
  timeout: '电脑没有回应。请确认电脑上的程序还开着、网络正常，再试一次',
};

/** 打印请求超时：可能已经出纸，提醒先去看一眼，避免重复打印。 */
const PRINT_TIMEOUT_NOTICE = '没有收到打印结果，可能已经出纸。请先到打印机旁确认，再决定是否重打';

const TERMINAL_SCREENS: ReadonlySet<Screen> = new Set(['no-link', 'ended', 'not-found', 'taken']);

export function initialPhoneState(hasLink: boolean): PhoneState {
  return {
    screen: hasLink ? 'connecting' : 'no-link',
    link: 'reconnecting',
    camera: 'pending',
    printer: null,
    raw: null,
    preview: null,
    forced: false,
    result: null,
    notice: null,
    endReason: null,
  };
}

export function reducePhone(state: PhoneState, event: PhoneEvent): PhoneState {
  if (TERMINAL_SCREENS.has(state.screen)) {
    return state;
  }
  switch (event.type) {
    case 'link':
      return { ...state, link: event.link };
    case 'welcomed':
      return {
        ...state,
        link: 'online',
        printer: event.printer,
        screen: state.screen === 'connecting' ? 'scanning' : state.screen,
      };
    case 'camera':
      return { ...state, camera: event.camera };
    case 'decoded':
      if (state.screen !== 'scanning' || state.link !== 'online') {
        return state;
      }
      return { ...state, screen: 'checking', raw: event.raw, preview: null, result: null, notice: null };
    case 'preview-result':
      if (state.screen !== 'checking') {
        return state;
      }
      if (event.result.status === 'invalid') {
        return { ...state, screen: 'result', result: { kind: 'invalid', reason: event.result.reason } };
      }
      return { ...state, screen: 'confirm', preview: event.result };
    case 'print-requested':
      if ((state.screen !== 'confirm' && state.screen !== 'result') || state.raw === null) {
        return state;
      }
      return { ...state, screen: 'printing', forced: event.force, result: null, notice: null };
    case 'print-result':
      if (state.screen !== 'printing') {
        return state;
      }
      return { ...state, screen: 'result', result: { kind: 'print', result: event.result, forced: state.forced } };
    case 'request-failed':
      return failRequest(state, event.reason);
    case 'rescan':
      if (state.screen !== 'confirm' && state.screen !== 'result') {
        return state;
      }
      return { ...state, screen: 'scanning', raw: null, preview: null, result: null, notice: null, forced: false };
    case 'ended':
      return { ...state, screen: 'ended', endReason: event.reason };
    case 'not-found':
      return { ...state, screen: 'not-found' };
    case 'taken':
      return { ...state, screen: 'taken' };
  }
}

function failRequest(state: PhoneState, reason: RequestFailure): PhoneState {
  if (state.screen === 'checking') {
    return { ...state, screen: 'scanning', raw: null, notice: FAILURE_NOTICES[reason] };
  }
  if (state.screen === 'printing') {
    const notice = reason === 'timeout' ? PRINT_TIMEOUT_NOTICE : FAILURE_NOTICES[reason];
    // 从结果页重试时没有预览：退回结果页前的确认页不成立，就回到取景。
    return state.preview
      ? { ...state, screen: 'confirm', notice }
      : { ...state, screen: 'scanning', raw: null, notice };
  }
  return state;
}
