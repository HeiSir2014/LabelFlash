//! 本地 OCR 引擎：PP-OCRv6 文字检测 + 识别，不依赖 Python、外部程序和云服务。
//! 流水线和参数来源见 docs/superpowers/specs/2026-09-30-ocr-engine-design.md。

pub mod ctc;
pub mod detection;
pub mod error;
pub mod geometry;
pub mod image;
pub mod reading_order;
pub mod recognition;

pub use error::OcrError;
