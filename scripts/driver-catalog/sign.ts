/**
 * 签驱动清单。
 * 用法：bun run driver-catalog:sign --in <清单源文件> --out <签好的清单> --key-id <编号> [--key <私钥文件>] [--valid-days 180]
 * 私钥文件也可以用环境变量 LABELFLASH_DRIVER_CATALOG_KEY_FILE 指定。源文件只写 models，见 docs/driver-catalog.md。
 */
import { createPrivateKey } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { rawPublicKey } from '../../src/main/drivers/catalog-signature';
import { DRIVER_CATALOG_PUBLIC_KEYS } from '../../src/shared/driver-catalog-keys';
import { DEFAULT_VALID_DAYS, signCatalog } from './catalog-signing';

const KEY_FILE_ENV = 'LABELFLASH_DRIVER_CATALOG_KEY_FILE';

const { values } = parseArgs({
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
    'key-id': { type: 'string' },
    key: { type: 'string' },
    'valid-days': { type: 'string' },
  },
});
const keyPath = values.key ?? process.env[KEY_FILE_ENV];
const keyId = values['key-id'];
if (values.in === undefined || values.out === undefined || keyId === undefined || keyPath === undefined) {
  console.error(
    `用法：bun run driver-catalog:sign --in <清单源文件> --out <签好的清单> --key-id <编号> [--key <私钥文件>]（或设 ${KEY_FILE_ENV}）[--valid-days ${DEFAULT_VALID_DAYS}]`,
  );
  process.exit(1);
}
const privateKey = createPrivateKey(await readFile(keyPath, 'utf8'));
// 程序只认内置的公钥：签之前先核对，免得签出一份所有用户都用不了的清单。
if (DRIVER_CATALOG_PUBLIC_KEYS[keyId] !== rawPublicKey(privateKey)) {
  console.error(
    `这把私钥的公钥不在 src/shared/driver-catalog-keys.ts 的「${keyId}」下：程序会拒绝它签的清单。先把公钥加进去并发布程序。`,
  );
  process.exit(1);
}
const validDays = values['valid-days'] === undefined ? DEFAULT_VALID_DAYS : Number(values['valid-days']);
const source: unknown = JSON.parse(await readFile(values.in, 'utf8'));
const result = signCatalog(source, { keyId, privateKey, now: Date.now(), validDays });
if (!result.ok) {
  console.error('清单有问题，没有签：');
  for (const issue of result.issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}
await writeFile(values.out, `${JSON.stringify(result.envelope, null, 2)}\n`);
console.log(`已签好：${result.modelCount} 个型号，版本 ${result.version}，有效期到 ${result.expiresAt}。`);
console.log('上传到清单地址即可（见 docs/driver-catalog.md）；到期前记得重新签一次。');
