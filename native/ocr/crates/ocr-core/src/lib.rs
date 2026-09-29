//! 本地 OCR 引擎：PP-OCRv6 文字检测 + 识别，不依赖 Python、外部程序和云服务。
//! 流水线和参数来源见 docs/superpowers/specs/2026-09-30-ocr-engine-design.md。

pub mod ctc;
pub mod detection;
pub mod engine;
pub mod error;
pub mod geometry;
pub mod image;
pub mod inference;
pub mod layout;
pub mod postprocess;
pub mod reading_order;
pub mod recognition;

pub use detection::{DetectionOptions, LimitType};
pub use engine::{EngineOptions, OcrEngine, OcrResult, TextRegion, Timing};
pub use error::OcrError;
pub use image::{ImageView, PixelFormat};
