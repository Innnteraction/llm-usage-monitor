pub mod checkpoint;
pub mod claude;
pub mod codex;
pub mod types;

pub use checkpoint::LocalUsageCheckpointStore;
pub use claude::ClaudeLocalScanner;
pub use codex::CodexLocalScanner;
pub use types::{LocalUsageCheckpointState, TokenContribution};

use self::types::LocalUsageFileCheckpoint;
use crate::core::types::LocalTokenUsage;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

// 최대 한 줄만 버퍼링하고 미완성 UTF-8/JSON 행은 다음 스캔에서 재시도한다.
const MAX_LINE_BYTES: u64 = 16 * 1024 * 1024;
type ParseLine = fn(serde_json::Value, &mut LocalUsageFileCheckpoint) -> Result<(), ()>;

fn boundary(file: &mut File, offset: u64) -> std::io::Result<String> {
    let mut hash = Sha256::new();
    for start in [0, offset.saturating_sub(4096)] {
        file.seek(SeekFrom::Start(start))?;
        let mut bytes = vec![0; (offset - start).min(4096) as usize];
        file.read_exact(&mut bytes)?;
        hash.update(bytes);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn scan_file(
    path: &Path,
    file_key: &str,
    previous: Option<&LocalUsageFileCheckpoint>,
    parse: ParseLine,
    provider: &str,
) -> std::io::Result<LocalUsageFileCheckpoint> {
    let metadata = path.metadata()?;
    let size = metadata.len();
    let mtime = metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;
    let identity = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| hash(&d.as_millis().to_string()))
        .unwrap_or_default();
    let mut file = File::open(path)?;
    if let Some(p) = previous {
        if p.size == size
            && p.mtime_ms == mtime
            && p.identity == identity
            && !p.boundary_hash.is_empty()
            && boundary(&mut file, p.offset)? == p.boundary_hash
        {
            return Ok(p.clone());
        }
    }
    let resume = if let Some(p) = previous {
        size > p.size
            && p.offset <= size
            && p.identity == identity
            && !p.boundary_hash.is_empty()
            && boundary(&mut file, p.offset)? == p.boundary_hash
    } else {
        false
    };
    let mut cp = if resume {
        previous.unwrap().clone()
    } else {
        LocalUsageFileCheckpoint {
            file_key: file_key.into(),
            identity: identity.clone(),
            size: 0,
            mtime_ms: 0.,
            offset: 0,
            boundary_hash: String::new(),
            error_count: Some(0),
            observed_from: None,
            contribution: TokenContribution::default(),
            last_cumulative: None,
            messages: None,
        }
    };
    file.seek(SeekFrom::Start(cp.offset))?;
    let mut reader = BufReader::with_capacity(8192, file);
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = reader
            .by_ref()
            .take(MAX_LINE_BYTES + 1)
            .read_until(b'\n', &mut line)?;
        if n == 0 {
            break;
        }
        if line.len() as u64 > MAX_LINE_BYTES && !line.ends_with(b"\n") {
            // 크기 제한을 넘은 행을 청크로 버린다. 내용은 보존하지 않는다.
            while !line.ends_with(b"\n") {
                line.clear();
                if reader
                    .by_ref()
                    .take(MAX_LINE_BYTES)
                    .read_until(b'\n', &mut line)?
                    == 0
                {
                    break;
                }
            }
            if !line.ends_with(b"\n") {
                break;
            }
            cp.error_count = Some(cp.error_count.unwrap_or(0).saturating_add(1));
            cp.offset = reader.stream_position()?;
            continue;
        }
        if !line.ends_with(b"\n") {
            break;
        }
        cp.offset = reader.stream_position()?;
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let contains = |needle: &[u8]| line.windows(needle.len()).any(|w| w == needle);
        let candidate = if provider == "codex" {
            contains(b"token_count") && contains(b"total_token_usage")
        } else {
            contains(b"\"assistant\"") && contains(b"\"message\"") && contains(b"\"usage\"")
        };
        if !candidate {
            continue;
        }
        let valid = serde_json::from_slice(&line)
            .ok()
            .is_some_and(|value| parse(value, &mut cp).is_ok());
        if !valid {
            cp.error_count = Some(cp.error_count.unwrap_or(0).saturating_add(1));
        }
    }
    let mut file = reader.into_inner();
    cp.boundary_hash = boundary(&mut file, cp.offset)?;
    cp.identity = identity;
    cp.size = size;
    cp.mtime_ms = mtime;
    Ok(cp)
}
fn discover(dir: &Path, files: &mut Vec<PathBuf>, failures: &mut u64) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            *failures += 1;
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                *failures += 1;
                continue;
            }
        };
        let kind = match entry.file_type() {
            Ok(k) => k,
            Err(_) => {
                *failures += 1;
                continue;
            }
        };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            discover(&path, files, failures);
        } else if path.extension().is_some_and(|e| e == "jsonl") {
            files.push(path);
        }
    }
}
fn scan(
    root: &Path,
    store: &LocalUsageCheckpointStore,
    provider: &str,
    parse: ParseLine,
) -> LocalTokenUsage {
    let root_key = root_hash(root);
    let mut section = store.get_provider(provider);
    if section.root_key.as_deref() != Some(root_key.as_str()) {
        section = Default::default();
    }
    section.root_key = Some(root_key.clone());
    let mut files = vec![];
    let mut failed = 0;
    discover(root, &mut files, &mut failed);
    let discovered: HashSet<_> = files
        .iter()
        .map(|p| file_hash(&root_key, root, p))
        .collect();
    let discovery_failed = failed > 0;
    if failed == 0 {
        section.files.retain(|key, _| discovered.contains(key));
    }
    let mut agg = TokenContribution::default();
    for path in &files {
        let key = file_hash(&root_key, root, path);
        match scan_file(path, &key, section.files.get(&key), parse, provider) {
            Ok(cp) => {
                if cp.error_count.unwrap_or(0) > 0 {
                    failed += 1;
                }
                agg.add(&cp.contribution);
                section.files.insert(key, cp);
            }
            Err(_) => {
                failed += 1;
                if let Some(cp) = section.files.get(&key) {
                    agg.add(&cp.contribution);
                }
            }
        }
    }
    if discovery_failed {
        for (key, checkpoint) in &section.files {
            if !discovered.contains(key) {
                agg.add(&checkpoint.contribution);
            }
        }
    }
    if provider == "claude" {
        let mut messages = std::collections::HashMap::<String, TokenContribution>::new();
        for file in section.files.values() {
            if let Some(m) = &file.messages {
                for (id, value) in m {
                    messages.entry(id.clone()).or_default().merge_message(value);
                }
            }
        }
        agg = TokenContribution::default();
        for v in messages.values() {
            agg.add(v);
        }
    }
    if !agg.valid() {
        return failed_usage();
    }
    let summary = LocalTokenUsage {
        scope: "local_device".into(),
        scanned_file_count: section.files.len() as u64,
        failed_file_count: failed,
        input_tokens: agg.input_tokens,
        output_tokens: agg.output_tokens,
        cache_read_tokens: (provider != "claude" || agg.cache_read_tokens > 0)
            .then_some(agg.cache_read_tokens),
        cache_write_tokens: (provider != "claude" || agg.cache_write_tokens > 0)
            .then_some(agg.cache_write_tokens),
        total_tokens: agg.input_tokens.saturating_add(agg.output_tokens),
        partial: failed > 0,
        calculated_at: chrono::Utc::now(),
        observed_from: section
            .files
            .values()
            .filter_map(|f| f.observed_from.as_ref())
            .filter_map(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&chrono::Utc))
            .min(),
    };
    section.summary = Some(summary.clone());
    store.save_provider(provider, section);
    summary
}
fn failed_usage() -> LocalTokenUsage {
    LocalTokenUsage {
        scope: "local_device".into(),
        scanned_file_count: 0,
        failed_file_count: 1,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: None,
        cache_write_tokens: None,
        total_tokens: 0,
        partial: true,
        calculated_at: chrono::Utc::now(),
        observed_from: None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn codex_line(input: u64) -> String {
        format!(
            "{}\n",
            serde_json::json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":input,"output_tokens":2,"cached_input_tokens":0,"total_tokens":input+2}}}})
        )
    }
    #[tokio::test]
    async fn codex_incremental_partial_utf8_truncate_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("sessions");
        std::fs::create_dir(&root).unwrap();
        let path = root.join("session.jsonl");
        std::fs::write(&path, codex_line(10)).unwrap();
        let store = LocalUsageCheckpointStore::new(dir.path().join("cache.json"));
        let scanner = CodexLocalScanner::with_root(root, store.clone());
        assert_eq!(scanner.scan().await.total_tokens, 12);
        let before = store
            .get_provider("codex")
            .files
            .values()
            .next()
            .unwrap()
            .offset;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        let line = format!("{{\"note\":\"{}한글\"}}\n", "a".repeat(8180));
        let cut = line.find('한').unwrap() + 1;
        file.write_all(&line.as_bytes()[..cut]).unwrap();
        file.flush().unwrap();
        let partial = scanner.scan().await;
        assert!(!partial.partial);
        assert_eq!(partial.total_tokens, 12);
        assert_eq!(
            store
                .get_provider("codex")
                .files
                .values()
                .next()
                .unwrap()
                .offset,
            before
        );
        file.write_all(&line.as_bytes()[cut..]).unwrap();
        file.write_all(codex_line(25).as_bytes()).unwrap();
        file.flush().unwrap();
        let complete = scanner.scan().await;
        assert!(!complete.partial);
        assert_eq!(complete.total_tokens, 27);
        assert_eq!(scanner.scan().await.total_tokens, 27);
        drop(file);
        std::fs::write(&path, codex_line(3)).unwrap();
        assert_eq!(scanner.scan().await.total_tokens, 5);
        std::fs::remove_file(path).unwrap();
        assert_eq!(scanner.scan().await.total_tokens, 0);
    }
    #[tokio::test]
    async fn claude_repeated_message_uses_latest_usage_and_malformed_is_partial() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let row = |out| {
            format!("{{\"type\":\"assistant\",\"message\":{{\"id\":\"synthetic\",\"usage\":{{\"input_tokens\":10,\"output_tokens\":{out},\"cache_read_input_tokens\":5}}}}}}\n")
        };
        std::fs::write(&path, row(2)).unwrap();
        let store = LocalUsageCheckpointStore::new(dir.path().join("cache.json"));
        let scanner = ClaudeLocalScanner::with_root(dir.path().into(), store);
        assert_eq!(scanner.scan().await.total_tokens, 17);
        let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        file.write_all(row(7).as_bytes()).unwrap();
        file.write_all(b"{\"assistant\" \"message\" \"usage\":invalid}\n")
            .unwrap();
        file.flush().unwrap();
        let usage = scanner.scan().await;
        assert_eq!(usage.total_tokens, 22);
        assert!(usage.partial);
    }
    #[tokio::test]
    async fn oversized_line_is_bounded_and_following_usage_survives() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.jsonl");
        let mut file = File::create(path).unwrap();
        for _ in 0..17408 {
            file.write_all(&[b'x'; 1024]).unwrap();
        }
        file.write_all(b"\n").unwrap();
        file.write_all(codex_line(8).as_bytes()).unwrap();
        drop(file);
        let scanner = CodexLocalScanner::with_root(
            dir.path().into(),
            LocalUsageCheckpointStore::new(dir.path().join("cache.json")),
        );
        let usage = scanner.scan().await;
        assert_eq!(usage.total_tokens, 10);
        assert!(usage.partial);
    }
}

fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn root_hash(root: &Path) -> String {
    let absolute = std::fs::canonicalize(root).unwrap_or_else(|_| {
        if root.is_absolute() {
            root.to_owned()
        } else {
            std::env::current_dir().unwrap_or_default().join(root)
        }
    });
    let value = absolute.to_string_lossy().replace('\\', "/");
    let value = value.strip_prefix("//?/").unwrap_or(&value);
    hash(&if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value.into()
    })
}
fn file_hash(root_key: &str, root: &Path, path: &Path) -> String {
    hash(&format!(
        "{}\0{}",
        root_key,
        path.strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    ))
}
fn observe(value: &serde_json::Value, cp: &mut LocalUsageFileCheckpoint) {
    if let Some(time) = value["timestamp"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    {
        let time = time
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        if cp.observed_from.as_ref().is_none_or(|old| *old > time) {
            cp.observed_from = Some(time);
        }
    }
}
