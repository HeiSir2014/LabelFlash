/** 扩展文件名：按平台和架构区分（和 napi-rs 的命名习惯一致），同一份代码在不同机器上找对应的文件。 */
export function addonFileName(platform: string, arch: string): string {
  const suffix = platform === 'win32' ? '-msvc' : '';
  return `ocr-addon.${platform}-${arch}${suffix}.node`;
}
