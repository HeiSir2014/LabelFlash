import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { missingOcrFiles, OCR_TIER_MODELS, ocrFiles } from './ocr-files';

describe('ocrFiles', () => {
  test('uses the files the installer puts under resources', () => {
    const files = ocrFiles({
      isPackaged: true,
      resourcesPath: 'R',
      appRoot: 'A',
      platform: 'win32',
      arch: 'x64',
      tier: 'fast',
    });
    expect(files).toEqual({
      addon: join('R', 'ocr', 'ocr-addon.node'),
      detectionModel: join('R', 'ocr', 'models', 'small', 'det.onnx'),
      recognitionModel: join('R', 'ocr', 'models', 'small', 'rec.onnx'),
      dictionary: join('R', 'ocr', 'models', 'small', 'dict.txt'),
    });
  });

  test('uses the built addon and the downloaded models when running from source', () => {
    const files = ocrFiles({
      isPackaged: false,
      resourcesPath: 'R',
      appRoot: 'A',
      platform: 'win32',
      arch: 'x64',
      tier: 'fast',
    });
    expect(files.addon).toBe(join('A', 'native', 'ocr', 'node', 'bin', 'ocr-addon.win32-x64-msvc.node'));
    expect(files.recognitionModel).toBe(join('A', 'models', 'small', 'rec.onnx'));
  });

  test('the accurate tier keeps the small detector and reads with the medium recognizer and its dictionary', () => {
    const files = ocrFiles({
      isPackaged: true,
      resourcesPath: 'R',
      appRoot: 'A',
      platform: 'win32',
      arch: 'x64',
      tier: 'accurate',
    });
    expect(files.detectionModel).toBe(join('R', 'ocr', 'models', 'small', 'det.onnx'));
    expect(files.recognitionModel).toBe(join('R', 'ocr', 'models', 'medium', 'rec.onnx'));
    expect(files.dictionary).toBe(join('R', 'ocr', 'models', 'medium', 'dict.txt'));
  });

  test('every tier names its detection and recognition models', () => {
    expect(OCR_TIER_MODELS).toEqual({
      fast: { detection: 'small', recognition: 'small' },
      accurate: { detection: 'small', recognition: 'medium' },
    });
  });

  test('lists the files that are missing', () => {
    const files = ocrFiles({
      isPackaged: true,
      resourcesPath: 'R',
      appRoot: 'A',
      platform: 'darwin',
      arch: 'arm64',
      tier: 'fast',
    });
    expect(missingOcrFiles(files, (path) => path.endsWith('.onnx'))).toEqual([files.addon, files.dictionary]);
  });
});
