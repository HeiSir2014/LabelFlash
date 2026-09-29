//! 识别前的准备：按四边形透视裁剪（官方 get_minarea_rect_crop + get_rotate_crop_image）、
//! 按宽高比分批、缩放补齐（官方 OCRReisizeNormImg + ToBatch）。

use crate::geometry::{convex_hull, min_area_rect, ordered_corners, Homography, Point, Quad};
use crate::image::{resize_bilinear, sample_bicubic, BgrImage, BgrSource};

/// 识别网络的输入高度（inference.yml 的 RecResizeImg.image_shape）。
pub const RECOGNITION_HEIGHT: usize = 48;
/// 至少按 320 宽补齐（同上，image_shape 的宽度）。
const RECOGNITION_BASE_WIDTH: f64 = 320.0;
/// 一行最宽 3200（官方的 max_img_w），再宽就压扁。
pub const RECOGNITION_MAX_WIDTH: usize = 3200;
/// 高是宽的 1.5 倍以上算竖排，转 90° 再识别（官方的固定值）。
const VERTICAL_RATIO: f64 = 1.5;
/// 截断前加的一点余量：浮点误差让 20 算成 19.999999 时，不能截成 19。
const TRUNCATE_TOLERANCE: f64 = 1e-6;

/// 按四边形裁出一行字：先取最小外接矩形排好四角，再透视变换成矩形（双三次、边缘复制）；竖排的转成横的。
/// 宽或高不到 1 像素时返回 None。
pub fn crop_quad<S: BgrSource>(source: &S, quad: &Quad) -> Option<BgrImage> {
    let [tl, tr, br, bl] = ordered_corners(&min_area_rect(&convex_hull(quad)));
    // Python 的 int()：截断。
    let width = (tl.distance(tr).max(br.distance(bl)) + TRUNCATE_TOLERANCE).trunc();
    let height = (tl.distance(bl).max(tr.distance(br)) + TRUNCATE_TOLERANCE).trunc();
    if width < 1.0 || height < 1.0 {
        return None;
    }
    let target = [
        Point::new(0.0, 0.0),
        Point::new(width, 0.0),
        Point::new(width, height),
        Point::new(0.0, height),
    ];
    // 目标像素 → 原图坐标：直接求反方向的变换，每个像素取样一次。
    let to_source = Homography::from_points(&target, &[tl, tr, br, bl])?;
    let crop = BgrImage::from_fn(width as usize, height as usize, |x, y| {
        let at = to_source.apply(Point::new(x as f64, y as f64));
        sample_bicubic(source, at.x, at.y)
    });
    Some(if height / width >= VERTICAL_RATIO {
        crop.rotate_counterclockwise()
    } else {
        crop
    })
}

/// 这一行补齐后的宽度：`int(48 × max(320/48, 宽/高))`，最多 3200。同一批按其中最宽的补齐。
pub fn padded_width(width: usize, height: usize) -> usize {
    let ratio =
        (RECOGNITION_BASE_WIDTH / RECOGNITION_HEIGHT as f64).max(width as f64 / height as f64);
    ((RECOGNITION_HEIGHT as f64 * ratio) as usize).min(RECOGNITION_MAX_WIDTH)
}

/// 这一行缩放后的宽度：按比例 `ceil(48 × 宽/高)`，不超过补齐宽度；超过 3200 的直接压到 3200。
pub fn resized_width(width: usize, height: usize) -> usize {
    let ratio =
        (RECOGNITION_BASE_WIDTH / RECOGNITION_HEIGHT as f64).max(width as f64 / height as f64);
    let target = (RECOGNITION_HEIGHT as f64 * ratio) as usize;
    if target > RECOGNITION_MAX_WIDTH {
        return RECOGNITION_MAX_WIDTH;
    }
    let proportional = (RECOGNITION_HEIGHT as f64 * width as f64 / height as f64).ceil() as usize;
    proportional.min(target)
}

/// 按宽高比从小到大排，每 `batch_size` 个一批（宽度相近的放一批，补齐的空白少）。返回各批的下标。
pub fn batches(aspect_ratios: &[f64], batch_size: usize) -> Vec<Vec<usize>> {
    let mut order: Vec<usize> = (0..aspect_ratios.len()).collect();
    order.sort_by(|&a, &b| aspect_ratios[a].total_cmp(&aspect_ratios[b]));
    order
        .chunks(batch_size.max(1))
        .map(<[usize]>::to_vec)
        .collect()
}

const HALF: f32 = 0.5;
const BYTE_SCALE: f32 = 1.0 / 255.0;

/// 把一行缩放到 `resized_width`×48，归一化到 [−1, 1]，写进批张量的第 `slot` 个位置（CHW，右边留 0 作补齐）。
/// `output` 是 `[batch, 3, 48, batch_width]`，调用方先清零。
pub fn write_recognition_input(
    line: &BgrImage,
    slot: usize,
    batch_width: usize,
    output: &mut [f32],
) {
    let width = resized_width(line.width(), line.height()).min(batch_width);
    let plane = RECOGNITION_HEIGHT * batch_width;
    let base = slot * 3 * plane;
    resize_bilinear(line, width, RECOGNITION_HEIGHT, |x, y, bgr| {
        for channel in 0..3 {
            output[base + channel * plane + y * batch_width + x] =
                (bgr[channel] * BYTE_SCALE - HALF) / HALF;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pads_short_lines_to_320_and_long_ones_to_their_ratio() {
        assert_eq!(padded_width(100, 48), 320);
        assert_eq!(padded_width(960, 48), 960);
        assert_eq!(padded_width(100_000, 10), RECOGNITION_MAX_WIDTH);
    }

    #[test]
    fn keeps_the_aspect_ratio_when_resizing() {
        // 100×48：按比例 100 宽，补齐到 320。
        assert_eq!(resized_width(100, 48), 100);
        // 100×30：ceil(48 × 3.33) = 160。
        assert_eq!(resized_width(100, 30), 160);
        // 超过 3200 的压到 3200。
        assert_eq!(resized_width(100_000, 10), RECOGNITION_MAX_WIDTH);
    }

    #[test]
    fn batches_by_aspect_ratio() {
        assert_eq!(
            batches(&[5.0, 1.0, 3.0, 2.0, 4.0], 2),
            vec![vec![1, 3], vec![2, 4], vec![0]]
        );
    }

    #[test]
    fn crops_an_axis_aligned_box_exactly() {
        let source = BgrImage::from_fn(40, 20, |x, y| [x as u8, y as u8, 0]);
        let quad = [
            Point::new(10.0, 5.0),
            Point::new(30.0, 5.0),
            Point::new(30.0, 15.0),
            Point::new(10.0, 15.0),
        ];
        let crop = crop_quad(&source, &quad).unwrap();
        assert_eq!((crop.width(), crop.height()), (20, 10));
        assert_eq!(crop.pixel(0, 0), [10, 5, 0]);
        assert_eq!(crop.pixel(19, 9), [29, 14, 0]);
    }

    #[test]
    fn turns_a_vertical_line_upright() {
        // 竖条 6×30：高宽比 5，转 90° 后是 30×6。
        let source = BgrImage::from_fn(40, 40, |x, y| [x as u8, y as u8, 0]);
        let quad = [
            Point::new(10.0, 5.0),
            Point::new(16.0, 5.0),
            Point::new(16.0, 35.0),
            Point::new(10.0, 35.0),
        ];
        let crop = crop_quad(&source, &quad).unwrap();
        assert_eq!((crop.width(), crop.height()), (30, 6));
        // 逆时针转：原来右上角到了左上角。
        assert_eq!(crop.pixel(0, 0), [15, 5, 0]);
    }

    #[test]
    fn skips_degenerate_boxes() {
        let source = BgrImage::new(10, 10);
        let point = Point::new(3.0, 3.0);
        assert!(crop_quad(&source, &[point; 4]).is_none());
    }

    #[test]
    fn writes_normalized_pixels_and_leaves_padding_at_zero() {
        let line = BgrImage::from_fn(96, 48, |_, _| [255, 0, 255]);
        let batch_width = 320;
        let mut output = vec![0.0; 2 * 3 * RECOGNITION_HEIGHT * batch_width];
        write_recognition_input(&line, 1, batch_width, &mut output);
        let plane = RECOGNITION_HEIGHT * batch_width;
        let slot = 3 * plane;
        assert!(output[..slot].iter().all(|&v| v == 0.0), "slot 0 untouched");
        assert_eq!(output[slot], 1.0);
        assert_eq!(output[slot + plane], -1.0);
        // 96 宽之后是补齐的 0。
        assert_eq!(output[slot + 96], 0.0);
        assert_eq!(output[slot + 95], 1.0);
    }
}
