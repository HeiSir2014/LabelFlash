// 构建第一段（electron-builder 自带脚本）的签名钩子。项目没有代码签名证书，这里不签名，
// 只把 electron-builder 生成的卸载程序复制出来，供第二段的自绘安装脚本打包。
// 其他文件（程序本身等）原样放过。
const { copyFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

const UNINSTALLER_SUFFIX = '__uninstaller.exe';

module.exports = async function captureUninstaller(configuration) {
  const target = process.env.LABELFLASH_UNINSTALLER_OUT;
  if (!target || !configuration.path.toLowerCase().endsWith(UNINSTALLER_SUFFIX)) {
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(configuration.path, target);
};
