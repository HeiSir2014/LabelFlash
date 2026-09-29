//! 用真实模型和一张真实的标签照片跑整条流水线。模型由 `bun run ocr:models` 下载到仓库的 models/；
//! 没下载时这些测试跳过（打印原因），不算失败。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use ocr_core::engine::{DEFAULT_INTRA_THREADS, DEFAULT_RECOGNITION_BATCH_SIZE};
use ocr_core::{DetectionOptions, EngineOptions, ImageView, OcrEngine, OcrResult, PixelFormat};

/// 样张：标签横放着拍（字是竖的），上面有货架号 A-1-2-3 和款号 CL5640-TK。
const FIXTURE: &str = "../../fixtures/shelf-label.jpg";
const SHELF_NUMBER: &str = "A-1-2-3";
const STYLE_CODE: &str = "CL5640-TK";

fn models_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../models")
}

fn engine(detection: &str, recognition: &str) -> Option<OcrEngine> {
    let dir = models_dir();
    let options = EngineOptions {
        detection_model: dir.join(detection).join("det.onnx"),
        recognition_model: dir.join(recognition).join("rec.onnx"),
        dictionary: dir.join(recognition).join("dict.txt"),
        intra_threads: DEFAULT_INTRA_THREADS,
        recognition_batch_size: DEFAULT_RECOGNITION_BATCH_SIZE,
        detection: DetectionOptions::default(),
    };
    if !options.detection_model.is_file() || !options.recognition_model.is_file() {
        eprintln!("跳过：没有模型（先运行 bun run ocr:models）");
        return None;
    }
    Some(OcrEngine::create(options).expect("engine loads"))
}

/// 样张解码成紧密排列的 RGB。
fn fixture() -> (Vec<u8>, usize, usize) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(FIXTURE);
    let mut decoder =
        jpeg_decoder::Decoder::new(std::fs::File::open(path).expect("fixture exists"));
    let pixels = decoder.decode().expect("fixture decodes");
    let info = decoder.info().expect("fixture has info");
    assert_eq!(info.pixel_format, jpeg_decoder::PixelFormat::RGB24);
    (pixels, usize::from(info.width), usize::from(info.height))
}

fn texts(result: &OcrResult) -> Vec<&str> {
    result
        .regions
        .iter()
        .map(|region| region.text.as_str())
        .collect()
}

fn recognize(
    engine: &OcrEngine,
    pixels: &[u8],
    width: usize,
    height: usize,
    format: PixelFormat,
) -> OcrResult {
    let stride = width * format.bytes_per_pixel();
    let image = ImageView::new(pixels, width, height, stride, format).expect("valid image");
    engine.recognize(&image).expect("recognizes")
}

/// RGB 转成别的格式（RGBA/BGRA 的 alpha 填 255）。
fn convert(rgb: &[u8], format: PixelFormat) -> Vec<u8> {
    rgb.chunks_exact(3)
        .flat_map(|p| match format {
            PixelFormat::Rgb => vec![p[0], p[1], p[2]],
            PixelFormat::Bgr => vec![p[2], p[1], p[0]],
            PixelFormat::Rgba => vec![p[0], p[1], p[2], 255],
            PixelFormat::Bgra => vec![p[2], p[1], p[0], 255],
        })
        .collect()
}

/// 打印每一段的结果，方便对照。
fn report(label: &str, result: &OcrResult) {
    eprintln!("{label}: {:?} {:?}", texts(result), result.timing);
    for region in &result.regions {
        eprintln!(
            "  {:?} det {:.3} rec {:.3} {:?}",
            region.text, region.detection_score, region.recognition_score, region.quad
        );
    }
}

// 货架号要用 small 识别模型：tiny 识别把热敏纸上的 A 读成了 4（见下一个测试）。检测用 tiny 就够。
#[test]
fn reads_the_shelf_number_with_the_small_recognizer() {
    let (pixels, width, height) = fixture();
    for (detection, recognition) in [("tiny", "small"), ("small", "small")] {
        let Some(engine) = engine(detection, recognition) else {
            return;
        };
        let result = recognize(&engine, &pixels, width, height, PixelFormat::Rgb);
        report(&format!("{detection} det + {recognition} rec"), &result);
        assert!(
            texts(&result).contains(&SHELF_NUMBER),
            "{detection}/{recognition}: {:?}",
            texts(&result)
        );
        assert!(
            texts(&result).iter().any(|text| text.contains(STYLE_CODE)),
            "{detection}/{recognition}: {:?}",
            texts(&result)
        );
        let shelf = result
            .regions
            .iter()
            .find(|region| region.text == SHELF_NUMBER)
            .unwrap();
        assert!(shelf.recognition_score > 0.8, "{}", shelf.recognition_score);
        assert!(shelf.detection_score > 0.6, "{}", shelf.detection_score);
        for point in shelf.quad {
            assert!(
                point.x >= 0.0
                    && point.x <= width as f64
                    && point.y >= 0.0
                    && point.y <= height as f64
            );
        }
    }
}

// 已知的局限：tiny 识别模型把这张标签上的 A 读成 4，其余部分读对。记下来，换模型时能看出变化。
#[test]
fn tiny_recognizer_reads_the_digits_of_the_shelf_number() {
    let Some(engine) = engine("tiny", "tiny") else {
        return;
    };
    let (pixels, width, height) = fixture();
    let result = recognize(&engine, &pixels, width, height, PixelFormat::Rgb);
    report("tiny det + tiny rec", &result);
    assert!(
        texts(&result).iter().any(|text| text.ends_with("-1-2-3")),
        "{:?}",
        texts(&result)
    );
}

#[test]
fn gives_the_same_result_for_every_pixel_format() {
    let Some(engine) = engine("tiny", "tiny") else {
        return;
    };
    let (rgb, width, height) = fixture();
    let expected = recognize(&engine, &rgb, width, height, PixelFormat::Rgb);
    for format in [PixelFormat::Bgr, PixelFormat::Rgba, PixelFormat::Bgra] {
        let actual = recognize(&engine, &convert(&rgb, format), width, height, format);
        assert_eq!(actual.regions, expected.regions, "{format:?}");
    }
}

#[test]
fn serves_concurrent_calls_from_one_engine() {
    let Some(engine) = engine("tiny", "tiny") else {
        return;
    };
    let engine = Arc::new(engine);
    let (rgb, width, height) = fixture();
    let rgb = Arc::new(rgb);
    let expected = recognize(&engine, &rgb, width, height, PixelFormat::Rgb).regions;
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let (engine, rgb) = (Arc::clone(&engine), Arc::clone(&rgb));
            std::thread::spawn(move || {
                recognize(&engine, &rgb, width, height, PixelFormat::Rgb).regions
            })
        })
        .collect();
    for worker in workers {
        assert_eq!(worker.join().expect("worker finishes"), expected);
    }
}
