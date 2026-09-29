import { describe, expect, test } from 'bun:test';
import { dictionaryText, readDetectionConfig, readRecognitionConfig } from './model-config';

// 摘自官方 PP-OCRv6_tiny_det_onnx 的 inference.yml（省略了和推理无关的部分）。
const DETECTION_YAML = `
Global:
  model_name: PP-OCRv6_tiny_det
PostProcess:
  box_thresh: 0.4
  max_candidates: 3000
  name: DBPostProcess
  thresh: 0.2
  unclip_ratio: 1.4
PreProcess:
  transform_ops:
  - DecodeImage:
      channel_first: false
      img_mode: BGR
  - DetResizeForTest: null
  - NormalizeImage:
      mean: [0.485, 0.456, 0.406]
      order: hwc
      scale: 1./255.
      std: [0.229, 0.224, 0.225]
  - ToCHWImage: null
`;

const RECOGNITION_YAML = `
Global:
  model_name: PP-OCRv6_tiny_rec
PreProcess:
  transform_ops:
  - DecodeImage:
      channel_first: false
      img_mode: BGR
  - RecResizeImg:
      image_shape: [3, 48, 320]
PostProcess:
  name: CTCLabelDecode
  character_dict:
  - '!'
  - ''''
  - A
  - 图
`;

describe('readDetectionConfig', () => {
  test('reads the DB parameters the model ships with', () => {
    expect(readDetectionConfig(DETECTION_YAML)).toEqual({
      modelName: 'PP-OCRv6_tiny_det',
      thresh: 0.2,
      boxThresh: 0.4,
      unclipRatio: 1.4,
      maxCandidates: 3000,
    });
  });

  // 引擎按 BGR 实现：模型改成 RGB 时要先改引擎，不能照样推理出错的结果。
  test('refuses a model whose preprocessing differs from what the engine implements', () => {
    expect(() => readDetectionConfig(DETECTION_YAML.replace('img_mode: BGR', 'img_mode: RGB'))).toThrow(
      'DecodeImage.img_mode',
    );
    expect(() => readDetectionConfig(DETECTION_YAML.replace('0.485', '0.5'))).toThrow('NormalizeImage.mean');
  });
});

describe('readRecognitionConfig', () => {
  test('reads the dictionary in order, without blank or space', () => {
    expect(readRecognitionConfig(RECOGNITION_YAML)).toEqual({
      modelName: 'PP-OCRv6_tiny_rec',
      dictionary: ['!', "'", 'A', '图'],
    });
  });

  test('refuses a recognition height the engine does not use', () => {
    expect(() => readRecognitionConfig(RECOGNITION_YAML.replace('[3, 48, 320]', '[3, 32, 320]'))).toThrow(
      'RecResizeImg.image_shape',
    );
  });

  // dict.txt 一行一个字：多字符的条目会让行号和类别号错开。
  test('refuses dictionary entries that are not a single character', () => {
    expect(() => readRecognitionConfig(RECOGNITION_YAML.replace('  - A\n', '  - AB\n'))).toThrow('第 3 项');
  });
});

test('writes one character per line with a trailing newline', () => {
  expect(dictionaryText(['!', 'A', '图'])).toBe('!\nA\n图\n');
});
