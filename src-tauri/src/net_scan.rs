//! Authorized, rate-limited TCP connect scanner.
//!
//! HARD RULE: targets must be loopback or RFC1918/ULA/link-local. Public
//! addresses and unresolvable-public hostnames are refused at this layer,
//! independent of UI gating.

use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const MAX_PORTS: usize = 1024;

fn permitted(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            v6.is_loopback() || (v6.segments()[0] & 0xffc0) == 0xfc00 // ULA fc00::/7
        }
    }
}

fn resolve_permitted(target: &str) -> Result<Vec<IpAddr>, String> {
    if let Ok(ip) = target.parse::<IpAddr>() {
        if permitted(ip) {
            return Ok(vec![ip]);
        }
        return Err("REFUSED: target is not loopback/private (public scanning is out of scope)".into());
    }
    let addrs: Vec<SocketAddr> = format!("{target}:0")
        .to_socket_addrs()
        .map_err(|e| format!("resolve failed: {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err("could not resolve target".into());
    }
    for a in &addrs {
        if !permitted(a.ip()) {
            return Err("REFUSED: hostname resolves outside loopback/private ranges".into());
        }
    }
    Ok(addrs.into_iter().map(|a| a.ip()).collect())
}

#[derive(serde::Serialize)]
pub struct TcpScanReport {
    target: String,
    scanned: usize,
    open: Vec<(u16, String)>,
    elapsed_ms: u64,
    refused_reason: Option<String>,
}

#[tauri::command]
pub fn tcp_scan(
    target: String,
    ports: Vec<u16>,
    timeout_ms: Option<u64>,
    concurrency: Option<usize>,
) -> Result<TcpScanReport, String> {
    if ports.is_empty() || ports.len() > MAX_PORTS {
        return Err(format!("ports count must be 1..{MAX_PORTS}"));
    }
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(400).clamp(50, 3000));
    let conc = concurrency.unwrap_or(48).clamp(1, 128);

    let ips = resolve_permitted(&target)?;
    let started = std::time::Instant::now();
    let open: Mutex<Vec<(u16, String)>> = Mutex::new(Vec::new());

    let mut remaining_ports: Vec<u16> = ports.clone();
    remaining_ports.sort_unstable();
    remaining_ports.dedup();

    let join_err: AtomicUsize = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        let mut handles: Vec<std::thread::ScopedJoinHandle<'_, ()>> = Vec::new();

        for ip in &ips {
            for port in &remaining_ports {
                while handles.len() >= conc {
                    if let Some(h) = handles.pop() {
                        if h.join().is_err() {
                            join_err.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
                let open_ref = &open;
                handles.push(scope.spawn(move || {
                    let addr = SocketAddr::new(*ip, *port);
                    if TcpStream::connect_timeout(&addr, timeout).is_ok() {
                        if let Ok(mut g) = open_ref.lock() {
                            g.push((*port, ip.to_string()));
                        }
                    }
                }));
            }
        }
        for h in handles {
            if h.join().is_err() {
                join_err.fetch_add(1, Ordering::Relaxed);
            }
        }
    });

    if join_err.load(Ordering::Relaxed) > 0 {
        return Err("one or more scan workers failed".into());
    }

    let mut found = open.into_inner().map_err(|_| "lock".to_string())?;
    found.sort();
    Ok(TcpScanReport {
        target: target.clone(),
        scanned: ports.len(),
        open: found,
        elapsed_ms: started.elapsed().as_millis() as u64,
        refused_reason: None,
    })
}

/// Enumerate the local machine's own private/loopback addresses (for
/// `pentest discover` - never touches the network beyond the local host).
#[tauri::command]
pub fn local_targets() -> Vec<String> {
    let mut out = vec!["127.0.0.1".to_string(), "::1".to_string()];
    if let Ok(addrs) = std::net::ToSocketAddrs::to_socket_addrs(&(std::env::var("COMPUTERNAME").unwrap_or_default().as_str(), 0)) {
        for a in addrs {
            if permitted(a.ip()) && !out.contains(&a.ip().to_string()) {
                out.push(a.ip().to_string());
            }
        }
    }
    out
}
