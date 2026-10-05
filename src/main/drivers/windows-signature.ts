import type { SignatureCheck } from '../../core/drivers/driver-install-flow';
import { powerShellLiteral } from '../../shared/firewall-rule';
import { runPowerShell } from './run-command';

/** 核对签名最多等 60 秒：要联网查证书吊销列表，网络慢时要十几秒。 */
const SIGNATURE_TIMEOUT_MS = 60_000;
const VALID_STATUS = 'Valid';

/**
 * 读安装包的 Authenticode 签名：状态（Valid 才算有效：证书链可信、没被吊销、文件没被改过）和签名证书的 Subject。
 * 普通权限运行；路径写成 PowerShell 单引号字符串，整段脚本经 -EncodedCommand 传入，不经命令行转义。
 */
export function authenticodeScript(path: string): string {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    `$Path = ${powerShellLiteral(path)}`,
    '$sig = Get-AuthenticodeSignature -LiteralPath $Path',
    "$subject = ''",
    'if ($sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }',
    'ConvertTo-Json -Compress -InputObject @{ status = $sig.Status.ToString(); subject = $subject }',
  ].join('\n');
}

export function parseAuthenticode(output: string): SignatureCheck {
  try {
    const parsed = JSON.parse(output.trim()) as { status?: unknown; subject?: unknown };
    if (typeof parsed.status !== 'string') {
      return { status: 'invalid', detail: 'unreadable' };
    }
    return parsed.status === VALID_STATUS && typeof parsed.subject === 'string' && parsed.subject !== ''
      ? { status: 'valid', signer: parsed.subject }
      : { status: 'invalid', detail: parsed.status };
  } catch {
    return { status: 'invalid', detail: 'unreadable' };
  }
}

export async function checkWindowsSignature(path: string): Promise<SignatureCheck> {
  const result = await runPowerShell(authenticodeScript(path), SIGNATURE_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    return { status: 'invalid', detail: `query failed (exit ${result.exitCode})` };
  }
  return parseAuthenticode(result.stdout);
}
