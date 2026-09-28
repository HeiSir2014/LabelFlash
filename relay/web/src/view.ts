/**
 * 把状态画到页面上。页面结构在 index.html 里，这里只切换区块、填文字（一律 textContent，不拼 HTML）。
 */
import type { VideoPoint } from './camera-features';
import type { JobEntry, PhoneState } from './phone-state';
import { type JobAction, jobView, linkBanner, messageView } from './result-view';

export interface ViewHandlers {
  onJobAction(job: JobEntry, action: JobAction): void;
  onPhoto(file: File): void;
  onManual(raw: string): void;
  onTorch(on: boolean): void;
  /** 点了取景画面：tap 是点在元素上的位置（像素），element 是元素的尺寸。 */
  onViewfinderTap(tap: VideoPoint, element: { width: number; height: number }): void;
}

export interface CameraExtras {
  hasTorch: boolean;
  isTorchOn: boolean;
}

const ACTION_LABELS: Record<JobAction, string> = {
  retry: '重试',
  force: '强制补打',
};

/** 对焦圈的动画时长：够看清点到了哪里，又不挡住画面。 */
const FOCUS_RING_MS = 700;

const CAMERA_HINTS: Record<PhoneState['camera'], string> = {
  pending: '正在打开摄像头…',
  live: '对准条码或二维码，扫到就打印',
  unavailable: '摄像头不可用（没有授权，或被别的应用占用）。可以拍照识别，或者手动输入。',
};

export class PhoneView {
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
      // 手电筒按钮也在取景框里，点它不算点按对焦。
      if ((event.target as HTMLElement).closest('button')) {
        return;
      }
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      handlers.onViewfinderTap(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        { width: box.width, height: box.height },
      );
    });
    this.byId<HTMLFormElement>('manual').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = this.byId<HTMLInputElement>('manual-input');
      const raw = input.value.trim();
      if (raw !== '') {
        input.value = '';
        input.blur();
        handlers.onManual(raw);
      }
    });
  }

  /** 在点按处画一个对焦圈（位置用 CSSOM 设置，不受 CSP 的内联样式限制）。 */
  showFocusRing(tap: VideoPoint): void {
    const ring = this.byId('focus-ring');
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
    animation.onfinish = () => {
      ring.hidden = true;
    };
  }

  /**
   * hint：取景下方的一次性提示（例如照片里没找到码、等结果的太多），没有时为 null。
   */
  render(state: PhoneState, camera: CameraExtras, hint: string | null): void {
    this.byId('printer').textContent = state.printer ? `打印机：${state.printer}` : '电脑上还没选打印机';
    const message = messageView(state);
    this.setText('link-banner', message ? null : linkBanner(state.link));
    this.byId('screen-message').hidden = message === null;
    this.byId('screen-scan').hidden = message !== null;
    if (message) {
      this.byId('message-title').textContent = message.title;
      this.setText('message-text', message.text || null);
      return;
    }
    const latest = state.jobs[0];
    const viewfinder = this.byId('viewfinder');
    viewfinder.hidden = state.camera === 'unavailable';
    viewfinder.dataset['tone'] = latest ? jobView(latest, state.link).tone : 'idle';
    this.byId('scan-hint').textContent = CAMERA_HINTS[state.camera];
    this.setText('scan-hint-extra', hint);
    const torch = this.byId<HTMLButtonElement>('torch');
    torch.hidden = !camera.hasTorch;
    torch.textContent = camera.isTorchOn ? '关手电筒' : '开手电筒';
    torch.onclick = () => this.handlers.onTorch(!camera.isTorchOn);
    this.byId('jobs').replaceChildren(...state.jobs.map((job) => this.renderJob(job, state)));
  }

  private renderJob(job: JobEntry, state: PhoneState): HTMLLIElement {
    const view = jobView(job, state.link);
    const item = this.doc.createElement('li');
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
    item.append(mark, body);
    if (view.actions.length > 0) {
      const actions = this.doc.createElement('div');
      actions.className = 'job-actions';
      actions.append(
        ...view.actions.map((action) => {
          const button = this.doc.createElement('button');
          button.type = 'button';
          button.className = action === 'force' ? 'button warning' : 'button secondary';
          button.textContent = ACTION_LABELS[action];
          button.disabled = state.screen !== 'scanning';
          button.addEventListener('click', () => this.handlers.onJobAction(job, action));
          return button;
        }),
      );
      item.append(actions);
    }
    return item;
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
