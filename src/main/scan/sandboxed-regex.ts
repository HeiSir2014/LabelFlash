import { createContext, Script } from 'node:vm';
import type { RegexReplacer } from '../../core/scan/enrich-model';
import type { RegexRunner } from '../../core/scan/recognize';

/** 单条正则最多执行这么久：足够正常的规则跑完，灾难性回溯的正则会被打断。 */
export const REGEX_TIMEOUT_MS = 20;

/** 编译结果按「正则 + 标志」缓存在上下文里。 */
const COMPILE = `
  const key = flags + '/' + pattern;
  let compiled = cache.get(key);
  if (!compiled) {
    compiled = new RegExp(pattern, flags);
    cache.set(key, compiled);
  }
  compiled.lastIndex = 0;`;

/** 返回参与了匹配的命名分组；结果序列化成 JSON 再传回，避免把上下文里的对象带出来。 */
const EXEC_SCRIPT = new Script(`(() => {${COMPILE}
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

const REPLACE_SCRIPT = new Script(`(() => {${COMPILE}
  return String(input.replace(compiled, replacement));
})()`);

type Warn = (message: string) => void;

/**
 * 识别规则和加工步骤可能来自别人分享的文件：写得不好的正则会在某些输入上灾难性回溯，把主进程卡死。
 * vm 的超时能打断正在执行的正则（已在 Electron 44 和 Bun 上实测），超时返回 null。
 */
function createSandbox(timeoutMs: number, warn: Warn) {
  const context = createContext({
    cache: new Map<string, RegExp>(),
    pattern: '',
    flags: '',
    input: '',
    replacement: '',
  });
  return (script: Script, values: Record<string, string>): unknown => {
    Object.assign(context, values);
    try {
      return script.runInContext(context, { timeout: timeoutMs });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        warn(`[scan] regex /${values['pattern']}/${values['flags']} timed out after ${timeoutMs}ms`);
        return null;
      }
      throw error;
    }
  };
}

/** 识别用：超时当作不匹配。 */
export function createSandboxedRegexRunner(
  timeoutMs: number = REGEX_TIMEOUT_MS,
  warn: Warn = (message) => console.warn(message),
): RegexRunner {
  const run = createSandbox(timeoutMs, warn);
  return (pattern, flags, input) => {
    const json = run(EXEC_SCRIPT, { pattern, flags, input }) as string | null;
    return json === null ? null : (JSON.parse(json) as Record<string, string>);
  };
}

/** 加工步骤「正则替换」用：返回替换后的文本，超时返回 null。 */
export function createSandboxedRegexReplacer(
  timeoutMs: number = REGEX_TIMEOUT_MS,
  warn: Warn = (message) => console.warn(message),
): RegexReplacer {
  const run = createSandbox(timeoutMs, warn);
  return (pattern, flags, input, replacement) =>
    run(REPLACE_SCRIPT, { pattern, flags, input, replacement }) as string | null;
}
