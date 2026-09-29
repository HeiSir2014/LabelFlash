/**
 * PP-OCRv6 官方 ONNX 模型自带的 inference.yml：读出字典和 DB 参数，并核对引擎实现时依据的预处理参数。
 * 引擎（native/ocr/crates/ocr-core）按下面 ENGINE_ASSUMPTIONS 实现；官方模型哪天改了这些值，
 * 下载时就停下来报错，而不是拿错的参数去推理、得到看似正常的错结果。
 */

/** 引擎实现时依据的值，和 ocr-core 里的常量一一对应（见设计文档第 3 节）。 */
export const ENGINE_ASSUMPTIONS = {
  imageMode: 'BGR',
  detectionMean: [0.485, 0.456, 0.406],
  detectionStd: [0.229, 0.224, 0.225],
  detectionScale: '1./255.',
  detectionOrder: 'hwc',
  recognitionShape: [3, 48, 320],
  detectionPostProcess: 'DBPostProcess',
  recognitionPostProcess: 'CTCLabelDecode',
} as const;

export interface DetectionModelConfig {
  modelName: string;
  thresh: number;
  boxThresh: number;
  unclipRatio: number;
  maxCandidates: number;
}

export interface RecognitionModelConfig {
  modelName: string;
  /** 不含 blank 和末尾的空格：引擎加载时自己补上（和官方 CTCLabelDecode 一致）。 */
  dictionary: string[];
}

type Yaml = Record<string, unknown>;

export function readDetectionConfig(yamlText: string): DetectionModelConfig {
  const config = parse(yamlText);
  const ops = transformOps(config);
  expectEqual('DecodeImage.img_mode', field(ops, 'DecodeImage', 'img_mode'), ENGINE_ASSUMPTIONS.imageMode);
  expectEqual('NormalizeImage.mean', field(ops, 'NormalizeImage', 'mean'), ENGINE_ASSUMPTIONS.detectionMean);
  expectEqual('NormalizeImage.std', field(ops, 'NormalizeImage', 'std'), ENGINE_ASSUMPTIONS.detectionStd);
  expectEqual('NormalizeImage.scale', field(ops, 'NormalizeImage', 'scale'), ENGINE_ASSUMPTIONS.detectionScale);
  expectEqual('NormalizeImage.order', field(ops, 'NormalizeImage', 'order'), ENGINE_ASSUMPTIONS.detectionOrder);
  const post = section(config, 'PostProcess');
  expectEqual('PostProcess.name', post['name'], ENGINE_ASSUMPTIONS.detectionPostProcess);
  return {
    modelName: modelName(config),
    thresh: number(post, 'thresh'),
    boxThresh: number(post, 'box_thresh'),
    unclipRatio: number(post, 'unclip_ratio'),
    maxCandidates: number(post, 'max_candidates'),
  };
}

export function readRecognitionConfig(yamlText: string): RecognitionModelConfig {
  const config = parse(yamlText);
  const ops = transformOps(config);
  expectEqual('DecodeImage.img_mode', field(ops, 'DecodeImage', 'img_mode'), ENGINE_ASSUMPTIONS.imageMode);
  expectEqual(
    'RecResizeImg.image_shape',
    field(ops, 'RecResizeImg', 'image_shape'),
    ENGINE_ASSUMPTIONS.recognitionShape,
  );
  const post = section(config, 'PostProcess');
  expectEqual('PostProcess.name', post['name'], ENGINE_ASSUMPTIONS.recognitionPostProcess);
  const dictionary = post['character_dict'];
  if (!Array.isArray(dictionary) || dictionary.length === 0) {
    throw new Error('PostProcess.character_dict 不是非空列表');
  }
  const bad = dictionary.findIndex((entry) => typeof entry !== 'string' || [...entry].length !== 1);
  if (bad !== -1) {
    // dict.txt 一行一个字：多字符或含换行的条目会让行号和类别号对不上。
    throw new Error(`字典第 ${bad + 1} 项不是单个字符：${JSON.stringify(dictionary[bad])}`);
  }
  return { modelName: modelName(config), dictionary: dictionary as string[] };
}

/** dict.txt：一行一个字，按字典顺序，行尾只用 \n。 */
export function dictionaryText(dictionary: readonly string[]): string {
  return `${dictionary.join('\n')}\n`;
}

function parse(yamlText: string): Yaml {
  const value: unknown = Bun.YAML.parse(yamlText);
  if (!isObject(value)) {
    throw new Error('inference.yml 不是对象');
  }
  return value;
}

function modelName(config: Yaml): string {
  const name = section(config, 'Global')['model_name'];
  if (typeof name !== 'string') {
    throw new Error('Global.model_name 缺失');
  }
  return name;
}

function transformOps(config: Yaml): Yaml[] {
  const ops = section(config, 'PreProcess')['transform_ops'];
  if (!Array.isArray(ops)) {
    throw new Error('PreProcess.transform_ops 不是列表');
  }
  return ops.filter(isObject);
}

function field(ops: Yaml[], op: string, key: string): unknown {
  const entry = ops.find((item) => op in item)?.[op];
  if (!isObject(entry)) {
    throw new Error(`PreProcess 里没有 ${op}`);
  }
  return entry[key];
}

function section(config: Yaml, key: string): Yaml {
  const value = config[key];
  if (!isObject(value)) {
    throw new Error(`inference.yml 缺少 ${key}`);
  }
  return value;
}

function number(config: Yaml, key: string): number {
  const value = config[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`PostProcess.${key} 不是数字`);
  }
  return value;
}

function expectEqual(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `模型的 ${name} 是 ${JSON.stringify(actual)}，引擎按 ${JSON.stringify(expected)} 实现：先核对官方实现、改好引擎再更新模型`,
    );
  }
}

function isObject(value: unknown): value is Yaml {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
