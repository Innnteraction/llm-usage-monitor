//! Bounded local activation protocol; no provider data crosses this channel.
use std::{
    io::{self, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_millis(1500);
const MAX_BYTES: usize = 64;

fn read_line(stream: &mut TcpStream) -> io::Result<String> {
    let deadline = Instant::now() + TIMEOUT;
    let mut bytes = Vec::new();
    while bytes.len() < MAX_BYTES {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| io::Error::from(io::ErrorKind::TimedOut))?;
        stream.set_read_timeout(Some(remaining))?;
        let mut byte = [0];
        stream.read_exact(&mut byte)?;
        bytes.push(byte[0]);
        if byte[0] == b'\n' {
            return String::from_utf8(bytes).map_err(|_| io::ErrorKind::InvalidData.into());
        }
    }
    Err(io::ErrorKind::InvalidData.into())
}

fn handle_connection(mut stream: TcpStream, show: &SyncSender<()>) -> io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    let request = read_line(&mut stream)?;
    let response = match request.as_str() {
        "llm-usage-monitor/1 node show\n" | "llm-usage-monitor/1 node hidden\n" => {
            "llm-usage-monitor/1 rust different\n"
        }
        "llm-usage-monitor/1 rust hidden\n" => "llm-usage-monitor/1 rust ok\n",
        "llm-usage-monitor/1 rust show\n" => {
            match show.try_send(()) {
                Ok(()) | Err(TrySendError::Full(())) => {}
                Err(TrySendError::Disconnected(())) => return Err(io::ErrorKind::BrokenPipe.into()),
            }
            "llm-usage-monitor/1 rust ok\n"
        }
        _ => return Err(io::ErrorKind::InvalidData.into()),
    };
    stream.write_all(response.as_bytes())
}

pub struct InstanceServer {
    stopped: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl InstanceServer {
    pub fn start(listener: TcpListener) -> io::Result<(Self, Receiver<()>)> {
        listener.set_nonblocking(true)?;
        let stopped = Arc::new(AtomicBool::new(false));
        let worker_stop = stopped.clone();
        let (show, requests) = mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name("instance-requests".into())
            .spawn(move || {
                while !worker_stop.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let _ = handle_connection(stream, &show);
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(20))
                        }
                        Err(_) => break,
                    }
                }
            })?;
        Ok((
            Self {
                stopped,
                worker: Some(worker),
            },
            requests,
        ))
    }
}

impl Drop for InstanceServer {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum ExistingInstance {
    Accepted,
    Other,
    Unavailable,
}

pub fn request_existing(port: u16, show: bool) -> ExistingInstance {
    let request = || -> io::Result<ExistingInstance> {
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let mut stream = TcpStream::connect_timeout(&address, TIMEOUT)?;
        stream.set_write_timeout(Some(TIMEOUT))?;
        stream.write_all(if show {
            b"llm-usage-monitor/1 rust show\n"
        } else {
            b"llm-usage-monitor/1 rust hidden\n"
        })?;
        Ok(match read_line(&mut stream)?.as_str() {
            "llm-usage-monitor/1 rust ok\n" => ExistingInstance::Accepted,
            "llm-usage-monitor/1 node different\n" => ExistingInstance::Other,
            _ => ExistingInstance::Unavailable,
        })
    };
    request().unwrap_or(ExistingInstance::Unavailable)
}

pub fn failure_message(kind: io::ErrorKind, result: ExistingInstance) -> &'static str {
    if result == ExistingInstance::Other {
        "Node 버전이 실행 중입니다. 트레이 메뉴에서 종료한 뒤 Rust 버전을 실행하세요."
    } else if kind == io::ErrorKind::AddrInUse {
        "실행 잠금 포트가 사용 중이지만 앱의 응답을 확인하지 못했습니다. 구버전 앱이 실행 중이거나 다른 프로그램이 포트를 사용 중일 수 있습니다. 트레이의 앱을 확인하세요."
    } else {
        "실행 잠금을 확보하지 못했습니다. 로컬 네트워크 권한 또는 포트 사용 제한을 확인하세요."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activation_is_coalesced_hidden_requests_stay_hidden_and_drop_releases_port() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (server, requests) = InstanceServer::start(listener).unwrap();
        assert_eq!(request_existing(port, false), ExistingInstance::Accepted);
        assert!(requests.try_recv().is_err());
        for _ in 0..3 {
            assert_eq!(request_existing(port, true), ExistingInstance::Accepted);
        }
        requests.try_recv().unwrap();
        assert!(requests.try_recv().is_err());
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_err());
        drop(server);
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
    }

    #[test]
    fn different_variant_and_invalid_request_never_activate() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (_server, requests) = InstanceServer::start(listener).unwrap();
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        stream
            .write_all(b"llm-usage-monitor/1 node show\n")
            .unwrap();
        assert_eq!(
            read_line(&mut stream).unwrap(),
            "llm-usage-monitor/1 rust different\n"
        );
        let mut invalid = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        invalid.write_all(&[b'x'; MAX_BYTES + 1]).unwrap();
        assert!(read_line(&mut invalid).is_err());
        assert!(requests.try_recv().is_err());
    }

    #[test]
    fn old_or_unrelated_listener_is_not_mistaken_for_a_running_app() {
        for response in ["", "unrelated\n"] {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let worker = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let _ = read_line(&mut stream);
                stream.write_all(response.as_bytes()).unwrap();
            });
            assert_eq!(request_existing(port, true), ExistingInstance::Unavailable);
            worker.join().unwrap();
        }
        assert_ne!(
            failure_message(
                io::ErrorKind::PermissionDenied,
                ExistingInstance::Unavailable
            ),
            failure_message(io::ErrorKind::AddrInUse, ExistingInstance::Unavailable)
        );
    }

    #[test]
    fn silent_peer_times_out_and_server_recovers_from_partial_requests() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(TIMEOUT + Duration::from_millis(200));
        });
        assert_eq!(request_existing(port, true), ExistingInstance::Unavailable);
        worker.join().unwrap();

        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (_server, requests) = InstanceServer::start(listener).unwrap();
        let mut partial = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        partial.write_all(b"llm-usage-monitor/1 rust ").unwrap();
        partial
            .set_read_timeout(Some(TIMEOUT + Duration::from_secs(1)))
            .unwrap();
        assert_eq!(partial.read(&mut [0]).unwrap(), 0);
        assert_eq!(request_existing(port, true), ExistingInstance::Accepted);
        requests.try_recv().unwrap();
    }
}
