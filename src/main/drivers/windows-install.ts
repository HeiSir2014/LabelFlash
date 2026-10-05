import type { WindowsPackage } from '../../core/drivers/catalog-model';
import type { PrivilegedInstaller, PrivilegedOutcome } from '../../core/drivers/driver-install-flow';
import { powerShellLiteral } from '../../shared/firewall-rule';
import { powerShellPath } from '../firewall';
import { encodePowerShell, runPowerShell } from './run-command';

/**
 * 提权脚本自己的退出码。安装程序、msiexec 用的都是小数（msiexec 的错误码在 1600–1700 一带），
 * 这里取 0x4C46（"LF"）开头的大数，不会和它们撞。
 */
export const ELEVATED_EXIT = {
  /** 操作员在 UAC 框里点了「否」（外层脚本识别 Win32 错误 1223）。 */
  declined: 0x4c460001,
  /** 复制到管理员专属目录后复核 SHA-256 不一致：文件在核对之后被换过。 */
  hashMismatch: 0x4c460002,
  /** 建目录、复制、启动安装程序时出错。 */
  prepareFailed: 0x4c460003,
  /** 外层没能启动提权进程（不是操作员拒绝）。 */
  launchFailed: 0x4c460004,
} as const;
/** Windows Installer 和多数安装程序的约定：3010 = 装好了、重启后生效；1641 = 装好了、已经发起重启。 */
const REBOOT_REQUIRED_EXIT = 3010;
const REBOOT_INITIATED_EXIT = 1641;
/** UAC 被取消时 Start-Process 报的 Win32 错误（ERROR_CANCELLED）。 */
const ERROR_CANCELLED = 1223;
/**
 * 安装最多等 15 分钟：驱动安装程序一般一两分钟，加上操作员看 UAC 框的时间。
 * 超时后提权的安装进程收不回来（普通权限结束不了它），只提示操作员等它装完再「重新检测」。
 */
export const INSTALL_TIMEOUT_MS = 15 * 60_000;

/**
 * 以管理员身份运行的脚本。核对过的文件在用户自己的临时目录里，同一用户的其他程序能改它，所以：
 * 1. 在 Windows\Temp 下新建一个随机名字的目录，创建时就只给 Administrators 和 SYSTEM 完全控制（不继承，
 *    没有「先建后改权限」的空档，别人放不进同名 DLL）；
 * 2. 把文件复制进去，在那里再算一次 SHA-256，和清单一致才运行（运行的就是清单签过的那份字节）；
 * 3. exe 带静默参数直接运行；msi 交给 msiexec /i … /qn /norestart；成功后让系统重新扫描设备；
 * 4. 删掉这个目录，用退出码报告结果。
 * 只用 .NET 类型，不调用 cmdlet：提权的 PowerShell 也会先到用户的「文档」里找模块，同一用户的程序能放同名的假模块。
 * 系统目录取 [Environment]::SystemDirectory（来自系统 API），不读环境变量。
 */
export function elevatedInstallScript(source: string, pkg: WindowsPackage): string {
  const successCodes = [...new Set([...pkg.successExitCodes, REBOOT_REQUIRED_EXIT, REBOOT_INITIATED_EXIT])];
  return `
$ErrorActionPreference = 'Stop'
$Source = ${powerShellLiteral(source)}
$Sha256 = ${powerShellLiteral(pkg.sha256)}
$Kind = ${powerShellLiteral(pkg.kind)}
$Arguments = ${powerShellLiteral(pkg.silentArgs.join(' '))}
$SuccessCodes = @(${successCodes.join(', ')})
$code = ${ELEVATED_EXIT.prepareFailed}
$system = [Environment]::SystemDirectory
$dir = [IO.Path]::Combine([IO.Path]::GetDirectoryName($system), 'Temp', 'cdl-labelflash-driver-' + [Guid]::NewGuid().ToString('N'))
try {
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in 'S-1-5-32-544', 'S-1-5-18') {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    $security.AddAccessRule($rule)
  }
  $null = [IO.Directory]::CreateDirectory($dir, $security)
  if ([IO.Directory]::GetFileSystemEntries($dir).Length -ne 0) { throw 'the new folder is not empty' }
  $file = [IO.Path]::Combine($dir, 'driver-installer.' + $Kind)
  [IO.File]::Copy($Source, $file)
  $stream = [IO.File]::OpenRead($file)
  try {
    $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
  }
  if ($hash -ne $Sha256) {
    $code = ${ELEVATED_EXIT.hashMismatch}
  } else {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.UseShellExecute = $false
    if ($Kind -eq 'msi') {
      $start.FileName = [IO.Path]::Combine($system, 'msiexec.exe')
      $start.Arguments = '/i "' + $file + '" /qn /norestart ' + $Arguments
    } else {
      $start.FileName = $file
      $start.Arguments = $Arguments
    }
    $process = [Diagnostics.Process]::Start($start)
    $process.WaitForExit()
    $code = $process.ExitCode
    if ($SuccessCodes -contains $code) {
      $scan = [Diagnostics.ProcessStartInfo]::new([IO.Path]::Combine($system, 'pnputil.exe'), '/scan-devices')
      $scan.UseShellExecute = $false
      $scan.CreateNoWindow = $true
      try { [Diagnostics.Process]::Start($scan).WaitForExit() } catch { }
    }
  }
} catch {
  $code = ${ELEVATED_EXIT.prepareFailed}
} finally {
  try { [IO.Directory]::Delete($dir, $true) } catch { }
}
exit $code
`;
}

/**
 * 普通权限的外层脚本：弹一次 UAC，以管理员身份运行系统目录里的 PowerShell 和整段 Base64 的提权脚本，
 * 等它结束并带回退出码。操作员点「否」时 Start-Process 抛出 Win32 错误 1223，换成 ELEVATED_EXIT.declined。
 * 和防火墙规则（src/main/firewall.ts）是同一个做法。
 */
export function launcherScript(elevated: string, powerShell: string): string {
  return `
try {
  $p = Start-Process -FilePath ${powerShellLiteral(powerShell)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encodePowerShell(elevated)}'
  exit $p.ExitCode
} catch {
  $e = $_.Exception
  while ($e) {
    if ($e -is [ComponentModel.Win32Exception] -and $e.NativeErrorCode -eq ${ERROR_CANCELLED}) { exit ${ELEVATED_EXIT.declined} }
    $e = $e.InnerException
  }
  exit ${ELEVATED_EXIT.launchFailed}
}
`;
}

/** 外层进程的结果 → 安装结果。successCodes 是清单写的成功退出码（默认只有 0）。 */
export function interpretInstallExit(
  result: { exitCode: number | null; timedOut: boolean },
  successCodes: readonly number[],
): PrivilegedOutcome {
  if (result.timedOut) {
    return { kind: 'timeout' };
  }
  switch (result.exitCode) {
    case null:
      return { kind: 'failed', exitCode: null };
    case ELEVATED_EXIT.declined:
      return { kind: 'declined' };
    case ELEVATED_EXIT.hashMismatch:
      return { kind: 'hash-mismatch' };
    case ELEVATED_EXIT.prepareFailed:
    case ELEVATED_EXIT.launchFailed:
      return { kind: 'failed', exitCode: null };
    case REBOOT_REQUIRED_EXIT:
    case REBOOT_INITIATED_EXIT:
      return { kind: 'installed', needsRestart: true };
    default:
      return successCodes.includes(result.exitCode)
        ? { kind: 'installed', needsRestart: false }
        : { kind: 'failed', exitCode: result.exitCode };
  }
}

/** Windows 的提权安装器：每次安装弹一次 UAC。 */
export function createWindowsInstaller(log: (line: string) => void): PrivilegedInstaller {
  return {
    async install(file, target) {
      if (target.platform !== 'windows') {
        throw new Error(`The Windows installer cannot install a ${target.platform} package`);
      }
      const elevated = elevatedInstallScript(file.path, target.package);
      const result = await runPowerShell(launcherScript(elevated, powerShellPath(process.env)), INSTALL_TIMEOUT_MS);
      log(
        `[drivers] ${target.model.id}: elevated install finished with exit ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`,
      );
      return interpretInstallExit(result, target.package.successExitCodes);
    },
  };
}
