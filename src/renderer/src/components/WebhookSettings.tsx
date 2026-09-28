import { useState } from 'react';
import type { Delivery, DeliveryState } from '../../../core/notify/delivery';
import {
  DEFAULT_WEBHOOK_EVENTS,
  isWebhookUrl,
  WEBHOOK_EVENTS,
  WEBHOOK_LIMITS,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookEventType,
} from '../../../core/notify/webhook-model';
import { formatDateTime } from '../lib/status-text';
import { useWebhookDeliveries } from '../view-models/use-webhook-deliveries';
import { ConfirmButton } from './ConfirmButton';
import { SelectField, TextInput, Toggle } from './form-controls';

const EVENT_LABELS: Record<WebhookEventType, string> = {
  printed: '已打印',
  failed: '打印失败',
  duplicate: '重复被拦截',
  invalid: '无法识别',
  test: '测试',
};

const STATE_LABELS: Record<DeliveryState, string> = {
  pending: '等待发送',
  delivered: '已送达',
  failed: '失败',
};

const NO_SIGNATURE = '';
/** 设置页只列出最近这么多条发送记录。 */
const SHOWN_DELIVERIES = 20;

interface WebhookSettingsProps {
  webhooks: readonly WebhookEndpoint[];
  secretNames: readonly string[];
  onChange: (webhooks: WebhookEndpoint[]) => Promise<unknown>;
}

/** 设置页「打印结果通知」：接口列表、编辑、发送测试、发送记录。 */
export function WebhookSettings({ webhooks, secretNames, onChange }: WebhookSettingsProps) {
  const [draft, setDraft] = useState<WebhookEndpoint | null>(null);
  const deliveries = useWebhookDeliveries();
  const names = new Map(webhooks.map((endpoint) => [endpoint.id, endpoint.name]));

  const save = async (endpoint: WebhookEndpoint) => {
    const exists = webhooks.some((item) => item.id === endpoint.id);
    await onChange(
      exists ? webhooks.map((item) => (item.id === endpoint.id ? endpoint : item)) : [...webhooks, endpoint],
    );
    setDraft(null);
  };

  return (
    <section className="note-presets" aria-label="打印结果通知">
      <h3 className="about__title">打印结果通知</h3>
      <p className="setting__hint">
        每次打印的结果以 JSON 发送到下面的地址（ERP、仓库系统、群机器人），先存进本机队列再在后台发送，
        网络断了会自动重试，不影响打印。设置了签名密钥时带 HMAC-SHA256 签名，接收方可以验证来源。
      </p>
      <ul className="plain-list">
        {webhooks.map((endpoint) => (
          <li key={endpoint.id} className="plain-list__item">
            <div className="plain-list__text">
              <strong>{endpoint.name}</strong>
              <span className="plain-list__meta">
                {endpoint.enabled ? '' : '已停用 · '}
                {endpoint.events.map((event) => EVENT_LABELS[event]).join('、') || '没有勾选事件'} · {endpoint.url}
              </span>
            </div>
            <div className="plain-list__actions">
              <button
                type="button"
                className="button button--small button--quiet"
                onClick={() => void deliveries.sendTest(endpoint.id)}
              >
                发送测试
              </button>
              <button type="button" className="button button--small button--quiet" onClick={() => setDraft(endpoint)}>
                编辑
              </button>
              <ConfirmButton
                className="button button--small button--quiet"
                label="删除"
                confirmLabel="确认删除"
                onConfirm={() => void onChange(webhooks.filter((item) => item.id !== endpoint.id))}
              />
            </div>
          </li>
        ))}
      </ul>
      {draft ? (
        <EndpointEditor
          endpoint={draft}
          secretNames={secretNames}
          onSave={(endpoint) => void save(endpoint)}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <button
          type="button"
          className="button button--small"
          disabled={webhooks.length >= WEBHOOK_LIMITS.endpoints}
          onClick={() =>
            setDraft({
              id: crypto.randomUUID(),
              name: '',
              url: 'https://',
              secretName: null,
              events: [...DEFAULT_WEBHOOK_EVENTS],
              enabled: true,
            })
          }
        >
          添加接口（{webhooks.length}/{WEBHOOK_LIMITS.endpoints}）
        </button>
      )}
      <DeliveryLog
        deliveries={deliveries.deliveries.slice(0, SHOWN_DELIVERIES)}
        endpointName={(id) => names.get(id) ?? '（已删除的接口）'}
        onRetry={(id) => void deliveries.retry(id)}
        onRefresh={() => void deliveries.refresh()}
      />
    </section>
  );
}

interface EndpointEditorProps {
  endpoint: WebhookEndpoint;
  secretNames: readonly string[];
  onSave: (endpoint: WebhookEndpoint) => void;
  onCancel: () => void;
}

function EndpointEditor({ endpoint, secretNames, onSave, onCancel }: EndpointEditorProps) {
  const [draft, setDraft] = useState(endpoint);
  const toggleEvent = (event: WebhookEvent, isOn: boolean) =>
    setDraft({
      ...draft,
      events: WEBHOOK_EVENTS.filter((item) => (item === event ? isOn : draft.events.includes(item))),
    });
  const issue = endpointIssue(draft);
  return (
    <div className="slot-card">
      <TextInput
        label="名称"
        value={draft.name}
        maxLength={WEBHOOK_LIMITS.nameLength}
        placeholder="例如 ERP"
        onChange={(name) => setDraft({ ...draft, name })}
      />
      <TextInput
        label="地址"
        value={draft.url}
        maxLength={WEBHOOK_LIMITS.urlLength}
        placeholder="https://erp.example.com/hooks/labels"
        onChange={(url) => setDraft({ ...draft, url: url.trim() })}
      />
      <SelectField
        label="签名密钥"
        value={draft.secretName ?? NO_SIGNATURE}
        options={[
          { value: NO_SIGNATURE, label: '不签名' },
          ...secretNames.map((name) => ({ value: name, label: name })),
          ...(draft.secretName && !secretNames.includes(draft.secretName)
            ? [{ value: draft.secretName, label: `${draft.secretName}（本机没有这个密钥）` }]
            : []),
        ]}
        onChange={(value) => setDraft({ ...draft, secretName: value === NO_SIGNATURE ? null : value })}
      />
      <p className="form-hint">签名密钥在「识别规则」页下方的「密钥」里添加，和接收方约定同一个值。</p>
      {WEBHOOK_EVENTS.map((event) => (
        <Toggle
          key={event}
          label={EVENT_LABELS[event]}
          checked={draft.events.includes(event)}
          onChange={(isOn) => toggleEvent(event, isOn)}
        />
      ))}
      <Toggle label="启用" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
      {issue && <p className="form-hint form-hint--error">{issue}</p>}
      <div className="slot-card__actions">
        <button type="button" className="button button--small button--quiet" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="button button--small button--primary"
          disabled={issue !== null}
          onClick={() => onSave({ ...draft, name: draft.name.trim() })}
        >
          保存
        </button>
      </div>
    </div>
  );
}

interface DeliveryLogProps {
  deliveries: readonly Delivery[];
  endpointName: (id: string) => string;
  onRetry: (id: number) => void;
  onRefresh: () => void;
}

function DeliveryLog({ deliveries, endpointName, onRetry, onRefresh }: DeliveryLogProps) {
  return (
    <div className="delivery-log">
      <div className="delivery-log__head">
        <strong>最近的发送记录</strong>
        <button type="button" className="button button--small button--quiet" onClick={onRefresh}>
          刷新
        </button>
      </div>
      {deliveries.length === 0 ? (
        <p className="form-hint">还没有发送记录。</p>
      ) : (
        <ul className="plain-list">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="plain-list__item">
              <div className="plain-list__text">
                <span>
                  <span className={`delivery-state delivery-state--${delivery.state}`}>
                    {STATE_LABELS[delivery.state]}
                  </span>{' '}
                  {EVENT_LABELS[delivery.event]} → {endpointName(delivery.endpointId)}
                </span>
                <span className="plain-list__meta">{deliveryDetail(delivery)}</span>
              </div>
              {delivery.state !== 'delivered' && (
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() => onRetry(delivery.id)}
                >
                  立即重试
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function endpointIssue(endpoint: WebhookEndpoint): string | null {
  if (endpoint.name.trim() === '') {
    return '请填写名称';
  }
  return isWebhookUrl(endpoint.url) ? null : '地址要以 http:// 或 https:// 开头';
}

function deliveryDetail(delivery: Delivery): string {
  const parts = [formatDateTime(delivery.createdAt), `尝试 ${delivery.attempts} 次`];
  if (delivery.lastError) {
    parts.push(delivery.lastError);
  }
  if (delivery.state === 'pending' && delivery.attempts > 0 && delivery.nextAttemptAt !== null) {
    parts.push(`下次 ${formatDateTime(delivery.nextAttemptAt)}`);
  }
  return parts.join(' · ');
}
