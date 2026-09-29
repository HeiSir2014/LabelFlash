import { describe, expect, test } from 'bun:test';
import { ApiError, errorBody } from './api-error';

describe('ApiError', () => {
  test('renders google.rpc.Status with ErrorInfo and field violations', () => {
    const error = ApiError.invalidArgument('fields 不能为空', [
      { field: 'requests[3].fields', description: '至少一个字段' },
    ]);
    expect(error.httpStatus).toBe(400);
    expect(errorBody(error)).toEqual({
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'fields 不能为空',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'INVALID_ARGUMENT', domain: 'labelflash' },
          {
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [{ field: 'requests[3].fields', description: '至少一个字段' }],
          },
        ],
      },
    });
  });

  test('leaves out BadRequest when no field is at fault', () => {
    const body = errorBody(new ApiError('NOT_FOUND', 'TEMPLATE_NOT_FOUND', '找不到模板')) as {
      error: { details: unknown[] };
    };
    expect(body.error.details).toHaveLength(1);
  });

  test('maps each canonical code to its HTTP status', () => {
    expect(new ApiError('NOT_FOUND', 'TEMPLATE_NOT_FOUND', 'x').httpStatus).toBe(404);
    expect(new ApiError('UNAUTHENTICATED', 'KEY_REQUIRED', 'x').httpStatus).toBe(401);
    expect(new ApiError('PERMISSION_DENIED', 'ORIGIN_NOT_AUTHORIZED', 'x').httpStatus).toBe(403);
    expect(new ApiError('FAILED_PRECONDITION', 'PRINTER_NOT_FOUND', 'x').httpStatus).toBe(400);
    expect(new ApiError('RESOURCE_EXHAUSTED', 'RATE_LIMITED', 'x').httpStatus).toBe(429);
    expect(new ApiError('INTERNAL', 'INTERNAL', 'x').httpStatus).toBe(500);
  });

  test('reports an oversized body as 413 with its own reason', () => {
    const error = ApiError.payloadTooLarge(16);
    expect(error).toMatchObject({ httpStatus: 413, status: 'INVALID_ARGUMENT', reason: 'PAYLOAD_TOO_LARGE' });
  });
});
