//! 文字的阅读顺序（官方 sorted_boxes）：先按左上角的 y、再按 x 排；同一行（y 相差不到 10 像素）里按 x 调整。

use crate::geometry::Quad;

/// 左上角 y 相差不到这么多像素算同一行（官方的固定值）。
const SAME_LINE_PIXELS: f64 = 10.0;

/// 返回按阅读顺序排列的下标。
pub fn reading_order(quads: &[Quad]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..quads.len()).collect();
    order.sort_by(|&a, &b| {
        let (a, b) = (quads[a][0], quads[b][0]);
        a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x))
    });
    for i in 0..order.len().saturating_sub(1) {
        for j in (0..=i).rev() {
            let (current, next) = (quads[order[j]][0], quads[order[j + 1]][0]);
            if (next.y - current.y).abs() < SAME_LINE_PIXELS && next.x < current.x {
                order.swap(j, j + 1);
            } else {
                break;
            }
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Point;

    fn at(x: f64, y: f64) -> Quad {
        [
            Point::new(x, y),
            Point::new(x + 10.0, y),
            Point::new(x + 10.0, y + 5.0),
            Point::new(x, y + 5.0),
        ]
    }

    #[test]
    fn reads_top_to_bottom() {
        assert_eq!(reading_order(&[at(0.0, 50.0), at(0.0, 10.0)]), vec![1, 0]);
    }

    #[test]
    fn reads_left_to_right_within_a_slightly_tilted_line() {
        // 右边那段比左边高 4 像素：按 y 会排到前面，同一行要按 x 纠正回来。
        assert_eq!(reading_order(&[at(0.0, 20.0), at(100.0, 16.0)]), vec![0, 1]);
    }

    #[test]
    fn keeps_separate_lines_apart() {
        assert_eq!(reading_order(&[at(100.0, 10.0), at(0.0, 30.0)]), vec![0, 1]);
    }
}
