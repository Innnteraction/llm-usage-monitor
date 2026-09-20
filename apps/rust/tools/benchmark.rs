use llm_usage_monitor_core::core::local_usage::{
    ClaudeLocalScanner, CodexLocalScanner, LocalUsageCheckpointStore,
};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufWriter, Write},
    time::Instant,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let codex_root = dir.path().join("codex");
    let claude_root = dir.path().join("claude");
    fs::create_dir(&codex_root)?;
    fs::create_dir(&claude_root)?;
    let count = 10_000u64;
    let codex_line=b"{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":100,\"output_tokens\":20}}}}\n";
    for i in 0..count {
        let mut file = BufWriter::new(File::create(codex_root.join(format!("{i}.jsonl")))?);
        file.write_all(codex_line)?;
        file.flush()?;
        let mut file = BufWriter::new(File::create(claude_root.join(format!("{i}.jsonl")))?);
        writeln!(file,"{{\"type\":\"assistant\",\"message\":{{\"id\":\"synthetic-{i}\",\"usage\":{{\"input_tokens\":100,\"output_tokens\":20}}}}}}")?;
        file.flush()?;
    }
    let store = LocalUsageCheckpointStore::new(dir.path().join("cache.json"));
    let codex = CodexLocalScanner::with_root(codex_root.clone(), store.clone());
    let claude = ClaudeLocalScanner::with_root(claude_root, store);
    for pass in ["cold", "warm", "append"] {
        if pass == "append" {
            let mut file = OpenOptions::new()
                .append(true)
                .open(codex_root.join("0.jsonl"))?;
            file.write_all(b"{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":150,\"output_tokens\":20}}}}\n")?;
        }
        let start = Instant::now();
        let (c, a) = tokio::join!(codex.scan(), claude.scan());
        assert_eq!(c.scanned_file_count, count);
        assert_eq!(a.scanned_file_count, count);
        assert!(!c.partial && !a.partial);
        assert_eq!(
            c.total_tokens,
            count * 120 + if pass == "append" { 50 } else { 0 }
        );
        assert_eq!(a.total_tokens, count * 120);
        println!(
            "{}",
            serde_json::json!({"pass":pass,"files":count*2,"elapsedMs":start.elapsed().as_secs_f64()*1000.,"totalTokens":c.total_tokens+a.total_tokens})
        );
    }
    Ok(())
}
