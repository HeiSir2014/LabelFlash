//! 整条流水线：检测 → DB 后处理 → 阅读顺序 → 透视裁剪 → 按宽高比分批识别 → CTC 解码。
//! 模型会话在创建时加载一次；每次调用用到的大缓冲（检测张量、概率图、识别批张量）留在引擎里复用。

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::Instant;

use crate::ctc::{decode, Dictionary};
use crate::detection::{detection_size, padded_size, write_detection_input, DetectionOptions};
use crate::geometry::Quad;
use crate::image::{BgrSource, ImageView};
use crate::inference::{InferenceBackend, InferenceInput, OrtBackend, SessionOptions};
use crate::postprocess::{text_boxes, ProbabilityMap};
use crate::reading_order::reading_order;
use crate::recognition::{
    batches, crop_quad, padded_width, write_recognition_input, RECOGNITION_HEIGHT,
};
use crate::OcrError;

/// 创建引擎的参数。检测和识别模型分开配置，可以混用不同档（例如 tiny 检测 + small 识别）。
#[derive(Clone, Debug)]
pub struct EngineOptions {
    pub detection_model: PathBuf,
    pub recognition_model: PathBuf,
    pub dictionary: PathBuf,
    pub intra_threads: usize,
    pub recognition_batch_size: usize,
    pub detection: DetectionOptions,
}

/// 默认的线程数和批大小（设计文档第 8 节）。
pub const DEFAULT_INTRA_THREADS: usize = 4;
pub const DEFAULT_RECOGNITION_BATCH_SIZE: usize = 8;

/// 一段文字。
#[derive(Clone, Debug, PartialEq)]
pub struct TextRegion {
    /// 原图坐标，左上、右上、右下、左下。
    pub quad: Quad,
    pub text: String,
    pub detection_score: f32,
    pub recognition_score: f32,
}

/// 各阶段耗时（毫秒）。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Timing {
    pub preprocess_ms: f64,
    pub detection_ms: f64,
    pub detection_postprocess_ms: f64,
    /// 裁剪 + 识别 + 解码。
    pub recognition_ms: f64,
    pub total_ms: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OcrResult {
    pub width: usize,
    pub height: usize,
    /// 按阅读顺序排列。
    pub regions: Vec<TextRegion>,
    pub timing: Timing,
}

#[derive(Default)]
struct Buffers {
    input: Vec<f32>,
    output: Vec<f32>,
}

pub struct OcrEngine {
    detector: Box<dyn InferenceBackend>,
    recognizer: Box<dyn InferenceBackend>,
    dictionary: Dictionary,
    detection: DetectionOptions,
    batch_size: usize,
    // 检测和识别各一把锁：两次调用可以一个在检测、一个在识别。
    detection_buffers: Mutex<Buffers>,
    recognition_buffers: Mutex<Buffers>,
}

impl OcrEngine {
    /// 加载两个模型和字典。
    pub fn create(options: EngineOptions) -> Result<Self, OcrError> {
        if options.intra_threads == 0 || options.recognition_batch_size == 0 {
            return Err(OcrError::InvalidInput(
                "intraThreads 和 recognitionBatchSize 都要大于 0".into(),
            ));
        }
        let text =
            std::fs::read_to_string(&options.dictionary).map_err(|error| OcrError::Model {
                path: options.dictionary.clone(),
                message: format!("字典读不了：{error}"),
            })?;
        let dictionary = Dictionary::parse(&text).map_err(|message| OcrError::Model {
            path: options.dictionary.clone(),
            message,
        })?;
        let session = SessionOptions {
            intra_threads: options.intra_threads,
        };
        let detector = OrtBackend::load(&options.detection_model, session)?;
        let recognizer = OrtBackend::load(&options.recognition_model, session)?;
        Self::with_backends(
            Box::new(detector),
            Box::new(recognizer),
            dictionary,
            options.detection,
            options.recognition_batch_size,
        )
        .map_err(|error| match error {
            // 类别数对不上：说清是哪个识别模型和哪个字典。
            OcrError::InvalidInput(message) => OcrError::Model {
                path: options.recognition_model.clone(),
                message: format!("{message}（字典 {}）", options.dictionary.display()),
            },
            other => other,
        })
    }

    /// 用给定的后端组装（测试里用假后端）。识别模型声明的类别数和字典对不上时报错。
    pub fn with_backends(
        detector: Box<dyn InferenceBackend>,
        recognizer: Box<dyn InferenceBackend>,
        dictionary: Dictionary,
        detection: DetectionOptions,
        batch_size: usize,
    ) -> Result<Self, OcrError> {
        if let Some(Some(classes)) = recognizer.declared_output_shape().last() {
            if *classes != dictionary.class_count() {
                return Err(OcrError::InvalidInput(format!(
                    "识别模型输出 {classes} 类，字典是 {} 个字 + blank + 空格 = {} 类：模型和字典不是一套",
                    dictionary.class_count() - 2,
                    dictionary.class_count()
                )));
            }
        }
        Ok(Self {
            detector,
            recognizer,
            dictionary,
            detection,
            batch_size: batch_size.max(1),
            detection_buffers: Mutex::new(Buffers::default()),
            recognition_buffers: Mutex::new(Buffers::default()),
        })
    }

    pub fn recognize(&self, image: &ImageView<'_>) -> Result<OcrResult, OcrError> {
        let started = Instant::now();
        let mut timing = Timing::default();
        let (padded_w, padded_h) = padded_size(image.width(), image.height());
        let (det_w, det_h) = detection_size(padded_w, padded_h, &self.detection);

        let boxes = {
            let mut buffers = self
                .detection_buffers
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let Buffers { input, output } = &mut *buffers;
            let step = Instant::now();
            write_detection_input(image, det_w, det_h, input);
            timing.preprocess_ms = elapsed_ms(step);

            let step = Instant::now();
            let shape = self.detector.run(
                InferenceInput {
                    shape: [1, 3, det_h, det_w],
                    data: input,
                },
                output,
            )?;
            timing.detection_ms = elapsed_ms(step);
            if shape.len() != 4 || shape[2] != det_h || shape[3] != det_w {
                return Err(OcrError::Inference(format!(
                    "检测模型输出形状 {shape:?}，应为 [1, 1, {det_h}, {det_w}]"
                )));
            }

            let step = Instant::now();
            let map = ProbabilityMap {
                data: &output[..det_w * det_h],
                width: det_w,
                height: det_h,
            };
            let boxes = text_boxes(map, padded_w, padded_h, &self.detection);
            timing.detection_postprocess_ms = elapsed_ms(step);
            boxes
        };

        let step = Instant::now();
        let quads: Vec<Quad> = boxes.iter().map(|text_box| text_box.quad).collect();
        let order = reading_order(&quads);
        let texts =
            self.recognize_lines(image, &order.iter().map(|&i| quads[i]).collect::<Vec<_>>())?;
        let regions = order
            .iter()
            .zip(texts)
            .map(|(&index, (text, recognition_score))| TextRegion {
                quad: boxes[index].quad,
                text,
                detection_score: boxes[index].score,
                recognition_score,
            })
            .collect();
        timing.recognition_ms = elapsed_ms(step);
        timing.total_ms = elapsed_ms(started);
        Ok(OcrResult {
            width: image.width(),
            height: image.height(),
            regions,
            timing,
        })
    }

    /// 裁出每一行，按宽高比分批，每批一次推理；结果按 `quads` 的顺序返回。裁不出来的行（退化的框）是空字符串、0 分。
    fn recognize_lines(
        &self,
        image: &ImageView<'_>,
        quads: &[Quad],
    ) -> Result<Vec<(String, f32)>, OcrError> {
        let crops: Vec<_> = quads.iter().map(|quad| crop_quad(image, quad)).collect();
        let mut results = vec![(String::new(), 0.0); quads.len()];
        let readable: Vec<usize> = (0..crops.len()).filter(|&i| crops[i].is_some()).collect();
        let ratios: Vec<f64> = readable
            .iter()
            .filter_map(|&i| crops[i].as_ref())
            .map(|crop| crop.width() as f64 / crop.height() as f64)
            .collect();
        let mut buffers = self
            .recognition_buffers
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let Buffers { input, output } = &mut *buffers;
        for batch in batches(&ratios, self.batch_size) {
            let lines: Vec<_> = batch
                .iter()
                .filter_map(|&k| crops[readable[k]].as_ref())
                .collect();
            let batch_width = lines
                .iter()
                .map(|line| padded_width(line.width(), line.height()))
                .max()
                .unwrap_or(0);
            input.clear();
            input.resize(lines.len() * 3 * RECOGNITION_HEIGHT * batch_width, 0.0);
            for (slot, line) in lines.iter().enumerate() {
                write_recognition_input(line, slot, batch_width, input);
            }
            let shape = self.recognizer.run(
                InferenceInput {
                    shape: [lines.len(), 3, RECOGNITION_HEIGHT, batch_width],
                    data: input,
                },
                output,
            )?;
            let [count, steps, classes] = shape[..] else {
                return Err(OcrError::Inference(format!(
                    "识别模型输出形状 {shape:?}，应为 [批大小, 时间步, 类别数]"
                )));
            };
            if count != lines.len() || classes != self.dictionary.class_count() {
                return Err(OcrError::Inference(format!(
                    "识别模型输出形状 {shape:?}，应为 [{}, 时间步, {}]",
                    lines.len(),
                    self.dictionary.class_count()
                )));
            }
            for (slot, &k) in batch.iter().enumerate() {
                let probabilities = &output[slot * steps * classes..(slot + 1) * steps * classes];
                let recognized = decode(probabilities, steps, classes, &self.dictionary);
                results[readable[k]] = (recognized.text, recognized.score);
            }
        }
        Ok(results)
    }
}

fn elapsed_ms(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::PixelFormat;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// 假检测：概率图里画几条横带，每条是一行字。
    struct FakeDetector {
        lines: usize,
    }

    impl InferenceBackend for FakeDetector {
        fn run(
            &self,
            input: InferenceInput<'_>,
            output: &mut Vec<f32>,
        ) -> Result<Vec<usize>, OcrError> {
            let [_, _, height, width] = input.shape;
            output.clear();
            output.resize(width * height, 0.0);
            for line in 0..self.lines {
                let top = 8 + line * 16;
                for y in top..top + 8 {
                    for x in 8..width - 8 {
                        output[y * width + x] = 0.9;
                    }
                }
            }
            Ok(vec![1, 1, height, width])
        }

        fn declared_output_shape(&self) -> Vec<Option<usize>> {
            vec![None, Some(1), None, None]
        }
    }

    /// 假识别：每一行都读成 "A"，并记下被调用了几次。
    struct FakeRecognizer {
        classes: usize,
        calls: Arc<AtomicUsize>,
    }

    impl InferenceBackend for FakeRecognizer {
        fn run(
            &self,
            input: InferenceInput<'_>,
            output: &mut Vec<f32>,
        ) -> Result<Vec<usize>, OcrError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let [count, ..] = input.shape;
            let steps = 2;
            output.clear();
            for _ in 0..count * steps {
                let mut row = vec![0.0; self.classes];
                row[1] = 1.0;
                output.extend(row);
            }
            Ok(vec![count, steps, self.classes])
        }

        fn declared_output_shape(&self) -> Vec<Option<usize>> {
            vec![None, None, Some(self.classes)]
        }
    }

    fn engine(lines: usize, batch_size: usize, calls: Arc<AtomicUsize>) -> OcrEngine {
        let dictionary = Dictionary::parse("A\nB\n").unwrap();
        OcrEngine::with_backends(
            Box::new(FakeDetector { lines }),
            Box::new(FakeRecognizer {
                classes: dictionary.class_count(),
                calls,
            }),
            dictionary,
            DetectionOptions::default(),
            batch_size,
        )
        .unwrap()
    }

    #[test]
    fn recognizes_lines_in_batches_not_one_by_one() {
        let calls = Arc::new(AtomicUsize::new(0));
        let engine = engine(5, 2, Arc::clone(&calls));
        let pixels = vec![255u8; 320 * 96 * 4];
        let image = ImageView::new(&pixels, 320, 96, 320 * 4, PixelFormat::Bgra).unwrap();
        let result = engine.recognize(&image).unwrap();
        assert_eq!(result.regions.len(), 5);
        assert!(result.regions.iter().all(|region| region.text == "A"));
        // 5 行、每批 2 行：3 次推理。
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        // 按阅读顺序：从上到下。
        let tops: Vec<f64> = result
            .regions
            .iter()
            .map(|region| region.quad[0].y)
            .collect();
        assert!(tops.windows(2).all(|pair| pair[0] < pair[1]), "{tops:?}");
    }

    #[test]
    fn refuses_a_dictionary_that_does_not_match_the_model() {
        let result = OcrEngine::with_backends(
            Box::new(FakeDetector { lines: 1 }),
            Box::new(FakeRecognizer {
                classes: 99,
                calls: Arc::default(),
            }),
            Dictionary::parse("A\nB\n").unwrap(),
            DetectionOptions::default(),
            8,
        );
        assert!(matches!(result, Err(OcrError::InvalidInput(message)) if message.contains("99")));
    }

    #[test]
    fn returns_no_regions_for_an_empty_page() {
        let calls = Arc::new(AtomicUsize::new(0));
        let engine = engine(0, 8, Arc::clone(&calls));
        let pixels = vec![255u8; 64 * 64 * 3];
        let image = ImageView::new(&pixels, 64, 64, 64 * 3, PixelFormat::Rgb).unwrap();
        let result = engine.recognize(&image).unwrap();
        assert!(result.regions.is_empty());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
