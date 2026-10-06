import { decodeIppMessage, encodeIppMessage, type IppMessage } from '../../../core/ipp/ipp-codec';

/** 一次 IPP 请求的结果。 */
export interface IppReply {
  httpStatus: number;
  headers: Headers;
  /** 回复是 application/ipp 时解出来的报文；HTTP 层就拒绝了（401、404……）时为 null。 */
  message: IppMessage | null;
}

/** 测试和 E2E 用的 IPP 客户端：把报文和文档 POST 过去，解出回复。 */
export async function sendIpp(
  url: string,
  message: IppMessage,
  data: Uint8Array = new Uint8Array(0),
  headers: Record<string, string> = {},
): Promise<IppReply> {
  const head = encodeIppMessage(message);
  const body = new Uint8Array(head.length + data.length);
  body.set(head, 0);
  body.set(data, head.length);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/ipp', ...headers },
    body,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const isIpp = (response.headers.get('content-type') ?? '').startsWith('application/ipp');
  return {
    httpStatus: response.status,
    headers: response.headers,
    message: isIpp ? decodeIppMessage(bytes).message : null,
  };
}

/** HTTP 基本认证的请求头。 */
export function basicAuth(user: string, password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
}
