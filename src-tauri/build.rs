fn main() {
    println!("cargo:rerun-if-changed=native/reminders.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/reminders.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("inote_reminders");
        println!("cargo:rustc-link-lib=framework=EventKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
    tauri_build::build()
}
