/**
 * 把 Windows 安装包要带的本地 OCR 文件放到 dist/.ocr/（electron-builder.yml 的 win.extraResources 把它装进 resources/ocr/）：
 * - ocr-addon.node：Node-API 扩展，静态链接自己编的 /MT ONNX Runtime（build-onnxruntime.ts），
 *   只依赖系统 DLL，不需要 VC++ 运行库；
 * - det.onnx、rec.onnx、dict.txt：PP-OCRv6 small 检测 + small 识别（tiny 识别会把 A 读成 4，见 OCR 引擎设计第 10 节）；
 * - ONNX Runtime 的许可和第三方声明（它连同依赖一起编进了扩展）。
 * 放好后检查扩展的依赖，并用放好的这套文件识别一次样张：装进安装包的就是验证过的。
 * 由 scripts/installer/build-installer.ts 在打安装包前调用；也可以单独运行：bun scripts/ocr/stage-resources.ts
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { OcrEngine } from '../../native/ocr/node/src/index.ts';
import { PACKAGED_ADDON_NAME } from '../../src/main/ocr/ocr-files';
import { buildStaticRuntimeAddon } from './build-addon';
import { buildOnnxRuntime } from './build-onnxruntime';
import { fetchModels, MODELS_DIR } from './fetch-models';
import { msvcTool } from './msvc';
import { unwantedImports } from './onnxruntime-build';

const OCR_STAGING_DIR = join('dist', '.ocr');
/** 安装包带的模型档位。 */
const PACKAGED_MODEL_TIER = 'small';
const MODEL_FILES = ['det.onnx', 'rec.onnx', 'dict.txt'] as const;
const ONNXRUNTIME_NOTICES = ['onnxruntime-LICENSE.txt', 'onnxruntime-ThirdPartyNotices.txt'] as const;
/** 样张和上面的货架号（和 OCR 引擎的集成测试同一张）。 */
const SAMPLE_IMAGE = join('native', 'ocr', 'fixtures', 'shelf-label.jpg');
const SAMPLE_SHELF_NUMBER = 'A-1-2-3';

/** 扩展只能依赖系统 DLL：带出 VC++ 运行库或 DirectML 说明链接错了 ONNX Runtime。 */
function verifyImports(addon: string): void {
  const dumpbin = Bun.spawnSync([msvcTool('dumpbin.exe'), '/NOLOGO', '/DEPENDENTS', addon]);
  if (dumpbin.exitCode !== 0) {
    throw new Error(`dumpbin 读不了 ${addon}`);
  }
  const unwanted = unwantedImports(dumpbin.stdout.toString());
  if (unwanted.length > 0) {
    throw new Error(`${addon} 依赖 ${unwanted.join('、')}：安装包里不带这些 DLL，没装 VC++ 运行库的电脑上会加载失败`);
  }
}

/** 用放好的扩展和模型识别样张（和程序里一样传 BGRA），读不出货架号就不打包。 */
async function verifyStagedEngine(stagingDir: string): Promise<void> {
  const { data, info } = await sharp(SAMPLE_IMAGE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i] ?? 0;
    data[i] = data[i + 2] ?? 0;
    data[i + 2] = red;
  }
  const engine = await OcrEngine.create({
    addonPath: resolve(stagingDir, PACKAGED_ADDON_NAME),
    detModelPath: resolve(stagingDir, 'det.onnx'),
    recModelPath: resolve(stagingDir, 'rec.onnx'),
    dictionaryPath: resolve(stagingDir, 'dict.txt'),
  });
  const result = await engine.recognize({
    data,
    width: info.width,
    height: info.height,
    stride: info.width * info.channels,
    pixelFormat: 'BGRA',
  });
  const texts = result.regions.map((region) => region.text);
  if (!texts.includes(SAMPLE_SHELF_NUMBER)) {
    throw new Error(`放好的 OCR 没读出样张上的 ${SAMPLE_SHELF_NUMBER}：${JSON.stringify(texts)}`);
  }
}

export async function stageOcrResources(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('只有 Windows 安装包带本地 OCR');
  }
  await fetchModels();
  const onnxRuntimeDir = buildOnnxRuntime();
  const addon = buildStaticRuntimeAddon(onnxRuntimeDir);
  verifyImports(addon);

  rmSync(OCR_STAGING_DIR, { recursive: true, force: true });
  mkdirSync(OCR_STAGING_DIR, { recursive: true });
  copyFileSync(addon, join(OCR_STAGING_DIR, PACKAGED_ADDON_NAME));
  for (const file of MODEL_FILES) {
    copyFileSync(join(MODELS_DIR, PACKAGED_MODEL_TIER, file), join(OCR_STAGING_DIR, file));
  }
  for (const file of ONNXRUNTIME_NOTICES) {
    copyFileSync(join(onnxRuntimeDir, file), join(OCR_STAGING_DIR, file));
  }
  await verifyStagedEngine(OCR_STAGING_DIR);
  console.log(`[ocr] staged and verified ${readdirSync(OCR_STAGING_DIR).join(', ')}`);
}

if (import.meta.main) {
  await stageOcrResources();
}
