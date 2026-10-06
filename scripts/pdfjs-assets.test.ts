import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir, removeTempDir } from '../src/main/storage/testing/temp-dir';
import { pdfjsAssetFiles, pdfjsPackageDir } from './pdfjs-assets';

describe('pdfjsAssetFiles', () => {
  test('publishes the runtime files of pdf.js under fixed paths', async () => {
    const dir = await createTempDir('pdfjs-assets-');
    try {
      for (const sub of ['cmaps', 'cmaps/nested', 'standard_fonts', 'wasm', 'iccs']) {
        await mkdir(join(dir, sub), { recursive: true });
      }
      await writeFile(join(dir, 'cmaps', 'UniGB-UCS2-H.bcmap'), 'x');
      await writeFile(join(dir, 'standard_fonts', 'FoxitSans.pfb'), 'x');
      await writeFile(join(dir, 'wasm', 'openjpeg.wasm'), 'x');
      await writeFile(join(dir, 'iccs', 'CGATS001Compat-v2-micro.icc'), 'x');
      const files = pdfjsAssetFiles(dir);
      expect(files.map((file) => file.fileName).sort()).toEqual([
        'pdfjs/cmaps/UniGB-UCS2-H.bcmap',
        'pdfjs/iccs/CGATS001Compat-v2-micro.icc',
        'pdfjs/standard_fonts/FoxitSans.pfb',
        'pdfjs/wasm/openjpeg.wasm',
      ]);
      expect(files.find((file) => file.fileName.endsWith('.bcmap'))?.path).toBe(
        join(dir, 'cmaps', 'UniGB-UCS2-H.bcmap'),
      );
    } finally {
      await removeTempDir(dir);
    }
  });

  test('finds the installed package and its character maps', () => {
    expect(pdfjsAssetFiles(pdfjsPackageDir()).some((file) => file.fileName.startsWith('pdfjs/cmaps/'))).toBe(true);
  });

  // PDF 里嵌的 JavaScript 不执行：执行它用的引擎不进产物。
  test('leaves out the engine that would run scripts embedded in a PDF', () => {
    expect(pdfjsAssetFiles(pdfjsPackageDir()).some((file) => file.fileName.includes('quickjs'))).toBe(false);
  });
});
