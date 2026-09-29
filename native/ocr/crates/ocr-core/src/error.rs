use std::path::PathBuf;

/// 引擎的错误：说明写成中文，调用方（界面、日志）直接可用。
#[derive(Debug, thiserror::Error)]
pub enum OcrError {
    /// 调用方给的参数不对（图片尺寸、像素格式、配置）。
    #[error("{0}")]
    InvalidInput(String),
    /// 模型或字典文件读不了、格式不对，或者两者对不上。
    #[error("{path}：{message}")]
    Model { path: PathBuf, message: String },
    /// ONNX Runtime 推理出错。
    #[error("推理失败：{0}")]
    Inference(String),
}
