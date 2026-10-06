import { expect, test } from 'bun:test';
import { authenticodeScript, interpretSignatureQuery, parseAuthenticode } from './windows-signature';

test('passes the path as a PowerShell literal', () => {
  expect(authenticodeScript("C:\\Users\\O'Brien\\a.exe")).toContain("$Path = 'C:\\Users\\O''Brien\\a.exe'");
});

test('reads a valid signature and its signer', () => {
  expect(parseAuthenticode('{"status":"Valid","subject":"CN=示例品牌有限公司, C=CN"}')).toEqual({
    status: 'valid',
    signer: 'CN=示例品牌有限公司, C=CN',
  });
});

test('treats every other status and unreadable output as invalid', () => {
  expect(parseAuthenticode('{"status":"NotSigned","subject":""}')).toEqual({ status: 'invalid', detail: 'NotSigned' });
  expect(parseAuthenticode('{"status":"HashMismatch","subject":"CN=x"}')).toEqual({
    status: 'invalid',
    detail: 'HashMismatch',
  });
  expect(parseAuthenticode('oops')).toEqual({ status: 'invalid', detail: 'unreadable' });
});

test('reports a failed query as unverifiable, never as an invalid signature', () => {
  expect(interpretSignatureQuery({ exitCode: 1, stdout: '', stderr: 'module load error', timedOut: false })).toEqual({
    status: 'unverifiable',
    detail: 'query failed (exit 1)',
  });
  expect(interpretSignatureQuery({ exitCode: null, stdout: '', stderr: '', timedOut: true })).toEqual({
    status: 'unverifiable',
    detail: 'query failed (exit null)',
  });
});

test('parses the output when the query itself succeeded', () => {
  expect(
    interpretSignatureQuery({
      exitCode: 0,
      stdout: '{"status":"Valid","subject":"CN=示例品牌有限公司"}',
      stderr: '',
      timedOut: false,
    }),
  ).toEqual({ status: 'valid', signer: 'CN=示例品牌有限公司' });
});
