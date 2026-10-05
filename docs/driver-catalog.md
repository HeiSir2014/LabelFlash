# 驱动清单：生成密钥、写清单、签名、上传

「打印机」页的「驱动」一节按 USB 厂商号 / 产品号在**驱动清单**里找到型号，下载厂家官方安装包，核对大小、SHA-256 和数字签名者后静默安装。清单里有品牌和厂家网址，所以**不进仓库**，放在网上；程序只认带出品方签名的清单。

## 怎么保证安全

- 清单用 Ed25519 签名，公钥内置在程序里（`src/shared/driver-catalog-keys.ts`），私钥只在出品方手里、离线保存。清单被改过、被换成别人签的，程序都不用。
- 清单有版本号（签名时刻）和有效期（默认 180 天）。程序记住用过的最高版本，更旧的清单和过期的清单都不用——撤下的驱动不会被旧清单「复活」。
- 安装包只从清单写的 https 地址下载；大小、SHA-256 必须和清单一致，Windows 上 Authenticode 签名必须有效且签名者与清单逐字相同，macOS 上 pkg 必须是 Apple 签发的开发者证书签的、签名者逐字相同。任何一项不对就不装。
- 真正运行的是复制到管理员专属目录、再核对一次 SHA-256 的那份文件。

## 第一次：生成密钥并内置公钥

1. 在一台可信的电脑上：

   ```
   bun run driver-catalog:keygen --out <私钥文件，例如 E:\keys\labelflash-catalog-2026a.pem> --key-id 2026a
   ```

   私钥放在加密的 U 盘或密码管理器里，不提交、不上传、不发给别人。命令会打印公钥。
2. 把打印出的 `'2026a': '<公钥>'` 加进 `src/shared/driver-catalog-keys.ts`，经 PR 合进 master。**发布的程序里有这把公钥之后**，它签的清单才会被接受（发布作业也会检查这里不为空）。

## 写清单

清单源文件（例如 `driver-catalog.source.json`，文件名以 `driver-catalog` 开头的 JSON 已被 `.gitignore` 忽略，**不要放进仓库**）只写 `models`，其余由签名脚本填：

```json
{
  "models": [
    {
      "id": "example-x1",
      "brand": "示例品牌",
      "model": "示例型号 X1",
      "usb": [{ "vendorId": "1234", "productId": "ABCD" }],
      "driverNames": ["示例品牌 X1"],
      "commandSet": "tspl",
      "windows": {
        "url": "https://example.invalid/drivers/x1-setup.exe",
        "sizeBytes": 12900000,
        "sha256": "<64 位十六进制>",
        "kind": "exe",
        "silentArgs": ["/S"],
        "signer": "CN=示例品牌有限公司, O=示例品牌有限公司, L=…, C=CN"
      },
      "macos": { "downloadPage": "https://example.invalid/drivers/x1-mac" }
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 型号编号：小写字母、数字、横杠，清单里唯一 |
| `brand`、`model` | 界面上显示的品牌和型号（品牌 ≤ 40 字、型号 ≤ 80 字） |
| `usb` | 1–16 个 `{vendorId, productId}`，各 4 位十六进制。Windows「设备管理器」→ 设备 → 属性 → 详细信息 → 硬件 ID 里的 `VID_xxxx&PID_xxxx` |
| `driverNames` | 装好后系统里的驱动名（Windows「打印机属性 → 高级 → 驱动程序」；macOS 的打印机型号名），最多 8 个。指令集「自动」和诊断的「重新安装驱动」靠它认型号 |
| `commandSet` | `tspl`、`zpl`、`epl` 或不写 |
| `windows.url` | 官方安装包的 https 地址（厂家官网或你自己镜像的副本） |
| `windows.sizeBytes`、`sha256`、`signer` | 用 `bun run driver-catalog:describe <安装包>` 在 Windows 上读出来，原样复制 |
| `windows.kind` | `exe` 或 `msi` |
| `windows.silentArgs` | 静默安装参数，最多 8 个，每个只能有字母、数字和 `_ . / : = + -`（不能带空格、引号和路径）。常见写法：NSIS `/S`；Inno Setup `/VERYSILENT` `/SUPPRESSMSGBOXES` `/NORESTART`；InstallShield `/s`；msi 不用写 `/qn`（程序会加），可以写属性如 `ALLUSERS=1`。**先在一台电脑上手工跑一次确认真的不弹窗** |
| `windows.successExitCodes` | 可选：哪些退出码算成功（默认只有 0；3010、1641 总是按「装好了、要重启」处理） |
| `macos.pkg` | 可选：`{url, sizeBytes, sha256, signer}`，`signer` 是 `pkgutil --check-signature` 证书链第一行（`Developer ID Installer: …`），在 Mac 上用 `describe` 读 |
| `macos.downloadPage` | 没有 pkg 时打开的官方下载页（https） |

## 签名

```
bun run driver-catalog:sign --in driver-catalog.source.json --out driver-catalog.json --key-id 2026a --key <私钥文件>
```

- 也可以用环境变量 `LABELFLASH_DRIVER_CATALOG_KEY_FILE` 指定私钥文件。
- 有效期默认 180 天，`--valid-days` 可改（最长 400）。
- 任何一个型号不合格都不会签，并列出原因；私钥对应的公钥不在程序里也不会签。

## 上传

清单和中转服务放在同一台服务器上，由 nginx 直接提供静态文件（不经过中转服务）：

```nginx
# 放在中转服务那个 server 里；路径按自己的服务器改。
location = /labelflash/driver-catalog.json {
    alias /srv/labelflash/driver-catalog.json;
    default_type application/json;
    add_header Cache-Control "no-cache";
}
```

- nginx 跑在容器里时，把放清单的目录挂进容器（只读）。
- 上传时先传成临时文件再改名，避免程序下载到写了一半的文件：

  ```
  scp driver-catalog.json <服务器>:/srv/labelflash/driver-catalog.json.tmp
  ssh <服务器> mv /srv/labelflash/driver-catalog.json.tmp /srv/labelflash/driver-catalog.json
  ```
- 用浏览器打开清单地址，能看到 `{"format":1,"keyId":…}` 就对了。

## 让官方安装包带上清单地址

在 GitHub 仓库的 Settings → Secrets and variables → Actions → Variables 里加 `LABELFLASH_DEFAULT_DRIVER_CATALOG_URL`，值是上面的完整地址。CI 构建安装包时注入（代码里不写域名）；没设这个变量发布作业会失败。自己构建时可以用环境变量 `CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL` 指定；都没有时界面显示「未配置驱动清单地址」，用户可以在「驱动清单地址」里自己填。

## 续签、更新、换密钥

- **续签**：到期前（建议每 3–4 个月）重新签一次、上传。过期后程序不再用它，「驱动」一节显示过期日期。
- **加型号、改安装包**：改源文件、重新签名、上传。版本号自动变大，用户下次检测时拿到新清单。
- **换密钥**：生成新密钥 → 新公钥加进 `driver-catalog-keys.ts`（旧的保留）→ 发布程序 → 大家更新后用新私钥签清单 → 再发一版删掉旧公钥。
- **私钥泄露**：立即按「换密钥」做，并在新版程序里删掉旧公钥；旧版程序在更新之前仍信任旧公钥，所以同时尽快让用户更新。泄露期间别人签的清单仍要过「https 下载 + 厂家签名者核对」这一关。
