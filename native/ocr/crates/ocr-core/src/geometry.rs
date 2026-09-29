//! 几何：凸包、最小外接矩形、四点排序、多边形面积周长、透视变换。
//! 对应官方实现里的 cv2.minAreaRect / boxPoints / getPerspectiveTransform，用纯 Rust 写，不引入 OpenCV。

/// 原图上的一点（像素坐标）。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn distance(self, other: Self) -> f64 {
        (self.x - other.x).hypot(self.y - other.y)
    }
}

/// 四边形，按左上、右上、右下、左下排列。
pub type Quad = [Point; 4];

/// 凸包（单调链算法），逆时针，去掉共线的点。少于 3 个不同的点时原样返回。
pub fn convex_hull(points: &[Point]) -> Vec<Point> {
    let mut sorted: Vec<Point> = points.to_vec();
    sorted.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    sorted.dedup();
    if sorted.len() < 3 {
        return sorted;
    }
    let cross =
        |o: Point, a: Point, b: Point| (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    let mut hull: Vec<Point> = Vec::with_capacity(sorted.len() * 2);
    for pass in 0..2 {
        let start = hull.len();
        let points: Box<dyn Iterator<Item = &Point>> = if pass == 0 {
            Box::new(sorted.iter())
        } else {
            Box::new(sorted.iter().rev())
        };
        for &point in points {
            while hull.len() >= start + 2
                && cross(hull[hull.len() - 2], hull[hull.len() - 1], point) <= 0.0
            {
                hull.pop();
            }
            hull.push(point);
        }
        // 每一段的最后一点是下一段的第一点，去掉避免重复。
        hull.pop();
    }
    hull
}

/// 旋转矩形：中心、沿 `axis` 方向的边长 `width`、垂直方向的边长 `height`。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RotatedRect {
    pub center: Point,
    pub width: f64,
    pub height: f64,
    /// `width` 那条边的方向，单位向量。
    pub axis: Point,
}

impl RotatedRect {
    pub fn corners(&self) -> [Point; 4] {
        let (ux, uy) = (
            self.axis.x * self.width / 2.0,
            self.axis.y * self.width / 2.0,
        );
        let (vx, vy) = (
            -self.axis.y * self.height / 2.0,
            self.axis.x * self.height / 2.0,
        );
        let c = self.center;
        [
            Point::new(c.x - ux - vx, c.y - uy - vy),
            Point::new(c.x + ux - vx, c.y + uy - vy),
            Point::new(c.x + ux + vx, c.y + uy + vy),
            Point::new(c.x - ux + vx, c.y - uy + vy),
        ]
    }

    pub fn short_side(&self) -> f64 {
        self.width.min(self.height)
    }

    /// 四条边各向外推 `distance`：矩形按圆角外扩后的最小外接矩形正是这个（官方 unclip 之后再取最小外接矩形）。
    pub fn expanded(&self, distance: f64) -> Self {
        Self {
            width: self.width + 2.0 * distance,
            height: self.height + 2.0 * distance,
            ..*self
        }
    }
}

/// 凸包的最小面积外接矩形（旋转卡壳：最小矩形必有一条边和凸包的某条边共线）。
pub fn min_area_rect(hull: &[Point]) -> RotatedRect {
    match hull.len() {
        0 => RotatedRect {
            center: Point::default(),
            width: 0.0,
            height: 0.0,
            axis: Point::new(1.0, 0.0),
        },
        1 => RotatedRect {
            center: hull[0],
            width: 0.0,
            height: 0.0,
            axis: Point::new(1.0, 0.0),
        },
        _ => {
            let mut best: Option<(f64, RotatedRect)> = None;
            for index in 0..hull.len() {
                let a = hull[index];
                let b = hull[(index + 1) % hull.len()];
                let length = a.distance(b);
                if length == 0.0 {
                    continue;
                }
                let axis = Point::new((b.x - a.x) / length, (b.y - a.y) / length);
                let (mut min_u, mut max_u, mut min_v, mut max_v) =
                    (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
                for point in hull {
                    let u = point.x * axis.x + point.y * axis.y;
                    let v = -point.x * axis.y + point.y * axis.x;
                    min_u = min_u.min(u);
                    max_u = max_u.max(u);
                    min_v = min_v.min(v);
                    max_v = max_v.max(v);
                }
                let (width, height) = (max_u - min_u, max_v - min_v);
                let area = width * height;
                if best.is_none_or(|(best_area, _)| area < best_area) {
                    let (mid_u, mid_v) = ((min_u + max_u) / 2.0, (min_v + max_v) / 2.0);
                    let center = Point::new(
                        mid_u * axis.x - mid_v * axis.y,
                        mid_u * axis.y + mid_v * axis.x,
                    );
                    best = Some((
                        area,
                        RotatedRect {
                            center,
                            width,
                            height,
                            axis,
                        },
                    ));
                }
            }
            best.map_or(
                RotatedRect {
                    center: hull[0],
                    width: 0.0,
                    height: 0.0,
                    axis: Point::new(1.0, 0.0),
                },
                |(_, rect)| rect,
            )
        }
    }
}

/// 官方的 get_mini_boxes：四角按 x 排序，左边两点里 y 小的是左上，右边两点里 y 小的是右上。
pub fn ordered_corners(rect: &RotatedRect) -> Quad {
    let mut points = rect.corners();
    // 稳定排序，和 Python 的 sorted 一致。
    points.sort_by(|a, b| a.x.total_cmp(&b.x));
    let (top_left, bottom_left) = if points[1].y > points[0].y {
        (points[0], points[1])
    } else {
        (points[1], points[0])
    };
    let (top_right, bottom_right) = if points[3].y > points[2].y {
        (points[2], points[3])
    } else {
        (points[3], points[2])
    };
    [top_left, top_right, bottom_right, bottom_left]
}

/// 多边形面积（鞋带公式，取绝对值）。
pub fn polygon_area(points: &[Point]) -> f64 {
    let n = points.len();
    let twice: f64 = (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            a.x * b.y - b.x * a.y
        })
        .sum();
    twice.abs() / 2.0
}

pub fn polygon_perimeter(points: &[Point]) -> f64 {
    let n = points.len();
    (0..n)
        .map(|i| points[i].distance(points[(i + 1) % n]))
        .sum()
}

/// 透视变换（3×3 单应矩阵，h[8] = 1）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Homography([f64; 9]);

impl Homography {
    /// 把 `from` 的四个点分别映射到 `to` 的四个点（cv2.getPerspectiveTransform）。四点共线等退化情况返回 None。
    pub fn from_points(from: &[Point; 4], to: &[Point; 4]) -> Option<Self> {
        // 8 个未知数：每对点给两个方程。
        let mut system = [[0.0f64; 9]; 8];
        for i in 0..4 {
            let (x, y, u, v) = (from[i].x, from[i].y, to[i].x, to[i].y);
            system[2 * i] = [x, y, 1.0, 0.0, 0.0, 0.0, -x * u, -y * u, u];
            system[2 * i + 1] = [0.0, 0.0, 0.0, x, y, 1.0, -x * v, -y * v, v];
        }
        let solution = solve(&mut system)?;
        Some(Self([
            solution[0],
            solution[1],
            solution[2],
            solution[3],
            solution[4],
            solution[5],
            solution[6],
            solution[7],
            1.0,
        ]))
    }

    pub fn apply(&self, point: Point) -> Point {
        let h = &self.0;
        let w = h[6] * point.x + h[7] * point.y + h[8];
        Point::new(
            (h[0] * point.x + h[1] * point.y + h[2]) / w,
            (h[3] * point.x + h[4] * point.y + h[5]) / w,
        )
    }
}

/// 高斯消元（列主元）解 8×8 线性方程组，最后一列是常数项。
fn solve(system: &mut [[f64; 9]; 8]) -> Option<[f64; 8]> {
    const SINGULAR: f64 = 1e-12;
    for column in 0..8 {
        let pivot = (column..8)
            .max_by(|&a, &b| system[a][column].abs().total_cmp(&system[b][column].abs()))?;
        if system[pivot][column].abs() < SINGULAR {
            return None;
        }
        system.swap(column, pivot);
        let pivot_row = system[column];
        for (row, equation) in system.iter_mut().enumerate() {
            if row != column {
                let factor = equation[column] / pivot_row[column];
                for (value, pivot_value) in equation.iter_mut().zip(pivot_row).skip(column) {
                    *value -= factor * pivot_value;
                }
            }
        }
    }
    let mut solution = [0.0; 8];
    for (i, value) in solution.iter_mut().enumerate() {
        *value = system[i][8] / system[i][i];
    }
    Some(solution)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-6;

    fn close(a: Point, b: Point) -> bool {
        (a.x - b.x).abs() < EPSILON && (a.y - b.y).abs() < EPSILON
    }

    #[test]
    fn hull_drops_interior_and_collinear_points() {
        let points = [
            Point::new(0.0, 0.0),
            Point::new(2.0, 0.0),
            Point::new(4.0, 0.0),
            Point::new(4.0, 3.0),
            Point::new(0.0, 3.0),
            Point::new(2.0, 1.0),
        ];
        let hull = convex_hull(&points);
        assert_eq!(hull.len(), 4);
        assert!((polygon_area(&hull) - 12.0).abs() < EPSILON);
    }

    #[test]
    fn min_area_rect_of_an_axis_aligned_block() {
        let points: Vec<Point> = (0..=10)
            .flat_map(|x| (0..=4).map(move |y| Point::new(f64::from(x), f64::from(y))))
            .collect();
        let rect = min_area_rect(&convex_hull(&points));
        assert!((rect.width * rect.height - 40.0).abs() < EPSILON);
        assert!((rect.short_side() - 4.0).abs() < EPSILON);
        assert!(close(rect.center, Point::new(5.0, 2.0)));
    }

    #[test]
    fn min_area_rect_follows_a_rotated_rectangle() {
        // 20×6 的矩形转 30°：外接矩形应当就是它本身，而不是更大的轴对齐框。
        let rect = RotatedRect {
            center: Point::new(50.0, 40.0),
            width: 20.0,
            height: 6.0,
            axis: Point::new(30f64.to_radians().cos(), 30f64.to_radians().sin()),
        };
        let found = min_area_rect(&convex_hull(&rect.corners()));
        assert!((found.width * found.height - 120.0).abs() < 1e-4);
        assert!((found.short_side() - 6.0).abs() < 1e-6);
    }

    #[test]
    fn orders_corners_top_left_first_clockwise() {
        for degrees in [-40.0f64, -10.0, 0.0, 10.0, 40.0] {
            let rect = RotatedRect {
                center: Point::new(100.0, 100.0),
                width: 60.0,
                height: 20.0,
                axis: Point::new(degrees.to_radians().cos(), degrees.to_radians().sin()),
            };
            let [tl, tr, br, bl] = ordered_corners(&rect);
            assert!(
                tl.x <= tr.x.min(br.x) + EPSILON && bl.x <= tr.x.min(br.x) + EPSILON,
                "{degrees}"
            );
            assert!(tl.y < bl.y, "{degrees}");
            assert!(tr.y < br.y, "{degrees}");
        }
    }

    #[test]
    fn expanding_a_rectangle_moves_every_side_out() {
        let rect = RotatedRect {
            center: Point::new(0.0, 0.0),
            width: 10.0,
            height: 4.0,
            axis: Point::new(1.0, 0.0),
        };
        let bigger = rect.expanded(1.5);
        assert!((bigger.width - 13.0).abs() < EPSILON && (bigger.height - 7.0).abs() < EPSILON);
        assert_eq!(bigger.center, rect.center);
    }

    #[test]
    fn area_and_perimeter_of_a_rectangle() {
        let corners = [
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 4.0),
            Point::new(0.0, 4.0),
        ];
        assert!((polygon_area(&corners) - 40.0).abs() < EPSILON);
        assert!((polygon_perimeter(&corners) - 28.0).abs() < EPSILON);
    }

    #[test]
    fn homography_maps_the_four_corners_and_inverts() {
        let quad = [
            Point::new(10.0, 20.0),
            Point::new(110.0, 30.0),
            Point::new(105.0, 70.0),
            Point::new(5.0, 60.0),
        ];
        let square = [
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            Point::new(100.0, 40.0),
            Point::new(0.0, 40.0),
        ];
        let forward = Homography::from_points(&quad, &square).unwrap();
        let backward = Homography::from_points(&square, &quad).unwrap();
        for (from, to) in quad.iter().zip(&square) {
            assert!(close(forward.apply(*from), *to));
            assert!(close(backward.apply(*to), *from));
        }
        let inside = Point::new(50.0, 45.0);
        assert!(close(backward.apply(forward.apply(inside)), inside));
    }

    #[test]
    fn homography_rejects_collinear_points() {
        let line = [
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(2.0, 0.0),
            Point::new(3.0, 0.0),
        ];
        assert!(Homography::from_points(&line, &line).is_none());
    }
}
