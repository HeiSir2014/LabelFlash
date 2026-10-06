/**
 * 读安装包的信息，填清单用：大小、SHA-256、签名者（Windows 读 Authenticode，macOS 读 pkg 的签名）。
 * 用法：bun run driver-catalog:describe <安装包文件>
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { checkMacSignature } from '../../src/main/drivers/mac-install';
import { checkWindowsSignature } from '../../src/main/drivers/windows-signature';

const path = process.argv[2];
if (path === undefined) {
  console.error('用法：bun run driver-catalog:describe <安装包文件>');
  process.exit(1);
}
const bytes = await readFile(path);
const signature =
  process.platform === 'win32'
    ? await checkWindowsSignature(path)
    : process.platform === 'darwin'
      ? await checkMacSignature(path)
      : null;
console.log(
  JSON.stringify(
    {
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      signer: signature?.status === 'valid' ? signature.signer : null,
    },
    null,
    2,
  ),
);
if (signature === null) {
  console.error('这个系统读不了签名：Windows 安装包在 Windows 上读，pkg 在 Mac 上读。');
} else if (signature.status !== 'valid') {
  console.error(`签名无效（${signature.detail}）：程序不会安装它。`);
  process.exit(1);
}
