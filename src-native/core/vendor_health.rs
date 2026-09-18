use crate::core::types::{ProviderId, ServiceHealthIndicator, VendorServiceStatus};
use chrono::Utc;
use serde::Deserialize;
use std::env;
use std::time::Duration;

pub const CLAUDE_STATUS_URL: &str = "https://status.claude.com/api/v2/summary.json";
pub const CLAUDE_FALLBACK_STATUS_URL: &str = "https://status.anthropic.com/api/v2/summary.json";
pub const CLAUDE_STATUS_PAGE_URL: &str = "https://status.claude.com";

pub const OPENAI_STATUS_URL: &str = "https://status.openai.com/api/v2/summary.json";
pub const OPENAI_STATUS_PAGE_URL: &str = "https://status.openai.com";

pub const GOOGLE_CLOUD_INCIDENTS_URL: &str = "https://status.cloud.google.com/incidents.json";
pub const ANTIGRAVITY_STATUS_PAGE_URL: &str = "https://status.cloud.google.com";

pub const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Deserialize)]
struct StatuspageSummary {
    status: Option<StatuspageStatus>,
    components: Option<Vec<StatuspageComponent>>,
    incidents: Option<Vec<StatuspageIncident>>,
}

#[derive(Debug, Deserialize)]
struct StatuspageStatus {
    indicator: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StatuspageComponent {
    name: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StatuspageIncident {
    name: Option<String>,
    impact: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleIncident {
    id: Option<String>,
    begin: Option<String>,
    end: Option<String>,
    external_desc: Option<String>,
    service_name: Option<String>,
    severity: Option<String>,
}

fn map_indicator(raw: Option<&str>) -> ServiceHealthIndicator {
    match raw.map(|s| s.to_lowercase()).as_deref() {
        Some("none") | Some("operational") => ServiceHealthIndicator::Operational,
        Some("minor") | Some("degraded_performance") => ServiceHealthIndicator::Minor,
        Some("major") | Some("partial_outage") => ServiceHealthIndicator::Major,
        Some("critical") | Some("major_outage") => ServiceHealthIndicator::Critical,
        _ => ServiceHealthIndicator::Unknown,
    }
}

fn indicator_rank(ind: ServiceHealthIndicator) -> u8 {
    match ind {
        ServiceHealthIndicator::Unknown => 0,
        ServiceHealthIndicator::Operational => 1,
        ServiceHealthIndicator::Minor => 2,
        ServiceHealthIndicator::Major => 3,
        ServiceHealthIndicator::Critical => 4,
    }
}

fn combine_signals(
    overall: ServiceHealthIndicator,
    component: ServiceHealthIndicator,
) -> ServiceHealthIndicator {
    if indicator_rank(component) > indicator_rank(overall) {
        component
    } else {
        overall
    }
}

pub fn get_simulated_incident(provider_id: ProviderId) -> Option<VendorServiceStatus> {
    let mock_target = env::var("LLM_USAGE_MONITOR_MOCK_INCIDENT").ok()?.trim().to_lowercase();
    if mock_target.is_empty() {
        return None;
    }

    let matches = mock_target == "1"
        || mock_target == "true"
        || mock_target == "all"
        || mock_target == provider_id.as_str();

    if !matches {
        return None;
    }

    let now = Utc::now();
    match provider_id {
        ProviderId::Claude => Some(VendorServiceStatus {
            indicator: ServiceHealthIndicator::Minor,
            description: "Elevated error rates on Claude Code (Simulated)".to_string(),
            status_page_url: CLAUDE_STATUS_PAGE_URL.to_string(),
            incident_title: Some("Claude Code service incident reported (Simulated)".to_string()),
            checked_at: now,
        }),
        ProviderId::Codex => Some(VendorServiceStatus {
            indicator: ServiceHealthIndicator::Major,
            description: "Codex API service outage (Simulated)".to_string(),
            status_page_url: OPENAI_STATUS_PAGE_URL.to_string(),
            incident_title: Some("Codex API Outage (Simulated)".to_string()),
            checked_at: now,
        }),
        ProviderId::Antigravity => Some(VendorServiceStatus {
            indicator: ServiceHealthIndicator::Critical,
            description: "Google Cloud AI incident (Simulated)".to_string(),
            status_page_url: ANTIGRAVITY_STATUS_PAGE_URL.to_string(),
            incident_title: Some("Antigravity service degraded (Simulated)".to_string()),
            checked_at: now,
        }),
    }
}

pub async fn fetch_claude_status(client: &reqwest::Client) -> VendorServiceStatus {
    let now = Utc::now();
    if let Some(simulated) = get_simulated_incident(ProviderId::Claude) {
        return simulated;
    }

    let urls = [CLAUDE_STATUS_URL, CLAUDE_FALLBACK_STATUS_URL];
    for url in urls {
        let resp = match client.get(url).timeout(FETCH_TIMEOUT).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };

        if let Ok(data) = resp.json::<StatuspageSummary>().await {
            let mut indicator = map_indicator(data.status.as_ref().and_then(|s| s.indicator.as_deref()));

            if let Some(components) = data.components {
                let relevant = components.into_iter().filter(|c| {
                    let name = c.name.as_deref().unwrap_or("").to_lowercase();
                    name.contains("claude code") || name.contains("claude api")
                });
                let mut worst = ServiceHealthIndicator::Operational;
                for comp in relevant {
                    let comp_ind = map_indicator(comp.status.as_deref());
                    worst = combine_signals(worst, comp_ind);
                }
                indicator = combine_signals(indicator, worst);
            }

            let active_incident = data.incidents.and_then(|incs| {
                incs.into_iter().find(|inc| {
                    let s = inc.status.as_deref().unwrap_or("").to_lowercase();
                    s != "resolved" && s != "completed"
                })
            });

            let default_desc = if indicator == ServiceHealthIndicator::Operational {
                "All Systems Operational"
            } else {
                "Service incident reported"
            };

            let description = data
                .status
                .and_then(|s| s.description)
                .unwrap_or_else(|| default_desc.to_string());

            return VendorServiceStatus {
                indicator,
                description,
                status_page_url: CLAUDE_STATUS_PAGE_URL.to_string(),
                incident_title: active_incident.and_then(|inc| inc.name),
                checked_at: now,
            };
        }
    }

    VendorServiceStatus {
        indicator: ServiceHealthIndicator::Unknown,
        description: "Status page temporarily unreachable".to_string(),
        status_page_url: CLAUDE_STATUS_PAGE_URL.to_string(),
        incident_title: None,
        checked_at: now,
    }
}

pub async fn fetch_codex_status(client: &reqwest::Client) -> VendorServiceStatus {
    let now = Utc::now();
    if let Some(simulated) = get_simulated_incident(ProviderId::Codex) {
        return simulated;
    }

    let resp = match client
        .get(OPENAI_STATUS_URL)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => {
            return VendorServiceStatus {
                indicator: ServiceHealthIndicator::Unknown,
                description: "Status page temporarily unreachable".to_string(),
                status_page_url: OPENAI_STATUS_PAGE_URL.to_string(),
                incident_title: None,
                checked_at: now,
            };
        }
    };

    if let Ok(data) = resp.json::<StatuspageSummary>().await {
        let mut indicator = map_indicator(data.status.as_ref().and_then(|s| s.indicator.as_deref()));

        if let Some(components) = data.components {
            let relevant = components.into_iter().filter(|c| {
                let name = c.name.as_deref().unwrap_or("").to_lowercase();
                name.contains("codex") || name.contains("api") || name.contains("login")
            });
            let mut worst = ServiceHealthIndicator::Operational;
            for comp in relevant {
                let comp_ind = map_indicator(comp.status.as_deref());
                worst = combine_signals(worst, comp_ind);
            }
            indicator = combine_signals(indicator, worst);
        }

        let active_incident = data.incidents.and_then(|incs| {
            incs.into_iter().find(|inc| {
                let s = inc.status.as_deref().unwrap_or("").to_lowercase();
                s != "resolved" && s != "completed"
            })
        });

        let default_desc = if indicator == ServiceHealthIndicator::Operational {
            "All Systems Operational"
        } else {
            "Service incident reported"
        };

        let description = data
            .status
            .and_then(|s| s.description)
            .unwrap_or_else(|| default_desc.to_string());

        return VendorServiceStatus {
            indicator,
            description,
            status_page_url: OPENAI_STATUS_PAGE_URL.to_string(),
            incident_title: active_incident.and_then(|inc| inc.name),
            checked_at: now,
        };
    }

    VendorServiceStatus {
        indicator: ServiceHealthIndicator::Unknown,
        description: "Status page temporarily unreachable".to_string(),
        status_page_url: OPENAI_STATUS_PAGE_URL.to_string(),
        incident_title: None,
        checked_at: now,
    }
}

pub async fn fetch_antigravity_status(client: &reqwest::Client) -> VendorServiceStatus {
    let now = Utc::now();
    if let Some(simulated) = get_simulated_incident(ProviderId::Antigravity) {
        return simulated;
    }

    let mut indicator = ServiceHealthIndicator::Operational;
    let mut incident_title = None;

    if let Ok(resp) = client
        .get(GOOGLE_CLOUD_INCIDENTS_URL)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(incidents) = resp.json::<Vec<GoogleIncident>>().await {
                let active_ai = incidents.into_iter().find(|inc| {
                    if inc.end.is_some() {
                        return false;
                    }
                    let text = format!(
                        "{} {}",
                        inc.service_name.as_deref().unwrap_or(""),
                        inc.external_desc.as_deref().unwrap_or("")
                    )
                    .to_lowercase();

                    text.contains("gemini")
                        || text.contains("vertex")
                        || text.contains("ai platform")
                        || text.contains("antigravity")
                });

                if let Some(first) = active_ai {
                    indicator = if first.severity.as_deref() == Some("high") {
                        ServiceHealthIndicator::Critical
                    } else {
                        ServiceHealthIndicator::Minor
                    };
                    incident_title = first.external_desc;
                }
            }
        }
    }

    let description = if indicator == ServiceHealthIndicator::Operational {
        "All Systems Operational".to_string()
    } else {
        "Google Cloud AI incident reported".to_string()
    };

    VendorServiceStatus {
        indicator,
        description,
        status_page_url: ANTIGRAVITY_STATUS_PAGE_URL.to_string(),
        incident_title,
        checked_at: now,
    }
}

pub async fn fetch_vendor_status(
    provider_id: ProviderId,
    client: &reqwest::Client,
) -> VendorServiceStatus {
    match provider_id {
        ProviderId::Claude => fetch_claude_status(client).await,
        ProviderId::Codex => fetch_codex_status(client).await,
        ProviderId::Antigravity => fetch_antigravity_status(client).await,
    }
}
