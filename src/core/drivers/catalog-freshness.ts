import type { DriverCatalog } from './catalog-model';

export type CatalogFreshness = { ok: true } | { ok: false; reason: 'expired' | 'rolled-back'; issue: string };

/** ISO 时间的前 10 个字符是日期（YYYY-MM-DD）。 */
const ISO_DATE_LENGTH = 10;

/**
 * 这份清单能不能用：
 * - 版本比这台电脑用过的最高版本低：不用（防止有人拿旧清单换掉新清单，旧清单里可能有已经撤下的驱动）；
 * - 过了有效期：不用（同一个理由，签过的旧清单不能无限期被重放）。同一版本可以反复用（缓存、重新下载）。
 */
export function checkCatalogFreshness(
  catalog: DriverCatalog,
  highestSeenVersion: number | null,
  now: number,
): CatalogFreshness {
  if (highestSeenVersion !== null && catalog.version < highestSeenVersion) {
    return {
      ok: false,
      reason: 'rolled-back',
      issue: '下载到的驱动清单比这台电脑上次用的旧，可能被换过，不使用：稍后再试，一直这样请联系出品方',
    };
  }
  if (now >= catalog.expiresAt) {
    return {
      ok: false,
      reason: 'expired',
      issue: `驱动清单已在 ${utcDate(catalog.expiresAt)} 过期（电脑时间是 ${utcDate(now)}）：电脑时间不对的话先校准时间，否则请等出品方更新清单`,
    };
  }
  return { ok: true };
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, ISO_DATE_LENGTH);
}
