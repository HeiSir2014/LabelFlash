import { describe, expect, test } from 'bun:test';
import type { FieldViolation } from './api-error';
import { BATCH_LIMIT, parseBatchRequest, parseCreateRequest, parseRenderRequest } from './request-schema';

const VALID = { template: 'templates/builtin-generic', fields: [{ name: '订单号', value: 'A001' }] };

function violationsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    return (error as { fieldViolations: FieldViolation[] }).fieldViolations.map((item) => item.field);
  }
  throw new Error('expected the request to be rejected');
}

describe('parseCreateRequest', () => {
  test('accepts a minimal request and fills in defaults', () => {
    expect(parseCreateRequest(VALID)).toEqual({
      templateId: 'builtin:generic',
      fields: [{ name: '订单号', value: 'A001' }],
      content: null,
      copies: 1,
      printer: null,
      requestId: null,
    });
  });

  test('accepts every optional field', () => {
    const requestId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    expect(
      parseCreateRequest({
        ...VALID,
        template: 'custom-7a2e',
        content: 'SF1',
        copies: 3,
        printer: '面单机B',
        requestId,
      }),
    ).toMatchObject({ templateId: 'custom:7a2e', content: 'SF1', copies: 3, printer: '面单机B', requestId });
  });

  test('reports every bad field with its path', () => {
    expect(
      violationsOf(() =>
        parseCreateRequest({ template: 'x', fields: [], copies: 0, printer: 7, requestId: 'not-a-uuid' }),
      ),
    ).toEqual(['template', 'fields', 'copies', 'printer', 'requestId']);
  });

  test('rejects a body that is not an object', () => {
    expect(violationsOf(() => parseCreateRequest([VALID]))).toContain('template');
    expect(violationsOf(() => parseCreateRequest(null))).toContain('fields');
  });

  test('rejects field names that rules would reject, repeated names and oversized values', () => {
    expect(violationsOf(() => parseCreateRequest({ ...VALID, fields: [{ name: '{x}', value: 'a' }] }))).toEqual([
      'fields[0].name',
    ]);
    expect(
      violationsOf(() =>
        parseCreateRequest({
          ...VALID,
          fields: [
            { name: 'a', value: '1' },
            { name: 'a', value: '2' },
          ],
        }),
      ),
    ).toEqual(['fields[1].name']);
    expect(
      violationsOf(() => parseCreateRequest({ ...VALID, fields: [{ name: 'a', value: 'x'.repeat(1001) }] })),
    ).toEqual(['fields[0].value']);
  });

  test('rejects empty or oversized content and fractional copies', () => {
    expect(violationsOf(() => parseCreateRequest({ ...VALID, content: '', copies: 1.5 }))).toEqual([
      'content',
      'copies',
    ]);
  });
});

describe('parseBatchRequest', () => {
  test('prefixes violations with the index of the request', () => {
    expect(violationsOf(() => parseBatchRequest({ requests: [VALID, { ...VALID, fields: [] }] }))).toEqual([
      'requests[1].fields',
    ]);
  });

  test('allows up to the batch limit and no more', () => {
    expect(parseBatchRequest({ requests: Array.from({ length: BATCH_LIMIT }, () => VALID) })).toHaveLength(BATCH_LIMIT);
    expect(
      violationsOf(() => parseBatchRequest({ requests: Array.from({ length: BATCH_LIMIT + 1 }, () => VALID) })),
    ).toEqual(['requests']);
    expect(violationsOf(() => parseBatchRequest({ requests: [] }))).toEqual(['requests']);
  });
});

describe('parseRenderRequest', () => {
  test('takes fields and optional content', () => {
    expect(parseRenderRequest({ fields: VALID.fields, content: 'A001' })).toEqual({
      fields: VALID.fields,
      content: 'A001',
    });
    expect(parseRenderRequest({ fields: VALID.fields })).toEqual({ fields: VALID.fields, content: null });
  });

  test('requires fields', () => {
    expect(violationsOf(() => parseRenderRequest({}))).toEqual(['fields']);
  });
});
