//! Local fixture bridge. Never starts provider CLIs or reads default account roots.
use llm_usage_monitor_core::core::{
    engine::cache,
    local_usage::{ClaudeLocalScanner, CodexLocalScanner, LocalUsageCheckpointStore},
};
#[tokio::main]
async fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 4, "usage: cache-fixture scan|lock|quota|incomplete-write CACHE ROOT");
    let dir = std::path::PathBuf::from(&args[2]);
    assert_ne!(dir, cache::directory(), "fixture requires isolated storage");
    if args[1] == "quota" {
        let providers = cache::load(&dir);
        cache::save(&dir, &providers).ok();
        println!("{}", serde_json::to_string(&providers).unwrap());
        return;
    }
    if args[1] == "incomplete-write" {
        use std::io::Write;
        let _lock = cache::acquire_lock(&dir).unwrap();
        let mut file = tempfile::NamedTempFile::new_in(&dir).unwrap();
        file.write_all(b"{\"schemaVersion\":").unwrap();
        file.as_file().sync_all().unwrap();
        println!("temporary-written");
        std::io::stdout().flush().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    if args[1] == "lock" {
        match cache::acquire_lock(&dir) {
            Ok(_lock) => {
                println!("locked");
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
            Err(_) => std::process::exit(2),
        }
        return;
    }
    assert_eq!(args[1], "scan");
    let root = std::path::PathBuf::from(&args[3]);
    let store = LocalUsageCheckpointStore::new(dir.join("local-usage-index-v2.json"));
    let codex = CodexLocalScanner::with_root(root.join("codex"), store.clone())
        .scan()
        .await;
    let claude = ClaudeLocalScanner::with_root(root.join("claude"), store)
        .scan()
        .await;
    // Only aggregate fixture values; raw inputs and account identifiers are never printed.
    println!("{}", serde_json::json!({"codex":codex,"claude":claude}));
}
