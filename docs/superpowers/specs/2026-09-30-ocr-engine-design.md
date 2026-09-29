# 本地 OCR 引擎设计

日期：2026-09-30。子项目「货架号识别」的第一部分：一个不依赖 Python、不调用外部程序和云服务的文字识别引擎，以 Node-API 扩展的形式给 Bun 和 Node.js 调用。第二部分（手机截图、协议、「图中文字识别」加工步骤、模板里用货架号）另写设计文档。

## 1. 目标与边界

- **做**：PP-OCRv6 文字检测 → DB 后处理 → 四边形框 → 透视裁剪 → 批量识别 → CTC 解码，输出每段文字的四点框、文字、检测分和识别分，以及各阶段耗时。
- **输入**：原始像素（BGRA、RGBA、BGR、RGB，带行跨度 stride）。引擎不做 PNG / JPEG 编解码：程序里由 Electron 的 `nativeImage` 解码成 BGRA，测试和 benchmark 用开发依赖 sharp 解码。
- **调用**：同一个 `.node` 文件给 Bun 和 Node.js 用；推理在工作线程上跑，不阻塞 JS 事件循环；模型会话创建一次、反复使用。
- **不做**（这一阶段）：版面 / 标签检测（只留接口）、GPU、SIMD 专门优化、精简算子的 ONNX Runtime、macOS 打包、装进安装包。
- **不用**：Python、PaddleOCR 的 Python 运行时、子进程、完整的 OpenCV。

## 2. 结构

```
native/ocr/
├── Cargo.toml              workspace
├── crates/
│   ├── ocr-core/           纯 Rust，不依赖 Node-API
│   │   └── src/
│   │       ├── image.rs        像素格式、stride、BGR 取样、缩放、归一化
│   │       ├── geometry.rs     点、四边形排序、最小外接矩形、多边形面积周长、透视变换
│   │       ├── detection.rs    检测的预处理、坐标映射
│   │       ├── postprocess.rs  DB 后处理：二值化、轮廓、框分、unclip
│   │       ├── recognition.rs  裁剪、按宽高比排序分批、缩放补齐
│   │       ├── ctc.rs          字典、CTC 解码、置信度
│   │       ├── reading_order.rs 阅读顺序
│   │       ├── inference.rs    推理后端接口 + ONNX Runtime 实现
│   │       ├── layout.rs       第二类检测模型的接口（只定义结果类型和 trait）
│   │       └── engine.rs       把上面串成 OcrEngine
│   └── ocr-addon/          napi-rs：cdylib，只做参数转换和异步任务
└── node/                   TypeScript 包装（ocr-node）：加载 .node、类型、参数校验、benchmark、示例
models/（不进 git，脚本下载）
├── tiny/  det.onnx  rec.onnx  dict.txt
└── small/ det.onnx  rec.onnx  dict.txt
```

- **依赖方向**：`ocr-addon` → `ocr-core`；`node` 只加载 `ocr-addon` 编出来的 `.node`。`ocr-core` 用 `cargo test` 测，不需要 Node。
- **模型不嵌进 `.node`**：`scripts/ocr/fetch-models.ts` 从 Hugging Face 的官方仓库（`PaddlePaddle/PP-OCRv6_{tiny,small}_{det,rec}_onnx`）下载，按登记的 SHA-256 校验，并从识别模型的 `inference.yml` 生成 `dict.txt`（一行一个字）。模型是 Apache-2.0 许可，NOTICE 里登记。

## 3. 模型参数：从模型和官方实现来，不凭假设

下面的值都已对照官方 ONNX 仓库的 `inference.yml` 和 PaddleX 的实现核实过（PaddleOCR 3.7 的推理由 PaddleX 执行）。能从模型里读的在运行时读；读不到的写成有名字的默认值，由测试对照 `inference.yml` 核对。

| 项 | 值 | 来源 / 处理 |
|---|---|---|
| 检测输入 / 输出 | `x`：`[N,3,H,W]` float32；输出 `[N,1,H,W]` 概率图 | 输入输出名从会话元数据读，不写死 |
| 颜色顺序 | BGR | `DecodeImage.img_mode` |
| 检测归一化 | `(x/255 − mean)/std`，mean `[0.485,0.456,0.406]`，std `[0.229,0.224,0.225]`，按 BGR 通道顺序套用 | `NormalizeImage` |
| 检测缩放 | 按 `limit_type` 和 `limit_side_len` 算比例 → 取整 → 长边不超过 `max_side_limit` → 各边四舍五入到 32 的倍数（至少 32）→ 双线性 | 默认取官方 OCR 流水线的 `64 / min / 4000`；可配置（单独跑检测模块时官方用 `960 / max`） |
| DB 后处理 | thresh、box_thresh、unclip_ratio、max_candidates | 默认取官方 OCR 流水线的 `0.3 / 0.6 / 1.5`，max_candidates 用模型自带的 3000；可配置（模型自带的前三项是 `0.2 / 0.4–0.45 / 1.4`） |
| 识别输入 | `[N,3,48,W]`，W 动态；输出 `[N,T,C]`，已做 softmax | 高度 48 从 `RecResizeImg.image_shape` 来；T 从输出形状读，不假设 W/8 |
| 识别缩放 | 目标宽 `int(48·max(320/48, w/h))`，最多 3200；按比例缩到 `ceil(48·w/h)`（不超过目标宽）；`(x/255−0.5)/0.5`；右侧补 0 到本批最宽 | `OCRReisizeNormImg`、`ToBatch` |
| 字典 | tiny 6904 个字，small 18708 个；首位补 blank，末尾补空格 | 启动时核对：输出类别数 = 字数 + 2，不等就报错 |
| CTC | 每步取最大值 → 去掉连续重复 → 去掉 blank；置信度 = 保留下来的各步最大概率的平均，没有字时为 0 | `CTCLabelDecode` |
| 批大小 | 默认 8（官方 6），可配置 | |

## 4. 流水线

1. **取样与预处理**：从调用方的像素（任一格式、任意 stride）直接取样成 BGR，并在同一遍里缩放到检测尺寸、归一化、写成 CHW 张量，不先生成一份完整的 BGR 图。原图另外只在裁剪文字时按需取样。
2. **检测**：一次推理得到概率图。
3. **DB 后处理**（`postprocess.rs`）：
   - 概率图 > thresh 得到二值图；
   - 找轮廓（`imageproc::contours::find_contours`，纯 Rust），最多 max_candidates 个；
   - 最小外接矩形（旋转卡壳，写在 `geometry.rs`，不用 OpenCV），短边小于 3 的丢掉；
   - 框分（fast 模式）：框内概率的平均值，低于 box_thresh 的丢掉；
   - unclip：距离 = 面积 × unclip_ratio / 周长，多边形向外扩（圆角连接；用纯 Rust 的 `i_overlay`，不需要 C++ 编译器），再取最小外接矩形，短边小于 5 的丢掉；
   - 四点排成左上、右上、右下、左下；按比例映射回原图坐标并夹在图内。
4. **阅读顺序**：先按左上角的 y、再按 x 排序，y 相差不到 10 像素且 x 顺序反了的相邻两个交换（和官方一致）。
5. **透视裁剪**：宽 = 上下两边较长的，高 = 左右两边较长的；用透视变换把四边形拉成矩形，双三次取样，边缘复制；高 / 宽 ≥ 1.5 时逆时针转 90°（竖着的一段字转正）。裁剪直接写成识别需要的高度，不先裁出原尺寸再缩放。
6. **批量识别**：按宽高比从小到大排序，每 `recognitionBatchSize` 个一批，每批一次 ORT 推理；补齐宽度到本批最宽；结果按原来的顺序放回。
7. **CTC 解码**：按第 3 节。

## 5. 推理后端

```rust
pub trait InferenceBackend: Send + Sync {
    /// 一个 float32 输入、一个 float32 输出；形状按模型的动态维度填。
    fn run(&self, input: TensorView<'_>) -> Result<Tensor, OcrError>;
    fn input_name(&self) -> &str;
}
```

- 现在只有 `OrtBackend`（`ort` 2.0 rc）。以后换 OpenVINO、ncnn，只需要再实现这个 trait。
- 会话在 `OcrEngine::create` 时创建一次；`intraThreads`、图优化级别在创建时设定。`ort` 的 `run` 要 `&mut self`，同一个会话的推理用互斥锁排队；检测和识别是两个会话，两次调用可以一个在检测、一个在识别。
- **链接方式**：Windows 用 `ort` 下载的静态 ONNX Runtime，得到一个自包含的 `.node`。macOS：`ort` 没有 Intel Mac 的预编译包，微软也从 1.24 起不再发布 Intel Mac 版；做 macOS 打包时改为运行时加载（`load-dynamic`）官方 1.23 的 universal2 动态库，或者自己编 x86_64，到时单独评估。

## 6. JS 接口

```ts
const engine = await OcrEngine.create({
  detModelPath, recModelPath, dictionaryPath,
  intraThreads: 4,
  recognitionBatchSize: 8,
  // 可选，默认见第 3 节
  detection?: { limitSideLen, limitType, maxSideLimit, thresh, boxThresh, unclipRatio, maxCandidates },
});
const result = await engine.recognize({ data, width, height, stride, pixelFormat: 'BGRA' });
engine.close();
```

- 返回 `OcrResult`：`width`、`height`、`regions[]`（`box` 四点、`text`、`detectionScore`、`recognitionScore`）、`timing`（预处理、检测、检测后处理、识别、总计，毫秒）。
- **异步**：`create` 和 `recognize` 都用 napi-rs 的 `AsyncTask`，在 libuv 的线程池上执行，结果回到 JS 线程。
- **少复制**：`data` 以 `Uint8Array` / `Buffer` 的引用传进工作线程直接读，不复制一份；约定在 Promise 结束前调用方不改这块内存（写进类型注释）。
- **校验**：宽高、stride、长度（`stride × (height−1) + width × 每像素字节数 ≤ data.length`）、像素格式在 TS 和 Rust 两边都查，出错给中文说明；`close` 之后再调用直接报错；`close` 等正在进行的推理结束后才释放会话。
- **Bun 和 Node 共用**：同一个 `.node`，TS 包装按平台和架构找文件（`ocr-addon.win32-x64-msvc.node` 这类 napi-rs 的命名）。

## 7. 第二类检测模型（只留接口）

```rust
pub struct Detection { pub quad: Quad, pub label: String, pub confidence: f32 }
pub trait RegionDetector: Send + Sync { fn detect(&self, image: &ImageView<'_>) -> Result<Vec<Detection>, OcrError>; }
```

版面、标签检测以后作为另一个 `RegionDetector` 实现，和 OCR 各自独立：OCR 不依赖它，它也不依赖 OCR。JS 侧同样留一个独立的 `LayoutEngine`，这一阶段不实现。

## 8. 性能

- 会话只建一次；识别按批推理；像素直接从调用方的内存取样。
- 每次调用复用的缓冲放在引擎里（检测张量、概率图、识别批张量），用互斥锁保护，避免每次分配。
- ORT：`intraThreads` 默认 4，`interThreads` 1，图优化级别 3。
- benchmark（`native/ocr/node/bench`）：同一张图预热 3 次后跑 20 次，报告各阶段中位数和 p95；tiny/tiny、tiny det + small rec、small/small 三种组合。

## 9. 测试与验收

- **单元测试**（`cargo test`，不需要模型）：
  - CTC：去重、去 blank、置信度、空结果；字典解析（blank、末尾空格、类别数核对）；
  - 几何：四点排序（各种旋转角度）、最小外接矩形、面积和周长、unclip 后的框、透视变换（四角映射、逆变换）、竖排转 90°；
  - 坐标：检测尺寸的计算（对照官方公式的几组数值）、映射回原图并夹边；
  - 阅读顺序；按宽高比分批与结果放回原位；像素格式与 stride 取样。
- **集成测试**（有模型时运行）：用一张真实的标签照片跑整条流水线，结果里要有 `A-1-2-3`、`CL5640-TK`；四种像素格式的结果一致；同一引擎并发调用。
- **Bun 和 Node 各跑一次** TS 示例：创建引擎、识别、关闭，事件循环在推理期间照常运转（定时器按时触发）。
- **提交前**：`cargo test`、`cargo clippy -- -D warnings`、`cargo fmt --check`，以及仓库原有的 `bun run check`。

## 10. 以后

- 第二部分：手机截图（按二维码角点摆正后截一块）、协议和中转服务、「图中文字识别」加工步骤（区域、正则、字段名、识别不到时的处理）、模板里用货架号、配置中心。
- 打包：Windows 把 `.node` 和模型放进安装包的 resources；macOS 的 ONNX Runtime 方案；CI 编译 `.node`。
- 版面 / 标签检测、SIMD、GPU、精简的 ONNX Runtime、零复制的原生帧、包体优化。
