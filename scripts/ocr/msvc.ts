/**
 * 构建机上的 Visual Studio：用 vswhere 找安装位置、版本，以及 MSVC 工具（lib.exe、dumpbin.exe）。
 * 编 ONNX Runtime、合并静态库、检查扩展的依赖都要用。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
/** 「使用 C++ 的桌面开发」里的 x64 编译器组件。 */
const VC_TOOLS_COMPONENT = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64';

export interface VisualStudio {
  path: string;
  major: number;
}

function vswhere(property: string): string {
  const found = Bun.spawnSync([
    VSWHERE,
    '-latest',
    '-products',
    '*',
    '-requires',
    VC_TOOLS_COMPONENT,
    '-property',
    property,
  ]);
  const value = found.stdout.toString().trim();
  if (found.exitCode !== 0 || value === '') {
    throw new Error('找不到带 C++ 工具的 Visual Studio（需要「使用 C++ 的桌面开发」）');
  }
  return value;
}

export function visualStudio(): VisualStudio {
  return { path: vswhere('installationPath'), major: Number.parseInt(vswhere('installationVersion'), 10) };
}

/** MSVC 工具的完整路径（默认工具集、x64 主机、x64 目标）。 */
export function msvcTool(name: 'lib.exe' | 'dumpbin.exe'): string {
  const { path } = visualStudio();
  const version = readFileSync(
    join(path, 'VC', 'Auxiliary', 'Build', 'Microsoft.VCToolsVersion.default.txt'),
    'utf8',
  ).trim();
  const tool = join(path, 'VC', 'Tools', 'MSVC', version, 'bin', 'Hostx64', 'x64', name);
  if (!existsSync(tool)) {
    throw new Error(`找不到 ${tool}`);
  }
  return tool;
}
