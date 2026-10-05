import type { DeviceProblem } from '../core/drivers/detected-device';
import type { InstallState } from '../core/drivers/driver-install-flow';

export { DEVICE_KEY_PATTERN } from '../core/drivers/detected-device';

export type DriverPlatformView = 'windows' | 'mac' | 'unsupported';

/** staleIssue 不为 null：新清单用不了，用的是上次下载的（原因写在里面）。 */
export type CatalogView =
  | { state: 'unconfigured' }
  | { state: 'loading' }
  | { state: 'ready'; issuedAt: number; expiresAt: number; modelCount: number; staleIssue: string | null }
  | { state: 'failed'; issue: string };

export type DeviceActionView =
  | { kind: 'install'; brand: string; model: string; sizeBytes: number }
  | { kind: 'open-page'; brand: string; model: string }
  | { kind: 'no-package'; brand: string; model: string }
  | { kind: 'not-in-catalog' }
  | { kind: 'no-catalog' };

export interface DriverDeviceView {
  key: string;
  /** 系统给的名字。 */
  name: string;
  /** 0A5F:0120。 */
  usbId: string;
  problem: DeviceProblem;
  problemCode: number | null;
  action: DeviceActionView;
}

export interface DriverInstallView {
  /** 每次安装一个新编号：界面据此只在一次安装完成时刷新一次打印机列表。 */
  id: number;
  modelId: string;
  /** 从「驱动」一节的设备点的；从 5b 的「重新安装驱动」来的为 null。 */
  deviceKey: string | null;
  brand: string;
  model: string;
  state: InstallState;
}

export interface DriverStatus {
  platform: DriverPlatformView;
  catalog: CatalogView;
  /** null = 还没检测过。 */
  devices: DriverDeviceView[] | null;
  isDetecting: boolean;
  /** 检测 USB 设备失败时的说明。 */
  detectIssue: string | null;
  /** 最近一次安装（进行中或已结束）；没装过为 null。 */
  install: DriverInstallView | null;
}
