import { describe, expect, test } from 'bun:test';
import {
  cmakeGenerator,
  isSupportedPython,
  libsToMerge,
  onnxRuntimeBuildKey,
  unwantedImports,
} from './onnxruntime-build';

describe('onnxRuntimeBuildKey', () => {
  test('starts with the ONNX Runtime version and is stable', () => {
    expect(onnxRuntimeBuildKey()).toMatch(/^\d+\.\d+\.\d+-[0-9a-f]{12}$/);
    expect(onnxRuntimeBuildKey()).toBe(onnxRuntimeBuildKey());
  });
});

describe('cmakeGenerator', () => {
  test('maps Visual Studio 2022 and 2026', () => {
    expect(cmakeGenerator(17)).toBe('Visual Studio 17 2022');
    expect(cmakeGenerator(18)).toBe('Visual Studio 18 2026');
  });

  test('rejects versions the ONNX Runtime build script does not know', () => {
    expect(() => cmakeGenerator(16)).toThrow('Visual Studio');
  });
});

describe('isSupportedPython', () => {
  test('accepts 3.10 and later', () => {
    expect(isSupportedPython('Python 3.10.0')).toBe(true);
    expect(isSupportedPython('Python 3.12.11\r\n')).toBe(true);
  });

  test('rejects older or unreadable versions', () => {
    expect(isSupportedPython('Python 3.9.7')).toBe(false);
    expect(isSupportedPython('Python 2.7.18')).toBe(false);
    expect(isSupportedPython('')).toBe(false);
  });
});

describe('libsToMerge', () => {
  test('keeps release libraries and drops full protobuf, protoc and CMake scratch files', () => {
    expect(
      libsToMerge([
        'Release\\onnxruntime_session.lib',
        '_deps/abseil_cpp-build/absl/base/Release/absl_base.lib',
        '_deps/protobuf-build/Release/libprotobuf-lite.lib',
        '_deps/protobuf-build/Release/libprotobuf.lib',
        '_deps/protobuf-build/Release/libprotoc.lib',
        '_deps/re2-build/Debug/re2.lib',
        'CMakeFiles/Release/probe.lib',
        'Release/onnxruntime_session.pdb',
      ]),
    ).toEqual([
      'Release/onnxruntime_session.lib',
      '_deps/abseil_cpp-build/absl/base/Release/absl_base.lib',
      '_deps/protobuf-build/Release/libprotobuf-lite.lib',
    ]);
  });
});

describe('unwantedImports', () => {
  const dumpbin = (dlls: string[]) =>
    [
      'Dump of file ocr_addon.dll',
      '',
      '  Image has the following dependencies:',
      '',
      ...dlls.map((dll) => `    ${dll}`),
      '',
      '  Summary',
    ].join('\r\n');

  test('accepts an add-on that only needs system DLLs', () => {
    expect(
      unwantedImports(
        dumpbin(['KERNEL32.dll', 'ntdll.dll', 'dbghelp.dll', 'SETUPAPI.dll', 'dxgi.dll', 'ADVAPI32.dll']),
      ),
    ).toEqual([]);
  });

  test('reports the VC++ runtime, the universal CRT forwarders and DirectML', () => {
    expect(
      unwantedImports(
        dumpbin([
          'KERNEL32.dll',
          'MSVCP140.dll',
          'VCRUNTIME140_1.dll',
          'api-ms-win-crt-heap-l1-1-0.dll',
          'DirectML.dll',
          'd3d12.dll',
        ]),
      ),
    ).toEqual(['MSVCP140.dll', 'VCRUNTIME140_1.dll', 'api-ms-win-crt-heap-l1-1-0.dll', 'DirectML.dll', 'd3d12.dll']);
  });
});
