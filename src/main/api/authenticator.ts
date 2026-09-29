import { isWebOrigin } from '../../shared/local-api';
import { ApiError } from './api-error';
import { hashApiKey } from './api-keys';
import { isLoopbackAddress, isLoopbackHost } from './network';

/** 通过授权的调用方。 */
export interface Caller {
  /** 写进任务和打印记录：key:<密钥编号> 或 origin:<网站>。 */
  id: string;
  /** 显示用：密钥名称或网站。 */
  label: string;
}

export interface AuthRequest {
  remoteAddress: string | undefined;
  /** 本服务实际监听的端口（核对 Host 用）。 */
  port: number;
  /** 请求头，名字小写（和 node:http 一致）。 */
  headers: Readonly<Record<string, string | undefined>>;
}

export interface AuthenticatorDeps {
  findKeyByHash: (hash: string) => { id: string; name: string } | null;
  hasAnyKey: () => boolean;
  isOriginAuthorized: (origin: string) => boolean;
  /**
   * 把网站列进「等确认」（程序里由操作员用鼠标点允许或拒绝）；不等结果，网页先收到答复，允许后重试。
   * 返回这个网站现在的状态：等确认、刚被拒绝、等确认的网站已满。
   */
  requestOrigin: (origin: string) => 'pending' | 'denied' | 'busy';
  /** 记下密钥最后一次使用的时间（配置中心显示）。 */
  touchKey: (id: string) => void;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * 按顺序认调用方：
 * 1. 带程序密钥的，本机、局域网都认，不核对 Host（局域网程序可以用机器名访问）；
 * 2. 本机来的浏览器请求（带 Origin）：核对 Host，再看网站是否授权过，没有就弹框询问；
 * 3. 其余（局域网里不带密钥的、本机程序不带密钥的）一律要密钥。
 * Origin 由浏览器填写；本机程序也能伪造它，但本机程序本来就能操作这台电脑，这里只防网页。
 */
export class Authenticator {
  constructor(private readonly deps: AuthenticatorDeps) {}

  authenticate(request: AuthRequest): Caller {
    const authorization = request.headers['authorization'];
    if (authorization?.startsWith(BEARER_PREFIX)) {
      const key = this.deps.findKeyByHash(hashApiKey(authorization.slice(BEARER_PREFIX.length).trim()));
      if (key === null) {
        throw new ApiError('UNAUTHENTICATED', 'KEY_INVALID', '程序密钥不对或已撤销：请在电脑上的「本机接口」页查看');
      }
      this.deps.touchKey(key.id);
      return { id: `key:${key.id}`, label: key.name };
    }
    const origin = request.headers['origin'];
    if (origin !== undefined && isLoopbackAddress(request.remoteAddress)) {
      return this.authenticateWebsite(origin, request);
    }
    if (!this.deps.hasAnyKey()) {
      throw new ApiError('UNAUTHENTICATED', 'NO_KEYS_YET', '还没有程序密钥：请先在电脑上的「本机接口」页生成');
    }
    throw new ApiError('UNAUTHENTICATED', 'KEY_REQUIRED', '请在 Authorization 请求头里带上程序密钥（Bearer）');
  }

  private authenticateWebsite(origin: string, request: AuthRequest): Caller {
    if (!isLoopbackHost(request.headers['host'], request.port)) {
      throw new ApiError('PERMISSION_DENIED', 'HOST_NOT_ALLOWED', '网页请用 http://127.0.0.1 或 http://localhost 访问');
    }
    if (!isWebOrigin(origin)) {
      throw new ApiError(
        'PERMISSION_DENIED',
        'ORIGIN_UNSUPPORTED',
        '只有 http、https 网站能按网站授权：本地文件打开的网页请改用程序密钥',
      );
    }
    if (this.deps.isOriginAuthorized(origin)) {
      return { id: `origin:${origin}`, label: origin };
    }
    switch (this.deps.requestOrigin(origin)) {
      case 'denied':
        throw new ApiError('PERMISSION_DENIED', 'ORIGIN_DENIED', '操作员在电脑上拒绝了这个网站：10 分钟后可以再请求');
      case 'busy':
        throw new ApiError(
          'PERMISSION_DENIED',
          'ORIGIN_NOT_AUTHORIZED',
          '电脑上已经有几个网站在等确认：请稍后重试，或请操作员先处理',
        );
      case 'pending':
        throw new ApiError('PERMISSION_DENIED', 'ORIGIN_NOT_AUTHORIZED', '请在电脑上的程序里点「允许」，然后重试');
    }
  }
}
