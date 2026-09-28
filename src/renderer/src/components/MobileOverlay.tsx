import { useEffect, useRef } from 'react';
import type { ConfigPage } from '../lib/app-view';
import { MOBILE_QR_CAPTION, type MobileOverlayView } from '../lib/mobile-text';
import { KEEP_FOCUS_ATTRIBUTE } from '../lib/scan-focus';
import { ConfirmButton } from './ConfirmButton';
import { PageLink } from './config/PageLink';

/** 标题栏按钮用它关联浮层（aria-controls）。 */
export const MOBILE_OVERLAY_ID = 'mobile-overlay';
/**
 * 二维码显示的边长（CSS 像素）：放得下约 100 个字符的链接，隔着一臂远手机也能一次扫出。
 * 和 tokens.css 的 --mobile-qr-size 一致（生成前的占位框用它）。
 */
export const MOBILE_QR_SIZE_PX = 200;

interface MobileOverlayProps {
  view: MobileOverlayView;
  /** 二维码图片（data URL）；生成前为 null。 */
  qrImage: string | null;
  onStart: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  onRemovePhone: (id: string) => void;
  onAllowNewPhones: () => void;
  onOpenPage: (page: ConfigPage) => void;
  onClose: () => void;
}

/**
 * 「手机扫码」浮层。非模态：扫码框和 F2 照常可用，所以不用 dialog.showModal（它会让页面其余部分不可操作）。
 * 标了 data-keep-focus：键盘在里面操作时焦点不被拉回扫码框，扫码枪的字符照样进扫码框。
 * Esc 关闭，焦点回到扫码框（由 onClose 负责）。
 */
export function MobileOverlay({
  view,
  qrImage,
  onStart,
  onStop,
  onRegenerate,
  onRemovePhone,
  onAllowNewPhones,
  onOpenPage,
  onClose,
}: MobileOverlayProps) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 打开时把焦点放进浮层，键盘可以直接 Tab 到里面的按钮；读屏也会读出浮层的名称。
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // 捕获阶段处理 Esc，并阻止它再传下去：不能让同一次 Esc 又被别处当作「返回」。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const keepFocus = { [KEEP_FOCUS_ATTRIBUTE]: '' };

  return (
    <section
      ref={panelRef}
      id={MOBILE_OVERLAY_ID}
      className={`mobile-overlay mobile-overlay--${view.tone}`}
      role="dialog"
      aria-labelledby="mobile-overlay-title"
      tabIndex={-1}
      {...keepFocus}
    >
      <header className="mobile-overlay__header">
        <h2 id="mobile-overlay-title" className="mobile-overlay__title">
          手机扫码
        </h2>
        <button type="button" className="mobile-overlay__close" aria-label="关闭（Esc）" onClick={onClose}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </header>

      {(view.message || view.link) && (
        <p className="mobile-overlay__message" role="status">
          {view.message}
          {view.link && (
            <>
              {' '}
              <PageLink page={view.link.page} onOpen={onOpenPage}>
                {view.link.label}
              </PageLink>
            </>
          )}
        </p>
      )}

      {view.url && (
        <figure className="mobile-overlay__qr">
          {qrImage ? (
            <img src={qrImage} alt="手机扫码的二维码" width={MOBILE_QR_SIZE_PX} height={MOBILE_QR_SIZE_PX} />
          ) : (
            <span className="mobile-overlay__qr-placeholder" aria-hidden="true" />
          )}
          <figcaption>
            {MOBILE_QR_CAPTION}
            {view.countdown && <span className="mobile-overlay__countdown">{view.countdown} 后失效</span>}
          </figcaption>
        </figure>
      )}

      {view.isJoinLocked && (
        <div className="mobile-overlay__lock">
          <span>已暂停新手机加入（移除手机后自动暂停）</span>
          <button type="button" className="button button--small" onClick={onAllowNewPhones}>
            允许新手机加入
          </button>
        </div>
      )}

      {view.phones.length > 0 && (
        <ul className="mobile-overlay__phones" aria-label="已加入的手机">
          {view.phones.map((phone) => (
            <li key={phone.id} className="mobile-phone">
              <span
                className={`mobile-phone__dot${phone.isOnline ? ' mobile-phone__dot--online' : ''}`}
                aria-hidden="true"
              />
              <span className="mobile-phone__text">
                <span className="mobile-phone__device">{phone.device}</span>
                <span className="mobile-phone__detail">{phone.detail}</span>
              </span>
              <ConfirmButton
                className="button button--small button--quiet"
                label="移除"
                confirmLabel="确认移除"
                onConfirm={() => onRemovePhone(phone.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {view.summary && <p className="mobile-overlay__summary">{view.summary}</p>}

      <footer className="mobile-overlay__actions">
        {view.actions.start && (
          <button type="button" className="button button--primary" onClick={onStart}>
            生成二维码
          </button>
        )}
        {view.actions.regenerate && (
          <button type="button" className="button" onClick={onRegenerate}>
            换一个二维码
          </button>
        )}
        {view.actions.stop && (
          <ConfirmButton
            className="button"
            label="结束"
            confirmLabel="确认结束：手机上会显示已结束"
            onConfirm={onStop}
          />
        )}
      </footer>
    </section>
  );
}
