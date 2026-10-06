# 本机接口接入说明

CDL-云签速印在电脑上提供一个 HTTP 接口。网页系统、客户端软件、服务器程序把「模板 + 字段」交给它，它按模板排版、按纸张选打印机、打出标签；也可以只排版，取回 PDF。

- 接口遵循 Google API 设计规范（AIP）：资源、标准方法、`google.rpc.Status` 错误格式、分页。
- 完整描述是 OpenAPI 3.1：`GET /v1/openapi.json`，可以用它生成各种语言的调用代码。
- 设计文档：`docs/superpowers/specs/2026-09-30-local-api-design.md`。

## 1. 找到服务

| 项 | 说明 |
|---|---|
| 地址 | 本机：`http://127.0.0.1:<端口>`；局域网：`http://<这台电脑的局域网 IP>:<端口>`。配置中心「本机接口」页列出了可用的地址 |
| 端口 | 一般是 17631。程序记住上次成功用的端口，下次启动还用它，所以配好之后端口不会变；只有它被别的程序占了才换：依次试 17631–17640，都不行就由系统分配一个。换了端口时配置中心会提示。在配置中心填了端口的，优先用填的 |
| 确认身份 | `GET /v1/service` 不需要授权，返回 `{"product":"CDL-LabelFlash","apiVersion":"v1","appVersion":"…","port":17631,"instanceId":"…"}`。先调它，确认连的是本程序，不是占着端口的别的程序 |
| 这台电脑的编号 | `instanceId` 是这台电脑上本程序的固定编号（UUID），重启、升级、换端口都不变。调用方可以记下它：换端口后找到的服务，用它确认还是原来那台电脑 |
| 协议 | 只有 HTTP，没有 HTTPS。局域网里传输是明文，只在可信的局域网里使用 |
| 程序开着才可用 | 接口跑在 CDL-云签速印里，程序退出时接口也不可用 |

连不上记下的端口时，可以按 17631 → 17640 的顺序试，每个都用 `/v1/service` 确认 `product` 和 `instanceId`。

## 2. 授权

除了 `/v1/service` 和 `/v1/openapi.json`，其他接口都要授权。有两种方式：

### 程序密钥（客户端软件、服务器程序）

1. 在配置中心「本机接口」页「程序密钥」里填名称（例如「ERP 服务器」），点「生成密钥」。
2. 密钥以 `lf_` 开头，只显示这一次，点「复制」存到调用方的配置里。程序只保存它的摘要，丢了只能撤销后重新生成。
3. 每个请求带上请求头：`Authorization: Bearer lf_…`。

本机和局域网的程序都用这种方式。局域网来的请求只认程序密钥。

### 网站授权（浏览器里的网页，只限本机）

网页从本机的浏览器调用 `http://127.0.0.1:<端口>` 时，不用密钥：

1. 网页第一次调用，收到 403 和原因 `ORIGIN_NOT_AUTHORIZED`；同时程序顶部出现「网站想使用打印服务：允许 / 拒绝」，并弹出系统通知提醒操作员。
2. 操作员点「允许」后，这个网站（协议 + 域名 + 端口）一直有效，直到在配置中心「本机接口」页撤销。网页重试即可。
3. 操作员点「拒绝」后 10 分钟内，这个网站的请求直接收到 403 和原因 `ORIGIN_DENIED`，不再询问。10 分钟没人处理的询问自动收起，网页再次调用时重新询问。
4. 同时最多 3 个网站在等确认，再多的收到 `ORIGIN_NOT_AUTHORIZED`，稍后重试即可。

网页能读到哪些响应：已授权网站的所有响应；没授权的网站只能读到上面两种授权错误（`ORIGIN_NOT_AUTHORIZED`、`ORIGIN_DENIED`），其他响应浏览器不让读，`fetch` 会抛出 `TypeError`。

注意：

- 网页要用 `http://127.0.0.1` 或 `http://localhost` 访问：程序核对 Host，防 DNS 重绑定。
- Chrome 142 起，公网网页访问本机会先弹浏览器自己的「访问本地网络设备」权限框，用户拒绝时 `fetch` 直接失败，网页要提示用户去浏览器的网站设置里允许。
- 用本地文件（`file://`）打开的网页、沙盒 iframe 没有网站来源（Origin 是 `null`），不能按网站授权，请改用程序密钥（例如由自己的后端转发）。

## 3. 接口

所有路径都在 `/v1` 下。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/service` | 确认身份（不需要授权） |
| GET | `/v1/openapi.json` | OpenAPI 描述（不需要授权） |
| GET | `/v1/templates` | 可用的模板 |
| GET | `/v1/templates/{template}` | 一个模板 |
| POST | `/v1/templates/{template}:render` | 只排版，返回 PDF |
| GET | `/v1/printers` | 打印机、各自负责的纸张和状态 |
| POST | `/v1/printJobs` | 提交一个打印任务 |
| POST | `/v1/printJobs:batchCreate` | 一次提交多个（最多 1000 个） |
| GET | `/v1/printJobs/{printJob}` | 任务状态 |
| GET | `/v1/printJobs` | 本调用方的任务，新的在前，分页 |

### 模板

```json
{
  "name": "templates/builtin-generic",
  "displayName": "通用（二维码在左）",
  "paper": { "widthMm": 60, "heightMm": 40 },
  "printer": null,
  "fieldsMode": "ALL",
  "fieldNames": []
}
```

- 模板在电脑上的配置中心「模板」页设计。接口里用 `name`（冒号换成了横线：程序里的 `builtin:generic` 就是 `builtin-generic`）。
- 1.3.0 起内置标签模板只有「通用」一组。原来的样衣模板名照样能用：`builtin-standard`、`builtin-plain` 按 `builtin-generic` 打，`builtin-qr-right` 按 `builtin-generic-qr-right` 打。
- `fieldsMode` 为 `ALL` 时，标签按你给的顺序显示全部字段；`PICKED` 时只显示模板指定的字段。`fieldNames` 是模板点名要的字段（指定的字段、二维码取的字段、备注里的 `{字段名}`），照着传即可。
- 模板分三类：标签（二维码 + 字段区）、面单（格子版式）、自由设计（元素版式，吊牌、价签、商品条码）。面单和自由设计的 `fieldsMode` 都是 `PICKED`，`fieldNames` 列出版面上用到的全部字段，按这个清单传字段即可。

### 打印任务

请求：

```json
{
  "template": "templates/builtin-generic",
  "fields": [
    { "name": "编码", "value": "CL5640-TK" },
    { "name": "颜色", "value": "图片色" },
    { "name": "尺码", "value": "XL" }
  ],
  "content": "CL5640-TK-图片色-XL",
  "copies": 1,
  "printer": null,
  "requestId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

| 字段 | 说明 |
|---|---|
| `template` | 必填，模板名 |
| `fields` | 必填，1–50 个，有顺序。名称 1–20 个字，不能有花括号、换行和控制字符，不能重名；值最长 1000 个字 |
| `content` | 可选，最长 1000 个字。「完整内容」：二维码选了「完整内容」、底部整行、备注里的 `{完整内容}` 用它。不给时由字段拼成「名称：值」一行一个 |
| `copies` | 1–100，默认 1。每一份都是一条打印记录 |
| `printer` | 可选，系统里的打印机名（见 `GET /v1/printers` 的 `printer`）。不给时按模板决定：模板指定的打印机 → 纸张分配 |
| `requestId` | 可选，UUID。同一调用方 24 小时内重复提交同一个 `requestId`，直接返回已有的任务，不会再打。网络超时后重试时一定要带上它 |

返回（HTTP 200）：

```json
{
  "name": "printJobs/3f1c0b52-…",
  "template": "templates/builtin-generic",
  "fields": [ … ],
  "content": "CL5640-TK-图片色-XL",
  "copies": 1,
  "printer": null,
  "requestId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "state": "QUEUED",
  "sentCopies": 0,
  "failure": null,
  "createTime": "2026-09-30T08:00:00.000Z",
  "updateTime": "2026-09-30T08:00:00.000Z"
}
```

状态 `state`：`QUEUED`（排队）→ `PRINTING`（正在打）→ `SENT`（全部份数都已发送打印）或 `FAILED`。

- `SENT` 表示已经交给打印机的打印队列，不代表纸一定出来了，和程序界面的「已发送打印」一致。
- 失败时 `failure` 是 `{ "reason": "…", "message": "中文说明" }`，`sentCopies` 是已经发送的份数，后面的份数不再打：

| reason | 意思 |
|---|---|
| `NO_PRINTER` | 这种纸还没有分配打印机 |
| `PRINTER_NOT_FOUND` | 打印机不在这台电脑上 |
| `PRINTER_NOT_READY` | 打印机缺纸、离线或卡纸 |
| `PRINT_TIMEOUT` | 打印超时，可能已经出纸，要到打印机旁确认 |
| `PRINT_ERROR` | 打印机驱动报错 |
| `INTERRUPTED` | 程序在打完之前退出了；重启后不会自动续打，按 `sentCopies` 决定补打多少 |

任务按提交顺序一个接一个打，一个任务的所有份数连续打完再打下一个，所以一批标签出纸的顺序和提交的顺序一致。任务状态保留 7 天；每一张打印记录（包括字段）长期保存在电脑上的打印记录里。

### 打印快递面单

面单模板和标签模板用法一样：订单系统先向快递公司（或第三方面单服务）取好运单号，再把运单号、分拣码、收寄件信息作为字段交给面单模板。电商平台电子面单取的号不能这样打（平台返回加密的打印数据，规定只能用平台自己的打印组件打印）。

内置面单模板：

| 模板名 | 纸张 | 适用 |
|---|---|---|
| `templates/builtin-waybill-platform-130` | 76×130 一联 | 中通、圆通、申通、韵达、极兔 |
| `templates/builtin-waybill-platform-180` | 100×180 二联 | 中通、圆通、申通、韵达、极兔 |
| `templates/builtin-waybill-sf-180` | 100×180 二联 | 顺丰 |
| `templates/builtin-waybill-sf-150` | 100×150 | 顺丰（顺丰自己的面单纸） |
| `templates/builtin-waybill-deppon-180` | 100×180 二联 | 德邦 |

字段名（`GET /v1/templates/{template}` 的 `fieldNames` 列出这个模板用到的全部字段；没给的字段这一格留空，一段里的字段全没给时整段不印）：

| 字段 | 用在 |
|---|---|
| `快递公司`、`产品类型`、`运单号`、`二维码` | 平台标准模板印 `快递公司`（同一套模板给五家用）；顺丰、德邦模板直接印公司名 |
| `三段码`、`集包地`、`集包编码`、`物品`、`备注` | 平台标准 |
| `末端网点`、`虚拟号码`、`订单号` | 平台标准一联（「末」「虚拟号码」只在有值时印） |
| `收件人`、`收件电话`、`收件地址`、`寄件人`、`寄件电话`、`寄件地址` | 全部 |
| `时效`、`目的地代码`、`代收货款`、`付款方式`、`声明价值`、`托寄物` | 顺丰 |
| `城市代码`、`出港码`、`进港码` | 顺丰 100×150 |
| `路由站1`–`路由站4`、`路由码1`–`路由码4`、`末端码` | 德邦 |
| `自定义区` | 全部：商家自定义区，例如商品明细 |

打印时间由程序填，不用传。`运单号` 印成 Code128 条码，只能是字母、数字和常见符号；放不下或有中文时这一张不印条码（预览上有提示）。

```json
{
  "template": "templates/builtin-waybill-platform-180",
  "fields": [
    { "name": "快递公司", "value": "中通快递" },
    { "name": "产品类型", "value": "标准快递" },
    { "name": "运单号", "value": "781234567890123" },
    { "name": "三段码", "value": "531-A03 12" },
    { "name": "集包地", "value": "杭州转运中心" },
    { "name": "收件人", "value": "张三" },
    { "name": "收件电话", "value": "138****0000" },
    { "name": "收件地址", "value": "浙江省杭州市西湖区文三路 478 号" },
    { "name": "寄件人", "value": "CDL 工作室" },
    { "name": "寄件电话", "value": "139****0000" },
    { "name": "寄件地址", "value": "广东省广州市白云区石井街道" }
  ],
  "content": "781234567890123",
  "requestId": "0f8e6b3c-2d4a-4c1e-9b7a-5e6f7a8b9c0d"
}
```

纸张或版式和你手上的面单纸不一样（例如德邦 100×177）时，在配置中心复制内置面单模板，改纸张、行高和格子，再用复制出来的模板名。

### 自由设计模板

吊牌、价签、商品条码这类「设计一次、填数据打印」的标签：在配置中心「模板」页用设计器摆好文字、条码、二维码、表格、图片、线和矩形，接口按版面打印，用法和标签模板一样。

内置示例：`templates/builtin-canvas-tag`（60×40 吊牌：编码、颜色尺码表格、Code128、二维码、货架号和日期）。

- `fieldNames`（`GET /v1/templates/{template}` 返回）列出版面上用到的全部字段：文字框、条码、二维码里的 `{字段名}`，以及表格每一格里的 `{字段名}`，按这个清单传字段即可；没传的字段留空。
- 条码、二维码内容不合码制（位数、校验位、字符集……）或放不下时，这一张不印，这个请求照样成功：接口的返回和打印记录里都看不出来，原因只写在电脑上的日志里（配置中心看不到也一样）。标签上这类字段建议先在设计器里预览一遍，确认在实际数据下能印出来。

### 批量

`POST /v1/printJobs:batchCreate`，请求 `{ "requests": [ {…}, {…} ] }`，最多 1000 个，返回 `{ "printJobs": [ … ] }`，顺序和请求一致。

- 整批先校验：有一个参数不对、模板或打印机找不到，整批都不收，错误里写明是第几个（例如 `requests[12].fields`）。
- 收下之后每个任务各自成功或失败。
- 排队中的标签总数最多 5000 张，超出时整批拒绝（`RESOURCE_EXHAUSTED`，原因 `QUEUE_FULL`），等前面的打完再提交。

### 只排版（PDF）

`POST /v1/templates/{template}:render`，请求 `{ "fields": [ … ], "content": "…" }`，返回 `application/pdf`：一页，页面尺寸是模板的纸张。不打印，也不写打印记录。

### 打印机

```json
{
  "name": "printers/%E9%9D%A2%E5%8D%95%E6%9C%BAB",
  "printer": "面单机B",
  "displayName": "面单机B",
  "papers": [{ "widthMm": 100, "heightMm": 180 }],
  "templates": [],
  "state": "NOT_READY",
  "stateMessage": "缺纸"
}
```

`state` 是 `READY`、`NOT_READY` 或 `UNKNOWN`（macOS 上、或还没查到时）。

### 分页

`GET /v1/printJobs?pageSize=50&pageToken=…`：`pageSize` 默认 50、最大 1000；返回的 `nextPageToken` 原样传回取下一页，空字符串表示没有更多。

## 4. 错误

错误都是 `google.rpc.Status` 格式：

```json
{
  "error": {
    "code": 400,
    "status": "INVALID_ARGUMENT",
    "message": "请求参数不对，见 fieldViolations",
    "details": [
      { "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "INVALID_ARGUMENT", "domain": "labelflash" },
      {
        "@type": "type.googleapis.com/google.rpc.BadRequest",
        "fieldViolations": [{ "field": "requests[3].fields", "description": "1–50 个 { name, value }" }]
      }
    ]
  }
}
```

按 `ErrorInfo.reason` 判断，`message` 是写给人看的中文。

| HTTP | status | 常见 reason |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | `INVALID_ARGUMENT`（见 `fieldViolations`） |
| 400 | `FAILED_PRECONDITION` | `PRINTER_NOT_FOUND` |
| 401 | `UNAUTHENTICATED` | `KEY_REQUIRED`、`KEY_INVALID`、`NO_KEYS_YET`（电脑上还没生成过密钥） |
| 403 | `PERMISSION_DENIED` | `ORIGIN_NOT_AUTHORIZED`（去电脑上点允许）、`ORIGIN_DENIED`（操作员拒绝了，10 分钟后可以再请求）、`ORIGIN_UNSUPPORTED`、`HOST_NOT_ALLOWED` |
| 404 | `NOT_FOUND` | `TEMPLATE_NOT_FOUND`、`PRINT_JOB_NOT_FOUND`（别的调用方的任务也按不存在处理） |
| 413 | `INVALID_ARGUMENT` | `PAYLOAD_TOO_LARGE`（请求体超过 4MB，请分批） |
| 429 | `RESOURCE_EXHAUSTED` | `RATE_LIMITED`、`QUEUE_FULL`、`RENDER_BUSY`（同时生成的 PDF 太多） |
| 500 | `INTERNAL` | `INTERNAL`（详情写在电脑上的日志里） |
| 503 | `UNAVAILABLE` | `PRINTERS_UNAVAILABLE`（读不到这台电脑的打印机列表，稍后重试） |

收到 429 和 503 时等一会儿（例如 1 秒，再失败就加倍）再重试；重试打印任务时带上原来的 `requestId`。

## 5. 限额

- 请求体最大 4MB。
- 同一调用方每秒 20 个请求，可以突发到 40 个。局域网里同一台电脑认证前的请求另有每秒 40 个的上限。
- 一次批量最多 1000 个任务；一张标签最多 50 个字段、100 份；排队中的标签最多 5000 张。
- 同时最多生成 2 个 PDF，另有 8 个排队，再多的收到 `RENDER_BUSY`。
- 查进度时不要逐个任务轮询：一批几百个任务，用 `GET /v1/printJobs` 每秒查一次列表即可。

## 6. 局域网和防火墙

- 局域网访问默认开启，在配置中心「本机接口」页可以关掉，关掉后只接受这台电脑上的网页和程序。
- Windows：安装时会弹一次管理员确认，加一条防火墙入站规则：只放行本程序的 TCP 连接，专用、公用、域网络都生效（Windows 常把新连的 Wi-Fi 当作公用网络）。局域网来的请求照样要程序密钥。
- Windows 防火墙还没放行本程序时（安装时点了「否」，或从没有这条规则的旧版本升级上来），局域网访问先不打开，只接受这台电脑上的网页和程序，免得 Windows 自己弹出防火墙警告。「本机接口」页会提示，点「添加防火墙规则」确认后自动对局域网开放。
- macOS：安装时把程序加进系统防火墙的允许列表（打开了防火墙才起作用）。

## 7. 示例

下面的 `BASE` 换成配置中心显示的地址，`KEY` 换成生成的程序密钥。

### JavaScript（网页，本机浏览器，网站授权）

```js
const BASE = 'http://127.0.0.1:17631';

// crypto.randomUUID 只在 https 或 localhost 的网页里有；内网 http 页面用 getRandomValues 生成。
function newRequestId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function print(fields, content) {
  const response = await fetch(`${BASE}/v1/printJobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      template: 'templates/builtin-generic',
      fields,
      content,
      requestId: newRequestId(),
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    const reason = body.error.details?.[0]?.reason;
    if (reason === 'ORIGIN_NOT_AUTHORIZED') {
      throw new Error('请在打印电脑上的程序里点「允许」，然后重试');
    }
    if (reason === 'ORIGIN_DENIED') {
      throw new Error('打印电脑拒绝了这个网站：请联系操作员');
    }
    throw new Error(body.error.message);
  }
  return body; // 状态为 QUEUED 的任务
}

async function waitSent(name) {
  for (;;) {
    const job = await (await fetch(`${BASE}/v1/${name}`)).json();
    if (job.state === 'SENT' || job.state === 'FAILED') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// 只排版：拿到 PDF
async function renderPdf(fields) {
  const response = await fetch(`${BASE}/v1/templates/builtin-generic:render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  return response.blob();
}
```

浏览器拒绝访问本地网络、或程序没开时，`fetch` 会直接抛出 `TypeError`，要提示用户检查。

### Python（requests，程序密钥）

```python
import time
import uuid

import requests

BASE = "http://192.168.1.20:17631"
HEADERS = {"Authorization": "Bearer lf_…"}

requests.get(f"{BASE}/v1/service", timeout=3).raise_for_status()

batch = {
    "requests": [
        {
            "template": "templates/builtin-generic",
            "fields": [{"name": "编码", "value": f"CL{n:04d}"}, {"name": "尺码", "value": "M"}],
            "requestId": str(uuid.uuid4()),
        }
        for n in range(300)
    ]
}
response = requests.post(f"{BASE}/v1/printJobs:batchCreate", json=batch, headers=HEADERS, timeout=30)
if not response.ok:
    raise RuntimeError(response.json()["error"])
jobs = response.json()["printJobs"]

# 每秒查一次本调用方的任务列表（新的在前），不逐个任务查：同一调用方每秒最多 20 个请求。
pending = {job["name"] for job in jobs}
delay = 1
while pending:
    time.sleep(delay)
    listed = requests.get(f"{BASE}/v1/printJobs", params={"pageSize": 1000}, headers=HEADERS, timeout=10)
    if listed.status_code in (429, 503):
        delay = min(delay * 2, 30)
        continue
    listed.raise_for_status()
    delay = 1
    for job in listed.json()["printJobs"]:
        if job["name"] in pending and job["state"] in ("SENT", "FAILED"):
            pending.discard(job["name"])
            if job["state"] == "FAILED":
                print(job["name"], job["failure"])

pdf = requests.post(
    f"{BASE}/v1/templates/builtin-generic:render",
    json={"fields": [{"name": "编码", "value": "CL0001"}]},
    headers=HEADERS,
    timeout=30,
)
open("label.pdf", "wb").write(pdf.content)
```

### C#（HttpClient，程序密钥）

```csharp
using System.Net.Http.Headers;
using System.Net.Http.Json;

var http = new HttpClient { BaseAddress = new Uri("http://192.168.1.20:17631") };
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "lf_…");

var request = new
{
    template = "templates/builtin-generic",
    fields = new[] { new { name = "编码", value = "CL5640-TK" }, new { name = "尺码", value = "XL" } },
    copies = 2,
    requestId = Guid.NewGuid().ToString(),
};
var response = await http.PostAsJsonAsync("/v1/printJobs", request);
var job = await response.Content.ReadFromJsonAsync<PrintJob>();
if (!response.IsSuccessStatusCode)
{
    throw new Exception(await response.Content.ReadAsStringAsync());
}

while (job!.State is "QUEUED" or "PRINTING")
{
    await Task.Delay(500);
    job = await http.GetFromJsonAsync<PrintJob>($"/v1/{job.Name}");
}
Console.WriteLine($"{job.State} {job.SentCopies} {job.Failure?.Message}");

record PrintJob(string Name, string State, int SentCopies, Failure? Failure);
record Failure(string Reason, string Message);
```

### Java（java.net.http，程序密钥）

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.UUID;

public class PrintLabel {
  static final String BASE = "http://192.168.1.20:17631";
  static final String KEY = "lf_…";

  public static void main(String[] args) throws Exception {
    HttpClient http = HttpClient.newHttpClient();
    String body = """
        {"template":"templates/builtin-generic",
         "fields":[{"name":"编码","value":"CL5640-TK"},{"name":"尺码","value":"XL"}],
         "requestId":"%s"}
        """.formatted(UUID.randomUUID());
    HttpRequest create = HttpRequest.newBuilder(URI.create(BASE + "/v1/printJobs"))
        .header("Authorization", "Bearer " + KEY)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(body))
        .build();
    HttpResponse<String> created = http.send(create, HttpResponse.BodyHandlers.ofString());
    System.out.println(created.statusCode() + " " + created.body()); // 用 JSON 库读出 name 后轮询 GET /v1/{name}

    HttpRequest render = HttpRequest.newBuilder(URI.create(BASE + "/v1/templates/builtin-generic:render"))
        .header("Authorization", "Bearer " + KEY)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("{\"fields\":[{\"name\":\"编码\",\"value\":\"CL5640-TK\"}]}"))
        .build();
    http.send(render, HttpResponse.BodyHandlers.ofFile(Path.of("label.pdf")));
  }
}
```

## 8. 打印结果通知（Webhook）

接口是你来问；打印结果通知是程序推给你：在配置中心「打印结果通知」页填一个地址（最多 5 个），每打一张就把结果以 JSON `POST` 过去，带 HMAC-SHA256 签名（设了签名密钥时）。通知先存进本机队列、后台发送，失败按 1 分钟、5 分钟、30 分钟、2 小时、12 小时重试，24 小时内仍不成功就放弃。

- **事件**：已打印、打印失败、重复被拦截、无法识别，每个地址自己勾选（默认前两种）。
- **来源**：每个地址自己勾选要哪些来源的打印结果：扫码（扫码枪、按内容重打）、手机扫码、本机接口、局域网共享、批量打印、打印 PDF。默认是前四种，**不含批量打印和打印 PDF**：一批几千上万张，每张一条通知，5 个地址就是几万条排队。要逐张记录时在地址上勾上。从打印记录重打的那一张算它原来的来源（重打批量打的那一张还是「批量打印」）。2.0.0 之前保存的地址按默认处理。
- 请求体里的 `source` 是打印记录的来源：`desktop`、`history`、`mobile`、`api`、`batch`、`pdf`、`ipp`。
- **队列上限**：等待发送的通知最多 10000 条（所有地址合计），等了 7 天以上的也放弃；放弃的在发送记录里写「排队太久或太多，已放弃」。

## 9. 隐私

本机接口提交的每一张都完整保存字段（面单上可能有收件人的姓名、电话、地址），只存在这台电脑上：

- 打印记录里的，超过「打印记录保留」的条数时和其他记录一起删除；
- 给调用方查进度的任务记录保留 7 天，之后自动删除。
