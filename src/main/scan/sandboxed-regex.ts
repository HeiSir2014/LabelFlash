import { createContext, Script } from 'node:vm';
import type { RegexRunner } from '../../core/scan/recognize';

/** 单条正则最多执行这么久：足够正常的规则跑完，灾难性回溯的正则会被打断。 */
export const REGEX_TIMEOUT_MS = 20;

/**
 * 在独立的 vm 上下文里执行，编译结果按「正则 + 标志」缓存在上下文里。
 * 结果序列化成 JSON 再传回，避免把上下文里的对象带出来。
 */
const EXEC_SCRIPT = new Script(`(() => {
  const key = flags + '/' + pattern;
  let compiled = cache.get(key);
  if (!compiled) {
    compiled = new RegExp(pattern, flags);
    cache.set(key, compiled);
  }
  compiled.lastIndex = 0;
  const match = compiled.exec(input);
  if (!match || !match.groups) {
    return null;
  }
  const groups = {};
  for (const [name, value] of Object.entries(match.groups)) {
    if (value !== undefined) {
      groups[name] = value;
    }
  }
  return JSON.stringify(groups);
})()`);

/**
 * 识别规则可能来自别人分享的文件：写得不好的正则会在某些输入上灾难性回溯，把主进程卡死。
 * vm 的超时能打断正在执行的正则（已在 Electron 44 和 Bun 上实测），超时就当作不匹配。
 */
export function createSandboxedRegexRunner(
  timeoutMs: number = REGEX_TIMEOUT_MS,
  warn: (message: string) => void = (message) => console.warn(message),
): RegexRunner {
  const context = createContext({ cache: new Map<string, RegExp>(), pattern: '', flags: '', input: '' });
  return (pattern, flags, input) => {
    context['pattern'] = pattern;
    context['flags'] = flags;
    context['input'] = input;
    try {
      const json = EXEC_SCRIPT.runInContext(context, { timeout: timeoutMs }) as string | null;
      return json === null ? null : (JSON.parse(json) as Record<string, string>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        warn(`[scan] regex /${pattern}/${flags} timed out after ${timeoutMs}ms; treated as no match`);
        return null;
      }
      throw error;
    }
  };
}
