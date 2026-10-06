import { describe, expect, test } from 'bun:test';
import { interpretOsascript, MAC_HASH_MISMATCH_EXIT, osascriptArgs, parsePkgSignature } from './mac-install';

const SIGNED = `Package "driver-installer.pkg":
   Status: signed by a developer certificate issued by Apple for distribution
   Notarization: trusted by the Apple notary service
   Signed with a trusted timestamp on: 2026-09-01 08:00:00 +0000
   Certificate Chain:
    1. Developer ID Installer: 示例品牌 (EXAMPLE123)
       Expires: 2030-01-01 00:00:00 +0000
       SHA256 Fingerprint:
           00 11 22
       ------------------------------------------------------------------------
    2. Developer ID Certification Authority
`;

describe('parsePkgSignature', () => {
  test('reads the leaf certificate of an Apple-issued developer signature', () => {
    expect(parsePkgSignature(SIGNED)).toEqual({
      status: 'valid',
      signer: 'Developer ID Installer: 示例品牌 (EXAMPLE123)',
    });
  });

  test('treats unsigned or self-signed packages as invalid', () => {
    expect(parsePkgSignature('Package "a.pkg":\n   Status: no signature\n')).toEqual({
      status: 'invalid',
      detail: 'no signature',
    });
    expect(parsePkgSignature('Package "a.pkg":\n   Status: signed by untrusted certificate\n')).toMatchObject({
      status: 'invalid',
    });
  });
});

describe('osascriptArgs', () => {
  test('passes the script, path and hash as arguments instead of building an AppleScript string', () => {
    const args = osascriptArgs('/tmp/x/driver-installer.pkg', 'f'.repeat(64));
    expect(args.slice(-3)).toEqual([
      expect.stringContaining('/usr/sbin/installer -pkg'),
      '/tmp/x/driver-installer.pkg',
      'f'.repeat(64),
    ]);
    expect(args.join(' ')).toContain('with administrator privileges');
  });
});

describe('interpretOsascript', () => {
  test('maps the dialog and script outcomes', () => {
    expect(interpretOsascript({ exitCode: 0, stdout: '', stderr: '', timedOut: false })).toEqual({
      kind: 'installed',
      needsRestart: false,
    });
    expect(
      interpretOsascript({
        exitCode: 1,
        stdout: '',
        stderr: '0:200: execution error: User canceled. (-128)\n',
        timedOut: false,
      }),
    ).toEqual({ kind: 'declined' });
    expect(
      interpretOsascript({
        exitCode: 1,
        stdout: '',
        stderr: `execution error: (${MAC_HASH_MISMATCH_EXIT})`,
        timedOut: false,
      }),
    ).toEqual({ kind: 'hash-mismatch' });
    expect(
      interpretOsascript({
        exitCode: 1,
        stdout: '',
        stderr: 'execution error: installer: Error - The package is broken. (1)',
        timedOut: false,
      }),
    ).toEqual({ kind: 'failed', exitCode: 1 });
    expect(interpretOsascript({ exitCode: null, stdout: '', stderr: '', timedOut: true })).toEqual({
      kind: 'timeout',
    });
  });
});
