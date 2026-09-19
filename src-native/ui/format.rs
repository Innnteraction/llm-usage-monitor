use chrono::{DateTime, Utc};

/// 사용률에 따른 색상 톤
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UsageTone {
    Low,    // < 70% (초록/파랑)
    Medium, // 70% ~ 89% (주황/노랑)
    High,   // >= 90% (빨강)
    Stale,  // 오래된 데이터 (회색)
}

pub fn get_usage_tone(used_percent: Option<f64>, is_stale: bool) -> UsageTone {
    if is_stale {
        return UsageTone::Stale;
    }
    match used_percent {
        Some(p) if p >= 90.0 => UsageTone::High,
        Some(p) if p >= 70.0 => UsageTone::Medium,
        _ => UsageTone::Low,
    }
}

/// 백분율 포맷팅 (예: 47.0%)
pub fn format_percent(val: Option<f64>) -> String {
    match val {
        Some(v) if v.is_finite() => format!("{:02.0}%", v.max(0.).round()),
        _ => "--".to_string(),
    }
}

/// 토큰 수 친화적 포맷팅 (예: 5.04B, 12.3M, 450K)
pub fn format_token_count(tokens: u64) -> String {
    if tokens >= 1_000_000_000 {
        format!("{:.1}B", tokens as f64 / 1_000_000_000.0)
    } else if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.0}K", (tokens as f64 / 1_000.0).round())
    } else {
        tokens.to_string()
    }
}

/// 리셋 시각 카운트다운 문자열 (예: "in 2h 15m", "in 1d 4h", "in 45m")
pub fn format_reset_countdown(resets_at: Option<DateTime<Utc>>, now_utc: DateTime<Utc>) -> String {
    let target = match resets_at {
        Some(dt) => dt,
        None => return "--".to_string(),
    };

    let diff_secs = (target - now_utc).num_seconds();
    if diff_secs <= 0 {
        return "reset pending".to_string();
    }

    let remaining_mins = diff_secs / 60;
    let days = remaining_mins / (24 * 60);
    let hours = (remaining_mins % (24 * 60)) / 60;
    let minutes = remaining_mins % 60;

    if days > 0 {
        format!("{days}d {hours}h")
    } else if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

pub fn format_compact_countdown(resets_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> String {
    let Some(target) = resets_at else {
        return "--".into();
    };
    if target <= now {
        return "pending".into();
    }
    let remaining = (target - now).num_minutes();
    let (days, hours, minutes) = (remaining / 1440, remaining % 1440 / 60, remaining % 60);
    if days > 0 {
        format!("{days}d {hours:02}h")
    } else if hours > 0 {
        format!("{hours}h {minutes:02}m")
    } else {
        format!("{minutes}m")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_format_token_count() {
        assert_eq!(format_token_count(500), "500");
        assert_eq!(format_token_count(1500), "2K");
        assert_eq!(format_token_count(12_340_000), "12.3M");
        assert_eq!(format_token_count(7_047_286_282), "7.0B");
    }

    #[test]
    fn test_format_reset_countdown() {
        let now = Utc.with_ymd_and_hms(2026, 9, 19, 12, 0, 0).unwrap();

        // 2시간 30분 뒤
        let future_2h = Utc.with_ymd_and_hms(2026, 9, 19, 14, 30, 0).unwrap();
        assert_eq!(format_reset_countdown(Some(future_2h), now), "2h 30m");

        // 1일 5시간 뒤
        let future_1d = Utc.with_ymd_and_hms(2026, 9, 20, 17, 0, 0).unwrap();
        assert_eq!(format_reset_countdown(Some(future_1d), now), "1d 5h");

        // 과거 시각
        let past = Utc.with_ymd_and_hms(2026, 9, 19, 11, 0, 0).unwrap();
        assert_eq!(format_reset_countdown(Some(past), now), "reset pending");
        assert_eq!(format_compact_countdown(Some(future_1d), now), "1d 05h");
        assert_eq!(
            format_compact_countdown(Some(now + chrono::Duration::minutes(62)), now),
            "1h 02m"
        );
        assert_eq!(format_compact_countdown(Some(past), now), "pending");
    }

    #[test]
    fn test_usage_tone() {
        assert_eq!(get_usage_tone(Some(30.0), false), UsageTone::Low);
        assert_eq!(get_usage_tone(Some(75.0), false), UsageTone::Medium);
        assert_eq!(get_usage_tone(Some(92.0), false), UsageTone::High);
        assert_eq!(get_usage_tone(Some(30.0), true), UsageTone::Stale);
    }
}
