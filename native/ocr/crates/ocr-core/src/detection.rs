//! 检测的参数、输入尺寸和预处理（官方 DetResizeForTest + NormalizeImage + ToCHWImage）。

use crate::image::{resize_bilinear, BgrSource, Padded};

/// 缩放时按短边（Min）还是长边（Max）对齐 `limit_side_len`。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LimitType {
    Min,
    Max,
}

/// 检测和 DB 后处理的参数。默认值取官方 OCR 流水线（PaddleX 的 OCR.yaml），见设计文档第 3 节。
#[derive(Clone, Debug, PartialEq)]
pub struct DetectionOptions {
    pub limit_side_len: u32,
    pub limit_type: LimitType,
    pub max_side_limit: u32,
    /// 概率图二值化的阈值。
    pub thresh: f32,
    /// 框内平均概率低于它的框丢掉。
    pub box_thresh: f32,
    /// 框向外扩的比例（文字区域在训练时是向内缩过的）。
    pub unclip_ratio: f32,
    pub max_candidates: usize,
}

impl Default for DetectionOptions {
    fn default() -> Self {
        Self {
            limit_side_len: 64,
            limit_type: LimitType::Min,
            max_side_limit: 4000,
            thresh: 0.3,
            box_thresh: 0.6,
            unclip_ratio: 1.5,
            // 官方流水线没有改这一项，用模型自带的值。
            max_candidates: 3000,
        }
    }
}

/// 太小的图先补到这么大（官方在宽 + 高不到 64 时补到 32×32）。
const MIN_PADDED_SIDE: usize = 32;
const MIN_PADDED_SUM: usize = 64;
/// 检测网络要求边长是 32 的倍数。
const SIZE_MULTIPLE: f64 = 32.0;

/// 检测前补过边的图的大小。
pub fn padded_size(width: usize, height: usize) -> (usize, usize) {
    if width + height < MIN_PADDED_SUM {
        (width.max(MIN_PADDED_SIDE), height.max(MIN_PADDED_SIDE))
    } else {
        (width, height)
    }
}

/// 送进检测网络的宽高（官方 resize_image_type0，包括 Python 的 int 截断和 round 的「四舍六入五成双」）。
pub fn detection_size(width: usize, height: usize, options: &DetectionOptions) -> (usize, usize) {
    let (w, h) = (width as f64, height as f64);
    let limit = f64::from(options.limit_side_len);
    let ratio = match options.limit_type {
        LimitType::Max if w.max(h) > limit => {
            if h > w {
                limit / h
            } else {
                limit / w
            }
        }
        LimitType::Min if w.min(h) < limit => {
            if h < w {
                limit / h
            } else {
                limit / w
            }
        }
        _ => 1.0,
    };
    let mut resized_h = (h * ratio).trunc();
    let mut resized_w = (w * ratio).trunc();
    let max_side = f64::from(options.max_side_limit);
    if resized_h.max(resized_w) > max_side {
        let ratio = max_side / resized_h.max(resized_w);
        resized_h = (resized_h * ratio).trunc();
        resized_w = (resized_w * ratio).trunc();
    }
    let round_to_multiple =
        |side: f64| ((side / SIZE_MULTIPLE).round_ties_even() * SIZE_MULTIPLE).max(SIZE_MULTIPLE);
    (
        round_to_multiple(resized_w) as usize,
        round_to_multiple(resized_h) as usize,
    )
}

const DETECTION_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const DETECTION_STD: [f32; 3] = [0.229, 0.224, 0.225];
const BYTE_SCALE: f32 = 1.0 / 255.0;

/// 缩放、归一化，写成 `[1, 3, height, width]` 的 CHW 张量（通道顺序 B、G、R，均值方差按这个顺序套用）。
/// `output` 由调用方复用，这里只按需要的大小调整长度。
pub fn write_detection_input<S: BgrSource>(
    source: &S,
    width: usize,
    height: usize,
    output: &mut Vec<f32>,
) {
    let (padded_w, padded_h) = padded_size(source.width(), source.height());
    let padded = Padded::new(source, padded_w, padded_h);
    let plane = width * height;
    output.clear();
    output.resize(plane * 3, 0.0);
    resize_bilinear(&padded, width, height, |x, y, bgr| {
        let at = y * width + x;
        for channel in 0..3 {
            output[channel * plane + at] =
                (bgr[channel] * BYTE_SCALE - DETECTION_MEAN[channel]) / DETECTION_STD[channel];
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::BgrImage;

    fn options(limit_side_len: u32, limit_type: LimitType) -> DetectionOptions {
        DetectionOptions {
            limit_side_len,
            limit_type,
            ..DetectionOptions::default()
        }
    }

    #[test]
    fn keeps_images_already_past_the_minimum_side() {
        // 短边 480 ≥ 64：不缩放，只取到 32 的倍数。
        assert_eq!(
            detection_size(640, 480, &options(64, LimitType::Min)),
            (640, 480)
        );
        assert_eq!(
            detection_size(1000, 700, &options(64, LimitType::Min)),
            (992, 704)
        );
    }

    #[test]
    fn scales_up_a_thin_strip_to_the_minimum_side() {
        // 短边 40 < 64：比例 1.6，200×40 → 320×64。
        assert_eq!(
            detection_size(200, 40, &options(64, LimitType::Min)),
            (320, 64)
        );
    }

    #[test]
    fn caps_the_longest_side() {
        // 长边 5000 > 4000：缩到 4000×2400，再取 32 的倍数。
        assert_eq!(
            detection_size(5000, 3000, &options(64, LimitType::Min)),
            (4000, 2400)
        );
    }

    #[test]
    fn scales_down_to_the_maximum_side_in_max_mode() {
        assert_eq!(
            detection_size(1920, 1080, &options(960, LimitType::Max)),
            (960, 544)
        );
    }

    #[test]
    fn rounds_half_to_even_like_python() {
        // 48/32 = 1.5 → 2；80/32 = 2.5 → 2（不是 3）。
        let keep = options(1, LimitType::Min);
        assert_eq!(detection_size(48, 80, &keep), (64, 64));
        // 不会小于 32。
        assert_eq!(detection_size(10, 10, &keep), (32, 32));
    }

    #[test]
    fn pads_only_tiny_images() {
        assert_eq!(padded_size(20, 10), (32, 32));
        assert_eq!(padded_size(40, 30), (40, 30));
    }

    #[test]
    fn normalizes_bgr_channels_with_the_imagenet_statistics() {
        let white = BgrImage::from_fn(32, 32, |_, _| [255, 255, 255]);
        let mut input = Vec::new();
        write_detection_input(&white, 32, 32, &mut input);
        assert_eq!(input.len(), 3 * 32 * 32);
        let plane = 32 * 32;
        for channel in 0..3 {
            let expected = (1.0 - DETECTION_MEAN[channel]) / DETECTION_STD[channel];
            assert!((input[channel * plane + 5] - expected).abs() < 1e-6);
        }
    }
}
