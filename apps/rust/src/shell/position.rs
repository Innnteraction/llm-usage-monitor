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
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// Windows의 물리 작업영역을 현재 GPUI 창의 논리 좌표로 변환한다.
    pub fn to_logical(self, scale: f32) -> Option<Self> {
        if !scale.is_finite() || scale <= 0.0 || self.width <= 0.0 || self.height <= 0.0 {
            return None;
        }
        Some(Self::new(
            self.x / scale,
            self.y / scale,
            self.width / scale,
            self.height / scale,
        ))
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

    natural_height.max(minimum_height).min(maximum_height)
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
        "right" => Point::new(
            work_area.x + work_area.width - window_size.width,
            centered_y,
        ),
        _ => Point::new(
            centered_x,
            work_area.y + work_area.height - window_size.height,
        ), // "bottom"
    };

    Point::new(
        clamp(
            raw.x,
            work_area.x,
            work_area.x + work_area.width - window_size.width,
        ),
        clamp(
            raw.y,
            work_area.y,
            work_area.y + work_area.height - window_size.height,
        ),
    )
}

pub fn clamp_window_position(
    position: Point,
    window_size: WindowSize,
    work_area: WindowRect,
) -> Point {
    let valid_x = if finite(position.x) {
        position.x
    } else {
        work_area.x
    };
    let valid_y = if finite(position.y) {
        position.y
    } else {
        work_area.y
    };
    let max_x = work_area.x + work_area.width - window_size.width;
    let max_y = work_area.y + work_area.height - window_size.height;

    Point::new(
        clamp(valid_x, work_area.x, work_area.x.max(max_x)),
        clamp(valid_y, work_area.y, work_area.y.max(max_y)),
    )
}

/// 사용자 기준점은 보정 결과로 덮어쓰지 않는다. 접으면 원래 위치로 돌아온다.
pub fn resized_popover_geometry(
    requested_height: f32,
    custom_position: Option<Point>,
    anchor: Point,
    work_area: WindowRect,
) -> (WindowSize, Point) {
    let minimum = if requested_height < 304. {
        requested_height.max(124.)
    } else {
        360.
    };
    let height = clamp_popover_height(
        Some(requested_height),
        minimum,
        (work_area.height - 4.).max(1.),
    );
    let dimensions = WindowSize::new(480_f32.min(work_area.width), height);
    let position = custom_position
        .map(|p| clamp_window_position(p, dimensions, work_area))
        .unwrap_or_else(|| calculate_popover_position(anchor, work_area, dimensions));
    (dimensions, position)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resize_stays_on_secondary_monitor_at_each_dpi() {
        // 물리 좌표로 오른쪽, 왼쪽, 위쪽 모니터와 하단 작업표시줄을 표현한다.
        for physical in [
            WindowRect::new(1920., 0., 2560., 1400.),
            WindowRect::new(-2560., 0., 2560., 1400.),
            WindowRect::new(0., -1440., 2560., 1400.),
        ] {
            for scale in [1., 1.25, 1.5, 2.] {
                let area = physical.to_logical(scale).unwrap();
                let origin = Point::new(area.x + 80., area.y + 60.);
                // 최초 주 모니터 anchor가 남아 있어도 사용자 위치를 우선한다.
                let anchor = Point::new(1780., 1080.);
                for height in [124., 360., 500., 124., 360.] {
                    let (dimensions, position) =
                        resized_popover_geometry(height, Some(origin), anchor, area);
                    assert_eq!(position, origin);
                    assert!(position.x + dimensions.width <= area.x + area.width);
                    assert!(position.y + dimensions.height <= area.y + area.height);
                }
                assert_eq!(area.x * scale, physical.x);
                assert_eq!(area.y * scale, physical.y);
                assert_eq!(area.height * scale, physical.height);
            }
        }
    }

    #[test]
    fn edge_clamping_does_not_replace_dragged_origin() {
        let area = WindowRect::new(-1600., 0., 1600., 860.);
        let origin = Point::new(-600., 600.);
        let anchor = Point::new(1780., 1080.);
        for _ in 0..3 {
            let (_, expanded) = resized_popover_geometry(720., Some(origin), anchor, area);
            assert_eq!(expanded, Point::new(origin.x, 140.));
            let (_, collapsed) = resized_popover_geometry(124., Some(origin), anchor, area);
            assert_eq!(collapsed, origin);
        }
    }

    #[test]
    fn resize_uses_current_monitor_height_and_width() {
        let anchor = Point::new(1780., 1080.);
        for area in [
            WindowRect::new(1920., 0., 1280., 720.),
            WindowRect::new(-400., -600., 400., 600.),
        ] {
            let (dimensions, position) =
                resized_popover_geometry(2000., Some(Point::new(area.x, area.y)), anchor, area);
            assert_eq!(dimensions.height, area.height - 4.);
            assert_eq!(dimensions.width, area.width.min(480.));
            assert_eq!(position, Point::new(area.x, area.y));
        }
    }

    #[test]
    fn unmodified_window_keeps_tray_anchor() {
        let area = WindowRect::new(0., 0., 1920., 1040.);
        let anchor = Point::new(1780., 1060.);
        for height in [124., 720., 360.] {
            let (dimensions, position) = resized_popover_geometry(height, None, anchor, area);
            assert_eq!(position.y + dimensions.height, 1040.);
        }
    }

    #[test]
    fn invalid_native_geometry_is_rejected() {
        let area = WindowRect::new(1920., 0., 2560., 1400.);
        for scale in [0., -1., f32::NAN, f32::INFINITY] {
            assert!(area.to_logical(scale).is_none());
        }
        assert!(WindowRect::new(0., 0., 0., 100.).to_logical(1.).is_none());
    }

    #[test]
    fn content_resize_keeps_bottom_anchor_and_custom_position_in_work_area() {
        let area = WindowRect::new(-1280., 0., 1280., 984.);
        for requested in [124., 360., 720., 2000.] {
            let height = clamp_popover_height(Some(requested), 124., area.height);
            let size = WindowSize::new(480., height);
            let anchored = calculate_popover_position(Point::new(-20., 1000.), area, size);
            let custom = clamp_window_position(Point::new(-100., 900.), size, area);
            for pos in [anchored, custom] {
                assert!(pos.x >= area.x && pos.x + size.width <= area.x + area.width);
                assert!(pos.y >= area.y && pos.y + size.height <= area.y + area.height);
            }
        }
    }

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

/// tray-icon은 Windows에서 물리 좌표를 반환한다. GPUI와 같은 DPI 기준으로 변환한다.
#[cfg(target_os = "windows")]
pub fn native_tray_work_area(tray: WindowRect) -> Option<(Point, WindowRect)> {
    use windows::Win32::{
        Foundation::POINT,
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
    };
    let center = POINT {
        x: (tray.x + tray.width / 2.) as i32,
        y: (tray.y + tray.height / 2.) as i32,
    };
    // 유효한 출력 구조체와 OS 소유 monitor handle만 전달한다.
    unsafe {
        let monitor = MonitorFromPoint(center, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let (mut x, mut y) = (96, 96);
        GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut x, &mut y).ok()?;
        let scale = x.max(1) as f32 / 96.;
        let r = info.rcWork;
        Some((
            Point::new(center.x as f32 / scale, center.y as f32 / scale),
            WindowRect::new(
                r.left as f32 / scale,
                r.top as f32 / scale,
                (r.right - r.left) as f32 / scale,
                (r.bottom - r.top) as f32 / scale,
            ),
        ))
    }
}
