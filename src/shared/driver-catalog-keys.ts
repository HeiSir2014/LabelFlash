/**
 * 驱动清单的签名公钥（Ed25519，32 字节原始公钥的 base64），键是密钥编号。
 * - 私钥只在出品方手里（离线保存，不进仓库）；生成、签名、换密钥见 docs/driver-catalog.md。
 * - 换密钥：先把新公钥加进来、发一版程序，等大家都更新了再用新私钥签清单，最后删掉旧公钥。
 * - 自己构建、用自己的清单：换成自己的公钥。
 * 空表时任何清单都核对不过，「驱动」一节显示清单的密钥这个版本不认识。
 */
export const DRIVER_CATALOG_PUBLIC_KEYS: Readonly<Record<string, string>> = {};
