# 本地 OCR 引擎实施计划

设计：`docs/superpowers/specs/2026-09-30-ocr-engine-design.md`。分五个阶段，每个阶段单独提交，提交前 `cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check` 和 `bun run check` 都要通过。

## 阶段 1：工程骨架和模型

**目标**：Cargo workspace（`native/ocr`：`ocr-core`、`ocr-addon`）能编译；`bun run ocr:models` 下载 tiny、small 两套模型到 `models/`，校验 SHA-256，从识别模型的 `inference.yml` 生成 `dict.txt`。
**成功标准**：`cargo test` 能跑；`models/{tiny,small}/{det.onnx,rec.onnx,dict.txt}` 就位；`dict.txt` 行数分别是 6904、18708。
**测试**：`scripts/ocr/model-config.test.ts` 读 `inference.yml` 片段，核对引擎的默认参数（颜色顺序、均值方差、识别高度、DB 参数）和模型配置一致。
**状态**：完成

## 阶段 2：纯逻辑（不需要模型）

**目标**：`image`（像素格式、stride、取样、双线性缩放、归一化）、`geometry`（四点排序、最小外接矩形、面积周长、透视变换）、`ctc`（字典、解码、置信度）、`reading_order`、检测尺寸计算、识别分批。
**成功标准**：各模块单元测试通过，数值对照官方公式。
**测试**：见设计第 9 节「单元测试」。
**状态**：未开始

## 阶段 3：DB 后处理

**目标**：二值化 → 轮廓 → 最小外接矩形 → 框分 → unclip → 映射回原图。
**成功标准**：合成的概率图（几个矩形、旋转的矩形）得到正确的四点框和分数。
**测试**：矩形、旋转 30° 的矩形、低分区域被丢掉、太小的框被丢掉、坐标夹边。
**状态**：未开始

## 阶段 4：推理和整条流水线

**目标**：`InferenceBackend` + `OrtBackend`；`OcrEngine`：检测 → 后处理 → 裁剪 → 批量识别 → CTC → 阅读顺序；缓冲复用；耗时统计。
**成功标准**：Rust 集成测试用真实模型识别 `native/ocr/fixtures/shelf-label.png`，结果里有 `A-1-2-3` 和 `CL5640-TK`；输出类别数和字典不符时报错。
**测试**：集成测试（没有模型时跳过并说明）；四种像素格式结果一致。
**状态**：未开始

## 阶段 5：Node-API 扩展、TS 包装、benchmark

**目标**：`ocr-addon`（napi-rs `AsyncTask`）；`native/ocr/node`：`OcrEngine.create / recognize / close`、参数校验、类型；`bun run ocr:build` 编译并把 `.node` 放好；示例和 benchmark 在 Bun 和 Node 上都能跑。
**成功标准**：Bun、Node 各跑一次示例得到同样的文字；推理期间事件循环里的定时器照常触发；benchmark 输出三种模型组合的各阶段耗时。
**测试**：TS 包装的参数校验单元测试（不需要 `.node`）；有 `.node` 和模型时的端到端测试。
**状态**：未开始
