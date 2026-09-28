# 手机扫码中转服务

「手机扫码」功能的云端部分：手机网页扫码，经这个中转服务送到店里的电脑，由电脑打印。设计见 `docs/superpowers/specs/2026-09-29-mobile-scan-relay-design.md`。

官方安装包默认连接 yterm.cn 上的中转服务。任何人都可以自己部署一个，再在电脑的设置里填自己的地址。

## 它做什么

- **提供扫码页**（`/m/`）：手机浏览器打开后实时取景，扫到就打；几部手机可以同时用，打印排队。
- **按会话转发消息**（`/ws/desktop`、`/ws/phone`）：
  - 只看得到外层信封；手机和电脑之间的内容是端到端加密的，中转服务看不到扫码内容。
  - 不写磁盘，也没有数据库。重启后电脑和手机自动重连，会话照常继续。
- **健康检查**（`/healthz`）：返回版本、会话数和连接数。

## 目录

| 路径 | 内容 |
|---|---|
| `src/` | 服务端：`hub.ts`（会话路由、限流、容量）、`server.ts`（`Bun.serve` 接线）、`static-files.ts`（扫码页和安全响应头）、`config.ts` |
| `web/` | 扫码页：`index.html`、`styles.css`、`src/`（状态机、控制器、协议、发件箱存储、摄像头、解码、界面） |
| `test/` | 假摄像头的浏览器测试 |
| `deploy/nginx-location.conf` | nginx 反向代理示例 |
| `Dockerfile` | 镜像（只放构建产物） |

协议、加密和重连代码在 `src/shared/`（`mobile-protocol.ts`、`mobile-crypto.ts`、`relay-socket.ts`），电脑端在 `src/main/mobile/`。

## 本机运行

```bash
bun run relay:dev                                          # 构建并在 http://localhost:3180 启动
bun scripts/relay/demo-desktop.ts http://localhost:3180/   # 命令行版电脑端：显示二维码，不真的打印
bun run test:relay-browser                                 # 用 Edge 的假摄像头跑一遍扫码
```

- **打开页面**：在电脑上用 `http://localhost:3180/m/…` 打开扫码页（浏览器把 localhost 当作安全上下文，摄像头可用），点「开始扫码」打开摄像头。
- **地址要一致**：手机页面的 Origin 必须和中转服务的 `PUBLIC_ORIGIN` 一致，所以要用 `localhost`，不能用 `127.0.0.1`。
- **真机测试**：手机不能访问电脑的 localhost。要用真手机试，先部署到有 https 的服务器。

## 部署

需要一台有域名、有 https 证书、装了 Docker 的服务器。

1. **反向代理**：在站点里加一个路径前缀，转发到 `127.0.0.1:3180`。nginx 的写法见 `deploy/nginx-location.conf`，只需加一次。
2. **发布**：设置三个环境变量后运行 `bun run relay:deploy`：

   | 变量 | 例子 | 说明 |
   |---|---|---|
   | `RELAY_DEPLOY_SSH` | `my-server` | ssh 主机名（`~/.ssh/config` 里的别名） |
   | `RELAY_PUBLIC_ORIGIN` | `https://relay.example.com` | 扫码页对外的 origin，传给容器的 `PUBLIC_ORIGIN` |
   | `RELAY_HEALTH_URL` | `https://relay.example.com/labelflash/healthz` | 对外的健康检查地址 |

   脚本依次做这几件事：
   - 先检查：工作区有没提交的改动、或者服务器上已经在运行这个版本时，不发布（提交新改动后再发）；
   - 本机构建，上传到服务器的 `~/labelflash-relay/<版本>/`；
   - `docker build`，替换容器 `labelflash-relay`；
   - 在服务器本机和对外各检查一次健康，没通过就换回上一个版本；
   - 只保留最近两个版本的目录和镜像，更早的会被删除。
3. **电脑端**：在电脑的设置里填中转地址 `https://relay.example.com/labelflash/`。

**容器的运行方式**：
- 以非 root 用户运行，文件系统只读；
- 端口只映射到宿主机的 127.0.0.1；
- 内存上限 128 MB；
- 日志 5 MB × 2 份轮转；
- `--restart unless-stopped`。

**服务端的环境变量**：
- `PUBLIC_ORIGIN`：必填，没有默认值；
- `PORT`：默认 3180；
- `HOST`：默认 `0.0.0.0`，指容器内。
