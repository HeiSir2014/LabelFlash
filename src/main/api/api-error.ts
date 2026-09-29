/** AIP-193 的规范错误码 → HTTP 状态码（google.rpc.Code 的 HTTP 映射）。 */
const HTTP_STATUS = {
  INVALID_ARGUMENT: 400,
  FAILED_PRECONDITION: 400,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  RESOURCE_EXHAUSTED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const;
export type CanonicalCode = keyof typeof HTTP_STATUS;

/** 413 不是 google.rpc.Code 的映射：请求体超限按 INVALID_ARGUMENT 报，HTTP 状态用 413，调用方好认。 */
const PAYLOAD_TOO_LARGE_STATUS = 413;
/** ErrorInfo 的 domain：标明错误原因（reason）是本程序定义的。 */
const ERROR_DOMAIN = 'labelflash';

export interface FieldViolation {
  field: string;
  description: string;
}

/** 接口返回给调用方的错误；message 用中文，写清怎么改。 */
export class ApiError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly status: CanonicalCode,
    readonly reason: string,
    message: string,
    readonly fieldViolations: readonly FieldViolation[] = [],
    httpStatus?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus ?? HTTP_STATUS[status];
  }

  static invalidArgument(message: string, violations: readonly FieldViolation[] = []): ApiError {
    return new ApiError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', message, violations);
  }

  static payloadTooLarge(limitBytes: number): ApiError {
    return new ApiError(
      'INVALID_ARGUMENT',
      'PAYLOAD_TOO_LARGE',
      `请求体超过 ${limitBytes} 字节：请分批提交`,
      [],
      PAYLOAD_TOO_LARGE_STATUS,
    );
  }
}

/** google.rpc.Status 的 JSON 形式（AIP-193）。 */
export function errorBody(error: ApiError): unknown {
  const details: unknown[] = [
    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: error.reason, domain: ERROR_DOMAIN },
  ];
  if (error.fieldViolations.length > 0) {
    details.push({ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: error.fieldViolations });
  }
  return { error: { code: error.httpStatus, status: error.status, message: error.message, details } };
}
