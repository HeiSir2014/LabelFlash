export type NoticeTone = 'error' | 'warning' | 'info';

export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
}

type Listener = (notices: readonly Notice[]) => void;

/** 同时最多显示的通知条数，超出时丢弃最早的一条。 */
const MAX_VISIBLE_NOTICES = 3;

/** 界面级通知：IPC 失败、后台操作结果等。与扫码状态条分开，不会覆盖当前扫码结果。 */
export class NoticeCenter {
  private notices: readonly Notice[] = [];
  private nextId = 1;
  private readonly listeners = new Set<Listener>();

  push(tone: NoticeTone, message: string): void {
    // 连续出现同一条消息时不重复堆叠。
    if (this.notices.at(-1)?.message === message) {
      return;
    }
    this.notices = [...this.notices, { id: this.nextId++, tone, message }].slice(-MAX_VISIBLE_NOTICES);
    this.emit();
  }

  dismiss(id: number): void {
    this.notices = this.notices.filter((notice) => notice.id !== id);
    this.emit();
  }

  snapshot(): readonly Notice[] {
    return this.notices;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.notices);
    }
  }
}

export const notices = new NoticeCenter();

/** 调用主进程失败时使用：写日志（主进程会收集渲染进程的 console）并提示操作员。 */
export function reportError(action: string, error: unknown): void {
  console.error(`[renderer] ${action} failed`, error);
  notices.push('error', `${action}失败：程序内部错误，已写入日志`);
}
