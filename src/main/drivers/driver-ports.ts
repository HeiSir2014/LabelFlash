import type { InstallerVerifier, PrivilegedInstaller } from '../../core/drivers/driver-install-flow';
import { type DriverPlatform, findModelByUsbId } from '../../core/drivers/install-plan';
import type { DeviceSource } from './driver-station';
import { detectMacDevices } from './mac-devices';
import { checkMacSignature, createMacInstaller } from './mac-install';
import { detectWindowsDevices } from './windows-devices';
import { createWindowsInstaller } from './windows-install';
import { checkWindowsSignature } from './windows-signature';

export interface SystemDriverPorts {
  devices: DeviceSource;
  verifier: InstallerVerifier;
  installer: PrivilegedInstaller;
}

/** 按平台选设备检测、签名核对和提权安装；平台分支只在这里（index.ts 只管接线）。 */
export function systemDriverPorts(platform: DriverPlatform | null, log: (line: string) => void): SystemDriverPorts {
  switch (platform) {
    case 'windows':
      return {
        devices: { detect: () => detectWindowsDevices() },
        verifier: { check: (file) => checkWindowsSignature(file.path) },
        installer: createWindowsInstaller(log),
      };
    case 'mac':
      return {
        devices: {
          detect: (catalog) => detectMacDevices((id) => catalog !== null && findModelByUsbId(catalog, id) !== null),
        },
        verifier: { check: (file) => checkMacSignature(file.path) },
        installer: createMacInstaller(log),
      };
    case null:
      return {
        devices: { detect: async () => [] },
        verifier: { check: async () => ({ status: 'invalid', detail: 'unsupported platform' }) },
        installer: { install: async () => ({ kind: 'failed', exitCode: null }) },
      };
  }
}
