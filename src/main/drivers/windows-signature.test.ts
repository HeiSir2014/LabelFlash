import { expect, test } from 'bun:test';
import { authenticodeScript, parseAuthenticode } from './windows-signature';

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
