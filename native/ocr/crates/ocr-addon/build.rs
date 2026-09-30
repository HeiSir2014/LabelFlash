fn main() {
    napi_build::setup();
    // 自己编的 ONNX Runtime（1.30 起）在 Windows 上总会编进 ETW 事件源（core/platform/windows/telemetry.cc），
    // 它用到 shell32 的 CommandLineToArgvW；ort-sys 只链接它认识的系统库。
    // 只是导入库：没用到就不会产生对 shell32.dll 的依赖，链接预编译包时没有影响。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-lib=shell32");
    }
}
