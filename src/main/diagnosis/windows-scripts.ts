import {
  PRINT_TICKET_LOCAL_NAME_PATTERN,
  PRINT_TICKET_NAMESPACE_PATTERN,
  type PrintTicketPaper,
} from '../../core/diagnosis/paper-choice';
import { powerShellLiteral } from '../../shared/firewall-rule';
import { PAPER_TOLERANCE_MM, type PaperSize } from '../../shared/paper-sizes';

/** 脚本的退出码：提权后的窗口是隐藏的，输出拿不回来，结果只能靠退出码带回。 */
export const SCRIPT_EXIT = { done: 0, failed: 1, driverRefused: 3, rolledBack: 4 } as const;

const MICRONS_PER_MM = 1_000;
/** 等服务停下、启动的最长时间：Spooler 正常几秒内就好，30 秒还没好就是卡住了。 */
const SERVICE_WAIT_SECONDS = 30;

/** Print Schema / XML Schema 的命名空间名（PrintTicket 规定必须这样写，不是网络地址）。 */
const PSF = 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework';
const PSK = 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const XSD = 'http://www.w3.org/2001/XMLSchema';

/**
 * 每个脚本的开头：出错就停；不显示进度条；模块只从 PowerShell 自己的目录找
 * （以管理员身份运行时，用户「文档」里的同名模块可以借确认框提权，见 firewall-rule.ts）。
 */
const PREAMBLE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "$env:PSModulePath = Join-Path $PSHOME 'Modules'",
].join('\n');

/** 打开这台打印机的队列，要「管理打印机」权限（清空、改默认设置都要）。 */
const OPEN_QUEUE_AS_ADMIN = `Add-Type -AssemblyName System.Printing
  $queue = New-Object System.Printing.PrintQueue -ArgumentList (New-Object System.Printing.PrintServer), $Name, ([System.Printing.PrintSystemDesiredAccess]::AdministratePrinter)`;

const RESTART_SPOOLER_BODY = `
try {
  Add-Type -AssemblyName System.ServiceProcess
  $service = New-Object System.ServiceProcess.ServiceController -ArgumentList 'Spooler'
  if ($service.StartType -eq [System.ServiceProcess.ServiceStartMode]::Disabled) {
    & (Join-Path ([Environment]::SystemDirectory) 'sc.exe') config Spooler start= auto | Out-Null
    if ($LASTEXITCODE -ne 0) { exit ${SCRIPT_EXIT.failed} }
  }
  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    $service.Stop()
    $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(${SERVICE_WAIT_SECONDS}))
  }
  $service.Start()
  $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(${SERVICE_WAIT_SECONDS}))
  exit ${SCRIPT_EXIT.done}
} catch {
  exit ${SCRIPT_EXIT.failed}
}`;

/**
 * 重启后台打印服务（管理员）：被禁用的先设为自动；ServiceController.Stop 会先停依赖它的服务（例如传真），
 * 不会替它们重新启动——它们本来也只在用到时启动。
 */
export function restartSpoolerScript(): string {
  return [PREAMBLE, RESTART_SPOOLER_BODY].join('\n');
}

/** 清空这台打印机的队列（管理员）：PrintQueue.Purge 取消全部任务，不管是谁的。 */
export function purgeQueueScript(printerName: string): string {
  return [
    PREAMBLE,
    `$Name = ${powerShellLiteral(printerName)}`,
    `try {
  ${OPEN_QUEUE_AS_ADMIN}
  $queue.Purge()
  exit ${SCRIPT_EXIT.done}
} catch {
  exit ${SCRIPT_EXIT.failed}
}`,
  ].join('\n');
}

/**
 * 取消本程序的几个任务（当前用户，不要管理员：任务的提交人可以取消自己的任务）。
 * 某个任务刚好打完了不算错：写一行到 stderr（进日志），接着取消下一个。输出取消成功的个数。
 */
export function cancelJobsScript(printerName: string, ids: readonly number[]): string {
  if (ids.length === 0 || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new Error(`Invalid job ids to cancel: ${ids.join(', ')}`);
  }
  return [
    PREAMBLE,
    `$Name = ${powerShellLiteral(printerName)}`,
    `$Ids = @(${ids.join(', ')})`,
    `$canceled = 0
try {
  Add-Type -AssemblyName System.Printing
  $queue = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($Name)
  foreach ($id in $Ids) {
    try { $queue.GetJob($id).Cancel(); $canceled++ } catch { [Console]::Error.WriteLine("job $id: " + $_.Exception.Message) }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit ${SCRIPT_EXIT.failed}
}
[Console]::Out.WriteLine($canceled)
exit ${SCRIPT_EXIT.done}`,
  ].join('\n');
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * 只含纸张这一项的 PrintTicket 增量，交给 PrintQueue.MergeAndValidatePrintTicket 合进现有设置：
 * 驱动的选项写成它自己命名空间里的名字；自定义尺寸写 psk:CustomMediaSize 和两个以微米计的参数。
 */
export function paperDeltaTicket(paper: PrintTicketPaper): string {
  const head = `<?xml version="1.0" encoding="UTF-8"?>`;
  const namespaces = `xmlns:psf="${PSF}" xmlns:psk="${PSK}" xmlns:xsi="${XSI}" xmlns:xsd="${XSD}"`;
  if (paper.kind === 'option') {
    if (!PRINT_TICKET_NAMESPACE_PATTERN.test(paper.namespace)) {
      throw new Error(`Invalid PrintTicket namespace: ${paper.namespace}`);
    }
    if (!PRINT_TICKET_LOCAL_NAME_PATTERN.test(paper.localName)) {
      throw new Error(`Invalid PrintTicket option name: ${paper.localName}`);
    }
    return `${head}<psf:PrintTicket ${namespaces} xmlns:lf="${escapeXmlAttribute(paper.namespace)}" version="1"><psf:Feature name="psk:PageMediaSize"><psf:Option name="lf:${paper.localName}"/></psf:Feature></psf:PrintTicket>`;
  }
  const integer = (value: number) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid custom paper size in microns: ${value}`);
    }
    return `<psf:Value xsi:type="xsd:integer">${value}</psf:Value>`;
  };
  return `${head}<psf:PrintTicket ${namespaces} version="1"><psf:Feature name="psk:PageMediaSize"><psf:Option name="psk:CustomMediaSize"><psf:ScoredProperty name="psk:MediaSizeWidth"><psf:ParameterRef name="psk:PageMediaSizeMediaSizeWidth"/></psf:ScoredProperty><psf:ScoredProperty name="psk:MediaSizeHeight"><psf:ParameterRef name="psk:PageMediaSizeMediaSizeHeight"/></psf:ScoredProperty></psf:Option></psf:Feature><psf:ParameterInit name="psk:PageMediaSizeMediaSizeWidth">${integer(paper.widthMicrons)}</psf:ParameterInit><psf:ParameterInit name="psk:PageMediaSizeMediaSizeHeight">${integer(paper.heightMicrons)}</psf:ParameterInit></psf:PrintTicket>`;
}

/**
 * 设置驱动的默认纸张（管理员），失败回滚：
 * 1. 记下原来的 DefaultPrintTicket；
 * 2. 把增量合进去、让驱动校验，校验后的尺寸不对就说明驱动不接受（什么都没改，退出 3）；
 * 3. 写回、重读，重读的尺寸不对就恢复原来的（退出 4）；
 * 4. 同一账户的 UserPrintTicket（打印首选项里的个人设置，Chromium 打印时用它）也合进同样的增量。
 * PageMediaSize 的宽高以 1/96 英寸计。
 */
const SET_PAPER_BODY = `
$MicronsPerDip = 25400 / 96
function Test-Paper($ticket) {
  $size = $ticket.PageMediaSize
  if ($null -eq $size -or $null -eq $size.Width -or $null -eq $size.Height) { return $false }
  return ([Math]::Abs($size.Width * $MicronsPerDip - $WidthMicrons) -le $ToleranceMicrons) -and ([Math]::Abs($size.Height * $MicronsPerDip - $HeightMicrons) -le $ToleranceMicrons)
}
$queue = $null
$before = $null
try {
  ${OPEN_QUEUE_AS_ADMIN}
  $before = $queue.DefaultPrintTicket.GetXmlStream().ToArray()
  $delta = New-Object System.Printing.PrintTicket -ArgumentList (,(New-Object System.IO.MemoryStream -ArgumentList (,[Convert]::FromBase64String($Delta))))
  $merged = $queue.MergeAndValidatePrintTicket($queue.DefaultPrintTicket, $delta).ValidatedPrintTicket
  if (-not (Test-Paper $merged)) { exit ${SCRIPT_EXIT.driverRefused} }
  $queue.DefaultPrintTicket = $merged
  $queue.Commit()
  $queue.Refresh()
  if (-not (Test-Paper $queue.DefaultPrintTicket)) { throw 'read-back mismatch' }
  if ($null -ne $queue.UserPrintTicket) {
    $queue.UserPrintTicket = $queue.MergeAndValidatePrintTicket($queue.UserPrintTicket, $delta).ValidatedPrintTicket
    $queue.Commit()
  }
  exit ${SCRIPT_EXIT.done}
} catch {
  if ($null -ne $queue -and $null -ne $before) {
    try {
      $queue.DefaultPrintTicket = New-Object System.Printing.PrintTicket -ArgumentList (,(New-Object System.IO.MemoryStream -ArgumentList (,$before)))
      $queue.Commit()
      exit ${SCRIPT_EXIT.rolledBack}
    } catch {
      exit ${SCRIPT_EXIT.failed}
    }
  }
  exit ${SCRIPT_EXIT.failed}
}`;

export function setDriverPaperScript(printerName: string, paper: PrintTicketPaper, target: PaperSize): string {
  return [
    PREAMBLE,
    `$Name = ${powerShellLiteral(printerName)}`,
    `$Delta = '${Buffer.from(paperDeltaTicket(paper), 'utf8').toString('base64')}'`,
    `$WidthMicrons = ${Math.round(target.widthMm * MICRONS_PER_MM)}`,
    `$HeightMicrons = ${Math.round(target.heightMm * MICRONS_PER_MM)}`,
    `$ToleranceMicrons = ${PAPER_TOLERANCE_MM * MICRONS_PER_MM}`,
    SET_PAPER_BODY,
  ].join('\n');
}
