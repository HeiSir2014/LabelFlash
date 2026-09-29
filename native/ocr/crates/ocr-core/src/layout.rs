//! 第二类检测模型（版面、标签、物体检测）的接口：只定义结果和 trait，这一阶段没有实现。
//! 和 OCR 互不依赖：OCR 不需要它，它也不需要 OCR。

use crate::geometry::Quad;
use crate::image::ImageView;
use crate::OcrError;

/// 检测到的一个区域：四点框、类别名和置信度。
#[derive(Clone, Debug, PartialEq)]
pub struct Detection {
    pub quad: Quad,
    pub label: String,
    pub confidence: f32,
}

pub trait RegionDetector: Send + Sync {
    fn detect(&self, image: &ImageView<'_>) -> Result<Vec<Detection>, OcrError>;
}
