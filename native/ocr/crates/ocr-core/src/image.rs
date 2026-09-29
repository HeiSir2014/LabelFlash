//! 像素：调用方给的原始像素（四种格式、任意行跨度）按 BGR 取样，以及和 OpenCV 一致的缩放、取样方式。
//!
//! 官方流水线在 OpenCV 里处理 8 位图：每次缩放、透视变换的结果都先存成 0–255 的整数。
//! 这里每次取样后同样四舍五入到整数，识别和检测看到的像素值和官方一致。

use crate::OcrError;

/// 调用方的像素格式。模型要 BGR，其余格式在取样时换通道顺序，不另外转一份整图。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelFormat {
    Bgra,
    Rgba,
    Bgr,
    Rgb,
}

impl PixelFormat {
    pub const fn bytes_per_pixel(self) -> usize {
        match self {
            Self::Bgra | Self::Rgba => 4,
            Self::Bgr | Self::Rgb => 3,
        }
    }

    /// B、G、R 三个通道在一个像素里的字节位置。
    const fn bgr_offsets(self) -> [usize; 3] {
        match self {
            Self::Bgra | Self::Bgr => [0, 1, 2],
            Self::Rgba | Self::Rgb => [2, 1, 0],
        }
    }
}

/// 能按坐标取 BGR 像素的图：调用方的原图，或者引擎自己裁出来的一块。
pub trait BgrSource {
    fn width(&self) -> usize;
    fn height(&self) -> usize;
    /// 调用方保证坐标在图内。
    fn pixel(&self, x: usize, y: usize) -> [u8; 3];

    /// 越界时取最近的边缘像素（OpenCV 的 BORDER_REPLICATE）。
    fn pixel_clamped(&self, x: isize, y: isize) -> [u8; 3] {
        let x = x.clamp(0, self.width() as isize - 1) as usize;
        let y = y.clamp(0, self.height() as isize - 1) as usize;
        self.pixel(x, y)
    }
}

/// 调用方的像素，不复制：直接从调用方的内存里按 stride 取样。
#[derive(Clone, Copy, Debug)]
pub struct ImageView<'a> {
    data: &'a [u8],
    width: usize,
    height: usize,
    stride: usize,
    bytes_per_pixel: usize,
    offsets: [usize; 3],
}

impl<'a> ImageView<'a> {
    pub fn new(
        data: &'a [u8],
        width: usize,
        height: usize,
        stride: usize,
        format: PixelFormat,
    ) -> Result<Self, OcrError> {
        if width == 0 || height == 0 {
            return Err(OcrError::InvalidInput(format!(
                "图片宽高必须大于 0，收到 {width}×{height}"
            )));
        }
        let bytes_per_pixel = format.bytes_per_pixel();
        let row = width
            .checked_mul(bytes_per_pixel)
            .ok_or_else(|| OcrError::InvalidInput("图片太宽".into()))?;
        if stride < row {
            return Err(OcrError::InvalidInput(format!(
                "stride {stride} 小于一行像素的字节数 {row}（宽 {width} × {bytes_per_pixel}）"
            )));
        }
        let required = stride
            .checked_mul(height - 1)
            .and_then(|bytes| bytes.checked_add(row))
            .ok_or_else(|| OcrError::InvalidInput("图片太大".into()))?;
        if data.len() < required {
            return Err(OcrError::InvalidInput(format!(
                "像素数据只有 {} 字节，{width}×{height}、stride {stride} 至少要 {required} 字节",
                data.len()
            )));
        }
        Ok(Self {
            data,
            width,
            height,
            stride,
            bytes_per_pixel,
            offsets: format.bgr_offsets(),
        })
    }
}

impl BgrSource for ImageView<'_> {
    fn width(&self) -> usize {
        self.width
    }

    fn height(&self) -> usize {
        self.height
    }

    #[inline]
    fn pixel(&self, x: usize, y: usize) -> [u8; 3] {
        let at = y * self.stride + x * self.bytes_per_pixel;
        let [b, g, r] = self.offsets;
        [self.data[at + b], self.data[at + g], self.data[at + r]]
    }
}

/// 引擎自己的一块 BGR 图（裁出来的文字行），紧密排列。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BgrImage {
    width: usize,
    height: usize,
    data: Vec<u8>,
}

impl BgrImage {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            data: vec![0; width * height * 3],
        }
    }

    pub fn from_fn(
        width: usize,
        height: usize,
        mut pixel: impl FnMut(usize, usize) -> [u8; 3],
    ) -> Self {
        let mut image = Self::new(width, height);
        for y in 0..height {
            for x in 0..width {
                image.set(x, y, pixel(x, y));
            }
        }
        image
    }

    pub fn set(&mut self, x: usize, y: usize, value: [u8; 3]) {
        let at = (y * self.width + x) * 3;
        self.data[at..at + 3].copy_from_slice(&value);
    }

    /// 逆时针转 90°（numpy 的 rot90）：竖着的一行字转成横的。
    pub fn rotate_counterclockwise(&self) -> Self {
        let (width, height) = (self.height, self.width);
        Self::from_fn(width, height, |x, y| self.pixel(self.width - 1 - y, x))
    }
}

impl BgrSource for BgrImage {
    fn width(&self) -> usize {
        self.width
    }

    fn height(&self) -> usize {
        self.height
    }

    #[inline]
    fn pixel(&self, x: usize, y: usize) -> [u8; 3] {
        let at = (y * self.width + x) * 3;
        [self.data[at], self.data[at + 1], self.data[at + 2]]
    }
}

/// 在右边和下边补黑，补到至少 `width`×`height`（检测时太小的图先补到 32×32，和官方一致）。
pub struct Padded<'a, S: BgrSource> {
    inner: &'a S,
    width: usize,
    height: usize,
}

impl<'a, S: BgrSource> Padded<'a, S> {
    pub fn new(inner: &'a S, width: usize, height: usize) -> Self {
        Self {
            inner,
            width: width.max(inner.width()),
            height: height.max(inner.height()),
        }
    }
}

impl<S: BgrSource> BgrSource for Padded<'_, S> {
    fn width(&self) -> usize {
        self.width
    }

    fn height(&self) -> usize {
        self.height
    }

    fn pixel(&self, x: usize, y: usize) -> [u8; 3] {
        if x < self.inner.width() && y < self.inner.height() {
            self.inner.pixel(x, y)
        } else {
            [0; 3]
        }
    }
}

/// OpenCV INTER_LINEAR 的一个方向：目标坐标按像素中心对齐到源坐标，取相邻两点和权重。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LinearTap {
    pub first: usize,
    pub second: usize,
    pub weight: f32,
}

pub fn linear_taps(destination: usize, source: usize) -> Vec<LinearTap> {
    let scale = source as f64 / destination as f64;
    (0..destination)
        .map(|index| {
            let position = (index as f64 + 0.5) * scale - 0.5;
            let mut first = position.floor();
            let mut weight = position - first;
            if first < 0.0 {
                first = 0.0;
                weight = 0.0;
            }
            let last = (source - 1) as f64;
            if first >= last {
                first = last;
                weight = 0.0;
            }
            let first = first as usize;
            LinearTap {
                first,
                second: (first + 1).min(source - 1),
                weight: weight as f32,
            }
        })
        .collect()
}

/// 双线性缩放到 `width`×`height`，逐像素交给 `write(x, y, bgr)`；像素值和 OpenCV 一样先取整到 0–255。
pub fn resize_bilinear<S: BgrSource>(
    source: &S,
    width: usize,
    height: usize,
    mut write: impl FnMut(usize, usize, [f32; 3]),
) {
    let columns = linear_taps(width, source.width());
    let rows = linear_taps(height, source.height());
    for (y, row) in rows.iter().enumerate() {
        for (x, column) in columns.iter().enumerate() {
            let top_left = source.pixel(column.first, row.first);
            let top_right = source.pixel(column.second, row.first);
            let bottom_left = source.pixel(column.first, row.second);
            let bottom_right = source.pixel(column.second, row.second);
            let mut bgr = [0.0; 3];
            for channel in 0..3 {
                let top = f32::from(top_left[channel]) * (1.0 - column.weight)
                    + f32::from(top_right[channel]) * column.weight;
                let bottom = f32::from(bottom_left[channel]) * (1.0 - column.weight)
                    + f32::from(bottom_right[channel]) * column.weight;
                bgr[channel] = to_byte(top * (1.0 - row.weight) + bottom * row.weight);
            }
            write(x, y, bgr);
        }
    }
}

/// OpenCV INTER_CUBIC 的系数（A = −0.75）。
fn cubic_weights(fraction: f32) -> [f32; 4] {
    const A: f32 = -0.75;
    let x = fraction;
    let w0 = ((A * (x + 1.0) - 5.0 * A) * (x + 1.0) + 8.0 * A) * (x + 1.0) - 4.0 * A;
    let w1 = ((A + 2.0) * x - (A + 3.0)) * x * x + 1.0;
    let w2 = ((A + 2.0) * (1.0 - x) - (A + 3.0)) * (1.0 - x) * (1.0 - x) + 1.0;
    [w0, w1, w2, 1.0 - w0 - w1 - w2]
}

/// 在源坐标 (x, y) 处双三次取样，越界取边缘像素；结果取整到 0–255。
pub fn sample_bicubic<S: BgrSource>(source: &S, x: f64, y: f64) -> [u8; 3] {
    let base_x = x.floor();
    let base_y = y.floor();
    let weights_x = cubic_weights((x - base_x) as f32);
    let weights_y = cubic_weights((y - base_y) as f32);
    let (base_x, base_y) = (base_x as isize, base_y as isize);
    let mut sum = [0.0f32; 3];
    for (row, weight_y) in weights_y.iter().enumerate() {
        for (column, weight_x) in weights_x.iter().enumerate() {
            let pixel =
                source.pixel_clamped(base_x - 1 + column as isize, base_y - 1 + row as isize);
            for channel in 0..3 {
                sum[channel] += f32::from(pixel[channel]) * weight_x * weight_y;
            }
        }
    }
    sum.map(|value| to_byte(value) as u8)
}

/// 取整到 0–255（OpenCV 的 saturate_cast<uchar>：四舍五入、截到范围内）。
#[inline]
fn to_byte(value: f32) -> f32 {
    value.round().clamp(0.0, 255.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient(width: usize, height: usize, format: PixelFormat) -> Vec<u8> {
        let bpp = format.bytes_per_pixel();
        let mut data = vec![0; width * height * bpp];
        for y in 0..height {
            for x in 0..width {
                let at = (y * width + x) * bpp;
                let [b, g, r] = format.bgr_offsets();
                data[at + b] = (x * 10) as u8;
                data[at + g] = (y * 10) as u8;
                data[at + r] = 200;
            }
        }
        data
    }

    #[test]
    fn reads_the_same_bgr_pixel_from_every_format() {
        for format in [
            PixelFormat::Bgra,
            PixelFormat::Rgba,
            PixelFormat::Bgr,
            PixelFormat::Rgb,
        ] {
            let data = gradient(4, 3, format);
            let view = ImageView::new(&data, 4, 3, 4 * format.bytes_per_pixel(), format).unwrap();
            assert_eq!(view.pixel(3, 2), [30, 20, 200], "{format:?}");
        }
    }

    #[test]
    fn honours_a_stride_with_row_padding() {
        // 每行后面多 8 个字节（例如对齐到 16 字节的帧）：取样要跳过它们。
        let format = PixelFormat::Bgra;
        let tight = gradient(3, 2, format);
        let stride = 3 * 4 + 8;
        let mut padded = vec![0xEE; stride * 2];
        for y in 0..2 {
            padded[y * stride..y * stride + 12].copy_from_slice(&tight[y * 12..y * 12 + 12]);
        }
        let view = ImageView::new(&padded, 3, 2, stride, format).unwrap();
        assert_eq!(view.pixel(2, 1), [20, 10, 200]);
    }

    #[test]
    fn accepts_a_last_row_without_trailing_padding() {
        let data = vec![0u8; 20 + 12];
        assert!(ImageView::new(&data, 3, 2, 20, PixelFormat::Bgra).is_ok());
    }

    #[test]
    fn rejects_inconsistent_sizes() {
        let data = vec![0u8; 10];
        assert!(ImageView::new(&data, 0, 1, 4, PixelFormat::Bgra).is_err());
        assert!(ImageView::new(&data, 2, 1, 7, PixelFormat::Bgra).is_err());
        assert!(ImageView::new(&data, 2, 2, 8, PixelFormat::Bgra).is_err());
    }

    #[test]
    fn maps_pixel_centres_like_opencv_when_resizing() {
        // 4 → 2：目标像素中心 0.5、1.5 对应源坐标 0.5、2.5。
        let taps = linear_taps(2, 4);
        assert_eq!(
            taps[0],
            LinearTap {
                first: 0,
                second: 1,
                weight: 0.5
            }
        );
        assert_eq!(
            taps[1],
            LinearTap {
                first: 2,
                second: 3,
                weight: 0.5
            }
        );
        // 放大时两端贴边：不越界，权重为 0。
        let taps = linear_taps(4, 2);
        assert_eq!(
            taps[0],
            LinearTap {
                first: 0,
                second: 1,
                weight: 0.0
            }
        );
        assert_eq!(
            taps[3],
            LinearTap {
                first: 1,
                second: 1,
                weight: 0.0
            }
        );
    }

    #[test]
    fn resizes_with_rounded_bytes() {
        let source = BgrImage::from_fn(2, 1, |x, _| if x == 0 { [0, 0, 0] } else { [255, 101, 3] });
        let mut out = Vec::new();
        resize_bilinear(&source, 4, 1, |_, _, bgr| out.push(bgr));
        // 源坐标 −0.25→0、0.25、0.75、1.25→1。
        assert_eq!(out[0], [0.0, 0.0, 0.0]);
        assert_eq!(out[1], [64.0, 25.0, 1.0]);
        assert_eq!(out[2], [191.0, 76.0, 2.0]);
        assert_eq!(out[3], [255.0, 101.0, 3.0]);
    }

    #[test]
    fn bicubic_reproduces_pixels_on_integer_coordinates() {
        let source = BgrImage::from_fn(5, 5, |x, y| [(x * 40) as u8, (y * 40) as u8, 7]);
        assert_eq!(sample_bicubic(&source, 2.0, 3.0), [80, 120, 7]);
        // 越界取边缘像素。
        assert_eq!(sample_bicubic(&source, -3.0, 0.0), [0, 0, 7]);
    }

    #[test]
    fn rotates_counterclockwise_like_numpy() {
        // 2×1 的一行 [a, b] 转成 1×2 的一列：上面是 b，下面是 a。
        let row = BgrImage::from_fn(2, 1, |x, _| [x as u8, 0, 0]);
        let column = row.rotate_counterclockwise();
        assert_eq!((column.width(), column.height()), (1, 2));
        assert_eq!(column.pixel(0, 0), [1, 0, 0]);
        assert_eq!(column.pixel(0, 1), [0, 0, 0]);
    }

    #[test]
    fn pads_with_black_on_the_right_and_bottom() {
        let source = BgrImage::from_fn(2, 2, |_, _| [9, 9, 9]);
        let padded = Padded::new(&source, 32, 32);
        assert_eq!((padded.width(), padded.height()), (32, 32));
        assert_eq!(padded.pixel(1, 1), [9, 9, 9]);
        assert_eq!(padded.pixel(2, 0), [0, 0, 0]);
    }
}
