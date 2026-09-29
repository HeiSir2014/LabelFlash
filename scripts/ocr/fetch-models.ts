/**
 * 下载 PP-OCRv6 官方 ONNX 模型到 models/{tiny,small}/：det.onnx、rec.onnx、dict.txt（另存 det.yml、rec.yml 备查）。
 * 从 Hugging Face 的 PaddlePaddle 官方仓库按固定版本下载，逐个核对 SHA-256；已经下载且哈希对的跳过。
 * 模型是 Apache-2.0 许可，不进 git，也不嵌进 .node（见 docs/superpowers/specs/2026-09-30-ocr-engine-design.md）。
 * 用法：bun run ocr:models
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dictionaryText, readDetectionConfig, readRecognitionConfig } from './model-config';

export const MODELS_DIR = 'models';

interface ModelSource {
  /** Hugging Face 上的仓库名。 */
  repo: string;
  /** 固定的提交：官方仓库更新后不会悄悄换掉我们用的模型。 */
  revision: string;
  onnxSha256: string;
  ymlSha256: string;
}

type Tier = 'tiny' | 'small';
type Kind = 'det' | 'rec';

export const MODEL_SOURCES: Record<Tier, Record<Kind, ModelSource>> = {
  tiny: {
    det: {
      repo: 'PaddlePaddle/PP-OCRv6_tiny_det_onnx',
      revision: '2ba1506c0380b8f0b03dd142459aac66d4421f6c',
      onnxSha256: '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8',
      ymlSha256: '3ac018be6f97499a08faa3bbdeb33640968d9307f6736d152902747a9f259593',
    },
    rec: {
      repo: 'PaddlePaddle/PP-OCRv6_tiny_rec_onnx',
      revision: '2612ab37152ae0a677521bae4e1e3d4fb4cf7c30',
      onnxSha256: '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6',
      ymlSha256: '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1',
    },
  },
  small: {
    det: {
      repo: 'PaddlePaddle/PP-OCRv6_small_det_onnx',
      revision: '28fe5895c24fd108c19eb3e8479f4ab385fbfc62',
      onnxSha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
      ymlSha256: '193f435274bf9f0b5f71a929bbfbcf148282df7e633b34e7c373e8f44741b516',
    },
    rec: {
      repo: 'PaddlePaddle/PP-OCRv6_small_rec_onnx',
      revision: 'b8f84f0b80c529de40b4fbb3544b84fa7233a513',
      onnxSha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
      ymlSha256: 'ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1',
    },
  },
};

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 已有且哈希对就直接用；否则下载、核对哈希，写到临时文件再改名（中途断了不留半个文件）。 */
async function fetchVerified(url: string, target: string, expectedSha256: string): Promise<Uint8Array> {
  if (existsSync(target)) {
    const existing = new Uint8Array(await readFile(target));
    if (sha256(existing) === expectedSha256) {
      return existing;
    }
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败 ${response.status}：${url}`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expectedSha256) {
    throw new Error(`哈希不符：${url}\n  应为 ${expectedSha256}\n  实际 ${actual}`);
  }
  await writeFile(`${target}.part`, data);
  await rename(`${target}.part`, target);
  console.log(`[ocr] ${target}  ${Math.round(data.length / 1024)} KB`);
  return data;
}

async function fetchModel(tier: Tier, kind: Kind): Promise<string> {
  const source = MODEL_SOURCES[tier][kind];
  const dir = join(MODELS_DIR, tier);
  const base = `https://huggingface.co/${source.repo}/resolve/${source.revision}`;
  await fetchVerified(`${base}/inference.onnx`, join(dir, `${kind}.onnx`), source.onnxSha256);
  const yml = await fetchVerified(`${base}/inference.yml`, join(dir, `${kind}.yml`), source.ymlSha256);
  return new TextDecoder().decode(yml);
}

export async function fetchModels(): Promise<void> {
  for (const tier of Object.keys(MODEL_SOURCES) as Tier[]) {
    await mkdir(join(MODELS_DIR, tier), { recursive: true });
    const det = readDetectionConfig(await fetchModel(tier, 'det'));
    const rec = readRecognitionConfig(await fetchModel(tier, 'rec'));
    await writeFile(join(MODELS_DIR, tier, 'dict.txt'), dictionaryText(rec.dictionary), 'utf8');
    console.log(
      `[ocr] ${tier}: ${det.modelName} + ${rec.modelName}，字典 ${rec.dictionary.length} 个字；` +
        `模型自带的 DB 参数 thresh ${det.thresh}、box_thresh ${det.boxThresh}、unclip_ratio ${det.unclipRatio}`,
    );
  }
}

if (import.meta.main) {
  await fetchModels();
}
