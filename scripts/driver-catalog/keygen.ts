/**
 * 生成驱动清单的签名密钥：私钥写到指定文件（不覆盖已有文件），打印公钥和下一步。
 * 用法：bun run driver-catalog:keygen --out <私钥文件> --key-id <编号，例如 2026a>
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { KEY_ID_PATTERN, rawPublicKey } from '../../src/main/drivers/catalog-signature';

/** 只有自己能读写（Windows 上不生效，靠放在离线的加密盘里）。 */
const PRIVATE_KEY_FILE_MODE = 0o600;

const { values } = parseArgs({ options: { out: { type: 'string' }, 'key-id': { type: 'string' } } });
const out = values.out;
const keyId = values['key-id'];
if (out === undefined || keyId === undefined || !KEY_ID_PATTERN.test(keyId)) {
  console.error(
    '用法：bun run driver-catalog:keygen --out <私钥文件> --key-id <编号：小写字母、数字、横杠，例如 2026a>',
  );
  process.exit(1);
}
const { privateKey } = generateKeyPairSync('ed25519');
// wx：文件已存在就失败，不会覆盖已有的私钥。
await writeFile(out, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: PRIVATE_KEY_FILE_MODE });
console.log(`私钥已写到 ${out}：离线保存（例如加密的 U 盘），不要提交、不要上传、不要发给别人。`);
console.log(`密钥编号：${keyId}`);
console.log(`公钥：${rawPublicKey(privateKey)}`);
console.log(
  `下一步：把 '${keyId}': '${rawPublicKey(privateKey)}' 加进 src/shared/driver-catalog-keys.ts，提交并发布程序。`,
);
