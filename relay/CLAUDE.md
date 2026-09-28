# relay — 改中转服务和扫码页前先读

运行和部署见同目录的 `README.md`，设计见 `docs/superpowers/specs/2026-09-29-mobile-scan-relay-design.md`。

## 约束

- **代码里不写域名**：项目开源，官方中转服务的域名不进代码、测试和脚本。
  - 测试用 `relay.example.com`；服务端的 `PUBLIC_ORIGIN` 必填、没有默认值；
  - 部署目标从环境变量读；
  - 文档里只说「官方安装包默认用 yterm.cn」，具体服务器的配置不进仓库。
- **中转服务只转发**：不解析内层消息（它是加密的），不做业务判断，不写磁盘。手机的接纳、校验、排队、限流、打印都在电脑上（`src/main/mobile/`）。
- **协议只有一份**：
  - 消息类型、校验、常量都在 `src/shared/mobile-protocol.ts`，三方共用。
  - 改协议时同时改电脑端（`src/main/mobile/`）、手机端（`web/src/phone-session.ts`）、设计文档第 5 节，并补测试。
  - 协议不兼容的改动要升 `MOBILE_PROTOCOL_VERSION`，并让中转服务在一段时间内同时接受新旧版本。
- **协议按正规做法设计，不为界面兜底**：
  - 打印任务是幂等的（任务号去重），防重放靠本次连接的 `nonce` 加严格递增的 `seq`，背压靠明确的 `refused`。
  - 不要加「超时就提示用户去看看」这类兜底。
- **扫码页只从本站加载**：
  - CSP 不允许内联脚本、第三方资源；
  - zxing 的 wasm 由构建脚本复制到 `web/assets/` 并用 `locateFile` 指向本站；
  - 页面文字一律用 `textContent`，不用 `innerHTML`。
- **加解密是异步的**：两端都把收和发各串成一条链（`inbox`、`outgoing`），保证按 `seq` 顺序发出、按收到的顺序处理。新增收发路径时不要绕开这两条链。
- **用词一致**：结果标题取 `VOICE_CUE_TEXT`（经 `src/shared/print-cues.ts`），和电脑的状态栏、语音同一句话。

## 摄像头与解码（都在 `web/src/`）

- **能力判断是纯函数**：对焦、变焦、手电筒按 `getCapabilities()` 报告的能力决定，逻辑在 `camera-features.ts`，有单元测试；`camera.ts` 只调用浏览器 API。
- **iPhone**：不报告这些能力，由系统持续自动对焦，不要为它写特殊分支。
- **字符集**：没有 ECI 的码按原始字节判断 UTF-8 还是 GBK（`barcode-text.ts`），不用 ZXing 的猜测。短的 GBK 中文可能恰好是合法 UTF-8，例如「图片色」。
- **防抖**：同一张标签停在镜头里只打一次（`scan-gate.ts`）。拍照识别、手动输入、重试、补打不经过防抖，但会被记住。

## 测试

- **单元测试和集成测试**：`bun test relay src/shared src/main/mobile`。
  - 中转核心 `hub.ts` 用假连接和假时钟测；
  - `server.test.ts` 起真实服务；
  - `src/main/mobile/mobile-host.test.ts` 用真实中转服务和手机端代码走完整流程，包括中转服务重启。
- **浏览器测试**：`bun run test:relay-browser`，需要本机有 Edge。Edge 用假摄像头播放含二维码的视频，确认扫到、只打一次、显示结果。改了扫码页必须跑。
- **真手机**：部署到有 https 的服务器后，用 `scripts/relay/demo-desktop.ts` 当电脑端，在 iPhone Safari、iPhone 微信、安卓 Chrome、安卓微信上各扫一次，结果记进 `docs/windows-acceptance.md`。
