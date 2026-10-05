import { INSTALL_STEPS, type InstallFailure, type InstallStep } from '../../../core/drivers/driver-install-flow';
import type {
  CatalogView,
  DeviceActionView,
  DriverDeviceView,
  DriverInstallView,
  DriverPlatformView,
} from '../../../shared/drivers';

/** 「驱动」一节的文字。用词：驱动回调成功只代表安装程序说装好了，所以说「驱动已装好」，不说「打印机可以用了」。 */

export type TextTone = 'ok' | 'warning' | 'error' | 'running';

export interface ToneText {
  text: string;
  tone: TextTone;
}

const BYTES_PER_MB = 1024 * 1024;
const DATE_PART_DIGITS = 2;
const WINDOWS_GENERIC_DRIVER =
  '可以先试 Windows 自带的通用驱动（设置 › 蓝牙和其他设备 › 打印机和扫描仪 › 添加设备），或到厂家官网下载驱动';
const MAC_GENERIC_DRIVER = '到厂家官网下载 macOS 驱动';

export const INSTALL_STEP_LABELS: Readonly<Record<InstallStep, string>> = {
  downloading: '下载',
  verifying: '核对',
  installing: '安装',
  'finding-printer': '找打印机',
};

export function formatMegabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/** 本地日期 YYYY-MM-DD。 */
export function formatDate(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(DATE_PART_DIGITS, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function catalogText(view: CatalogView): ToneText {
  switch (view.state) {
    case 'unconfigured':
      return {
        tone: 'warning',
        text: '未配置驱动清单地址：清单里有的型号才能自动下载安装官方驱动。在下面「驱动清单地址」里填写出品方提供的地址',
      };
    case 'loading':
      return { tone: 'running', text: '正在读取驱动清单…' };
    case 'failed':
      return { tone: 'error', text: `驱动清单不能用：${view.issue}` };
    case 'ready': {
      const text = `驱动清单：${formatDate(view.issuedAt)} 签发，${view.modelCount} 个型号，有效期到 ${formatDate(view.expiresAt)}`;
      return view.staleIssue === null
        ? { tone: 'ok', text }
        : { tone: 'warning', text: `${text}（用的是上次下载的清单：${view.staleIssue}）` };
    }
  }
}

export function deviceTitle(device: DriverDeviceView): string {
  const { action } = device;
  if (action.kind === 'install' || action.kind === 'open-page' || action.kind === 'no-package') {
    return `${action.brand} ${action.model}`;
  }
  return device.name || '未知 USB 设备';
}

export function deviceDetail(device: DriverDeviceView): string {
  const problem =
    device.problem === 'no-driver'
      ? '没装驱动'
      : device.problem === 'no-queue'
        ? '还没有打印机'
        : `驱动有问题（设备管理器代码 ${device.problemCode ?? '未知'}）`;
  return `USB ${device.usbId} · ${problem}`;
}

/** 设备那一行的按钮（null = 没有按钮）和说明。 */
export function actionText(
  action: DeviceActionView,
  platform: DriverPlatformView,
): { button: string | null; guide: string | null } {
  const generic = platform === 'mac' ? MAC_GENERIC_DRIVER : WINDOWS_GENERIC_DRIVER;
  switch (action.kind) {
    case 'install':
      return { button: `安装驱动（${formatMegabytes(action.sizeBytes)}）`, guide: null };
    case 'open-page':
      return { button: '打开官方下载页', guide: '这个型号的 macOS 驱动要到厂家官网下载安装' };
    case 'no-package':
      return {
        button: null,
        guide: `清单里没有这个型号的${platform === 'mac' ? ' macOS ' : ' Windows '}驱动：${generic}`,
      };
    case 'not-in-catalog':
      return { button: null, guide: `清单里没有这个型号：${generic}` };
    case 'no-catalog':
      return { button: null, guide: `驱动清单不可用，不能自动安装：${generic}` };
  }
}

export function emptyDevicesText(platform: DriverPlatformView): string {
  return platform === 'mac'
    ? '没有发现清单里有、还没装驱动的 USB 设备（macOS 上只能认出清单里有的型号）'
    : '没有发现缺驱动的 USB 打印设备';
}

export function stepProgress(step: InstallStep, current: InstallStep): 'done' | 'current' | 'todo' {
  const index = INSTALL_STEPS.indexOf(step);
  const currentIndex = INSTALL_STEPS.indexOf(current);
  return index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
}

export function installText(view: DriverInstallView, platform: DriverPlatformView): ToneText {
  const name = `${view.brand} ${view.model}`;
  const { state } = view;
  switch (state.phase) {
    case 'running':
      return {
        tone: 'running',
        text: runningText(name, state.step, state.receivedBytes, state.totalBytes, platform),
      };
    case 'done': {
      const restart = state.needsRestart ? '（重启电脑后生效）' : '';
      return state.newPrinters.length > 0
        ? {
            tone: 'ok',
            text: `驱动已装好${restart}，新打印机：${state.newPrinters.join('、')}。到上面「纸张 → 打印机」给它分配纸张`,
          }
        : { tone: 'ok', text: `驱动已装好${restart}，但还没看到新打印机：重新插拔 USB 线后点「重新检测」` };
    }
    case 'failed':
      return { tone: 'error', text: failureText(state.failure, state.exitCode, platform) };
  }
}

function runningText(
  name: string,
  step: InstallStep,
  received: number,
  total: number,
  platform: DriverPlatformView,
): string {
  switch (step) {
    case 'downloading':
      return `正在下载${name} 的驱动：${formatMegabytes(received)} / ${formatMegabytes(total)}`;
    case 'verifying':
      return '正在核对安装包（大小、SHA-256、数字签名）…';
    case 'installing':
      return platform === 'mac'
        ? '请在弹出的窗口里输入这台 Mac 的登录密码，然后等安装完成（可能要几分钟）'
        : '请在 Windows 弹出的窗口里点「是」（允许 Windows PowerShell 安装核对过的驱动），然后等安装完成（可能要几分钟）';
    case 'finding-printer':
      return '驱动已装好，正在等系统建好新打印机…';
  }
}

function failureText(failure: InstallFailure, exitCode: number | null, platform: DriverPlatformView): string {
  switch (failure) {
    case 'download-failed':
      return '下载驱动失败：检查网络后再试';
    case 'download-timeout':
      return '下载驱动超时：网络太慢或断了，稍后再试';
    case 'too-large':
      return '下载到的文件比清单里写的大，已停止并删除：请联系出品方核对驱动清单';
    case 'canceled':
      return '已取消下载';
    case 'size-mismatch':
      return '下载到的文件大小和清单不一致，没有安装：稍后再试，一直这样请联系出品方';
    case 'hash-mismatch':
      return '下载到的文件和清单里的 SHA-256 不一致，可能被替换过，没有安装';
    case 'signature-invalid':
      return '安装包的数字签名无效，没有安装：请联系出品方';
    case 'signature-unverifiable':
      return '核对签名失败，详情见日志';
    case 'signer-mismatch':
      return '安装包不是清单要求的厂家签名的，没有安装：请联系出品方';
    case 'admin-declined':
      return platform === 'mac'
        ? '没有安装：没有输入管理员密码。要安装请再点一次'
        : '没有安装：管理员确认被取消了。要安装请再点一次，在弹出的窗口里点「是」';
    case 'installer-failed':
      return exitCode === null
        ? '安装程序没能运行，详情见日志：可以到厂家官网下载驱动手动安装'
        : `安装程序报错（退出码 ${exitCode}）：可以到厂家官网下载驱动手动安装`;
    case 'install-timeout':
      return '安装超过 15 分钟还没结束：等它装完后点「重新检测」';
    case 'internal':
      return '安装驱动时出错，详情见日志';
  }
}
