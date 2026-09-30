/**
 * 把 Windows 安装包要带的本地 OCR 文件放到 dist/.ocr/（electron-builder.yml 的 win.extraResources 把它装进 resources/ocr/）：
 * - ocr-addon.node：Node-API 扩展，静态链接自己编的 /MT ONNX Runtime（build-onnxruntime.ts），
 *   只依赖系统 DLL，不需要 VC++ 运行库；
 * - models/<档位>/ 下的 PP-OCRv6 模型：「极速」「精准」两档要用的都带上（OCR_TIER_MODELS），用户切换不用下载；
 * - ONNX Runtime 的许可和第三方声明（它连同依赖一起编进了扩展）。
 * 放好后检查扩展的依赖，并用放好的文件把每一档都识别一次样张：装进安装包的就是验证过的。
 * 由 scripts/installer/build-installer.ts 在打安装包前调用；也可以单独运行：bun scripts/ocr/stage-resources.ts
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { OcrEngine } from '../../native/ocr/node/src/index.ts';
import { OCR_TIER_MODELS, PACKAGED_ADDON_NAME, MODELS_DIR as PACKAGED_MODELS_DIR } from '../../src/main/ocr/ocr-files';
import type { OcrModelTier } from '../../src/shared/ocr-model';
import { buildStaticRuntimeAddon } from './build-addon';
import { onnxRuntimeLibrary } from './build-onnxruntime';
import { fetchModels, MODELS_DIR } from './fetch-models';
import { msvcTool } from './msvc';
import { unwantedImports } from './onnxruntime-build';

const OCR_STAGING_DIR = join('dist', '.ocr');
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

/** 某一档要用的模型文件（相对 models/ 的路径）：检测模型，识别模型和它的字典。 */
function tierModelFiles(tier: OcrModelTier): { det: string; rec: string; dict: string } {
  const { detection, recognition } = OCR_TIER_MODELS[tier];
  return { det: join(detection, 'det.onnx'), rec: join(recognition, 'rec.onnx'), dict: join(recognition, 'dict.txt') };
}

/** 用放好的扩展和某一档的模型识别样张（和程序里一样传 BGRA），读不出货架号就不打包。 */
async function verifyStagedEngine(stagingDir: string, tier: OcrModelTier): Promise<void> {
  const models = tierModelFiles(tier);
  const { data, info } = await sharp(SAMPLE_IMAGE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i] ?? 0;
    data[i] = data[i + 2] ?? 0;
    data[i + 2] = red;
  }
  const engine = await OcrEngine.create({
    addonPath: resolve(stagingDir, PACKAGED_ADDON_NAME),
    detModelPath: resolve(stagingDir, PACKAGED_MODELS_DIR, models.det),
    recModelPath: resolve(stagingDir, PACKAGED_MODELS_DIR, models.rec),
    dictionaryPath: resolve(stagingDir, PACKAGED_MODELS_DIR, models.dict),
  });
  const result = await engine.recognize({
    data,
    width: info.width,
    height: info.height,
    stride: info.width * info.channels,
    pixelFormat: 'BGRA',
  });
  engine.close();
  const texts = result.regions.map((region) => region.text);
  if (!texts.includes(SAMPLE_SHELF_NUMBER)) {
    throw new Error(`放好的 OCR（${tier}）没读出样张上的 ${SAMPLE_SHELF_NUMBER}：${JSON.stringify(texts)}`);
  }
}

export async function stageOcrResources(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('只有 Windows 安装包带本地 OCR');
  }
  await fetchModels();
  const onnxRuntimeDir = await onnxRuntimeLibrary();
  const addon = buildStaticRuntimeAddon(onnxRuntimeDir);
  verifyImports(addon);

  rmSync(OCR_STAGING_DIR, { recursive: true, force: true });
  mkdirSync(OCR_STAGING_DIR, { recursive: true });
  copyFileSync(addon, join(OCR_STAGING_DIR, PACKAGED_ADDON_NAME));
  const tiers = Object.keys(OCR_TIER_MODELS) as OcrModelTier[];
  // 两档共用的模型（small 检测）只放一份。
  const modelFiles = new Set(tiers.flatMap((tier) => Object.values(tierModelFiles(tier))));
  for (const file of modelFiles) {
    const target = join(OCR_STAGING_DIR, PACKAGED_MODELS_DIR, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(MODELS_DIR, file), target);
  }
  for (const file of ONNXRUNTIME_NOTICES) {
    copyFileSync(join(onnxRuntimeDir, file), join(OCR_STAGING_DIR, file));
  }
  for (const tier of tiers) {
    await verifyStagedEngine(OCR_STAGING_DIR, tier);
  }
  console.log(
    `[ocr] staged ${readdirSync(OCR_STAGING_DIR).join(', ')} with models ${[...modelFiles].join(', ')}; verified tiers ${tiers.join(', ')}`,
  );
}

if (import.meta.main) {
  await stageOcrResources();
}
