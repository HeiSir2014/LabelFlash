/**
 * 手机上按会话保存的东西：
 * - 令牌：刷新页面、断线重连后，电脑凭它认出还是这部手机；
 * - 发件箱：还没拿到结果的任务。页面被刷新、被系统回收后重新打开，这些任务按原来的任务号接着发，不丢也不多打。
 *
 * 存在 localStorage，每个会话一条记录；打开时顺手清掉早已结束的会话留下的记录。
 * 无痕模式或禁用存储时 localStorage 可能抛错，这时退回内存：本页有效，刷新后需要在电脑上重新开始。
 */
import {
  isRandomId,
  isRequestRaw,
  MAX_PENDING_JOBS,
  type PhoneField,
  type PhoneImage,
  parseManualFields,
  parsePhoneImage,
} from '../../../src/shared/mobile-protocol';

export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 发件箱里的一个任务：任务号就是幂等键，重发时原样带上（连同标签图和手动输入的字段）。 */
export interface StoredJob {
  id: string;
  raw: string;
  force: boolean;
  image?: PhoneImage;
  fields?: PhoneField[];
}

export interface SessionStore {
  readonly token: string | null;
  readonly jobs: readonly StoredJob[];
  saveToken(token: string): void;
  saveJobs(jobs: readonly StoredJob[]): void;
}

interface SessionRecord {
  token: string | null;
  jobs: StoredJob[];
  savedAt: number;
}

const KEY_PREFIX = 'labelflash.session.';
/** 记录保留多久：会话空闲 30 分钟就会结束，一天前的记录不会再用到。 */
export const RECORD_TTL_MS = 24 * 60 * 60_000;

export function openSessionStore(storage: KeyValueStorage | null, session: string, now: () => number): SessionStore {
  const key = KEY_PREFIX + session;
  removeExpired(storage, key, now());
  let record: SessionRecord = readRecord(storage, key) ?? { token: null, jobs: [], savedAt: now() };
  const save = (changes: Partial<SessionRecord>): void => {
    record = { ...record, ...changes, savedAt: now() };
    try {
      storage?.setItem(key, JSON.stringify(record));
    } catch (error) {
      // 存不进去（无痕模式、空间满）也能用：内存里有，本页继续有效。
      console.warn('[session-store] cannot save', error);
    }
  };
  return {
    get token() {
      return record.token;
    },
    get jobs() {
      return record.jobs;
    },
    saveToken(token) {
      save({ token });
    },
    saveJobs(jobs) {
      save({ jobs: [...jobs] });
    },
  };
}

function readRecord(storage: KeyValueStorage | null, key: string): SessionRecord | null {
  let text: string | null;
  try {
    text = storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (text === null) {
    return null;
  }
  try {
    return parseRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 存储里的内容也不可信（别的页面、旧版本写的）：逐字段检查，不合格的整条丢掉。 */
function parseRecord(value: unknown): SessionRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { token, jobs, savedAt } = value as Record<string, unknown>;
  if ((token !== null && !isRandomId(token)) || !Array.isArray(jobs) || typeof savedAt !== 'number') {
    return null;
  }
  const parsed = jobs.slice(0, MAX_PENDING_JOBS).map(parseJob);
  if (parsed.some((job) => job === null)) {
    return null;
  }
  return { token, jobs: parsed as StoredJob[], savedAt };
}

function parseJob(value: unknown): StoredJob | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const { id, raw, force } = record;
  if (!isRandomId(id) || !isRequestRaw(raw) || typeof force !== 'boolean') {
    return null;
  }
  // 图和字段按协议同样的规则检查：存储被改坏了就当这个任务没有，不发出去让电脑拒收。
  const image = record['image'] === undefined ? undefined : parsePhoneImage(record['image']);
  const fields = record['fields'] === undefined ? undefined : parseManualFields(record['fields']);
  if (image === null || fields === null) {
    return null;
  }
  return { id, raw, force, ...(image === undefined ? {} : { image }), ...(fields === undefined ? {} : { fields }) };
}

/** 删掉别的会话留下的过期记录。存储不可用时什么都不做。 */
function removeExpired(storage: KeyValueStorage | null, currentKey: string, now: number): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < (storage?.length ?? 0); index += 1) {
      const key = storage?.key(index);
      if (key?.startsWith(KEY_PREFIX) && key !== currentKey) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      const record = readRecord(storage, key);
      if (record === null || now - record.savedAt >= RECORD_TTL_MS) {
        storage?.removeItem(key);
      }
    }
  } catch (error) {
    console.warn('[session-store] cannot clean up old sessions', error);
  }
}
