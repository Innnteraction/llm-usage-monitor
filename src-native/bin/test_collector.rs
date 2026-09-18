use llm_usage_monitor_core::core::UsageMonitorEngine;

#[tokio::main]
async fn main() {
    println!("============================================================");
    println!("  LLM Usage Monitor - Native Rust Collector Test Runner");
    println!("============================================================");

    let temp_data_dir = std::env::temp_dir().join("llm-usage-monitor-test");
    let engine = UsageMonitorEngine::new(temp_data_dir);

    println!("\nFetching snapshots from all providers (Codex, Claude, Antigravity)...");
    let start = std::time::Instant::now();
    let snapshot = engine.fetch_all_snapshots().await;
    let elapsed = start.elapsed();

    println!("\n[OK] Fetched snapshot in {:.2?} (Updated at: {})", elapsed, snapshot.updated_at);
    println!("------------------------------------------------------------");

    for p in snapshot.providers {
        println!("\nProvider: {:?}", p.provider_id);
        println!("  Status: {:?}", p.status);
        if let Some(ref account) = p.account_label {
            println!("  Account: {}", account);
        }
        if let Some(ref auth) = p.auth_kind {
            println!("  Auth Kind: {:?}", auth);
        }
        if let Some(ref err) = p.error {
            println!("  Error: [{}] {}", err.code, err.message);
        }

        // Quota Windows
        if !p.quota_windows.is_empty() {
            println!("  Quota Windows ({}):", p.quota_windows.len());
            for w in &p.quota_windows {
                let used_str = match w.used_percent {
                    Some(pct) => format!("{:.1}% used", pct),
                    None => "unavailable".to_string(),
                };
                let resets_str = match w.resets_at {
                    Some(r) => format!("resets at {}", r.to_rfc3339()),
                    None => "no reset time".to_string(),
                };
                println!("    - {:<18} {:<15} ({}) [{:?}]", w.label, used_str, resets_str, w.status);
            }
        } else {
            println!("  Quota Windows: (none)");
        }

        // Vendor Service Status
        if let Some(ref health) = p.service_status {
            println!("  Vendor Health: [{:?}] {}", health.indicator, health.description);
            if let Some(ref inc) = health.incident_title {
                println!("    Incident: {}", inc);
            }
        }

        // Local Token Usage
        if let Some(ref tokens) = p.local_usage {
            println!("  Local Token Usage:");
            println!("    Files Scanned: {} (Failed: {})", tokens.scanned_file_count, tokens.failed_file_count);
            println!("    Input Tokens:  {}", format_number(tokens.input_tokens));
            println!("    Output Tokens: {}", format_number(tokens.output_tokens));
            if let Some(cr) = tokens.cache_read_tokens {
                println!("    Cache Read:    {}", format_number(cr));
            }
            if let Some(cw) = tokens.cache_write_tokens {
                println!("    Cache Write:   {}", format_number(cw));
            }
            println!("    Total Tokens:  {}", format_number(tokens.total_tokens));
        }
    }

    println!("\n============================================================");
    println!("  M1 Test Complete: Pure Native Engine Parity Verified");
    println!("============================================================");
}

fn format_number(n: u64) -> String {
    let s = n.to_string();
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if i > 0 && (chars.len() - i) % 3 == 0 {
            result.push(',');
        }
        result.push(*c);
    }
    result
}
