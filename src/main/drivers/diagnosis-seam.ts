import type { ActionResult } from '../../core/diagnosis/diagnosis-model';
import type { InstallFailure, InstallState } from '../../core/drivers/driver-install-flow';
import type { DriverReinstallSeam } from '../diagnosis/seams';
import type { DriverStation } from './driver-station';

/** 和 renderer 的 driver-text.ts 用词一致，但这里不分平台（只有 admin-declined 需要分平台，已经单独映射成 declined）。 */
function failureDetail(failure: InstallFailure, exitCode: number | null): string {
  switch (failure) {
    case 'download-failed':
      return '下载驱动失败，详情见日志';
    case 'download-timeout':
      return '下载驱动超时，详情见日志';
    case 'too-large':
      return '下载到的文件比清单里写的大，已停止并删除';
    case 'canceled':
      return '安装已取消';
    case 'size-mismatch':
      return '下载到的文件大小和清单不一致，没有安装';
    case 'hash-mismatch':
      return '下载到的文件和清单里的 SHA-256 不一致，可能被替换过，没有安装';
    case 'signature-invalid':
      return '安装包的数字签名无效，没有安装';
    case 'signature-unverifiable':
      return '核对签名失败，详情见日志';
    case 'signer-mismatch':
      return '安装包不是清单要求的厂家签名的，没有安装';
    case 'admin-declined':
      // 走不到这里：调用方在 admin-declined 时直接返回 { kind: 'declined' }，不经过这个函数。
      return '管理员确认被取消了';
    case 'installer-failed':
      return exitCode === null ? '安装程序没能运行，详情见日志' : `安装程序报错（退出码 ${exitCode}）`;
    case 'install-timeout':
      return '安装超过 15 分钟还没结束，详情见日志';
    case 'internal':
      return '安装驱动时出错，详情见日志';
  }
}

/**
 * 把 DriverStation.reinstall() 的终态换成诊断用的 ActionResult（见 main/diagnosis/seams.ts 里
 * DriverReinstallSeam.reinstall 的契约）：只在 phase 是 'done' 或 'failed' 时调用，'running' 不该出现——
 * reinstall() 本身就是等到终态才 resolve 的，这里仍然处理一下，不让一个理论上不会发生的状态抛出异常。
 */
export function mapInstallStateToActionResult(state: InstallState): ActionResult {
  switch (state.phase) {
    case 'done':
      return { kind: 'done' };
    case 'failed':
      if (state.failure === 'admin-declined') {
        return { kind: 'declined' };
      }
      return { kind: 'failed', detail: failureDetail(state.failure, state.exitCode) };
    case 'running':
      return { kind: 'failed', detail: '驱动安装还没结束就被问了结果，详情见日志' };
  }
}

/**
 * 给诊断（5b）用的适配器：按打印机名找驱动名，再调 DriverStation 按驱动名查 / 装。
 * getDrivers 是个取值函数，不是 DriverStation 本身：这个适配器在 DriverStation 构造之前就要建好
 * （传给 DiagnosisStation），和 printerCommands 的 hints: () => drivers.hints() 同一个道理——
 * 闭包按引用捕获外层的 drivers 变量，真正调用的时候它已经赋值了，声明顺序不影响这一点。
 */
export function createDriverReinstallSeam(
  getDrivers: () => DriverStation,
  driverNameOf: (printerName: string) => Promise<string | null>,
): DriverReinstallSeam {
  return {
    async canReinstall(printerName) {
      const driverName = await driverNameOf(printerName);
      return driverName !== null && getDrivers().hints().modelForDriverName(driverName)?.canInstall === true;
    },
    async reinstall(printerName) {
      const driverName = await driverNameOf(printerName);
      if (driverName === null) {
        throw new Error(`Cannot read the driver name of ${printerName}`);
      }
      const state = await getDrivers().reinstall(driverName);
      return mapInstallStateToActionResult(state);
    },
  };
}
