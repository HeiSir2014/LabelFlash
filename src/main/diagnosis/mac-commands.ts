import { CUPS_MEDIA_KEYWORD_PATTERN } from '../../core/diagnosis/paper-choice';
import { BRAND } from '../../shared/brand';

/** macOS 自带的命令，一律绝对路径：不按名字在搜索路径里找。 */
export const MAC_TOOLS = {
  lpstat: '/usr/bin/lpstat',
  ipptool: '/usr/bin/ipptool',
  cancel: '/usr/bin/cancel',
  cupsenable: '/usr/sbin/cupsenable',
  cupsaccept: '/usr/sbin/cupsaccept',
  lpadmin: '/usr/sbin/lpadmin',
  systemProfiler: '/usr/sbin/system_profiler',
  osascript: '/usr/bin/osascript',
  launchctl: '/bin/launchctl',
} as const;

/** CUPS 命令的输出按英文解析：中文系统下 lpstat 会说中文。 */
export const MAC_COMMAND_ENV: Readonly<Record<string, string>> = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

/** CUPS 因为权限拒绝时的说法（lpadmin、cupsenable 都是「程序名: Forbidden」这样）。 */
export const CUPS_FORBIDDEN_PATTERN = /forbidden|not authori[sz]ed|unauthori[sz]ed/i;
/** osascript 里操作员点了「取消」：AppleScript 的错误 -128。 */
export const USER_CANCELED_PATTERN = /\(-128\)/;
/** CUPS 队列名的长度上限（CUPS 自己限制 127 个字符）。 */
const MAX_QUEUE_NAME_LENGTH = 127;

/** 打印机名来自系统列表，这里再挡一次会被命令当成选项（-a）、或带控制字符的名字。 */
export function assertQueueName(name: string): void {
  if (
    name === '' ||
    name.length > MAX_QUEUE_NAME_LENGTH ||
    name.startsWith('-') ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来挡住控制字符
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new Error(`Invalid CUPS queue name: ${JSON.stringify(name)}`);
  }
}

/** /bin/sh 的单引号字面量：里面只有单引号要处理（结束、转义、再开始）。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** 给 do shell script 的命令：可执行文件（绝对路径）和每个参数都单引号转义，不留任何 shell 能展开的东西。 */
export function shellCommand(file: string, args: readonly string[]): string {
  return [file, ...args].map(shellQuote).join(' ');
}

const ADMIN_APPLESCRIPT = [
  'on run argv',
  'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges',
  'end run',
];

/** osascript 的参数：AppleScript 是固定的三行，命令和提示经 argv 传入。 */
export function adminOsascriptArgs(command: string, prompt: string): string[] {
  return [...ADMIN_APPLESCRIPT.flatMap((line) => ['-e', line]), command, prompt];
}

/** 管理员密码框上的话：说清是哪个程序、要做什么。 */
export function adminPrompt(action: string): string {
  return `${BRAND.productName} 要${action}。`;
}

/** 恢复一台被暂停或拒收的打印机：启用 + 接收任务。 */
export function enablePrinterCommand(queue: string): string {
  assertQueueName(queue);
  return `${shellCommand(MAC_TOOLS.cupsenable, [queue])} && ${shellCommand(MAC_TOOLS.cupsaccept, [queue])}`;
}

export function cancelAllJobsCommand(queue: string): string {
  assertQueueName(queue);
  return shellCommand(MAC_TOOLS.cancel, ['-a', queue]);
}

/** cupsd 由 launchd 管：kickstart -k 先停再起。 */
export function restartCupsCommand(): string {
  return shellCommand(MAC_TOOLS.launchctl, ['kickstart', '-k', 'system/org.cups.cupsd']);
}

/** lpadmin 设默认纸张的参数（job template 属性 media-default）。 */
export function setMediaArgs(queue: string, keyword: string): string[] {
  assertQueueName(queue);
  if (!CUPS_MEDIA_KEYWORD_PATTERN.test(keyword)) {
    throw new Error(`Invalid CUPS media keyword: ${keyword}`);
  }
  return ['-p', queue, '-o', `media-default=${keyword}`];
}

/** 临时测试文件名。 */
export const JOBS_TEST_FILE_NAME = 'labelflash-get-jobs.test';

/**
 * ipptool 的 Get-Jobs 测试：只要没完成的任务、只要六个属性。$uri、$user 由 ipptool 替换成命令行给的地址和当前用户。
 * 系统自带的 get-jobs.test 不一定在、要的属性也不一定够，所以自己写一份，用时写进临时目录。
 */
export const CUPS_GET_JOBS_TEST = `{
  NAME "LabelFlash Get-Jobs"
  OPERATION Get-Jobs
  GROUP operation-attributes-tag
  ATTR charset attributes-charset utf-8
  ATTR naturalLanguage attributes-natural-language en
  ATTR uri printer-uri $uri
  ATTR name requesting-user-name $user
  ATTR keyword which-jobs not-completed
  ATTR keyword requested-attributes job-id,job-name,job-originating-user-name,job-state,job-state-reasons,time-at-creation
  STATUS successful-ok
}
`;
