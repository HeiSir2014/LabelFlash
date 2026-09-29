/**
 * 把状态画到页面上。页面结构在 index.html 里，这里只切换区块、填文字（一律 textContent，不拼 HTML）。
 * 用到的文字都来自 result-view.ts 的纯函数。
 */
import type { Point, Size } from './camera-features';
import type { ViewExtras, ViewPort } from './phone-controller';
import type { JobEntry, PhoneState } from './phone-state';
import {
  type JobAction,
  type JobView,
  jobView,
  linkBanner,
  messageView,
  printerLine,
  scanHint,
  viewfinderCover,
} from './result-view';

export interface ViewHandlers {
  onOpenCamera(): void;
  onJobAction(job: JobEntry, action: JobAction): void;
  onPhoto(file: File): void;
  /** 返回是否已提交；没提交时输入框里的内容留着。 */
  onManual(raw: string): boolean;
  onTorch(on: boolean): void;
  onToggleSound(): void;
  /** 点了取景画面：tap 是点在元素上的位置（像素）。单击对焦，双击切换焦段。 */
  onViewfinderTap(tap: Point): void;
  onSwitchLens(): void;
  onReload(): void;
}

const ACTION_LABELS: Record<JobAction, string> = {
  retry: '重试',
  force: '强制补打',
};

/** 对焦圈的动画时长：够看清点到了哪里，又不挡住画面。 */
const FOCUS_RING_MS = 700;

interface RenderedJob {
  item: HTMLLIElement;
  /** 上次画的内容；没变就不动这一条。 */
  signature: string;
}

export class PhoneView implements ViewPort {
  private readonly renderedJobs = new Map<string, RenderedJob>();
  private focusAnimation: Animation | null = null;
  private announced = '';
  private isTorchOn = false;

  constructor(
    private readonly doc: Document,
    private readonly handlers: ViewHandlers,
  ) {
    this.byId<HTMLInputElement>('photo').addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) {
        handlers.onPhoto(file);
      }
    });
    this.byId('viewfinder').addEventListener('click', (event) => {
      // 手电筒、声音开关、焦段、开始扫码按钮也在取景框里，点它们不算点按取景画面。
      if ((event.target as HTMLElement).closest('button')) {
        return;
      }
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      handlers.onViewfinderTap({ x: event.clientX - box.left, y: event.clientY - box.top });
    });
    this.byId('cover-button').addEventListener('click', () => handlers.onOpenCamera());
    this.byId('torch').addEventListener('click', () => handlers.onTorch(!this.isTorchOn));
    this.byId('sound-toggle').addEventListener('click', () => handlers.onToggleSound());
    this.byId('lens').addEventListener('click', () => handlers.onSwitchLens());
    this.byId('message-action').addEventListener('click', () => handlers.onReload());
    this.byId<HTMLFormElement>('manual').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = this.byId<HTMLInputElement>('manual-input');
      const raw = input.value.trim();
      if (raw !== '' && handlers.onManual(raw)) {
        input.value = '';
        input.blur();
      }
    });
  }

  viewfinderSize(): Size | null {
    const box = this.byId('viewfinder').getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : null;
  }

  /** 在点按处画一个对焦圈（位置用 CSSOM 设置，不受 CSP 的内联样式限制）。连点时前一个动画直接作废。 */
  showFocusRing(tap: Point): void {
    const ring = this.byId('focus-ring');
    this.focusAnimation?.cancel();
    ring.style.left = `${tap.x}px`;
    ring.style.top = `${tap.y}px`;
    ring.hidden = false;
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = ring.animate(
      isReduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1.4)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.4 },
            { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
          ],
      { duration: FOCUS_RING_MS, easing: 'ease-out' },
    );
    this.focusAnimation = animation;
    animation.onfinish = () => {
      if (this.focusAnimation === animation) {
        ring.hidden = true;
        this.focusAnimation = null;
      }
    };
  }

  render(state: PhoneState, extras: ViewExtras): void {
    this.setText('printer', printerLine(state));
    const message = messageView(state);
    this.setText('link-banner', message ? null : linkBanner(state.link));
    this.byId('screen-message').hidden = message === null;
    this.byId('screen-scan').hidden = message !== null;
    if (message) {
      this.byId('message-title').textContent = message.title;
      this.setText('message-text', message.text || null);
      this.byId('message-action').hidden = message.action !== 'reload';
      return;
    }
    const latest = state.jobs[0];
    const viewfinder = this.byId('viewfinder');
    viewfinder.dataset['tone'] = latest ? jobView(latest, state.link).tone : 'idle';
    const cover = viewfinderCover(state);
    this.byId('viewfinder-cover').hidden = cover === null;
    this.setText('cover-text', cover?.text ?? null);
    this.setText('cover-button', cover?.button ?? null);
    this.byId('scan-hint').textContent = scanHint(state);
    this.setText('scan-hint-extra', extras.hint);
    this.isTorchOn = extras.isTorchOn;
    const torch = this.byId<HTMLButtonElement>('torch');
    torch.hidden = !extras.hasTorch;
    torch.textContent = extras.isTorchOn ? '关手电筒' : '开手电筒';
    torch.setAttribute('aria-pressed', String(extras.isTorchOn));
    const soundToggle = this.byId('sound-toggle');
    soundToggle.textContent = extras.isSoundOn ? '声音：开' : '声音：关';
    soundToggle.setAttribute('aria-pressed', String(extras.isSoundOn));
    const lens = this.byId('lens');
    lens.hidden = extras.lens === null;
    lens.textContent = extras.lens === 'far' ? '焦段：远' : '焦段：近';
    lens.setAttribute('aria-pressed', String(extras.lens === 'far'));
    // 识别组件坏了时拍照识别也用不了，只留手动输入。
    this.byId('photo-control').hidden = state.decoder === 'failed';
    this.renderJobs(state);
    this.announce(latest ? jobView(latest, state.link) : null);
  }

  /**
   * 任务列表按任务号复用节点，只改变了的那几条；列表本身不是朗读区，
   * 最新一条的变化由单独的 #announcer 读出来，屏幕阅读器不会把整个列表重读一遍。
   */
  private renderJobs(state: PhoneState): void {
    const items = state.jobs.map((job) => {
      const view = jobView(job, state.link);
      const signature = JSON.stringify(view);
      const rendered = this.renderedJobs.get(job.id);
      if (rendered?.signature === signature) {
        return rendered.item;
      }
      const item = rendered?.item ?? this.doc.createElement('li');
      this.fillJob(item, job, view);
      this.renderedJobs.set(job.id, { item, signature });
      return item;
    });
    const shown = new Set(state.jobs.map((job) => job.id));
    for (const id of this.renderedJobs.keys()) {
      if (!shown.has(id)) {
        this.renderedJobs.delete(id);
      }
    }
    this.byId('jobs').replaceChildren(...items);
  }

  private fillJob(item: HTMLLIElement, job: JobEntry, view: JobView): void {
    item.className = 'job';
    item.dataset['tone'] = view.tone;
    const mark = this.doc.createElement('span');
    mark.className = 'job-mark';
    mark.setAttribute('aria-hidden', 'true');
    const title = this.doc.createElement('p');
    title.className = 'job-title';
    title.textContent = view.title;
    const detail = this.doc.createElement('p');
    detail.className = 'job-detail';
    detail.textContent = view.detail;
    const body = this.doc.createElement('div');
    body.className = 'job-body';
    body.append(title, detail);
    item.replaceChildren(mark, body);
    if (view.actions.length > 0) {
      const actions = this.doc.createElement('div');
      actions.className = 'job-actions';
      actions.append(
        ...view.actions.map((action) => {
          const button = this.doc.createElement('button');
          button.type = 'button';
          button.className = action === 'force' ? 'button warning' : 'button';
          button.textContent = ACTION_LABELS[action];
          button.addEventListener('click', () => this.handlers.onJobAction(job, action));
          return button;
        }),
      );
      item.append(actions);
    }
  }

  private announce(view: JobView | null): void {
    const text = view ? `${view.title}：${view.detail}` : '';
    if (text !== this.announced) {
      this.announced = text;
      this.byId('announcer').textContent = text;
    }
  }

  private setText(id: string, text: string | null): void {
    const element = this.byId(id);
    element.textContent = text ?? '';
    element.hidden = text === null;
  }

  private byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.doc.getElementById(id);
    if (!element) {
      throw new Error(`页面缺少元素 #${id}`);
    }
    return element as T;
  }
}
