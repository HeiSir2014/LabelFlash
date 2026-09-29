import { describe, expect, test } from 'bun:test';
import { hasPostinstallScript, installLocation, isAdHocSigned, missingArchitectures } from './package-checks';

describe('missingArchitectures', () => {
  test('accepts a universal binary', () => {
    expect(missingArchitectures('x86_64 arm64\n')).toEqual([]);
  });

  test('names the architecture a single-arch binary lacks', () => {
    expect(missingArchitectures('arm64\n')).toEqual(['x86_64']);
  });
});

describe('isAdHocSigned', () => {
  // codesign -dv 的输出（写到 stderr），截取和判断有关的几行。
  const display = [
    'Executable=/tmp/CDL-云签速印.app/Contents/MacOS/CDL-云签速印',
    'Identifier=com.cdl.labelflash',
    'Format=app bundle with Mach-O universal (x86_64 arm64)',
    'CodeDirectory v=20400 size=520 flags=0x2(adhoc) hashes=5+7 location=embedded',
    'Signature=adhoc',
    'TeamIdentifier=not set',
  ].join('\n');

  test('recognises an ad-hoc signature', () => {
    expect(isAdHocSigned(display)).toBe(true);
  });

  test('rejects a binary without a signature', () => {
    expect(isAdHocSigned('/tmp/CDL-云签速印.app: code object is not signed at all')).toBe(false);
  });
});

describe('installLocation', () => {
  test('reads where the component package installs the app', () => {
    const packageInfo =
      '<?xml version="1.0" encoding="utf-8"?>\n<pkg-info overwrite-permissions="true" relocatable="false" ' +
      'identifier="com.cdl.labelflash" postinstall-action="none" version="1.0.1" format-version="2" ' +
      'install-location="/Applications" auth="root">\n</pkg-info>';
    expect(installLocation(packageInfo)).toBe('/Applications');
  });

  test('returns null when the package does not say', () => {
    expect(installLocation('<pkg-info identifier="com.cdl.labelflash"></pkg-info>')).toBeNull();
  });
});

describe('hasPostinstallScript', () => {
  test('finds the postinstall script in an expanded component package', () => {
    expect(hasPostinstallScript(['Distribution', 'app.pkg/PackageInfo', 'app.pkg/Scripts/postinstall'])).toBe(true);
    expect(hasPostinstallScript(['Distribution', 'app.pkg/PackageInfo', 'app.pkg/Payload'])).toBe(false);
  });
});
