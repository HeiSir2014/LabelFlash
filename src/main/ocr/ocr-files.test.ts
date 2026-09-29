import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { missingOcrFiles, ocrFiles } from './ocr-files';

describe('ocrFiles', () => {
  test('uses the files the installer puts under resources', () => {
    const files = ocrFiles({ isPackaged: true, resourcesPath: 'R', appRoot: 'A', platform: 'win32', arch: 'x64' });
    expect(files).toEqual({
      addon: join('R', 'ocr', 'ocr-addon.node'),
      detectionModel: join('R', 'ocr', 'det.onnx'),
      recognitionModel: join('R', 'ocr', 'rec.onnx'),
      dictionary: join('R', 'ocr', 'dict.txt'),
    });
  });

  test('uses the built addon and the downloaded small models when running from source', () => {
    const files = ocrFiles({ isPackaged: false, resourcesPath: 'R', appRoot: 'A', platform: 'win32', arch: 'x64' });
    expect(files.addon).toBe(join('A', 'native', 'ocr', 'node', 'bin', 'ocr-addon.win32-x64-msvc.node'));
    expect(files.recognitionModel).toBe(join('A', 'models', 'small', 'rec.onnx'));
  });

  test('lists the files that are missing', () => {
    const files = ocrFiles({ isPackaged: true, resourcesPath: 'R', appRoot: 'A', platform: 'darwin', arch: 'arm64' });
    expect(missingOcrFiles(files, (path) => path.endsWith('.onnx'))).toEqual([files.addon, files.dictionary]);
  });
});
