/** 扫码枪可能连击：同一个值在 intervalMs 内只接受一次。 */
export class RepeatFilter {
  private lastValue: string | null = null;
  private lastAcceptedAt = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  shouldAccept(value: string): boolean {
    const now = this.now();
    if (value === this.lastValue && now - this.lastAcceptedAt < this.intervalMs) {
      return false;
    }
    this.lastValue = value;
    this.lastAcceptedAt = now;
    return true;
  }
}
