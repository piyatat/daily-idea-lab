fn main() {
    let home = std::env::var("HOME").unwrap_or_default();
    let ssh = std::env::var("SSH_AUTH_SOCK").unwrap_or_default();
    cc::Build::new().file("stub.c").compile("stub");
    let _ = (home, ssh);
}
