/** 「关于」里的版本：CI 打的包带上构建号，报问题时能对上是哪一次构建；本机构建只有版本号。 */
export function formatAppVersion(version: string, buildNumber: string | null): string {
  return buildNumber === null ? `v${version}` : `v${version}（构建 ${buildNumber}）`;
}
