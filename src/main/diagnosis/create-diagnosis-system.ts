import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { readIppAttributes } from '../printing/driver-paper';
import type { PrinterProbeHost } from '../printing/printer-probe-host';
import { runElevatedPowerShellScript, runPowerShellScript } from '../windows-powershell';
import { runCommand } from './command-runner';
import { type DiagnosisSystem, UnsupportedDiagnosis } from './diagnosis-system';
import { CUPS_GET_JOBS_TEST, JOBS_TEST_FILE_NAME, MAC_COMMAND_ENV } from './mac-commands';
import { MacDiagnosis } from './mac-diagnosis';
import { WindowsDiagnosis } from './windows-diagnosis';

const DEFAULT_SYSTEM_ROOT = 'C:\\Windows';

/**
 * 按平台接上真实的进程和文件。Windows 必须有常驻探测进程（假打印机模式下没有，那时用 FakeDiagnosis）。
 * `probeHost` 必须是诊断专用的实例，不能和打印共用打印状态 / RAW 发送的那一个：诊断的查询
 * （USB、队列、驱动纸张选项）比打印状态慢得多，一旦超时，探测进程会被整个重启，共用的话会连累
 * 正在排队的打印请求。调用方（index.ts）负责各建一个 `PrinterProbeHost`。
 */
export function createDiagnosisSystem(platform: NodeJS.Platform, probeHost: PrinterProbeHost | null): DiagnosisSystem {
  if (platform === 'win32' && probeHost !== null) {
    return new WindowsDiagnosis({
      query: (command, name) => probeHost.query(command, name),
      runScript: runPowerShellScript,
      runElevated: runElevatedPowerShellScript,
      openQueueWindow,
    });
  }
  if (platform === 'darwin') {
    const env = { ...process.env, ...MAC_COMMAND_ENV };
    return new MacDiagnosis({
      run: (file, args, options) => runCommand(file, args, options, env),
      ippAttributes: readIppAttributes,
      currentUser: userInfo().username,
      withJobsTest,
    });
  }
  return new UnsupportedDiagnosis();
}

/** Get-Jobs 的测试文件写进新建的临时目录，用完连目录一起删（只删我们自己刚建的目录）。 */
async function withJobsTest<T>(use: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'labelflash-ipp-'));
  try {
    const path = join(dir, JOBS_TEST_FILE_NAME);
    await writeFile(path, CUPS_GET_JOBS_TEST, 'utf8');
    return await use(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 系统的打印队列窗口（printui /o）；窗口关掉后完成，界面随后重查队列。参数按数组传入，不经过 shell。 */
function openQueueWindow(printerName: string): Promise<void> {
  const rundll32 = join(process.env['SystemRoot'] ?? DEFAULT_SYSTEM_ROOT, 'System32', 'rundll32.exe');
  return new Promise((resolve, reject) => {
    execFile(rundll32, ['printui.dll,PrintUIEntry', '/o', '/n', printerName], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
