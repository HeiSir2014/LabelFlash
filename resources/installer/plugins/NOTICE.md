# nsNiuniuSkin.dll

安装界面用的 NSIS 界面插件（DirectUI）。闭源，只提供 DLL。

| 项 | 内容 |
|---|---|
| 来源 | 作者的官方仓库 https://github.com/leeqia/nsNiuniuSkin ，提交 `c5048daa0d0633f73fea8163406bb8db22728a5c`（2023-12-10），路径 `NSIS/Plugins/nsNiuniuSkin.dll` |
| 版本 | 1.0.0.2902（Unicode，x86） |
| SHA-256 | `acf0a9f02f82e3f684cf90cd1fa3f587124cc2d1cf1d01f10017ceefe4892c76` |
| 许可 | 官方仓库没有许可文件。作者在官方介绍页（http://ggniu.cn/articles/nsniuniuskin.html ）写明：「它也是一个完全免费的安装包UI控件，无任何的使用限制。」没有署名或水印要求。 |

注意：

- DLL 用 UPX 压缩过，杀毒软件可能误报。发布前把安装包送检，结果记进 `docs/windows-acceptance.md`。
- 这个版本不会按系统缩放放大界面，所以皮肤按 100%–300% 各生成一份，安装程序按系统 DPI 挑选（见 `scripts/installer/`）。
- 构建时校验 SHA-256（`scripts/installer/plugin.ts`），不在构建过程中下载。换版本时同时更新本文件和那里的哈希。
