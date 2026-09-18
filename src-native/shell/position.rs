/// 팝오버 창 및 트레이 위치 계산 모듈
/// Electron의 `src/main/windowPosition.ts` 로직 1:1 이식

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl WindowRect {
    pub fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self { x, y, width, height }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowSize {
    pub width: f32,
    pub height: f32,
}

impl WindowSize {
    pub fn new(width: f32, height: f32) -> Self {
        Self { width, height }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

fn finite(value: f32) -> bool {
    value.is_finite()
}

fn overlaps(first: &WindowRect, second: &WindowRect) -> bool {
    first.x < second.x + second.width
        && first.x + first.width > second.x
        && first.y < second.y + second.height
        && first.y + first.height > second.y
}

fn clamp(value: f32, minimum: f32, maximum: f32) -> f32 {
    let max = if minimum > maximum { minimum } else { maximum };
    value.max(minimum).min(max)
}

pub fn clamp_popover_height(
    requested_height: Option<f32>,
    minimum_height: f32,
    work_area_height: f32,
) -> f32 {
    let maximum_height = if finite(work_area_height) && work_area_height > 0.0 {
        work_area_height.floor()
    } else {
        minimum_height
    };

    let natural_height = match requested_height {
        Some(h) if finite(h) && h > 0.0 => h.ceil(),
        _ => minimum_height,
    };

    natural_height.clamp(minimum_height, maximum_height)
}

pub fn select_popover_anchor(
    tray_bounds: Option<WindowRect>,
    displays: &[WindowRect],
    cursor: Point,
) -> Point {
    if let Some(tb) = tray_bounds {
        let valid = finite(tb.x)
            && finite(tb.y)
            && finite(tb.width)
            && finite(tb.height)
            && tb.width > 0.0
            && tb.height > 0.0
            && displays.iter().any(|disp| overlaps(&tb, disp));

        if valid {
            return Point::new(
                (tb.x + (tb.width / 2.0)).round(),
                (tb.y + (tb.height / 2.0)).round(),
            );
        }
    }
    cursor
}

pub fn calculate_popover_position(
    anchor: Point,
    work_area: WindowRect,
    window_size: WindowSize,
) -> Point {
    let dist_top = (anchor.y - work_area.y).abs();
    let dist_bottom = (work_area.y + work_area.height - anchor.y).abs();
    let dist_left = (anchor.x - work_area.x).abs();
    let dist_right = (work_area.x + work_area.width - anchor.x).abs();

    // 가장 가까운 화면 모서리(edge)를 판별
    let mut min_dist = dist_top;
    let mut edge = "top";

    if dist_bottom < min_dist {
        min_dist = dist_bottom;
        edge = "bottom";
    }
    if dist_left < min_dist {
        min_dist = dist_left;
        edge = "left";
    }
    if dist_right < min_dist {
        edge = "right";
    }

    let centered_x = anchor.x - (window_size.width / 2.0).round();
    let centered_y = anchor.y - (window_size.height / 2.0).round();

    let raw = match edge {
        "top" => Point::new(centered_x, work_area.y),
        "left" => Point::new(work_area.x, centered_y),
        "right" => Point::new(work_area.x + work_area.width - window_size.width, centered_y),
        _ => Point::new(centered_x, work_area.y + work_area.height - window_size.height), // "bottom"
    };

    Point::new(
        clamp(raw.x, work_area.x, work_area.x + work_area.width - window_size.width),
        clamp(raw.y, work_area.y, work_area.y + work_area.height - window_size.height),
    )
}

pub fn clamp_window_position(
    position: Point,
    window_size: WindowSize,
    work_area: WindowRect,
) -> Point {
    let valid_x = if finite(position.x) { position.x } else { work_area.x };
    let valid_y = if finite(position.y) { position.y } else { work_area.y };
    let max_x = work_area.x + work_area.width - window_size.width;
    let max_y = work_area.y + work_area.height - window_size.height;

    Point::new(
        clamp(valid_x, work_area.x, work_area.x.max(max_x)),
        clamp(valid_y, work_area.y, work_area.y.max(max_y)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bottom_taskbar_position() {
        // 하단 작업표시줄: 화면 1920x1080 중 작업영역 (0, 0, 1920, 1040)
        // 트레이 위치 (1800, 1040, 40, 40)
        let work_area = WindowRect::new(0.0, 0.0, 1920.0, 1040.0);
        let tray_bounds = WindowRect::new(1800.0, 1040.0, 40.0, 40.0);
        let cursor = Point::new(1820.0, 1060.0);
        let window_size = WindowSize::new(380.0, 580.0);

        let anchor = select_popover_anchor(
            Some(tray_bounds),
            &[WindowRect::new(0.0, 0.0, 1920.0, 1080.0)],
            cursor,
        );
        assert_eq!(anchor, Point::new(1820.0, 1060.0));

        let pos = calculate_popover_position(anchor, work_area, window_size);
        // 하단 작업표시줄 바로 위 (1040 - 580 = 460)에 붙어야 함
        assert_eq!(pos.y, 460.0);
        // 화면 오른쪽 경계(1920 - 380 = 1540)를 넘지 않아야 함
        assert_eq!(pos.x, 1540.0);
    }

    #[test]
    fn test_top_menu_bar_position() {
        // macOS 상단 메뉴바: 작업영역 (0, 25, 1920, 1055)
        // 트레이 위치 (1500, 0, 30, 25)
        let work_area = WindowRect::new(0.0, 25.0, 1920.0, 1055.0);
        let tray_bounds = WindowRect::new(1500.0, 0.0, 30.0, 25.0);
        let cursor = Point::new(1515.0, 12.0);
        let window_size = WindowSize::new(380.0, 580.0);

        let anchor = select_popover_anchor(
            Some(tray_bounds),
            &[WindowRect::new(0.0, 0.0, 1920.0, 1080.0)],
            cursor,
        );

        let pos = calculate_popover_position(anchor, work_area, window_size);
        // 상단 바 바로 아래 (y = 25.0)에 위치
        assert_eq!(pos.y, 25.0);
    }
}
