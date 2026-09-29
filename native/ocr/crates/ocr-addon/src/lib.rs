//! 给 Bun / Node.js 用的 Node-API 扩展（同一个 .node 两边共用）。
//! 模型加载和识别都在 libuv 的线程池上跑（AsyncTask），不阻塞 JS 事件循环。
//! TypeScript 的类型和参数校验在 native/ocr/node/src/index.ts。

use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use napi::bindgen_prelude::{AsyncTask, Uint8Array};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use ocr_core::engine::{DEFAULT_INTRA_THREADS, DEFAULT_RECOGNITION_BATCH_SIZE};
use ocr_core::{
    DetectionOptions, EngineOptions, ImageView, LimitType, OcrEngine, OcrError, OcrResult,
    PixelFormat,
};

fn to_js_error(error: OcrError) -> Error {
    let status = match error {
        OcrError::InvalidInput(_) => Status::InvalidArg,
        OcrError::Model { .. } | OcrError::Inference(_) => Status::GenericFailure,
    };
    Error::new(status, error.to_string())
}

fn invalid(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

/// 检测和 DB 后处理的参数；不填的用官方 OCR 流水线的默认值。
#[napi(object)]
pub struct DetectionConfig {
    pub limit_side_len: Option<u32>,
    /// "min" 或 "max"。
    pub limit_type: Option<String>,
    pub max_side_limit: Option<u32>,
    pub thresh: Option<f64>,
    pub box_thresh: Option<f64>,
    pub unclip_ratio: Option<f64>,
    pub max_candidates: Option<u32>,
}

#[napi(object)]
pub struct EngineConfig {
    pub det_model_path: String,
    pub rec_model_path: String,
    pub dictionary_path: String,
    pub intra_threads: Option<u32>,
    pub recognition_batch_size: Option<u32>,
    pub detection: Option<DetectionConfig>,
}

fn detection_options(config: Option<DetectionConfig>) -> Result<DetectionOptions> {
    let defaults = DetectionOptions::default();
    let Some(config) = config else {
        return Ok(defaults);
    };
    let limit_type = match config.limit_type.as_deref() {
        None => defaults.limit_type,
        Some("min") => LimitType::Min,
        Some("max") => LimitType::Max,
        Some(other) => {
            return Err(invalid(format!(
                "limitType 只能是 min 或 max，收到 {other}"
            )))
        }
    };
    Ok(DetectionOptions {
        limit_side_len: config.limit_side_len.unwrap_or(defaults.limit_side_len),
        limit_type,
        max_side_limit: config.max_side_limit.unwrap_or(defaults.max_side_limit),
        thresh: config.thresh.map_or(defaults.thresh, |v| v as f32),
        box_thresh: config.box_thresh.map_or(defaults.box_thresh, |v| v as f32),
        unclip_ratio: config
            .unclip_ratio
            .map_or(defaults.unclip_ratio, |v| v as f32),
        max_candidates: config
            .max_candidates
            .map_or(defaults.max_candidates, |v| v as usize),
    })
}

pub struct CreateTask {
    options: Option<EngineOptions>,
}

impl Task for CreateTask {
    type Output = OcrEngine;
    type JsValue = NativeOcrEngine;

    fn compute(&mut self) -> Result<OcrEngine> {
        let options = self
            .options
            .take()
            .ok_or_else(|| Error::from_reason("引擎已经创建过"))?;
        OcrEngine::create(options).map_err(to_js_error)
    }

    fn resolve(&mut self, _env: Env, engine: OcrEngine) -> Result<NativeOcrEngine> {
        Ok(NativeOcrEngine {
            engine: Mutex::new(Some(Arc::new(engine))),
        })
    }
}

/// 加载模型、创建引擎（在线程池上，不阻塞事件循环）。
#[napi]
pub fn create_engine(config: EngineConfig) -> Result<AsyncTask<CreateTask>> {
    let options = EngineOptions {
        detection_model: PathBuf::from(config.det_model_path),
        recognition_model: PathBuf::from(config.rec_model_path),
        dictionary: PathBuf::from(config.dictionary_path),
        intra_threads: config
            .intra_threads
            .map_or(DEFAULT_INTRA_THREADS, |v| v as usize),
        recognition_batch_size: config
            .recognition_batch_size
            .map_or(DEFAULT_RECOGNITION_BATCH_SIZE, |v| v as usize),
        detection: detection_options(config.detection)?,
    };
    Ok(AsyncTask::new(CreateTask {
        options: Some(options),
    }))
}

#[napi(object)]
pub struct RecognizeInput {
    /// 像素。识别结束之前调用方不要改这块内存：工作线程直接读它，不复制。
    pub data: Uint8Array,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    /// "BGRA"、"RGBA"、"BGR" 或 "RGB"。
    pub pixel_format: String,
}

#[napi(object)]
pub struct JsPoint {
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
pub struct JsRegion {
    #[napi(js_name = "box")]
    pub quad: Vec<JsPoint>,
    pub text: String,
    pub detection_score: f64,
    pub recognition_score: f64,
}

#[napi(object)]
pub struct JsTiming {
    pub preprocess_ms: f64,
    pub detection_ms: f64,
    pub detection_postprocess_ms: f64,
    pub recognition_ms: f64,
    pub total_ms: f64,
}

#[napi(object)]
pub struct JsOcrResult {
    pub width: u32,
    pub height: u32,
    pub regions: Vec<JsRegion>,
    pub timing: JsTiming,
}

fn to_js_result(result: OcrResult) -> JsOcrResult {
    JsOcrResult {
        width: result.width as u32,
        height: result.height as u32,
        regions: result
            .regions
            .into_iter()
            .map(|region| JsRegion {
                quad: region
                    .quad
                    .iter()
                    .map(|point| JsPoint {
                        x: point.x,
                        y: point.y,
                    })
                    .collect(),
                text: region.text,
                detection_score: f64::from(region.detection_score),
                recognition_score: f64::from(region.recognition_score),
            })
            .collect(),
        timing: JsTiming {
            preprocess_ms: result.timing.preprocess_ms,
            detection_ms: result.timing.detection_ms,
            detection_postprocess_ms: result.timing.detection_postprocess_ms,
            recognition_ms: result.timing.recognition_ms,
            total_ms: result.timing.total_ms,
        },
    }
}

pub struct RecognizeTask {
    engine: Arc<OcrEngine>,
    data: Uint8Array,
    width: usize,
    height: usize,
    stride: usize,
    format: PixelFormat,
}

impl Task for RecognizeTask {
    type Output = OcrResult;
    type JsValue = JsOcrResult;

    fn compute(&mut self) -> Result<OcrResult> {
        let image = ImageView::new(
            &self.data,
            self.width,
            self.height,
            self.stride,
            self.format,
        )
        .map_err(to_js_error)?;
        self.engine.recognize(&image).map_err(to_js_error)
    }

    fn resolve(&mut self, _env: Env, output: OcrResult) -> Result<JsOcrResult> {
        Ok(to_js_result(output))
    }
}

fn pixel_format(name: &str) -> Result<PixelFormat> {
    match name {
        "BGRA" => Ok(PixelFormat::Bgra),
        "RGBA" => Ok(PixelFormat::Rgba),
        "BGR" => Ok(PixelFormat::Bgr),
        "RGB" => Ok(PixelFormat::Rgb),
        other => Err(invalid(format!(
            "pixelFormat 只能是 BGRA、RGBA、BGR、RGB，收到 {other}"
        ))),
    }
}

/// 一个引擎：两个模型会话和字典。关闭后不能再用；正在进行的识别各自持有引擎，结束后才真正释放。
#[napi]
pub struct NativeOcrEngine {
    engine: Mutex<Option<Arc<OcrEngine>>>,
}

#[napi]
impl NativeOcrEngine {
    #[napi]
    pub fn recognize(&self, input: RecognizeInput) -> Result<AsyncTask<RecognizeTask>> {
        let engine = self
            .engine
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
            .ok_or_else(|| invalid("引擎已经关闭"))?;
        let format = pixel_format(&input.pixel_format)?;
        // 在 JS 线程上先查一遍尺寸，参数不对时立刻报错，不进线程池。
        ImageView::new(
            &input.data,
            input.width as usize,
            input.height as usize,
            input.stride as usize,
            format,
        )
        .map_err(to_js_error)?;
        Ok(AsyncTask::new(RecognizeTask {
            engine,
            data: input.data,
            width: input.width as usize,
            height: input.height as usize,
            stride: input.stride as usize,
            format,
        }))
    }

    #[napi]
    pub fn close(&self) {
        self.engine
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
    }
}
