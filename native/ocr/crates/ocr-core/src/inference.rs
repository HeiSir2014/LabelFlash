//! 推理后端：流水线只通过 `InferenceBackend` 跑模型，以后换 OpenVINO、ncnn 只需要再实现这个 trait。
//! 现在只有 ONNX Runtime 一个实现。

use std::path::Path;
use std::sync::{Mutex, PoisonError};

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::TensorRef;

use crate::OcrError;

/// 一次推理的输入：一个 `[N, C, H, W]` 的 float32 张量。
#[derive(Clone, Copy, Debug)]
pub struct InferenceInput<'a> {
    pub shape: [usize; 4],
    pub data: &'a [f32],
}

pub trait InferenceBackend: Send + Sync {
    /// 跑一次推理，输出写进 `output`（复用调用方的缓冲，不每次分配），返回输出的形状。
    fn run(&self, input: InferenceInput<'_>, output: &mut Vec<f32>)
        -> Result<Vec<usize>, OcrError>;

    /// 模型声明的输出形状，动态的维度是 None。加载时用来核对模型和字典对不对得上。
    fn declared_output_shape(&self) -> Vec<Option<usize>>;
}

/// 会话的线程设置。
#[derive(Clone, Copy, Debug)]
pub struct SessionOptions {
    /// 一个算子内部用几个线程。
    pub intra_threads: usize,
}

/// ONNX Runtime 会话：创建一次，反复使用。`Session::run` 要独占，所以同一个会话的推理用互斥锁排队。
pub struct OrtBackend {
    session: Mutex<Session>,
    input_name: String,
    output_shape: Vec<Option<usize>>,
}

impl OrtBackend {
    pub fn load(path: &Path, options: SessionOptions) -> Result<Self, OcrError> {
        let fail = |message: String| OcrError::Model {
            path: path.to_owned(),
            message,
        };
        if !path.is_file() {
            return Err(fail("找不到模型文件".into()));
        }
        let session = Session::builder()
            .map_err(|error| fail(error.to_string()))?
            .with_optimization_level(GraphOptimizationLevel::All)
            .map_err(|error| fail(error.to_string()))?
            .with_intra_threads(options.intra_threads)
            .map_err(|error| fail(error.to_string()))?
            // 模型是一条链，算子之间不并行：inter 线程只会多开空闲线程。
            .with_inter_threads(1)
            .map_err(|error| fail(error.to_string()))?
            .commit_from_file(path)
            .map_err(|error| fail(format!("模型加载失败：{error}")))?;
        let [input] = session.inputs() else {
            return Err(fail(format!(
                "模型应当只有 1 个输入，实际 {} 个",
                session.inputs().len()
            )));
        };
        let input_name = input.name().to_owned();
        let output_shape = session
            .outputs()
            .first()
            .and_then(|output| output.dtype().tensor_shape())
            .map(|shape| shape.iter().map(|&d| usize::try_from(d).ok()).collect())
            .ok_or_else(|| fail("模型没有张量输出".into()))?;
        Ok(Self {
            session: Mutex::new(session),
            input_name,
            output_shape,
        })
    }
}

impl InferenceBackend for OrtBackend {
    fn run(
        &self,
        input: InferenceInput<'_>,
        output: &mut Vec<f32>,
    ) -> Result<Vec<usize>, OcrError> {
        let fail = |error: ort::Error| OcrError::Inference(error.to_string());
        // 直接引用调用方的切片，不复制。
        let tensor = TensorRef::from_array_view((input.shape, input.data)).map_err(fail)?;
        let mut session = self.session.lock().unwrap_or_else(PoisonError::into_inner);
        let outputs = session
            .run(ort::inputs![self.input_name.as_str() => tensor])
            .map_err(fail)?;
        let (shape, data) = outputs[0].try_extract_tensor::<f32>().map_err(fail)?;
        output.clear();
        output.extend_from_slice(data);
        shape
            .iter()
            .map(|&d| {
                usize::try_from(d)
                    .map_err(|_| OcrError::Inference(format!("输出形状不对：{shape:?}")))
            })
            .collect()
    }

    fn declared_output_shape(&self) -> Vec<Option<usize>> {
        self.output_shape.clone()
    }
}
