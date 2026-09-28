/**
 * 命令行版的电脑端：不开 Electron、不真的打印，用来拿真手机试扫码页和中转服务。
 * 在终端里显示二维码，手机扫码后提交的每个任务都打出来，并按「已发送打印」回复。
 *
 * 用法：bun scripts/relay/demo-desktop.ts <中转地址>
 *   例如 bun scripts/relay/demo-desktop.ts http://localhost:3180/   （配合 bun run relay:dev）
 * 按 Ctrl+C 结束会话。
 */
import QRCode from 'qrcode';
import { type PrinterInfo, systemClock } from '../../src/core/types';
import { MobileHost } from '../../src/main/mobile/mobile-host';
import { resolveRelayBase } from '../../src/main/mobile/relay-endpoint';
import type { MobileStatus } from '../../src/shared/mobile-status';
import type { SocketLike } from '../../src/shared/relay-socket';

/** 和电脑端 tick 的间隔一致：检查二维码有没有过期、会话有没有闲置太久。 */
const TICK_INTERVAL_MS = 5_000;
/** 按 Ctrl+C 后等这么久再退出：够把「结束」消息发给中转服务。 */
const EXIT_GRACE_MS = 500;
const DEMO_PRINTER: PrinterInfo = { name: 'demo', displayName: '演示打印机（不出纸）' };

const base = resolveRelayBase({ setting: process.argv[2] ?? null, buildDefault: null });
if (!base) {
  console.error('用法：bun scripts/relay/demo-desktop.ts <中转地址>，地址必须是 https（本机可以用 http://localhost）');
  process.exit(1);
}

let shownUrl: string | null = null;

const host = new MobileHost({
  relayBase: base,
  clock: systemClock,
  timers: {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  selectedPrinter: async () => DEMO_PRINTER,
  print: async (raw, force) => {
    console.log(`${new Date().toLocaleTimeString('zh-CN')}  ${force ? '强制补打' : '打印'}：${raw}`);
    return { status: 'printed', ruleName: '演示', fields: [{ name: '内容', value: raw }] };
  },
  log: (line) => console.log(`  · ${line}`),
});

host.onStatus((status: MobileStatus) => {
  if (status.state === 'active' && status.url !== shownUrl) {
    shownUrl = status.url;
    void QRCode.toString(status.url, { type: 'terminal', small: true }).then((qr) => {
      console.log(`\n用手机相机或微信扫这个二维码：\n${qr}\n${status.url}\n`);
    });
  }
  if (status.state === 'active') {
    const phones = status.phones.map((phone) => `${phone.device}${phone.online ? '' : '（离线）'}`).join('、');
    const joining = status.joinLocked ? '；已暂停新手机加入' : '';
    console.log(`  手机：${phones || '还没有'}；排队 ${status.queued} 张；已打印 ${status.printed} 张${joining}`);
  } else {
    console.log(`  状态：${status.state === 'failed' ? `失败（${status.error}）` : status.state}`);
  }
});

host.start();
const ticker = setInterval(() => host.tick(), TICK_INTERVAL_MS);
process.on('SIGINT', () => {
  clearInterval(ticker);
  host.stop('stopped');
  setTimeout(() => process.exit(0), EXIT_GRACE_MS);
});
