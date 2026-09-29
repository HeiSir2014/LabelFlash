//! DB 后处理（官方 DBPostProcess.boxes_from_bitmap，score_mode = fast，box_type = quad）：
//! 概率图 → 二值图 → 每个连通区域的最小外接矩形 → 框分 → 外扩 → 映射回原图。
//!
//! 和官方实现的两处写法不同，对文字行的结果相同：
//! - 官方用 findContours 找轮廓再取最小外接矩形。这里直接按 8 连通找区域、取区域像素的凸包：
//!   轮廓的最小外接矩形只取决于它的凸包，而区域的凸包就是外轮廓的凸包。
//!   官方的 RETR_LIST 还会把区域里的「洞」当作单独的轮廓；这些框落在低概率的洞上，框分通常过不了阈值。
//! - 官方用 pyclipper 把矩形按圆角外扩，再取最小外接矩形。矩形外扩后的最小外接矩形就是四边各向外推同样的距离，
//!   这里直接算（pyclipper 会先把顶点截成整数，这里同样先截断再算，保持一致）。

use crate::detection::DetectionOptions;
use crate::geometry::{
    convex_hull, min_area_rect, ordered_corners, polygon_area, polygon_perimeter, Point, Quad,
};

/// 最小外接矩形的短边小于它的丢掉（官方 min_size）；外扩后的门槛再加 2。
const MIN_SIZE: f64 = 3.0;
const MIN_EXPANDED_SIZE: f64 = MIN_SIZE + 2.0;

/// 检测到的一段文字：四点框（原图坐标，左上、右上、右下、左下）和框内的平均概率。
#[derive(Clone, Debug, PartialEq)]
pub struct TextBox {
    pub quad: Quad,
    pub score: f32,
}

/// 检测网络输出的概率图（和检测输入同样大小）。
#[derive(Clone, Copy, Debug)]
pub struct ProbabilityMap<'a> {
    pub data: &'a [f32],
    pub width: usize,
    pub height: usize,
}

/// 从概率图里找出文字框，坐标映射回 `source_width`×`source_height` 的原图。
pub fn text_boxes(
    map: ProbabilityMap<'_>,
    source_width: usize,
    source_height: usize,
    options: &DetectionOptions,
) -> Vec<TextBox> {
    let width_scale = source_width as f64 / map.width as f64;
    let height_scale = source_height as f64 / map.height as f64;
    let mut boxes = Vec::new();
    for region in regions(map, options.thresh, options.max_candidates) {
        let rect = min_area_rect(&convex_hull(&region));
        if rect.short_side() < MIN_SIZE {
            continue;
        }
        let corners = ordered_corners(&rect);
        let score = box_score(map, &corners);
        if score < options.box_thresh {
            continue;
        }
        let expanded = unclip(&corners, f64::from(options.unclip_ratio));
        let expanded_rect = min_area_rect(&convex_hull(&expanded));
        if expanded_rect.short_side() < MIN_EXPANDED_SIZE {
            continue;
        }
        let quad = ordered_corners(&expanded_rect).map(|point| {
            Point::new(
                (point.x * width_scale)
                    .round_ties_even()
                    .clamp(0.0, source_width as f64),
                (point.y * height_scale)
                    .round_ties_even()
                    .clamp(0.0, source_height as f64),
            )
        });
        boxes.push(TextBox { quad, score });
    }
    boxes
}

/// 概率大于 `thresh` 的像素按 8 连通分成区域，每个区域给出它的像素坐标（只保留每行最左、最右两点，凸包不变）。
fn regions(map: ProbabilityMap<'_>, thresh: f32, max_candidates: usize) -> Vec<Vec<Point>> {
    let (width, height) = (map.width, map.height);
    let foreground = |x: usize, y: usize| map.data[y * width + x] > thresh;
    let mut visited = vec![false; width * height];
    let mut stack = Vec::new();
    let mut regions = Vec::new();
    for start in 0..width * height {
        if regions.len() >= max_candidates {
            break;
        }
        if visited[start] || !foreground(start % width, start / width) {
            continue;
        }
        visited[start] = true;
        stack.push(start);
        // 每行的最左、最右：key 是行号。
        let mut rows: std::collections::BTreeMap<usize, (usize, usize)> =
            std::collections::BTreeMap::new();
        while let Some(index) = stack.pop() {
            let (x, y) = (index % width, index / width);
            rows.entry(y)
                .and_modify(|(left, right)| {
                    *left = (*left).min(x);
                    *right = (*right).max(x);
                })
                .or_insert((x, x));
            for ny in y.saturating_sub(1)..=(y + 1).min(height - 1) {
                for nx in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                    let neighbour = ny * width + nx;
                    if !visited[neighbour] && foreground(nx, ny) {
                        visited[neighbour] = true;
                        stack.push(neighbour);
                    }
                }
            }
        }
        let points = rows
            .into_iter()
            .flat_map(|(y, (left, right))| {
                [
                    Point::new(left as f64, y as f64),
                    Point::new(right as f64, y as f64),
                ]
            })
            .collect();
        regions.push(points);
    }
    regions
}

/// 框内的平均概率（官方 box_score_fast）：顶点截成整数后，框内和框边上的像素都算。
fn box_score(map: ProbabilityMap<'_>, corners: &Quad) -> f32 {
    let clamp = |value: f64, limit: usize| (value.max(0.0) as usize).min(limit - 1);
    let x_min = clamp(
        corners.iter().map(|p| p.x).fold(f64::MAX, f64::min).floor(),
        map.width,
    );
    let x_max = clamp(
        corners.iter().map(|p| p.x).fold(f64::MIN, f64::max).ceil(),
        map.width,
    );
    let y_min = clamp(
        corners.iter().map(|p| p.y).fold(f64::MAX, f64::min).floor(),
        map.height,
    );
    let y_max = clamp(
        corners.iter().map(|p| p.y).fold(f64::MIN, f64::max).ceil(),
        map.height,
    );
    // fillPoly 前先 astype(int32)：减去左上角后截断。
    let polygon =
        corners.map(|p| Point::new((p.x - x_min as f64).trunc(), (p.y - y_min as f64).trunc()));
    let mut sum = 0.0f64;
    let mut count = 0usize;
    for y in y_min..=y_max {
        for x in x_min..=x_max {
            if inside_or_on(&polygon, Point::new((x - x_min) as f64, (y - y_min) as f64)) {
                sum += f64::from(map.data[y * map.width + x]);
                count += 1;
            }
        }
    }
    if count == 0 {
        0.0
    } else {
        (sum / count as f64) as f32
    }
}

/// 点在凸四边形内或边上（四条边的叉积同号或为 0）。
fn inside_or_on(polygon: &Quad, point: Point) -> bool {
    let mut sign = 0.0f64;
    for i in 0..4 {
        let (a, b) = (polygon[i], polygon[(i + 1) % 4]);
        let cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        if cross != 0.0 {
            if sign != 0.0 && cross.signum() != sign {
                return false;
            }
            sign = cross.signum();
        }
    }
    true
}

/// 按 `面积 × ratio / 周长` 的距离把框向外扩，返回外扩后外接矩形的四角。
fn unclip(corners: &Quad, ratio: f64) -> [Point; 4] {
    let distance = polygon_area(corners) * ratio / polygon_perimeter(corners);
    let truncated: Vec<Point> = corners
        .iter()
        .map(|p| Point::new(p.x.trunc(), p.y.trunc()))
        .collect();
    min_area_rect(&convex_hull(&truncated))
        .expanded(distance)
        .corners()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一张全 0 的概率图，按给定的函数在一些位置填上概率。
    fn map_with(width: usize, height: usize, value: impl Fn(usize, usize) -> f32) -> Vec<f32> {
        (0..height)
            .flat_map(|y| (0..width).map(move |x| (x, y)))
            .map(|(x, y)| value(x, y))
            .collect()
    }

    fn options() -> DetectionOptions {
        DetectionOptions::default()
    }

    #[test]
    fn finds_an_axis_aligned_text_line_and_expands_it() {
        // 40×10 的高概率条（x 20..60，y 30..40）。
        let data = map_with(100, 80, |x, y| {
            if (20..60).contains(&x) && (30..40).contains(&y) {
                0.9
            } else {
                0.0
            }
        });
        let boxes = text_boxes(
            ProbabilityMap {
                data: &data,
                width: 100,
                height: 80,
            },
            100,
            80,
            &options(),
        );
        assert_eq!(boxes.len(), 1);
        let TextBox { quad, score } = &boxes[0];
        assert!(*score > 0.85, "{score}");
        // 像素中心 20..59 × 30..39 的外接矩形 39×9，外扩距离 351×1.5/96 ≈ 5.48。
        let [tl, tr, br, bl] = *quad;
        assert_eq!((tl.x, tl.y), (15.0, 25.0));
        assert_eq!((br.x, br.y), (64.0, 44.0));
        assert_eq!((tr.x, tr.y), (64.0, 25.0));
        assert_eq!((bl.x, bl.y), (15.0, 44.0));
    }

    #[test]
    fn maps_boxes_back_to_the_source_size() {
        let data = map_with(100, 80, |x, y| {
            if (20..60).contains(&x) && (30..40).contains(&y) {
                0.9
            } else {
                0.0
            }
        });
        let boxes = text_boxes(
            ProbabilityMap {
                data: &data,
                width: 100,
                height: 80,
            },
            200,
            40,
            &options(),
        );
        let [tl, _, br, _] = boxes[0].quad;
        assert_eq!((tl.x, tl.y), (29.0, 12.0));
        assert_eq!((br.x, br.y), (129.0, 22.0));
    }

    #[test]
    fn clamps_boxes_to_the_image() {
        let data = map_with(50, 20, |x, y| if x < 30 && y < 8 { 0.9 } else { 0.0 });
        let boxes = text_boxes(
            ProbabilityMap {
                data: &data,
                width: 50,
                height: 20,
            },
            50,
            20,
            &options(),
        );
        let [tl, ..] = boxes[0].quad;
        assert_eq!((tl.x, tl.y), (0.0, 0.0));
    }

    #[test]
    fn follows_a_rotated_line() {
        // 沿 20° 斜线的一条带子：框应当顺着它斜，而不是一个大的轴对齐框。
        let angle = 20f64.to_radians();
        let data = map_with(200, 120, |x, y| {
            let (dx, dy) = (x as f64 - 100.0, y as f64 - 60.0);
            let along = dx * angle.cos() + dy * angle.sin();
            let across = -dx * angle.sin() + dy * angle.cos();
            if along.abs() < 60.0 && across.abs() < 6.0 {
                0.95
            } else {
                0.0
            }
        });
        let boxes = text_boxes(
            ProbabilityMap {
                data: &data,
                width: 200,
                height: 120,
            },
            200,
            120,
            &options(),
        );
        assert_eq!(boxes.len(), 1);
        let [tl, tr, ..] = boxes[0].quad;
        let slope = ((tr.y - tl.y) / (tr.x - tl.x)).atan().to_degrees();
        assert!((slope - 20.0).abs() < 1.5, "{slope}");
    }

    #[test]
    fn drops_regions_below_the_box_threshold() {
        // 超过二值化阈值 0.3、但框内平均 0.5 < 0.6。
        let data = map_with(100, 80, |x, y| {
            if (20..60).contains(&x) && (30..40).contains(&y) {
                0.5
            } else {
                0.0
            }
        });
        assert!(text_boxes(
            ProbabilityMap {
                data: &data,
                width: 100,
                height: 80
            },
            100,
            80,
            &options()
        )
        .is_empty());
    }

    #[test]
    fn drops_specks() {
        let data = map_with(50, 50, |x, y| {
            if (10..12).contains(&x) && (10..12).contains(&y) {
                0.99
            } else {
                0.0
            }
        });
        assert!(text_boxes(
            ProbabilityMap {
                data: &data,
                width: 50,
                height: 50
            },
            50,
            50,
            &options()
        )
        .is_empty());
    }

    #[test]
    fn keeps_separate_lines_separate() {
        let data = map_with(100, 100, |x, y| {
            if (10..90).contains(&x) && ((10..20).contains(&y) || (40..52).contains(&y)) {
                0.9
            } else {
                0.0
            }
        });
        assert_eq!(
            text_boxes(
                ProbabilityMap {
                    data: &data,
                    width: 100,
                    height: 100
                },
                100,
                100,
                &options()
            )
            .len(),
            2
        );
    }

    #[test]
    fn stops_at_the_candidate_limit() {
        let data = map_with(100, 100, |x, y| {
            if (10..90).contains(&x) && ((10..20).contains(&y) || (40..52).contains(&y)) {
                0.9
            } else {
                0.0
            }
        });
        let limited = DetectionOptions {
            max_candidates: 1,
            ..options()
        };
        assert_eq!(
            text_boxes(
                ProbabilityMap {
                    data: &data,
                    width: 100,
                    height: 100
                },
                100,
                100,
                &limited
            )
            .len(),
            1
        );
    }

    #[test]
    fn scores_the_mean_inside_the_box_including_its_edges() {
        // 4×4 的框里一半 1.0、一半 0.0。
        let data = map_with(10, 10, |x, _| if x < 4 { 1.0 } else { 0.0 });
        let square = [
            Point::new(2.0, 2.0),
            Point::new(5.0, 2.0),
            Point::new(5.0, 5.0),
            Point::new(2.0, 5.0),
        ];
        let score = box_score(
            ProbabilityMap {
                data: &data,
                width: 10,
                height: 10,
            },
            &square,
        );
        assert!((score - 0.5).abs() < 1e-6, "{score}");
    }
}
